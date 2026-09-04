"""Domain services for notification creation and delivery orchestration."""

import json
import re
import uuid
from hmac import compare_digest
from urllib.parse import urlparse

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.concerns.models import Announcement, Concern
from apps.concerns.notification_subject import build_notification_subject


def _notification_title(concern: Concern) -> str:
    return concern.title or "Untitled Report"


def _notification_body(concern: Concern, status: str) -> str:
    status_events = list(concern.status_events.filter(status=status).order_by("-created_at")[:1])
    if status_events and status_events[0].note:
        return status_events[0].note
    return f"Your report status has been updated to {status}."


def _deliver_notification_after_commit(notification) -> None:
    """Queue WebSocket + push delivery in a worker, never on the request thread.

    Browser-push fan-out blocks up to 15 s per subscription. When the broker is
    unreachable, local development (no worker running) still delivers inline;
    production leaves the row for the recipient's poll fallback and logs it.
    """
    from .tasks import deliver_notification_task

    def _deliver():
        # Local development commonly runs the API and the slow ``heavy``
        # worker without a worker for the default ``eboses`` queue. Redis will
        # still accept ``delay()``, so the old exception fallback never ran and
        # browser pushes remained queued indefinitely. Deliver immediately in
        # local runtime so subscribed browsers receive notifications even when
        # every E-Boses tab is closed. Tests keep exercising the queued path.
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False) and not getattr(
            settings, "IS_TEST_RUN", False
        ):
            deliver_notification_task.run(notification.pk)
            return
        try:
            deliver_notification_task.delay(notification.pk)
        except Exception as exc:
            if getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
                deliver_notification_task.run(notification.pk)
            else:
                import logging

                logging.getLogger(__name__).error(
                    "Broker unavailable; notification #%s delivery deferred (%s).",
                    notification.pk,
                    exc.__class__.__name__,
                )

    transaction.on_commit(_deliver)


def _report_updates_enabled(concern: Concern) -> bool:
    settings_obj = getattr(concern.reporter, "resident_settings", None)
    return settings_obj is None or settings_obj.report_updates


def _push_alerts_enabled(user) -> bool:
    settings_obj = getattr(user, "resident_settings", None)
    return settings_obj is None or settings_obj.push_alerts


def web_push_config_health() -> dict:
    public_key = _clean_text(getattr(settings, "WEB_PUSH_PUBLIC_KEY", ""))
    private_key = _clean_text(getattr(settings, "WEB_PUSH_PRIVATE_KEY", ""))
    subject = _clean_text(getattr(settings, "WEB_PUSH_SUBJECT", ""))
    result = {
        "configured": bool(public_key and private_key),
        "public_key_present": bool(public_key),
        "private_key_present": bool(private_key),
        "subject_present": bool(subject),
        "subject_valid": bool(subject.startswith("mailto:") or subject.startswith("https://")),
        "key_pair_valid": None,
        "public_key_length": len(public_key),
        "public_key_decoded_length": None,
        "public_key_first_byte": None,
        "public_key_format_valid": None,
        "error": "",
    }
    if not public_key or not private_key:
        return result
    try:
        from base64 import urlsafe_b64decode
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        from py_vapid import Vapid
        from py_vapid.utils import b64urlencode

        decoded_public = urlsafe_b64decode(public_key + "=" * ((4 - len(public_key) % 4) % 4))
        result["public_key_decoded_length"] = len(decoded_public)
        result["public_key_first_byte"] = decoded_public[0] if decoded_public else None
        result["public_key_format_valid"] = len(decoded_public) == 65 and bool(decoded_public) and decoded_public[0] == 4
        vapid = Vapid.from_string(private_key)
        derived_public = b64urlencode(
            vapid.public_key.public_bytes(
                encoding=Encoding.X962,
                format=PublicFormat.UncompressedPoint,
            )
        ).rstrip("=")
        configured_public = public_key.rstrip("=")
        result["key_pair_valid"] = compare_digest(derived_public, configured_public)
    except Exception as exc:
        result["key_pair_valid"] = False
        result["error"] = f"{exc.__class__.__name__}: {_truncate(str(exc), 160)}"
    return result


def _clean_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _truncate(value, limit: int = 180) -> str:
    text = _clean_text(value)
    if len(text) <= limit:
        return text
    slice_ = text[:limit]
    at_word = slice_.rsplit(" ", 1)[0].strip()
    return f"{at_word if len(at_word) >= 32 else slice_.strip()}..."


def _choice_label(obj, field: str, fallback: str = "") -> str:
    method = getattr(obj, f"get_{field}_display", None)
    if callable(method):
        try:
            value = method()
            if value:
                return str(value)
        except Exception:
            pass
    raw = getattr(obj, field, fallback)
    return str(raw or fallback).replace("_", " ").title()


def _safe_metadata(notification) -> dict:
    metadata = getattr(notification, "metadata", None)
    return metadata if isinstance(metadata, dict) else {}


def _safe_url(value: str | None) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    if text.startswith("/") or text.startswith("http://") or text.startswith("https://"):
        return text
    return ""


def _concern_tracking_id(concern) -> str:
    return _clean_text(getattr(concern, "tracking_id", "")) or f"Report #{getattr(concern, 'pk', '')}".strip()


def _community_payload(community) -> dict | None:
    if not community:
        return None
    return {
        "id": getattr(community, "pk", None),
        "name": _clean_text(getattr(community, "name", "")) or "Community",
        "code": _clean_text(getattr(community, "code", "")) or None,
    }


def _department_payload(department) -> dict | None:
    if not department:
        return None
    return {
        "id": getattr(department, "pk", None),
        "name": _clean_text(getattr(department, "name", "")) or "Assigned unit",
        "short_name": _clean_text(getattr(department, "short_name", "")) or None,
        "code": _clean_text(getattr(department, "code", "")) or None,
    }


def _user_display_name(user) -> str:
    profile = getattr(user, "resident_profile", None)
    first_name = _clean_text(getattr(profile, "first_name", "")) or _clean_text(getattr(user, "first_name", ""))
    last_name = _clean_text(getattr(profile, "last_name", "")) or _clean_text(getattr(user, "last_name", ""))
    return _clean_text(f"{first_name} {last_name}") or _clean_text(getattr(user, "email", ""))


def _recipient_last_name(notification) -> str:
    recipient = getattr(notification, "recipient", None)
    profile = getattr(recipient, "resident_profile", None)
    return (
        _clean_text(getattr(profile, "last_name", ""))
        or _clean_text(getattr(recipient, "last_name", ""))
    )


