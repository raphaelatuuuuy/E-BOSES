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

from django.db.models import Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AuditLog
from apps.capabilities import MANAGE_USERS, capabilities_for

# Action prefix -> the section of the barangay it belongs to. Officials think in
# these terms, not in dotted action codes.
CATEGORIES = (
    ("media", "Protected media", ("media.", "concern.media_")),
    ("accounts", "Accounts", ("account.", "profile.", "admin.")),
    ("signin", "Sign-in", ("auth.", "password_reset.")),
    ("idchecks", "ID checks", ("ocr.",)),
    ("concerns", "Concerns", ("concern.", "emergency.", "responder.")),
    ("content", "Community content", ("announcement.", "event.", "content.")),
    ("settings", "Configuration", ("settings.", "map_dispatch_policy.")),
)

# Plain sentences. Anything not listed falls back to a humanised action code,
# so a new action never renders as a blank row.
ACTION_LABELS = {
    "media.raw_accessed": "Opened an unblurred photo",
    "account.data_export_downloaded": "Downloaded a resident's data export",
    "concern.media_redacted": "Blurred a photo on a report",
    "concern.media_redaction_removed": "Removed the blur from a photo",
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
    "map_dispatch_policy.updated": "Changed the zones and radius",
}

# Actions worth noticing in a list of thousands. Not an alarm — a marker that
# someone looked at something private, or overrode a protection.
SENSITIVE_ACTIONS = {
    "media.raw_accessed",
    "account.data_export_downloaded",
    "concern.media_redaction_removed",
    "emergency.contact_revealed",
    "auth.login_ip_blocked",
    "password_reset.requested_unknown",
}


def category_of(action):
    for key, _label, prefixes in CATEGORIES:
        if any(action.startswith(prefix) for prefix in prefixes):
            return key
    return "other"


def label_of(action):
    known = ACTION_LABELS.get(action)
    if known:
        return known
    # e.g. "unit.created" -> "Unit created"
    tail = action.split(".", 1)[-1].replace("_", " ").strip()
    return tail[:1].upper() + tail[1:] if tail else action


def person(user):
    if user is None:
        return None
    profile = getattr(user, "resident_profile", None)
    name = ""
    if profile is not None:
        name = f"{profile.first_name} {profile.last_name}".strip()
    return {
        "id": user.pk,
        "name": name or user.email or f"Account #{user.pk}",
        "email": user.email or "",
    }


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
        if category != "all":
            prefixes = next((p for key, _l, p in CATEGORIES if key == category), None)
            if prefixes is None:
                return Response({"category": ["Unknown category."]}, status=400)
            match = Q()
            for prefix in prefixes:
                match |= Q(action__startswith=prefix)
            queryset = queryset.filter(match)

        if (request.query_params.get("sensitive") or "") == "1":
            queryset = queryset.filter(action__in=SENSITIVE_ACTIONS)

        days = request.query_params.get("days")
        if days and days != "all":
            try:
                window = max(1, min(365, int(days)))
            except (TypeError, ValueError):
                return Response({"days": ["Use a whole number of days."]}, status=400)
            queryset = queryset.filter(created_at__gte=timezone.now() - timedelta(days=window))

        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(action__icontains=search)
                | Q(actor__email__icontains=search)
                | Q(target_user__email__icontains=search)
                | Q(actor__resident_profile__first_name__icontains=search)
                | Q(actor__resident_profile__last_name__icontains=search)
                | Q(target_user__resident_profile__first_name__icontains=search)
                | Q(target_user__resident_profile__last_name__icontains=search)
            )

        try:
            limit = min(200, max(1, int(request.query_params.get("limit", 10))))
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (TypeError, ValueError):
            return Response({"limit": ["Use whole numbers."]}, status=400)

        total = queryset.count()
        rows = queryset.order_by("-created_at", "-id")[offset : offset + limit]

        return Response(
            {
                "total": total,
                "offset": offset,
                "limit": limit,
                "categories": [
                    {"key": "all", "label": "Everything"},
                    *({"key": key, "label": label} for key, label, _p in CATEGORIES),
                ],
                "entries": [
                    {
                        "id": row.pk,
                        "action": row.action,
                        "label": label_of(row.action),
                        "category": category_of(row.action),
                        "sensitive": row.action in SENSITIVE_ACTIONS,
                        "actor": person(row.actor),
                        "target": person(row.target_user),
                        "ip_address": row.ip_address or "",
                        "metadata": row.metadata or {},
                        "created_at": row.created_at.isoformat(),
                    }
                    for row in rows
                ],
            }
        )
