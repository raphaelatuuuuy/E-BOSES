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


def notification_category(notification) -> str:
    type_value = notification.type or ""
    if type_value == "announcement":
        return "announcement"
    if type_value == "witness_alert" or type_value.startswith("emergency"):
        return "emergency"
    if "appeal" in type_value:
        return "appeal"
    if type_value in {"clarification_requested", "clarification_replied", "concern_comment", "concern_mention"}:
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
    metadata = _safe_metadata(notification)
    if _safe_url(metadata.get("icon_url")):
        return _safe_url(metadata.get("icon_url"))
    if notification.type == "announcement":
        return "/contents/announcements.png"
    if notification.type == "witness_alert" or notification.type.startswith("emergency"):
        alert = getattr(notification, "emergency", None)
        emergency_type = getattr(alert, "type", "")
        return {
            "medical": "/contents/medical.png",
            "fire": "/contents/fire.png",
            "crime": "/contents/crime.png",
            "disaster": "/contents/disaster.png",
            "other": "/contents/alerts.png",
        }.get(emergency_type, "/contents/alerts.png")
    if notification.type in {"concern_comment", "concern_mention", "clarification_requested", "clarification_replied"}:
        return "/contents/chat-comment.png"
    if "appeal" in (notification.type or ""):
        return "/contents/reports.png"
    concern = getattr(notification, "concern", None)
    category = getattr(concern, "category", "")
    return {
        "infrastructure": "/contents/infrastructure.png",
        "environment": "/contents/environment.png",
        "public_safety": "/contents/public-safety.png",
        "others": "/contents/others.png",
    }.get(category, "/contents/notifications.png")


def notification_image_url(notification) -> str:
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
        media = notification.concern.media.filter(public_visible=True).exclude(preview_file="").first()
    elif getattr(notification, "emergency_id", None):
        media = notification.emergency.media.exclude(preview_file="").first()
    return _safe_url(media.preview_file.url if media and media.preview_file else "")


def notification_tag(notification) -> str:
    metadata = _safe_metadata(notification)
    tag = _clean_text(metadata.get("tag_key") or metadata.get("tag"))
    if tag:
        return f"eboses-{tag.lower().replace(' ', '-')[:48]}"
    if notification.emergency_id and notification.type != "witness_alert":
        return f"eboses-emergency-{notification.emergency_id}"
    if notification.concern_id:
        return f"eboses-concern-{notification.concern_id}"
    return f"eboses-{notification.type or 'notification'}-{notification.pk}"


def _display_concern_notification(notification) -> tuple[str, str]:
    concern = notification.concern
    type_value = notification.type or ""
    role = getattr(notification.recipient, "role", "")
    tracking = _concern_tracking_id(concern)
    concern_title = _clean_text(getattr(concern, "title", "")) or "your report"
    note = _clean_text(notification.body or getattr(concern, "update_text", ""))
    status_label = _choice_label(concern, "status", type_value)
    status_titles = {
        "submitted": "Report received",
        "under_review": "Report under review",
        "assigned": "Concern assigned to you" if role == getattr(notification.recipient.Role, "FIRST_RESPONDER", "first_responder") else "Report assigned",
        "in_progress": "Report in progress",
        "resolved": "Report resolved",
        "rejected": "Report rejected",
    }
    special_titles = {
        "clarification_requested": "Reply needed on your report" if role == getattr(notification.recipient.Role, "RESIDENT", "resident") else "Clarification requested",
        "clarification_replied": "Resident replied",
        "appeal_submitted": "Report appeal submitted",
        "appeal_approved": "Report appeal approved",
        "appeal_denied": "Report appeal denied",
        "concern_comment": notification.title or "New community comment",
        "concern_mention": notification.title or "You were mentioned",
    }
    title = special_titles.get(type_value) or status_titles.get(type_value) or notification.title or f"Report {status_label.lower()}"
    context = f"{tracking} Â· {concern_title}" if tracking else concern_title
    if note:
        body = f"{context}. {note}"
    else:
        body = f"{context}. Status: {status_label}."
    return _truncate(title, 80), _truncate(body, 190)


def _display_emergency_notification(notification) -> tuple[str, str]:
    alert = notification.emergency
    type_value = notification.type or ""
    role = getattr(notification.recipient, "role", "")
    emergency_type = _choice_label(alert, "type", "Emergency")
    status_label = _choice_label(alert, "status", type_value)
    barangay = _clean_text(getattr(alert, "barangay", "")) or "your barangay"
    address = _clean_text(getattr(alert, "address", "")) or barangay
    note = _clean_text(notification.body)
    if type_value == "witness_alert":
        return (
            f"{emergency_type} emergency nearby",
            _truncate(note or f"A {emergency_type.lower()} emergency was reported in {barangay}. Stay clear of the area and wait for official instructions.", 190),
        )

    responder_role = getattr(notification.recipient.Role, "FIRST_RESPONDER", "first_responder")
    official_role = getattr(notification.recipient.Role, "BARANGAY_OFFICIAL", "barangay_official")
    if role == responder_role and type_value in {"emergency_routed", "emergency_escalated"}:
        title = f"Dispatch: {emergency_type} emergency"
    elif role == official_role and type_value == "emergency_escalated":
        title = "Emergency needs attention"
    else:
        title_map = {
            "emergency_submitted": "Emergency alert sent",
            "emergency_routed": "Responder routed",
            "emergency_acknowledged": "Responder connected",
            "emergency_en_route": "Responder en route",
            "emergency_nearby": "Responder nearby",
            "emergency_arrived": "Responder arrived",
            "emergency_resolved": "Emergency resolved",
            "emergency_cancelled": "Emergency cancelled",
            "emergency_escalated": "Backup responder requested",
            "emergency_appeal_submitted": "Emergency review requested",
            "emergency_appeal_approved": "Emergency review approved",
            "emergency_appeal_denied": "Emergency review denied",
        }
        title = title_map.get(type_value) or notification.title or f"Emergency {status_label.lower()}"
    body_bits = [f"{emergency_type} emergency", address]
    body = " Â· ".join(part for part in body_bits if part)
    if note:
        body = f"{body}. {note}"
    else:
        body = f"{body}. Status: {status_label}."
    return _truncate(title, 80), _truncate(body, 190)