def _greeting(notification) -> str:
    sent_at = getattr(notification, "created_at", None) or timezone.now()
    local_time = timezone.localtime(sent_at)
    if local_time.hour < 12:
        salutation = "Good morning"
    elif local_time.hour < 18:
        salutation = "Good afternoon"
    else:
        salutation = "Good evening"
    last_name = _recipient_last_name(notification)
    return f"{salutation}, {last_name}." if last_name else f"{salutation}."


def _with_greeting(notification, body: str) -> str:
    cleaned = _clean_text(body) or "Open E-Boses for more details."
    if cleaned.lower().startswith(("good morning", "good afternoon", "good evening")):
        return _truncate(cleaned, 190)
    return _truncate(f"{_greeting(notification)} {cleaned}", 190)


def _active_concern_assignment(concern):
    assignments = getattr(concern, "assignments", None)
    if assignments is None:
        return None
    prefetched = getattr(concern, "_prefetched_objects_cache", {}).get("assignments")
    if prefetched is not None:
        active = [item for item in prefetched if item.status == "active"]
        if active:
            return max(active, key=lambda item: (item.created_at, item.pk))
        return max(prefetched, key=lambda item: (item.created_at, item.pk), default=None)
    assignment = (
        assignments.select_related("department", "assignee", "assignee__resident_profile")
        .filter(status="active")
        .order_by("-created_at", "-id")
        .first()
    )
    return assignment or assignments.select_related(
        "department", "assignee", "assignee__resident_profile"
    ).order_by("-created_at", "-id").first()


def _active_emergency_assignment(alert, recipient=None):
    assignments = getattr(alert, "assignments", None)
    if assignments is None:
        return None
    active_statuses = ["assigned", "acknowledged", "en_route", "arrived", "assisting", "escalated"]
    prefetched = getattr(alert, "_prefetched_objects_cache", {}).get("assignments")
    if prefetched is not None:
        active = [item for item in prefetched if item.status in active_statuses]
        if recipient is not None:
            own = [item for item in active if item.responder_id == recipient.pk]
            if own:
                return max(own, key=lambda item: (item.assigned_at, item.pk))
        if active:
            return max(active, key=lambda item: (item.assigned_at, item.pk))
        own = [item for item in prefetched if recipient is not None and item.responder_id == recipient.pk]
        return max(own or prefetched, key=lambda item: (item.assigned_at, item.pk), default=None)
    queryset = assignments.select_related(
        "role_map__department",
        "responding_community",
        "responder",
        "responder__resident_profile",
    ).filter(status__in=active_statuses)
    if recipient is not None:
        own = queryset.filter(responder=recipient).order_by("-assigned_at", "-id").first()
        if own:
            return own
    assignment = queryset.order_by("-assigned_at", "-id").first()
    if assignment:
        return assignment
    latest = assignments.select_related(
        "role_map__department",
        "responding_community",
        "responder",
        "responder__resident_profile",
    )
    if recipient is not None:
        latest = latest.filter(responder=recipient)
    return latest.order_by("-assigned_at", "-id").first()


def _mapped_emergency_department(alert):
    try:
        from apps.emergencies.models import EmergencyTypeRoleMap

        role_map = (
            EmergencyTypeRoleMap.objects.select_related("department", "community")
            .filter(
                community_id=getattr(alert, "community_id", None),
                emergency_type=getattr(alert, "type", ""),
                is_active=True,
            )
            .order_by("-priority", "id")
            .first()
        )
        return getattr(role_map, "department", None)
    except Exception:
        return None


def notification_context(notification) -> dict:
    cached = getattr(notification, "_notification_context", None)
    if cached is not None:
        return cached

    concern = getattr(notification, "concern", None)
    alert = getattr(notification, "emergency", None)
    recipient = getattr(notification, "recipient", None)
    role = getattr(recipient, "role", "")
    resident_role = getattr(getattr(recipient, "Role", None), "RESIDENT", "resident")
    witness = notification.type == "witness_alert"
    context = {
        "community": _community_payload(
            getattr(notification, "community", None)
            or getattr(concern, "community", None)
            or getattr(alert, "community", None)
        ),
        "department": _department_payload(getattr(notification, "department", None)),
        "reference": None,
        "subject": None,
        "status": None,
        "location": None,
        "response": None,
    }

    if concern is not None:
        assignment = _active_concern_assignment(concern)
        department = (
            getattr(notification, "department", None)
            or getattr(assignment, "department", None)
            or getattr(concern, "assigned_department", None)
        )
        context.update(
            {
                "department": _department_payload(department),
                "reference": _concern_tracking_id(concern),
                "subject": build_notification_subject(
                    getattr(concern, "notification_subject", ""),
                    title=getattr(concern, "title", ""),
                    description=getattr(concern, "description", ""),
                    category=getattr(concern, "category", ""),
                ),
                "status": _choice_label(concern, "status", notification.type),
                "location": {
                    "barangay": _clean_text(getattr(concern, "barangay", "")) or None,
                    "address": _clean_text(getattr(concern, "address", "")) or None,
                    "confidence": _clean_text(getattr(concern, "location_confidence", "")) or None,
                },
                "response": {
                    "assignment_status": _choice_label(assignment, "status", "") if assignment else None,
                    "assigned_unit": _department_payload(department),
                    "responding_community": None,
                    "is_cross_community": False,
                }
                if department or assignment
                else None,
            }
        )
        if assignment and role != resident_role:
            context["response"]["assignee_name"] = _user_display_name(getattr(assignment, "assignee", None))

    elif alert is not None:
        assignment = _active_emergency_assignment(alert, recipient=recipient)
        role_map = getattr(assignment, "role_map", None)
        department = None if witness else (
            getattr(notification, "department", None)
            or getattr(role_map, "department", None)
            or _mapped_emergency_department(alert)
        )
        origin_community = getattr(alert, "community", None) or getattr(notification, "community", None)
        responding_community = getattr(assignment, "responding_community", None)
        if assignment and not responding_community:
            responding_community = getattr(role_map, "community", None)
        is_cross_community = bool(
            getattr(assignment, "is_cross_community", False)
            or (
                origin_community
                and responding_community
                and origin_community.pk != responding_community.pk
            )
        )
        context.update(
            {
                # Internal database ids still travel in the action payload and
                # URL, but they are not useful incident details for people.
                "reference": None,
                "subject": _choice_label(alert, "type", "Emergency"),
                "status": _choice_label(alert, "status", notification.type),
                "location": None
                if witness
                else {
                    "barangay": _clean_text(getattr(alert, "barangay", "")) or None,
                    "address": (
                        _clean_text(getattr(alert, "resolved_location", ""))
                        or _clean_text(getattr(alert, "reported_area", ""))
                        or _clean_text(getattr(alert, "address", ""))
                        or None
                    ),
                    "confidence": _clean_text(getattr(alert, "location_confidence", "")) or None,
                },
                "department": _department_payload(department),
                "response": None
                if witness
                else {
                    "assignment_status": _choice_label(assignment, "status", "") if assignment else None,
                    "assigned_unit": _department_payload(department),
                    "responding_community": _community_payload(responding_community),
                    "is_cross_community": is_cross_community,
                },
            }
        )
        if assignment and role != resident_role and not witness:
            context["response"]["assignee_name"] = _user_display_name(getattr(assignment, "responder", None))

    setattr(notification, "_notification_context", context)
    return context


