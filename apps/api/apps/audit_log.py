"""The system's audit log, for officials.

This replaces the Privacy requests screen. That screen existed to review data
exports and deletions, but exports complete themselves and there is nothing
useful for an official to decide about a resident asking for their own data.
What was actually missing is the opposite: a record of what everyone did —
including which official opened which protected photo.

Every row here already existed; `create_audit_log` has been writing them all
along. Only nothing read them back except a two-action sensitive-access list.
"""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AuditLog
from apps.capabilities import MANAGE_USERS, capabilities_for

# Action prefix -> the tab an official would look in. Officials think in these
# terms, not in dotted action codes. Order matters: the first match wins, so a
# narrow tab lists its exact codes before the broad prefixes of the tab that
# would otherwise swallow them (a report's photo belongs to Content & privacy,
# not to Concerns).
CATEGORIES = (
    (
        "automated",
        "Automated decisions",
        (
            "concern.ai_decided",
            "content.flag_auto_reviewed",
            "emergency.auto_routed",
            "emergency.sms_ai_assist",
        ),
    ),
    (
        "content",
        "Content & privacy",
        (
            "media.",
            "concern.media_",
            "content.",
            "announcement.",
            "event.",
            "map_boundary.",
            "map_dispatch_policy.",
            "ocr.configuration_",
            "ocr.template_",
        ),
    ),
    (
        "access",
        "Access & identity",
        ("auth.", "password_reset.", "account.", "profile.", "settings.", "admin.", "ocr."),
    ),
    (
        "concerns",
        "Concerns",
        ("concern.", "emergency.", "responder."),
    ),
)

# Whatever no prefix claims, and it is offered as a real tab: an action code the
# taxonomy has not caught up with must never become invisible to the official
# reading this screen.
OTHER_CATEGORY = ("other", "Other")