def _display_announcement_notification(notification) -> tuple[str, str]:
    metadata = _safe_metadata(notification)
    urgency = _clean_text(metadata.get("urgency")).lower()
    tag = _clean_text(metadata.get("tag")) or "Barangay"
    title_prefix = "Urgent announcement" if urgency == "urgent" else "Important announcement" if urgency == "important" else f"{tag} announcement"
    title = notification.title if notification.title.lower().startswith(("urgent", "important", "barangay")) else f"{title_prefix}: {notification.title}"
    body = notification.body or "Open E-Boses for the announcement details."
    return _truncate(title, 90), _truncate(body, 190)


def notification_display(notification) -> tuple[str, str]:
    metadata = _safe_metadata(notification)
    custom_title = _clean_text(metadata.get("display_title"))
    custom_body = _clean_text(metadata.get("display_body"))
    if custom_title and custom_body:
        return _truncate(custom_title, 90), _truncate(custom_body, 190)
    if notification.type == "announcement":
        return _display_announcement_notification(notification)
    if notification.emergency_id:
        return _display_emergency_notification(notification)
    if notification.concern_id:
        return _display_concern_notification(notification)
    return _truncate(custom_title or notification.title or "E-Boses update", 90), _truncate(custom_body or notification.body or "Open E-Boses for details.", 190)


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
            actions.append({"action": action[:32], "title": title[:32], "url": url})
        if actions:
            return actions
    url = notification_url(notification)
    if notification.type == "witness_alert":
        return [{"action": "open", "title": "Open E-Boses", "url": url}]
    if notification.type == "announcement":
        return [{"action": "open", "title": "View announcement", "url": url}]
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
    display_title, display_body = notification_display(notification)
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
        "badge": "/contents/logo.png",
        "image": notification_image_url(notification),
        "actions": notification_actions(notification),
        "requireInteraction": priority == "urgent",
        "renotify": priority in {"urgent", "important"},
        "timestamp": timezone.now().isoformat(),
        "notification": serialized or {},
        "data": {
            "notification_id": notification.pk,
            "type": notification.type,
            "concern_id": notification.concern_id,
            "emergency_id": None if notification.type == "witness_alert" else notification.emergency_id,
        },
    }
    if notification.emergency_id and notification.type != "witness_alert":
        alert = notification.emergency
        payload["data"]["location"] = {
            "latitude": str(getattr(alert, "latitude", "")),
            "longitude": str(getattr(alert, "longitude", "")),
            "address": _clean_text(getattr(alert, "address", "")),
            "barangay": _clean_text(getattr(alert, "barangay", "")),
        }
    if notification.concern_id:
        concern = notification.concern
        payload["data"]["location"] = {
            "latitude": str(getattr(concern, "latitude", "") or ""),
            "longitude": str(getattr(concern, "longitude", "") or ""),
            "address": _clean_text(getattr(concern, "address", "")),
            "barangay": _clean_text(getattr(concern, "barangay", "")),
        }
    return payload


def browser_push_extra_headers(endpoint: str) -> dict:
    host = (urlparse(endpoint).netloc or "").lower()
    if "notify.windows.com" in host:
        # Microsoft Edge/Windows Notification Service rejects encrypted Web
        # Push requests without a WNS type header on some Windows builds.
        return {"X-WNS-Type": "wns/raw"}
    return {}


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
            return f"/dashboard/emergency-history?alert={notification.emergency.public_id}"
        if notification.recipient.role == notification.recipient.Role.FIRST_RESPONDER:
            return f"/dashboard/responders/map?alert={notification.emergency_id}"
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
                "ttl": 3600,
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
            if status_code in {404, 410}:
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
        event_payload = {"concern": resident_concern_payload(concern)} if concern.visibility == Concern.Visibility.COMMUNITY and concern.validation_status == Concern.ValidationStatus.ACCEPTED else {"concern": {"id": concern.pk, "status": Concern.Status.REJECTED}, "removed": True}
        barangay = str(concern.community_id or concern.barangay)
    else:
        alert = EmergencyAlert.objects.filter(pk=resource_id).select_related("reporter", "reporter__resident_profile").first()
        if not alert:
            return
        event_payload = {"emergency": resident_emergency_payload(alert)}
        barangay = str(alert.community_id or alert.barangay)
    group = _resident_group_for_barangay(barangay)
    _broadcast(group, "resident_live_map.update", {"type": message_type, "payload": event_payload})


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
        community=getattr(concern, "community", None),
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
    metadata: dict | None = None,
    event_key: str = "",
) -> object | None:
    """Create a notification for an emergency participant."""
    from .models import Notification

    recipient = recipient or alert.reporter
    notification = Notification.objects.create(
        recipient=recipient,
        emergency=alert,
        type=type,
        title=title or f"Emergency alert #{alert.pk}",
        body=body or f"Emergency status updated to {alert.status.replace('_', ' ')}.",
        metadata=metadata or {},
        community=alert.community,
        department=getattr(getattr(alert, "category_ref", None), "department", None),
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
        create_emergency_notification(alert=alert, type=notification_type, body=body)
    broadcast_emergency_update(alert)


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