def notification_category(notification) -> str:
    type_value = notification.type or ""
    if type_value == "announcement":
        return "announcement"
    # Emergency chat belongs to the conversation stream. It may be attached
    # to an emergency record, but it is not itself a critical alert.
    if type_value == "chat_message":
        return "chat"
    if type_value == "witness_alert" or type_value.startswith("emergency"):
        return "emergency"
    if "appeal" in type_value:
        return "appeal"
    if type_value in {
        "clarification_requested",
        "clarification_replied",
        "concern_comment",
        "concern_mention",
        "chat_message",
    }:
        return "chat"
    return "report"


def notification_priority(notification) -> str:
    metadata = _safe_metadata(notification)
    urgency = _clean_text(metadata.get("urgency")).lower()
    if urgency in {"urgent", "important", "normal"}:
        return "urgent" if urgency == "urgent" else "important" if urgency == "important" else "normal"
    type_value = notification.type or ""
    if type_value == "witness_alert" or type_value in {
        "emergency_submitted",
        "emergency_routed",
        "emergency_en_route",
        "emergency_nearby",
        "emergency_arrived",
        "emergency_escalated",
    }:
        return "urgent"
    if "appeal" in type_value or type_value in {"clarification_requested", "clarification_replied", "assigned"}:
        return "important"
    return "normal"


def notification_icon_url(notification) -> str:
    # Keep browser notification artwork on the reviewed Lucide-derived icon
    # catalog. Legacy metadata may contain the old app logo, so it must not
    # override the purpose-specific notification icon.
    if notification.type == "announcement":
        return "/icons/notification-announcement.svg"
    if notification.type == "witness_alert":
        return "/icons/notification-critical.svg"
    if notification.type == "chat_message":
        return "/icons/notification-chat.svg"
    if notification.type == "emergency_updated":
        return "/icons/notification-info.svg"
    if "appeal" in (notification.type or ""):
        return "/icons/notification-appeal.svg"
    if notification.type in {"flag_dismissed", "post_taken_down", "comment_taken_down"}:
        return "/icons/notification-moderation.svg"
    if notification.type == "submitted":
        return "/icons/notification-report.svg"
    if notification.type == "under_review":
        return "/icons/notification-review.svg"
    if notification.type == "assigned":
        return "/icons/notification-assigned.svg"
    if notification.type == "in_progress":
        return "/icons/notification-progress.svg"
    if notification.type == "resolved":
        return "/icons/notification-resolved.svg"
    if notification.type == "rejected":
        return "/icons/notification-decision.svg"
    if notification.type == "witness_alert" or notification.type.startswith("emergency"):
        alert = getattr(notification, "emergency", None)
        emergency_type = getattr(alert, "type", "")
        return {
            "medical": "/icons/notification-medical.svg",
            "fire": "/icons/notification-fire.svg",
            "crime": "/icons/notification-crime.svg",
            "disaster": "/icons/notification-disaster.svg",
            "other": "/icons/notification-emergency.svg",
        }.get(emergency_type, "/icons/notification-emergency.svg")
    if notification.type in {
        "concern_comment",
        "concern_mention",
        "clarification_requested",
        "clarification_replied",
        "chat_message",
    }:
        return "/icons/notification-chat.svg"
    concern = getattr(notification, "concern", None)
    category = getattr(concern, "category", "")
    return {
        "infrastructure": "/icons/notification-infrastructure.svg",
        "environment": "/icons/notification-environment.svg",
        "public_safety": "/icons/notification-safety.svg",
        "others": "/icons/notification-report.svg",
    }.get(category, "/icons/notification-system.svg")


def notification_badge_url(notification) -> str:
    # Badges are monochrome system glyphs; keep them consistent across every
    # notification and prevent legacy custom artwork from leaking into pushes.
    return "/icons/notification-badge.svg"


def notification_image_url(notification) -> str:
    # Nearby witnesses receive safety guidance only. Never attach incident
    # media, even when a public preview exists for authorized participants.
    if notification.type == "witness_alert":
        return ""
    metadata = _safe_metadata(notification)
    # Announcements store a publish-time URL snapshot. Resolving the live
    # announcement is more reliable: it stays correct if the image was added
    # or replaced after the notification was sent.
    announcement_id = metadata.get("announcement_id")
    if announcement_id:
        try:
            announcement = Announcement.objects.get(pk=announcement_id)
        except (Announcement.DoesNotExist, TypeError, ValueError):
            announcement = None
        if announcement is not None and announcement.image:
            return _safe_url(announcement.image.url)
    # Only use public images in browser notifications. Private report/emergency
    # media still opens safely inside the authenticated app after tap.
    image_url = _safe_url(metadata.get("image_url"))
    if image_url:
        return image_url

    # Notifications may point to a concern/emergency without copying media
    # into metadata. Use only the processed public preview, never the original.
    media = None
    if getattr(notification, "concern_id", None):
        media = next(
            (
                item
                for item in notification.concern.media.all()
                if item.public_visible and bool(item.preview_file)
            ),
            None,
        )
    elif getattr(notification, "emergency_id", None):
        media = next(
            (item for item in notification.emergency.media.all() if bool(item.preview_file)),
            None,
        )
    return _safe_url(media.preview_file.url if media and media.preview_file else "")


def notification_tag(notification) -> str:
    metadata = _safe_metadata(notification)
    tag = _clean_text(metadata.get("tag_key") or metadata.get("tag"))
    if tag:
        base = f"eboses-{tag.lower().replace(' ', '-')[:48]}"
        return f"{base}-{notification.pk}"
    if notification.emergency_id and notification.type != "witness_alert":
        return f"eboses-emergency-{notification.emergency_id}-{notification.pk}"
    if notification.concern_id:
        return f"eboses-concern-{notification.concern_id}-{notification.pk}"
    return f"eboses-{notification.type or 'notification'}-{notification.pk}"