# Plain sentences. Anything not listed falls back to a humanised action code,
# so a new action never renders as a blank row.
ACTION_LABELS = {
    "media.raw_accessed": "Opened an unblurred photo",
    "account.data_export_downloaded": "Downloaded a resident's data export",
    "concern.media_redacted": "Blurred a photo on a report",
    "concern.media_redaction_removed": "Removed the blur from a photo",
    "concern.ai_decided": "System decided on a report",
    "auth.login_success": "Signed in",
    "auth.login_ip_blocked": "Sign-in blocked from an unusual place",
    "auth.registered": "Created an account",
    "password_reset.requested": "Asked for a password reset",
    "password_reset.requested_unknown": "Password reset asked for an unknown email",
    "password_reset.confirmed": "Set a new password",
    "profile.updated": "Updated their profile",
    "settings.updated": "Changed their settings",
    "account.staff_updated": "Changed a staff account",
    "account.resident_status_updated": "Changed a resident's status",
    "account.responder_updated": "Changed a responder's details",
    "account.name_changed": "Changed the name on an account",
    "account.phone_changed": "Changed the phone number on an account",
    "account.request_submitted": "Asked for a data export or deletion",
    "account.request_reviewed": "Reviewed a data request",
    "admin.user_created": "Created a new account",
    "ocr.configuration_draft_saved": "Saved a draft of the ID setup",
    "ocr.configuration_published": "Published the ID setup",
    "ocr.configuration_reset_defaults": "Reset the ID setup to defaults",
    "ocr.template_sample_uploaded": "Uploaded a sample ID photo",
    "ocr.template_restored": "Restored a proof type",
    "ocr.test_run_created": "Ran an ID reading test",
    "ocr.verification_accepted": "Accepted an ID check",
    "ocr.verification_rejected": "Rejected an ID check",
    "ocr.verification_review_required": "Held an ID check for review",
    "ocr.health_recheck": "Rechecked the ID reading service",
    "ocr.case_retry_requested": "Asked a resident to upload again",
    "concern.chat_message": "Sent a message on a report",
    "concern.status_updated": "Changed a report's status",
    "concern.remark_added": "Added a remark to a report",
    "concern.clarification_requested": "Asked the resident for more detail",
    "concern.clarification_replied": "Replied to a request for detail",
    "concern.appeal_submitted": "Appealed a report decision",
    "concern.appeal_reviewed": "Reviewed a report appeal",
    "content.flag_submitted": "Flagged something for review",
    "content.flag_reviewed": "Reviewed flagged content",
    "content.flag_auto_reviewed": "Automated review completed",
    "emergency.created": "Raised an emergency",
    "emergency.sms_created": "Raised an emergency by text message",
    "emergency.assigned": "Assigned an emergency to a unit",
    "emergency.auto_routed": "Emergency routed automatically",
    "emergency.cancelled": "Cancelled an emergency",
    "emergency.backup_requested": "Asked for backup",
    "emergency.contact_revealed": "Viewed a resident's contact number",
    "emergency.category_updated": "Changed an emergency category",
    "emergency.acknowledgment_timeout": "Nobody acknowledged in time",
    "emergency.appeal_submitted": "Appealed an emergency decision",
    "emergency.appeal_reviewed": "Reviewed an emergency appeal",
    "responder.shift_started": "Started a shift",
    "responder.shift_ended": "Ended a shift",
    "announcement.created": "Posted an announcement",
    "announcement.updated": "Edited an announcement",
    "announcement.deleted": "Deleted an announcement",
    "event.created": "Added a calendar event",
    "event.updated": "Edited a calendar event",
    "event.deleted": "Deleted a calendar event",
    "account.email_changed": "Changed the sign-in address on an account",
    "account.password_changed": "Changed an account password",
    "account.deactivated": "Deactivated an account",
    "account.reactivated": "Reactivated an account",
    "account.deletion_completed": "Deleted an account and its data",
    "account.request_withdrawn": "Withdrew a data request",
    "concern.assigned": "Assigned a report to a unit",
    "concern.reassigned": "Moved a report to another unit",
    "concern.published": "Showed a report to the community",
    "concern.media_privacy_reprocessed": "Re-checked the blur on a report photo",
    "emergency.en_route": "Responder is on the way",
    "emergency.resolved": "Closed an emergency",
    "emergency.transferred": "Handed an emergency to another unit",
    "emergency.reassigned": "Moved an emergency to another unit",
    "emergency.assignment_removed": "Took back an emergency assignment",
    "emergency.backup_assigned": "Sent backup to an emergency",
    "emergency.duty_changed": "Changed who is on duty",
    "emergency.category_created": "Added an emergency category",
    "emergency.responder_contact_revealed": "Viewed a responder's contact number",
    "emergency.sms_ai_assist": "Assistant read a text-message report",
    "emergency.sms_invalid_location": "Text-message report had no usable location",
    "map_boundary.updated": "Changed the barangay boundary",
    "map_dispatch_policy.updated": "Changed which unit answers each emergency",
    "ocr.case_approved": "Accepted an ID check",
    "ocr.case_rejected": "Rejected an ID check",
}

# Actions worth noticing in a list of thousands. Not an alarm — a marker that
# someone looked at something private, or overrode a protection.
SENSITIVE_ACTIONS = {
    "media.raw_accessed",
    "account.data_export_downloaded",
    "concern.media_redaction_removed",
    "emergency.contact_revealed",
    "emergency.responder_contact_revealed",
    "auth.login_ip_blocked",
    "password_reset.requested_unknown",
}

# Machine and service accounts have no person behind them. They are named by
# what they do — never by their sign-in address, because an email printed where
# a name belongs reads as a person to whoever is auditing the log.
SERVICE_ACCOUNTS = (
    ("sms-intake", "SMS intake service"),
    ("noreply", "Notification service"),
    ("no-reply", "Notification service"),
    ("system", "System"),
    ("bot", "Automated service"),
)

ROLE_LABELS = {
    "barangay_official": "Barangay official",
    "first_responder": "First responder",
    "resident": "Resident",
}


def category_of(action):
    for key, _label, prefixes in CATEGORIES:
        if any(action.startswith(prefix) for prefix in prefixes):
            return key
    return OTHER_CATEGORY[0]