def _display_concern_notification(notification) -> tuple[str, str]:
    concern = notification.concern
    type_value = notification.type or ""
    role = getattr(notification.recipient, "role", "")
    context = notification_context(notification)
    tracking = context.get("reference") or _concern_tracking_id(concern)
    concern_title = context.get("subject") or "Community report"
    community = (context.get("community") or {}).get("name") or "your community"
    department = context.get("department") or {}
    unit = department.get("name") or department.get("short_name") or "the assigned unit"
    note = _clean_text(notification.body or getattr(concern, "update_text", ""))
    status_label = context.get("status") or _choice_label(concern, "status", type_value)
    resident_role = getattr(getattr(notification.recipient, "Role", None), "RESIDENT", "resident")
    responder_role = getattr(getattr(notification.recipient, "Role", None), "FIRST_RESPONDER", "first_responder")
    official_role = getattr(getattr(notification.recipient, "Role", None), "BARANGAY_OFFICIAL", "barangay_official")
    reference = tracking or "this report"

    if type_value == "submitted":
        title = f"Report received · {reference}"
        body = f'Your report “{concern_title}” was received in {community}. We will keep you updated.'
    elif type_value == "under_review":
        title = f"Report under review · {reference}"
        body = f'“{concern_title}” is being reviewed by the barangay team in {community}.'
    elif type_value == "assigned":
        title = f"Report assigned · {unit}"
        if role == responder_role:
            title = f"New field assignment · {reference}"
            body = f'“{concern_title}” is assigned to your unit in {community}.'
        elif role == official_role:
            body = f'“{concern_title}” was assigned to {unit} for action in {community}.'
        else:
            body = f'Your report “{concern_title}” was assigned to {unit} in {community}.'
    elif type_value == "in_progress":
        title = f"Work started · {reference}"
        body = f'“{concern_title}” is now in progress with {unit}.'
    elif type_value == "resolved":
        title = f"Report resolved · {reference}"
        body = f'“{concern_title}” was marked resolved by {unit}.'
    elif type_value == "rejected":
        title = f"Report decision recorded · {reference}"
        body = f'“{concern_title}” was not accepted for action in {community}.'
    elif type_value == "clarification_requested":
        title = f"Clarification needed · {reference}"
        body = f'The barangay team needs more information about “{concern_title}”.'
    elif type_value == "clarification_replied":
        title = f"Clarification received · {reference}"
        body = f'A resident replied to the clarification request for “{concern_title}”.'
    elif type_value == "appeal_submitted":
        title = f"Report appeal submitted · {reference}"
        body = f'An appeal was submitted for “{concern_title}” in {community}.'
    elif type_value in {"appeal_approved", "appeal_denied"}:
        decision = "approved" if type_value.endswith("approved") else "denied"
        title = f"Report appeal {decision} · {reference}"
        body = f'The appeal for “{concern_title}” was {decision}.'
    elif type_value == "concern_comment":
        title = f"New report discussion · {reference}"
        body = f'New community discussion was added to “{concern_title}”.'
    elif type_value == "concern_mention":
        title = f"You were mentioned · {reference}"
        body = f'You were mentioned in the discussion for “{concern_title}”.'
    elif type_value == "chat_message":
        title = f"New report message · {reference}"
        body = f'A new message is available for “{concern_title}”.'
    elif type_value == "flag_dismissed":
        title = f"Report review completed · {reference}"
        body = f'The content report for “{concern_title}” was reviewed and remains available.'
    elif type_value == "post_taken_down":
        title = f"Report content removed · {reference}"
        body = f'Content connected to “{concern_title}” was removed after review.'
    elif type_value == "comment_taken_down":
        title = f"Report comment removed · {reference}"
        body = f'A comment on “{concern_title}” was removed after review.'
    else:
        title = f"Report update · {reference}"
        body = f'“{concern_title}” has a new update. Status: {status_label}.'

    if note and note.lower() not in body.lower():
        body = f"{body} {note}"
    return _truncate(title, 90), _truncate(body, 190)


def _display_emergency_notification(notification) -> tuple[str, str]:
    alert = notification.emergency
    type_value = notification.type or ""
    role = getattr(notification.recipient, "role", "")
    context = notification_context(notification)
    emergency_type = context.get("subject") or _choice_label(alert, "type", "Emergency")
    status_label = context.get("status") or _choice_label(alert, "status", type_value)
    location = context.get("location") or {}
    barangay = location.get("barangay") or _clean_text(getattr(alert, "barangay", "")) or "the reported area"
    address = location.get("address") or _clean_text(getattr(alert, "address", "")) or barangay
    placeholders = {"community pending confirmation", "location needs confirmation", "unknown"}
    if address.casefold() in placeholders:
        address = barangay
    location_label = address
    if barangay.casefold() not in address.casefold() and barangay.casefold() not in placeholders:
        location_label = f"{address}, {barangay}"
    response = context.get("response") or {}
    department = context.get("department") or {}
    unit = department.get("short_name") or department.get("name") or "the response team"
    responding_community = (response.get("responding_community") or {}).get("name")
    cross_community = bool(response.get("is_cross_community"))
    note = _clean_text(notification.body)
    if type_value == "witness_alert":
        return (
            f"Nearby {emergency_type} emergency · {barangay}",
            _truncate(note or f"A {emergency_type.lower()} emergency was reported near {barangay}. Stay clear of the area and wait for official instructions.", 190),
        )

    responder_role = getattr(notification.recipient.Role, "FIRST_RESPONDER", "first_responder")
    official_role = getattr(notification.recipient.Role, "BARANGAY_OFFICIAL", "barangay_official")
    title_map = {
        "emergency_submitted": f"{emergency_type} emergency received · {location_label}",
        "emergency_routed": f"{emergency_type} emergency dispatched · {location_label}",
        "emergency_acknowledged": f"{emergency_type} response acknowledged · {location_label}",
        "emergency_en_route": f"{emergency_type} responder en route · {location_label}",
        "emergency_nearby": f"{emergency_type} responder nearby · {location_label}",
        "emergency_arrived": f"{emergency_type} response arrived · {location_label}",
        "emergency_resolved": f"{emergency_type} emergency resolved · {location_label}",
        "emergency_cancelled": f"{emergency_type} emergency cancelled · {location_label}",
        "emergency_escalated": f"Emergency escalation · {emergency_type} · {location_label}",
        "emergency_appeal_submitted": f"Emergency review requested · {location_label}",
        "emergency_appeal_approved": f"Emergency review approved · {location_label}",
        "emergency_appeal_denied": f"Emergency review denied · {location_label}",
        "emergency_updated": f"Emergency response update · {location_label}",
    }
    title = title_map.get(type_value) or f"{emergency_type} emergency update · {location_label}"
    if cross_community:
        title = f"Cross-community dispatch · {emergency_type} · {location_label}"
    if role == responder_role and type_value in {"emergency_routed", "emergency_escalated"}:
        title = f"Dispatch assignment · {emergency_type} · {location_label}"
    elif role == official_role and type_value == "emergency_escalated":
        title = f"Manual attention required · {emergency_type} · {location_label}"

    body = f"{emergency_type} emergency reported around {location_label}. Assigned unit: {unit}. Status: {status_label}."
    if responding_community and cross_community:
        body = f"{body} Responding from {responding_community}."
    if note and note.lower() not in body.lower():
        body = f"{body} {note}"
    return _truncate(title, 80), _truncate(body, 190)


def _display_announcement_notification(notification) -> tuple[str, str]:
    metadata = _safe_metadata(notification)
    urgency = _clean_text(metadata.get("urgency")).lower()
    tag = _clean_text(metadata.get("tag")) or "Barangay"
    title_prefix = "Urgent announcement" if urgency == "urgent" else "Important announcement" if urgency == "important" else f"{tag} announcement"
    title = notification.title if notification.title.lower().startswith(("urgent", "important", "barangay")) else f"{title_prefix} · {notification.title}"
    body = notification.body or "Open E-Boses for the announcement details."
    return _truncate(title, 90), _truncate(body, 190)


def notification_display(notification) -> tuple[str, str]:
    metadata = _safe_metadata(notification)
    custom_title = _clean_text(metadata.get("display_title"))
    custom_body = _clean_text(metadata.get("display_body"))
    if custom_title and custom_body:
        return _truncate(custom_title, 90), _with_greeting(notification, custom_body)
    if notification.type == "announcement":
        title, body = _display_announcement_notification(notification)
    elif notification.emergency_id and notification.type != "chat_message":
        title, body = _display_emergency_notification(notification)
    elif notification.concern_id:
        title, body = _display_concern_notification(notification)
    else:
        title = _truncate(custom_title or notification.title or f"E-Boses update · {notification.type or 'notification'}", 90)
        body = custom_body or notification.body or "Open E-Boses for more details."
    return title, _with_greeting(notification, body)


def notification_actions(notification) -> list[dict]:
    metadata = _safe_metadata(notification)
    custom_actions = metadata.get("actions")
    if isinstance(custom_actions, list):
        actions = []
        for item in custom_actions[:2]:
            if not isinstance(item, dict):
                continue
            action = _clean_text(item.get("action")) or "open"
            title = _clean_text(item.get("title")) or "Open"
            url = _safe_url(item.get("url")) or notification_url(notification)
            entry = {"action": action[:32], "title": title[:32], "url": url}
            icon = _safe_url(item.get("icon"))
            if icon:
                entry["icon"] = icon
            actions.append(entry)
        if actions:
            return actions
    url = notification_url(notification)
    if notification.type == "witness_alert":
        return [{"action": "open", "title": "Open E-Boses", "url": url}]
    if notification.type == "announcement":
        return [{"action": "open", "title": "View announcement", "url": url}]
    if notification.type == "chat_message" and notification.emergency_id:
        return [{"action": "open", "title": "Open emergency chat", "url": url}]
    if notification.emergency_id:
        label = "Open dispatch" if getattr(notification.recipient, "role", "") == getattr(notification.recipient.Role, "FIRST_RESPONDER", "first_responder") else "Track emergency"
        if getattr(notification.recipient, "role", "") == getattr(notification.recipient.Role, "BARANGAY_OFFICIAL", "barangay_official"):
            label = "Open alert map"
        return [{"action": "open", "title": label, "url": url}]
    if notification.concern_id:
        label = "Open report"
        if getattr(notification.recipient, "role", "") == getattr(notification.recipient.Role, "FIRST_RESPONDER", "first_responder"):
            label = "Open map"
        return [{"action": "open", "title": label, "url": url}]
    return [{"action": "open", "title": "Open", "url": url}]


def notification_display_payload(notification, serialized: dict | None = None) -> dict:
    """Build the compact payload sent through the browser push provider.

    Web Push providers cap the encrypted request at roughly 4 KiB. The REST
    serializer and context used to be embedded multiple times, which made an
    ordinary chat notification exceed that limit. The service worker only
    needs display fields, navigation URL, and record identifiers; it can fetch
    the full notification after the user opens E-Boses.
    """
    display_title, display_body = notification_display(notification)
    context = notification_context(notification)
    metadata = _safe_metadata(notification)
    priority = notification_priority(notification)
    url = _safe_url(metadata.get("action_url")) or notification_url(notification)
    payload = {
        "title": display_title,
        "body": display_body,
        "url": url,
        "tag": notification_tag(notification),
        "category": notification_category(notification),
        "priority": priority,
        "icon": notification_icon_url(notification),
        "badge": notification_badge_url(notification),
        "image": notification_image_url(notification),
        "actions": notification_actions(notification),
        "requireInteraction": priority == "urgent",
        # Every persisted notification must produce a visible system alert.
        # Reusing a concern/emergency tag with renotify disabled made browsers
        # silently replace an older notification, which looked like background
        # delivery had stopped when the app was closed.
        "renotify": True,
        "timestamp": (notification.created_at or timezone.now()).isoformat(),
        "context": context,
        "data": {
            "notification_id": notification.pk,
            "type": notification.type,
            "concern_id": notification.concern_id,
            "emergency_id": None if notification.type == "witness_alert" else notification.emergency_id,
        },
    }
    return payload


def browser_push_extra_headers(endpoint: str) -> dict:
    # Chromium on Android can defer normal-urgency Web Push until the browser
    # is foregrounded, especially while the device is idle. High urgency asks
    # FCM/Android to wake the service worker for a user-visible notification.
    headers = {"Urgency": "high"}
    host = (urlparse(endpoint).netloc or "").lower()
    if "notify.windows.com" in host:
        # Microsoft Edge/Windows Notification Service rejects encrypted Web
        # Push requests without a WNS type header on some Windows builds.
        headers["X-WNS-Type"] = "wns/raw"
    return headers


def browser_push_service_label(endpoint: str) -> str:
    host = (urlparse(endpoint).netloc or "").lower()
    if "notify.windows.com" in host:
        return "microsoft_wns"
    if "fcm.googleapis.com" in host or "googleapis.com" in host:
        return "google_fcm"
    if "push.services.mozilla.com" in host or "mozilla.com" in host:
        return "mozilla_autopush"
    return host or "unknown"


def _broadcast(group_name: str, event_type: str, payload: dict) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                "type": event_type,
                "payload": payload,
                "event_id": uuid.uuid4().hex,
                "emitted_at": timezone.now().isoformat(),
            },
        )
    except Exception:
        # WebSocket delivery is a live enhancement; REST responses and polling fallback must keep working.
        return