def category_match():
    """One OR clause matching every action the tabs claim."""
    match = Q()
    for _key, _label, prefixes in CATEGORIES:
        match |= tab_match(prefixes)
    return match


def tab_match(prefixes):
    match = Q()
    for prefix in prefixes:
        match |= Q(action__startswith=prefix)
    return match


def tracking_ids(search):
    """Report ids a tracking reference points at.

    `tracking_id` is derived, and `tracking_number` may be blank, so a typed
    "RPT-2026-000123" is read as the report id it encodes.
    """
    try:
        from apps.concerns.models import Concern

        found = list(
            Concern.objects.filter(tracking_number__icontains=search).values_list("pk", flat=True)[:50]
        )
        digits = "".join(char for char in search if char.isdigit())
        year = ""
        if len(digits) > 6:
            year, digits = digits[:4], digits[4:]
        if digits:
            report = Concern.objects.filter(pk=int(digits))
            if len(year) == 4:
                report = report.filter(created_at__year=int(year))
            found.extend(report.values_list("pk", flat=True))
        return found
    except (LookupError, TypeError, ValueError, OverflowError):
        return []


def search_match(search):
    """Everything an official may type: action code, a person, a place, a report.

    Email stays searchable — it is how an account's rows are found — but it is
    never part of the response.
    """
    match = (
        Q(action__icontains=search)
        | Q(actor__email__icontains=search)
        | Q(target_user__email__icontains=search)
        | Q(actor__first_name__icontains=search)
        | Q(actor__last_name__icontains=search)
        | Q(actor__resident_profile__first_name__icontains=search)
        | Q(actor__resident_profile__last_name__icontains=search)
        | Q(target_user__first_name__icontains=search)
        | Q(target_user__last_name__icontains=search)
        | Q(target_user__resident_profile__first_name__icontains=search)
        | Q(target_user__resident_profile__last_name__icontains=search)
        | Q(user_agent__icontains=search)
    )
    if search.replace(".", "").isdigit():
        match |= Q(ip_address__icontains=search)
    ids = tracking_ids(search)
    if ids:
        match |= Q(metadata__concern_id__in=ids)
    return match


def label_of(action):
    known = ACTION_LABELS.get(action)
    if known:
        return known
    # e.g. "unit.created" -> "Unit created"
    tail = action.split(".", 1)[-1].replace("_", " ").strip()
    return tail[:1].upper() + tail[1:] if tail else action


def service_label(user):
    """A name for an account with no person behind it, or nothing for a person."""
    address = (getattr(user, "email", "") or "").strip().lower()
    local, _at, domain = address.partition("@")
    for prefix, label in SERVICE_ACCOUNTS:
        if local.startswith(prefix):
            return label
    if domain.endswith(".invalid") or domain == "localhost":
        return "Service account"
    return ""


def initials_of(text):
    parts = [part for part in (text or "").split() if part]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][:1] + parts[-1][:1]).upper()


def person(user, position=""):
    """Who did it, in a form that can be shown — never an email address.

    Staff accounts carry no resident profile, so their name lives on the user
    row; `UserSummarySerializer` already reads both, and this follows the same
    order. When neither has a name the account is described by its position,
    its role, or the service it runs.
    """
    if user is None:
        return None
    profile = getattr(user, "resident_profile", None)
    name = ""
    if profile is not None:
        name = f"{profile.first_name} {profile.last_name}".strip()
    if not name:
        name = " ".join(
            part
            for part in (
                getattr(user, "first_name", ""),
                getattr(user, "middle_name", ""),
                getattr(user, "last_name", ""),
            )
            if part
        ).strip()
    role = getattr(user, "role", "") or ""
    service = service_label(user)
    label = name or position or service or ROLE_LABELS.get(role, "") or "Staff account"
    return {
        "id": user.pk,
        "label": label,
        "name": name,
        "position": position,
        "role": role,
        "initials": initials_of(label),
        "service": bool(service) and not name,
    }