def broadcast_notification(notification) -> None:
    from .serializers import NotificationSerializer

    payload = NotificationSerializer(notification).data
    _broadcast(f"user_{notification.recipient_id}", "notification.created", payload)
    push_result = send_browser_push(notification, payload)
    if notification.type == "witness_alert" and notification.emergency_id:
        from apps.emergencies.models import WitnessNotification

        WitnessNotification.objects.filter(
            alert_id=notification.emergency_id,
            resident_id=notification.recipient_id,
        ).update(
            in_app_delivered_at=notification.created_at,
            push_status=push_result["status"],
            push_attempted_at=push_result["attempted_at"],
            push_delivered_at=push_result["delivered_at"],
            push_failure_count=push_result["failure_count"],
        )
    return push_result


def broadcast_concern_chat(concern_id, payload: dict) -> None:
    """Push a new report-chat message to everyone on that report's channel."""
    _broadcast(f"concern_{concern_id}", "concern.chat", payload)


def notification_url(notification) -> str:
    if notification.type == "witness_alert":
        return "/dashboard"
    if notification.type == "announcement":
        return "/dashboard/notifications?type=announcements"
    if notification.emergency_id:
        if notification.recipient.role == notification.recipient.Role.RESIDENT:
            source_concern = getattr(notification.emergency, "source_concern", None)
            if source_concern:
                return f"/dashboard/reports/{source_concern.public_id}"
            return "/dashboard/home"
        if notification.recipient.role == notification.recipient.Role.FIRST_RESPONDER:
            return f"/dashboard/responders/dispatch?alert={notification.emergency_id}"
        return f"/dashboard/alerts-map?alert={notification.emergency_id}"
    if notification.concern_id:
        if notification.recipient.role == notification.recipient.Role.FIRST_RESPONDER:
            return "/dashboard/responders/map"
        return f"/dashboard/reports/{notification.concern.public_id}"
    return "/dashboard"