def origin_of(user_agent):
    """Roughly where the action came from, in words an official can read.

    The stored user-agent is long and machine-shaped; only the device and
    browser are worth showing beside an IP address.
    """
    text = (user_agent or "").lower()
    if not text:
        return ""
    if "capacitor" in text or "eboses" in text or "okhttp" in text:
        device = "mobile app"
    elif "android" in text:
        device = "Android"
    elif "iphone" in text:
        device = "iPhone"
    elif "ipad" in text:
        device = "iPad"
    elif "windows" in text:
        device = "Windows"
    elif "macintosh" in text or "mac os" in text:
        device = "Mac"
    elif "linux" in text:
        device = "Linux"
    else:
        device = "an unknown device"
    if "edg/" in text or "edgios" in text:
        browser = "Edge"
    elif "chrome" in text or "crios" in text:
        browser = "Chrome"
    elif "firefox" in text or "fxios" in text:
        browser = "Firefox"
    elif "safari" in text:
        browser = "Safari"
    else:
        browser = ""
    return f"{browser} on {device}" if browser else device


class AuditLogView(APIView):
    """Read-only. An audit log that can be edited is not an audit log."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if MANAGE_USERS not in capabilities_for(request.user):
            return Response({"detail": "You do not have permission to read the audit log."}, status=403)

        queryset = AuditLog.objects.select_related(
            "actor", "actor__resident_profile", "target_user", "target_user__resident_profile"
        )
        if not request.user.is_superuser:
            from apps.community_scope import community_ids_for_user

            queryset = queryset.filter(community_id__in=community_ids_for_user(request.user))

        category = (request.query_params.get("category") or "all").strip().lower()
        known = {key for key, _label, _prefixes in CATEGORIES} | {OTHER_CATEGORY[0], "all"}
        if category not in known:
            return Response({"category": ["Unknown category."]}, status=400)

        scoped = queryset
        if (request.query_params.get("sensitive") or "") == "1":
            scoped = scoped.filter(action__in=SENSITIVE_ACTIONS)

        days = request.query_params.get("days")
        if days and days != "all":
            try:
                window = max(1, min(365, int(days)))
            except (TypeError, ValueError):
                return Response({"days": ["Use a whole number of days."]}, status=400)
            scoped = scoped.filter(created_at__gte=timezone.now() - timedelta(days=window))

        search = (request.query_params.get("search") or "").strip()
        if search:
            scoped = scoped.filter(search_match(search))

        for param, column in (("actor", "actor_id"), ("target", "target_user_id")):
            raw = request.query_params.get(param)
            if not raw:
                continue
            try:
                scoped = scoped.filter(**{column: int(raw)})
            except (TypeError, ValueError):
                return Response({param: ["Use an account id."]}, status=400)

        try:
            limit = min(200, max(1, int(request.query_params.get("limit", 10))))
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (TypeError, ValueError):
            return Response({"limit": ["Use whole numbers."]}, status=400)

        # One query counts every tab, so the number on a chip is the number of
        # rows behind it rather than however many happened to fit on the page.
        counts = scoped.aggregate(
            **{
                **{
                    key: Count("id", filter=tab_match(prefixes))
                    for key, _label, prefixes in CATEGORIES
                },
                "total": Count("id"),
            }
        )
        claimed = sum(counts[key] for key, _label, _prefixes in CATEGORIES)
        other_count = max(0, counts["total"] - claimed)

        if category == "all":
            selected = scoped
        elif category == OTHER_CATEGORY[0]:
            selected = scoped.exclude(category_match())
        else:
            selected = scoped.filter(
                tab_match(next(prefixes for key, _l, prefixes in CATEGORIES if key == category))
            )

        total = selected.count()
        rows = list(selected.order_by("-created_at", "-id")[offset : offset + limit])

        concern_ids = []
        for row in rows:
            try:
                concern_id = int((row.metadata or {}).get("concern_id") or 0)
            except (TypeError, ValueError):
                concern_id = 0
            if concern_id and concern_id not in concern_ids:
                concern_ids.append(concern_id)
        concerns = {}
        report_photos = {}
        resolution_photos = {}
        category_labels = {}
        llm_logs = {}
        if concern_ids:
            from apps.concerns.models import (
                Concern,
                ConcernMedia,
                ConcernResolutionEvidence,
                LlmDecisionLog,
            )

            for concern in Concern.objects.filter(pk__in=concern_ids).select_related(
                "assigned_department", "category_ref", "reporter", "reporter__resident_profile"
            ):
                concerns[concern.pk] = concern
                category_ref = getattr(concern, "category_ref", None)
                if category_ref is not None:
                    category_labels[concern.pk] = category_ref.name or category_ref.code or ""
            for media in (
                ConcernMedia.objects.filter(concern_id__in=concern_ids)
                .exclude(preview_file="")
                .order_by("concern_id", "pk")
            ):
                report_photos.setdefault(media.concern_id, []).append(media.pk)
            for evidence in (
                ConcernResolutionEvidence.objects.filter(concern_id__in=concern_ids)
                .exclude(preview_file="")
                .order_by("concern_id", "pk")
            ):
                resolution_photos.setdefault(evidence.concern_id, []).append(evidence.pk)
            for log in LlmDecisionLog.objects.filter(
                concern_id__in=concern_ids,
                domain=LlmDecisionLog.Domain.CONCERN,
                run_kind=LlmDecisionLog.RunKind.PRODUCTION,
            ).order_by("-created_at", "-id"):
                if log.concern_id not in llm_logs:
                    llm_logs[log.concern_id] = log

        # One query names every staff member who acted on this page. Their name
        # lives on the user row, and their position is what an official
        # recognises — neither is an email address.
        positions = {}
        people_ids = {row.actor_id for row in rows if row.actor_id}
        people_ids |= {row.target_user_id for row in rows if row.target_user_id}
        if people_ids:
            from apps.concerns.models import Designation

            for designation in (
                Designation.objects.filter(
                    user_id__in=people_ids, is_active=True, position__is_active=True
                )
                .select_related("position")
                .order_by("position__name")
            ):
                positions.setdefault(designation.user_id, designation.position.name)

        entries = []
        for row in rows:
            metadata = dict(row.metadata or {})
            try:
                concern_id = int(metadata.get("concern_id") or 0)
            except (TypeError, ValueError):
                concern_id = 0
            concern = concerns.get(concern_id)
            photos = []
            if concern_id:
                if concern is None:
                    metadata["tracking_id"] = (
                        f"RPT-{row.created_at.year}-{concern_id:06d}" if row.created_at else f"RPT-{concern_id:06d}"
                    )
                else:
                    metadata["tracking_id"] = concern.tracking_id
                    # Every visual this entry can be checked against, in the
                    # order an official reads them: what was reported, how it
                    # was closed, then the road the report was pinned to.
                    for index, media_pk in enumerate(report_photos.get(concern_id) or []):
                        photos.append(
                            {
                                "kind": "report",
                                "label": "Report photo" if index == 0 else f"Report photo {index + 1}",
                                "url": f"/api/concerns/media/{media_pk}/preview/",
                            }
                        )
                    for index, media_pk in enumerate(resolution_photos.get(concern_id) or []):
                        photos.append(
                            {
                                "kind": "resolution",
                                "label": "Resolution photo" if index == 0 else f"Resolution photo {index + 1}",
                                "url": f"/api/concerns/resolution-evidence/{media_pk}/preview/",
                            }
                        )
                    if photos:
                        metadata["preview_url"] = photos[0]["url"]
                    metadata["address"] = concern.address or ""
                    metadata["barangay"] = concern.barangay or ""
                    # The expanded row explains what was reported and how it
                    # ended, so carry the human-readable concern facts rather
                    # than leaving the UI to guess from a bare id.
                    metadata["concern_title"] = concern.title or ""
                    metadata["concern_description"] = concern.description or ""
                    category_label = category_labels.get(concern_id, "")
                    metadata["concern_category"] = category_label or concern.category or ""
                    metadata["concern_status"] = concern.get_status_display()
                    metadata["concern_validation_status"] = concern.get_validation_status_display()
                    profile = getattr(concern.reporter, "resident_profile", None)
                    profile_name = " ".join(
                        part
                        for part in (
                            getattr(profile, "first_name", ""),
                            getattr(profile, "last_name", ""),
                        )
                        if part
                    ).strip()
                    reporter_name = "Anonymous resident" if concern.is_anonymous else (
                        concern.reporter.get_full_name().strip() or profile_name or "Resident"
                    )
                    metadata["reporter_name"] = reporter_name
                    if concern.assigned_department_id:
                        metadata["assigned_unit"] = concern.assigned_department.name
                # The model's verdict is stored on the audit row itself, so
                # building the analysis never reads the large LLM snapshots
                # that used to make this endpoint slow. The road photo is
                # fetched lazily from the classification log when expanded.
                has_analysis = any(
                    metadata.get(key)
                    for key in ("severity", "relevance", "street_verdict", "street_reason")
                )
                log_id = metadata.get("analysis_log_id")
                if not log_id and concern_id and concern_id in llm_logs:
                    log_id = llm_logs[concern_id].pk
                    metadata["analysis_log_id"] = log_id
                if has_analysis or log_id:
                    analysis = {
                        "severity": metadata.get("severity") or "",
                        "relevance": metadata.get("relevance") or "",
                        "street_verdict": metadata.get("street_verdict") or "",
                        "street_reason": metadata.get("street_reason") or "",
                    }
                    try:
                        if log_id:
                            analysis["road_image"] = (
                                f"/api/concerns/classification/log/{int(log_id)}/street-image/"
                            )
                            photos.append(
                                {
                                    "kind": "area",
                                    "label": "Area photo",
                                    "url": analysis["road_image"],
                                }
                            )
                            if not analysis["street_verdict"] and log_id:
                                try:
                                    from apps.concerns.models import LlmDecisionLog
                                    log_row = LlmDecisionLog.objects.filter(pk=int(log_id)).only("id", "output_snapshot").first()
                                    if log_row and isinstance(log_row.output_snapshot, dict):
                                        street = log_row.output_snapshot.get("street_imagery")
                                        if isinstance(street, dict):
                                            analysis["street_verdict"] = street.get("verdict") or ""
                                            analysis["street_reason"] = street.get("explanation") or street.get("reason") or ""
                                except (TypeError, ValueError):
                                    pass
                    except (TypeError, ValueError):
                        pass
                    metadata["analysis"] = analysis
                if photos:
                    metadata["media"] = photos
            label = label_of(row.action)
            if row.action == "concern.ai_decided":
                decision = (metadata.get("decision") or "").lower()
                if decision == "accepted":
                    label = "System accepted a report"
                elif decision == "rejected":
                    label = "System rejected a report"
                elif decision in ("held", "review") or "review" in decision:
                    label = "System held a report for review"
            entries.append(
                {
                    "id": row.pk,
                    "action": row.action,
                    "label": label,
                    "category": category_of(row.action),
                    "sensitive": row.action in SENSITIVE_ACTIONS,
                    "actor": person(row.actor, positions.get(row.actor_id, "")),
                    "target": person(row.target_user, positions.get(row.target_user_id, "")),
                    "ip_address": row.ip_address or "",
                    "origin": origin_of(row.user_agent),
                    "metadata": metadata,
                    "created_at": row.created_at.isoformat(),
                }
            )

        return Response(
            {
                "total": total,
                "offset": offset,
                "limit": limit,
                "categories": [
                    {"key": "all", "label": "All activity", "count": counts["total"]},
                    *(
                        {"key": key, "label": label, "count": counts[key]}
                        for key, label, _prefixes in CATEGORIES
                    ),
                    *(
                        [
                            {
                                "key": OTHER_CATEGORY[0],
                                "label": OTHER_CATEGORY[1],
                                "count": other_count,
                            }
                        ]
                        if other_count
                        else []
                    ),
                ],
                "entries": entries,
            }
        )