def send_browser_push(notification, payload: dict | None = None) -> dict:
    result = {
        "status": "not_configured",
        "attempted_at": None,
        "delivered_at": None,
        "failure_count": 0,
        "failure_details": [],
        "config": web_push_config_health(),
        "push_services": [],
    }
    if not _push_alerts_enabled(notification.recipient):
        result["status"] = "disabled"
        return result
    if notification.concern_id and not _report_updates_enabled(notification.concern):
        result["status"] = "disabled"
        return result
    public_key = getattr(settings, "WEB_PUSH_PUBLIC_KEY", "")
    private_key = getattr(settings, "WEB_PUSH_PRIVATE_KEY", "")
    if not public_key or not private_key:
        return result
    subscriptions = list(notification.recipient.browser_push_subscriptions.filter(is_active=True))
    if not subscriptions:
        result["status"] = "not_subscribed"
        return result
    attempted_at = timezone.now()
    result["attempted_at"] = attempted_at
    try:
        from pywebpush import WebPushException, webpush
    except Exception as exc:
        result["status"] = "failed"
        result["failure_count"] = len(subscriptions)
        result["failure_details"].append(
            {
                "type": exc.__class__.__name__,
                "message": "pywebpush could not be imported.",
            }
        )
        return result

    payload = payload or {}
    data = json.dumps(notification_display_payload(notification, payload), default=str)
    claims = {"sub": getattr(settings, "WEB_PUSH_SUBJECT", "mailto:admin@example.com")}
    delivered_count = 0
    failure_count = 0
    for subscription in subscriptions:
        service_label = browser_push_service_label(subscription.endpoint)
        if service_label not in result["push_services"]:
            result["push_services"].append(service_label)
        try:
            push_args = {
                "subscription_info": {
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                "data": data,
                "vapid_private_key": private_key,
                "vapid_claims": claims,
                "headers": browser_push_extra_headers(subscription.endpoint),
                # Keep notifications available through a full day offline;
                # the unique notification tag prevents later pushes from
                # replacing earlier ones when the device reconnects.
                "ttl": 86400,
                "timeout": 15,
            }
            for attempt in range(2):
                try:
                    webpush(**push_args)
                    delivered_count += 1
                    break
                except WebPushException as exc:
                    response = getattr(exc, "response", None)
                    status_code = getattr(response, "status_code", None)
                    if attempt == 0 and status_code in {408, 425, 429, 500, 502, 503, 504}:
                        continue
                    raise
        except WebPushException as exc:
            failure_count += 1
            response = getattr(exc, "response", None)
            status_code = getattr(response, "status_code", None)
            reason = getattr(response, "reason", "") or ""
            detail = ""
            try:
                detail = (response.text or "")[:240] if response is not None else ""
            except Exception:
                detail = ""
            result["failure_details"].append(
                {
                    "type": "WebPushException",
                    "status_code": status_code,
                    "reason": reason,
                    "push_service": service_label,
                    "message": _truncate(detail or str(exc), 240),
                }
            )
            # 401/403 commonly mean this endpoint was subscribed with an old
            # VAPID key. It cannot recover through retries; make the browser
            # register a fresh subscription with the current key instead.
            if status_code in {401, 403, 404, 410}:
                subscription.is_active = False
                subscription.save(update_fields=["is_active", "updated_at"])
        except Exception as exc:
            failure_count += 1
            result["failure_details"].append(
                {
                    "type": exc.__class__.__name__,
                    "push_service": service_label,
                    "message": _truncate(str(exc), 240),
                }
            )
    result["failure_count"] = failure_count
    if delivered_count:
        result["delivered_at"] = timezone.now()
        result["status"] = "partial" if failure_count else "delivered"
    else:
        result["status"] = "failed"
    return result


def broadcast_live_map_event(message_type: str, payload: dict) -> None:
    resource = payload.get("concern") or payload.get("emergency") or {}
    community_id = resource.get("community_id")
    if not community_id and resource.get("id"):
        if message_type.startswith("concern."):
            from apps.concerns.models import Concern
            community_id = Concern.objects.filter(pk=resource["id"]).values_list("community_id", flat=True).first()
        elif message_type.startswith("emergency."):
            from apps.emergencies.models import EmergencyAlert
            community_id = EmergencyAlert.objects.filter(pk=resource["id"]).values_list("community_id", flat=True).first()
    department_ids = set()
    if resource.get("id") and message_type.startswith("concern."):
        from apps.concerns.models import Concern
        concern = Concern.objects.filter(pk=resource["id"]).select_related("category_ref").first()
        if concern:
            department_ids.update(filter(None, [concern.assigned_department_id, getattr(concern.category_ref, "department_id", None)]))
    elif resource.get("id") and message_type.startswith("emergency."):
        from apps.emergencies.models import EmergencyAlert, EmergencyTypeRoleMap
        alert = EmergencyAlert.objects.filter(pk=resource["id"]).first()
        if alert:
            department_ids.update(EmergencyTypeRoleMap.objects.filter(community=alert.community, emergency_type=alert.type, is_active=True).values_list("department_id", flat=True))
    event = {"type": message_type, "payload": payload}
    for department_id in filter(None, department_ids):
        _broadcast(f"official_live_map_department_{department_id}", "live_map.update", event)
    if community_id:
        _broadcast(f"official_live_map_community_{community_id}", "live_map.update", event)
    if message_type in {"concern.created", "concern.updated", "emergency.created", "emergency.updated"}:
        _broadcast_resident_map_event(message_type, payload)
    elif message_type == "location.updated":
        # Responder GPS is operationally private. It belongs on the incident
        # reporter's tracking channel, never on the community map stream.
        emergency_data = payload.get("emergency") or {}
        alert_id = emergency_data.get("id")
        if alert_id:
            _broadcast_reporter_emergency_map_event(alert_id)


def _resident_group_suffix(barangay: str | None) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", (barangay or "marikina-heights").strip().lower()).strip("-")
    return value or "marikina-heights"


def _resident_group_for_barangay(barangay: str | None) -> str:
    return f"resident_live_map_{_resident_group_suffix(barangay)}"


def _broadcast_resident_map_event(message_type: str, payload: dict) -> None:
    """Fan out only community-safe map events to matching barangay groups."""
    from apps.community_access import concern_is_public, emergency_is_public
    from apps.concerns.models import Concern
    from apps.emergencies.models import EmergencyAlert
    from apps.live_map import resident_concern_payload, resident_emergency_payload

    resource = payload.get("concern") or payload.get("emergency") or {}
    resource_id = resource.get("id")
    if not resource_id:
        return
    if message_type.startswith("concern."):
        concern = Concern.objects.filter(pk=resource_id).select_related("reporter", "reporter__resident_profile").first()
        if not concern:
            return
        event_payload = {"concern": resident_concern_payload(concern)} if concern_is_public(concern) else {"concern": {"id": concern.pk, "status": Concern.Status.REJECTED}, "removed": True}
        barangay = str(concern.community_id or concern.barangay)
    else:
        alert = EmergencyAlert.objects.filter(pk=resource_id).select_related("reporter", "reporter__resident_profile").first()
        if not alert:
            return
        event_payload = {"emergency": resident_emergency_payload(alert)} if emergency_is_public(alert) else {"emergency": {"id": alert.pk, "status": alert.status}, "removed": True}
        barangay = str(alert.community_id or alert.barangay)
    group = _resident_group_for_barangay(barangay)
    _broadcast(group, "resident_live_map.update", {"type": message_type, "payload": event_payload})
    _broadcast(
        "network_public_live_map",
        "network_public.update",
        {"type": message_type, "payload": event_payload},
    )


def _broadcast_reporter_emergency_map_event(alert_id: int) -> None:
    from apps.emergencies.models import EmergencyAlert
    from apps.live_map import resident_emergency_payload

    alert = EmergencyAlert.objects.filter(pk=alert_id).select_related("reporter", "reporter__resident_profile").first()
    if not alert:
        return
    from types import SimpleNamespace

    request = SimpleNamespace(user=alert.reporter)
    payload = {"emergency": resident_emergency_payload(alert, request=request)}
    _broadcast(f"resident_emergency_{alert.reporter_id}", "resident_live_map.update", {"type": "emergency.updated", "payload": payload})


def broadcast_emergency_update(alert) -> None:
    from apps.emergencies.serializers import EmergencyAlertSerializer
    from apps.live_map import emergency_payload, routes_for_alert

    payload = EmergencyAlertSerializer(alert).data
    _broadcast(f"emergency_{alert.pk}", "emergency.update", payload)
    routes = routes_for_alert(alert)
    broadcast_live_map_event("emergency.updated", {
        "emergency": emergency_payload(alert),
        "route": routes[0] if routes else None,
        "routes": routes,
    })


def broadcast_emergency_chat_message(message) -> None:
    """Push a chat message to everyone watching this emergency room."""
    from apps.emergencies.serializers import EmergencyChatMessageSerializer

    payload = EmergencyChatMessageSerializer(message).data
    _broadcast(f"emergency_{message.alert_id}", "emergency.chat", payload)


@transaction.atomic
def create_user_notification(
    *,
    recipient,
    type: str,
    title: str,
    body: str = "",
    concern: Concern | None = None,
    community=None,
    department=None,
    metadata: dict | None = None,
    event_key: str = "",
) -> object | None:
    """Create a notification for a specific user.

    View layers call this service so they do not need to import notification
    models directly across app boundaries.
    """
    from .models import Notification

    notification = Notification.objects.create(
        recipient=recipient,
        concern=concern,
        type=type,
        title=title,
        body=body,
        metadata=metadata or {},
        community=community or getattr(concern, "community", None),
        department=department or getattr(concern, "assigned_department", None),
        event_key=event_key,
    )
    _deliver_notification_after_commit(notification)
    return notification


@transaction.atomic
def create_notification(*, concern: Concern, type: str) -> object | None:
    """Create a notification for the report's reporter."""
    return create_user_notification(
        recipient=concern.reporter,
        concern=concern,
        type=type,
        title=_notification_title(concern),
        body=_notification_body(concern, type),
    )


@transaction.atomic
def create_emergency_notification(
    *,
    alert,
    type: str,
    recipient=None,
    title: str = "",
    body: str = "",
    department=None,
    assignment=None,
    metadata: dict | None = None,
    event_key: str = "",
) -> object | None:
    """Create a notification for an emergency participant."""
    from .models import Notification

    recipient = recipient or alert.reporter
    assignment = assignment or _active_emergency_assignment(alert, recipient=recipient)
    role_map = getattr(assignment, "role_map", None)
    department = department or getattr(role_map, "department", None) or _mapped_emergency_department(alert)
    notification = Notification.objects.create(
        recipient=recipient,
        emergency=alert,
        type=type,
        title=title or f"Emergency alert #{alert.pk}",
        body=body or f"Emergency status updated to {alert.status.replace('_', ' ')}.",
        metadata=metadata or {},
        community=alert.community,
        department=department,
        event_key=event_key,
    )
    _deliver_notification_after_commit(notification)
    return notification


def notify_emergency_status(alert, *, type: str, body: str = "") -> None:
    from .models import Notification

    type_map = {
        "submitted": Notification.Type.EMERGENCY_SUBMITTED,
        "routed": Notification.Type.EMERGENCY_ROUTED,
        "acknowledged": Notification.Type.EMERGENCY_ACKNOWLEDGED,
        "en_route": Notification.Type.EMERGENCY_EN_ROUTE,
        "nearby": Notification.Type.EMERGENCY_NEARBY,
        "arrived": Notification.Type.EMERGENCY_ARRIVED,
        "resolved": Notification.Type.EMERGENCY_RESOLVED,
        "cancelled": Notification.Type.EMERGENCY_CANCELLED,
    }
    notification_type = type_map.get(type)
    if notification_type:
        # Status events are persisted immediately before this hook in the
        # emergency state machine.  Use their id as an idempotency key so a
        # retry (or websocket reconnect) cannot create duplicate pushes.
        event = (
            alert.status_events.filter(status=type)
            .order_by("-created_at", "-id")
            .first()
        )
        event_key = (
            f"emergency:{alert.pk}:status:{event.pk}:recipient:{alert.reporter_id}"
            if event
            else ""
        )
        if not event_key or not Notification.objects.filter(
            recipient_id=alert.reporter_id, event_key=event_key
        ).exists():
            create_emergency_notification(
                alert=alert,
                type=notification_type,
                body=body,
                event_key=event_key,
            )
    broadcast_emergency_update(alert)


def replay_emergency_notifications(alert, *, recipient_ids=None) -> dict:
    """Backfill and deliver push/in-app notifications for an alert's history.

    Notifications are normally emitted when each status transition happens.
    This helper is intentionally idempotent so an official can repair a
    historical alert (or a deployment where the worker was offline) without
    sending duplicate pushes.  The event id is part of the unique key.
    """
    from django.contrib.auth import get_user_model
    from .models import Notification

    type_map = {
        "submitted": Notification.Type.EMERGENCY_SUBMITTED,
        "routed": Notification.Type.EMERGENCY_ROUTED,
        "acknowledged": Notification.Type.EMERGENCY_ACKNOWLEDGED,
        "en_route": Notification.Type.EMERGENCY_EN_ROUTE,
        "nearby": Notification.Type.EMERGENCY_NEARBY,
        "arrived": Notification.Type.EMERGENCY_ARRIVED,
        "resolved": Notification.Type.EMERGENCY_RESOLVED,
        "cancelled": Notification.Type.EMERGENCY_CANCELLED,
        "escalation_required": Notification.Type.EMERGENCY_ESCALATED,
    }
    events = list(alert.status_events.select_related("actor").order_by("created_at", "id"))
    assignment_rows = list(
        alert.assignments.select_related("responder").order_by("assigned_at", "id")
    )
    user_model = get_user_model()
    allowed = set(recipient_ids or [])
    recipients = {alert.reporter_id}
    for assignment in assignment_rows:
        recipients.add(assignment.responder_id)
    for event in events:
        if event.actor_id:
            recipients.add(event.actor_id)
    if allowed:
        recipients &= allowed
    users = {
        user.pk: user
        for user in user_model.objects.filter(pk__in=recipients, is_active=True)
    }
    created = 0
    queued = 0
    skipped = 0
    for event in events:
        notification_type = type_map.get(event.status)
        if not notification_type:
            continue
        event_recipients = set(users)
        # An event only goes to participants who were already involved at the
        # time it happened, preventing a newly added responder from receiving
        # an unrelated old alert history.
        event_recipients = {
            user_id
            for user_id in event_recipients
            if user_id == alert.reporter_id
            or user_id == event.actor_id
            or any(
                assignment.responder_id == user_id
                and assignment.assigned_at <= event.created_at
                for assignment in assignment_rows
            )
        }
        for user_id in event_recipients:
            recipient = users[user_id]
            event_key = f"emergency:{alert.pk}:status:{event.pk}:recipient:{recipient.pk}"
            if Notification.objects.filter(recipient=recipient, event_key=event_key).exists():
                skipped += 1
                continue
            assignment = next(
                (
                    item
                    for item in assignment_rows
                    if item.responder_id == recipient.pk and item.assigned_at <= event.created_at
                ),
                None,
            )
            notification = create_emergency_notification(
                alert=alert,
                recipient=recipient,
                type=notification_type,
                title=event.label or f"Emergency {event.status.replace('_', ' ')}",
                body=event.note or f"Emergency status updated to {event.status.replace('_', ' ')}.",
                assignment=assignment,
                metadata={"replayed": True, "status_event_id": event.pk},
                event_key=event_key,
            )
            if notification:
                created += 1
                queued += 1
    return {"events": len(events), "created": created, "queued": queued, "skipped": skipped}


def notify_flag_review_dismissed(*, flag_reporter, concern: Concern, staff_note: str) -> None:
    from .models import Notification

    create_user_notification(
        recipient=flag_reporter,
        concern=concern,
        type=Notification.Type.FLAG_DISMISSED,
        title="Flag report reviewed",
        body=(
            f"Your report was reviewed, however the content stays up. "
            f"Official note: {staff_note}"
        ),
    )


def notify_status_change(concern: Concern) -> None:
    """Create an appropriate notification when a concern's status changes."""
    from .models import Notification

    type_map = {
        Concern.Status.SUBMITTED: Notification.Type.SUBMITTED,
        Concern.Status.UNDER_REVIEW: Notification.Type.UNDER_REVIEW,
        Concern.Status.ASSIGNED: Notification.Type.ASSIGNED,
        Concern.Status.IN_PROGRESS: Notification.Type.IN_PROGRESS,
        Concern.Status.RESOLVED: Notification.Type.RESOLVED,
        Concern.Status.REJECTED: Notification.Type.REJECTED,
    }
    notif_type = type_map.get(concern.status)
    if notif_type:
        create_notification(concern=concern, type=notif_type)


def notify_validated_anonymous_concern_staff(concern: Concern) -> None:
    if (
        not concern.is_anonymous
        or concern.validation_status != Concern.ValidationStatus.ACCEPTED
        or not concern.assigned_department_id
    ):
        return

    from django.contrib.auth import get_user_model
    from .models import Notification

    event_key = f"anonymous-concern:{concern.pk}"
    if Notification.objects.filter(event_key=event_key).exists():
        return
    User = get_user_model()
    recipients = (
        User.objects.filter(
            is_active=True,
            status=User.Status.VERIFIED,
            role__in=[User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER],
            designations__is_active=True,
            designations__department_id=concern.assigned_department_id,
        )
        .distinct()
    )
    for recipient in recipients:
        create_user_notification(
            recipient=recipient,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title="New anonymous report",
            body=f"A new issue report was submitted in {concern.community.name}.",
            community=concern.community,
            department=concern.assigned_department,
            event_key=event_key,
        )
