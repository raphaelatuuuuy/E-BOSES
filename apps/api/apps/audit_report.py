"""Report generation for the audit log, for officials."""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AuditLog
from apps.capabilities import MANAGE_USERS, capabilities_for
from apps.concerns.models import Concern

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

OTHER_CATEGORY = ("other", "Other")


def category_match():
    match = Q()
    for _key, _label, prefixes in CATEGORIES:
        match |= tab_match(prefixes)
    return match


def tab_match(prefixes):
    match = Q()
    for prefix in prefixes:
        match |= Q(action__startswith=prefix)
    return match


def build_base_queryset(request):
    queryset = AuditLog.objects.select_related("actor", "target_user")
    if not request.user.is_superuser:
        from apps.community_scope import community_ids_for_user

        queryset = queryset.filter(community_id__in=community_ids_for_user(request.user))
    return queryset


def apply_filters(queryset, body):
    category = body.get("category", "all")
    if category and category != "all":
        queryset = queryset.filter(tab_match(next(p for k, _l, p in CATEGORIES if k == category)))

    if body.get("sensitive"):
        from apps.audit_log import SENSITIVE_ACTIONS

        queryset = queryset.filter(action__in=SENSITIVE_ACTIONS)

    date_from = body.get("date_from")
    date_to = body.get("date_to")
    if date_from:
        try:
            queryset = queryset.filter(created_at__gte=timezone.datetime.fromisoformat(date_from))
        except (ValueError, TypeError):
            pass
    if date_to:
        try:
            queryset = queryset.filter(created_at__lte=timezone.datetime.fromisoformat(date_to) + timezone.timedelta(hours=23, minutes=59, seconds=59))
        except (ValueError, TypeError):
            pass

    event_type = body.get("event_type", "all")
    if event_type and event_type != "all":
        action_prefixes = {
            "automated": ("concern.ai_decided", "content.flag_auto_reviewed", "emergency.auto_routed", "emergency.sms_ai_assist"),
            "manual": tuple(p for _k, _l, prefixes in CATEGORIES for p in prefixes if p not in ("concern.ai_decided", "content.flag_auto_reviewed", "emergency.auto_routed", "emergency.sms_ai_assist")),
        }
        prefixes = action_prefixes.get(event_type)
        if prefixes:
            queryset = queryset.filter(tab_match(prefixes))

    event_result = body.get("event_result", "all")
    if event_result and event_result != "all":
        result_actions = {
            "success": ("concern.status_updated", "concern.appeal_reviewed", "concern.assigned", "concern.reassigned"),
            "failure": ("concern.rejected", "concern.media_redacted"),
            "pending": ("concern.status_updated",),
        }
        actions = result_actions.get(event_result, ())
        if actions:
            queryset = queryset.filter(action__in=actions)

    tracking_id = body.get("tracking_id", "").strip()
    if tracking_id:
        ids = []
        try:
            found = list(Concern.objects.filter(tracking_number__icontains=tracking_id).values_list("pk", flat=True)[:50])
            ids.extend(found)
            digits = "".join(c for c in tracking_id if c.isdigit())
            year = ""
            if len(digits) > 6:
                year, digits = digits[:4], digits[4:]
            if digits:
                q = Concern.objects.filter(pk=int(digits))
                if year:
                    q = q.filter(created_at__year=int(year))
                ids.extend(q.values_list("pk", flat=True))
        except (ValueError, OverflowError):
            pass
        if ids:
            queryset = queryset.filter(metadata__concern_id__in=ids)

    concern_category = body.get("concern_category", "").strip()
    if concern_category and concern_category != "all":
        concern_ids = list(Concern.objects.filter(category=concern_category).values_list("pk", flat=True))
        queryset = queryset.filter(metadata__concern_id__in=concern_ids)

    concern_status = body.get("concern_status", "").strip()
    if concern_status and concern_status != "all":
        concern_ids = list(Concern.objects.filter(status=concern_status).values_list("pk", flat=True))
        queryset = queryset.filter(metadata__concern_id__in=concern_ids)

    actor = body.get("actor", "").strip()
    if actor:
        queryset = queryset.filter(
            Q(actor__first_name__icontains=actor)
            | Q(actor__last_name__icontains=actor)
            | Q(actor__email__icontains=actor)
        )

    actor_role = body.get("actor_role", "all")
    if actor_role and actor_role != "all":
        queryset = queryset.filter(actor__resident_profile__role=actor_role)

    barangay = body.get("barangay", "").strip()
    if barangay:
        queryset = queryset.filter(metadata__barangay__icontains=barangay)

    priority = body.get("priority", "all")
    if priority and priority != "all":
        queryset = queryset.filter(metadata__priority=priority)

    action_type = body.get("action_type", "all")
    if action_type and action_type != "all":
        if action_type == "automated":
            queryset = queryset.filter(action__startswith="concern.ai_decided")
        elif action_type == "manual":
            queryset = queryset.exclude(action__startswith="concern.ai_decided")

    return queryset


class AuditReportView(APIView):
    """Generate a report from audit log data. Returns filtered entries + preview."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if MANAGE_USERS not in capabilities_for(request.user):
            return Response({"detail": "You do not have permission."}, status=403)

        body = request.data or {}
        scope = body.get("scope", "current_view")
        preset = body.get("preset", "summary")
        format_ = body.get("format", "pdf")

        queryset = build_base_queryset(request)
        queryset = apply_filters(queryset, body)

        if scope == "specific_concerns":
            concern_ids = body.get("concern_ids", [])
            if concern_ids:
                queryset = queryset.filter(metadata__concern_id__in=concern_ids)

        total_matching = queryset.count()

        rows = list(queryset.order_by("-created_at", "-id")[:500])
        entries = []
        for row in rows:
            metadata = dict(row.metadata or {})
            entries.append({
                "id": row.pk,
                "action": row.action,
                "label": metadata.get("label", "") or row.action,
                "category": metadata.get("category", "") or "",
                "actor": metadata.get("actor", "") or "",
                "actor_role": metadata.get("actor_role", "") or "",
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "tracking_id": metadata.get("tracking_id", "") or "",
                "concern_title": metadata.get("concern_title", "") or "",
                "concern_status": metadata.get("concern_status", "") or "",
                "concern_category": metadata.get("concern_category", "") or "",
                "ip_address": row.ip_address or "",
                "result": metadata.get("result", "") or "",
                "summary": metadata.get("summary", "") or "",
            })

        return Response({
            "entries": entries,
            "total": total_matching,
            "preview": {
                "reportType": preset,
                "scope": scope,
                "dateRange": f"{body.get('date_from', '')} – {body.get('date_to', '')}" if body.get("date_from") or body.get("date_to") else "No date filter",
                "matchingConcerns": 0,
                "matchingEvents": total_matching,
                "format": format_,
            },
        })


class ConcernSearchView(APIView):
    """Search concerns by tracking ID, category, keyword, or location."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if MANAGE_USERS not in capabilities_for(request.user):
            return Response({"detail": "You do not have permission."}, status=403)

        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response({"concerns": []})

        queryset = Concern.objects.select_related("category_ref", "assigned_department").order_by("-created_at")
        queryset = queryset.filter(
            Q(tracking_number__icontains=q)
            | Q(title__icontains=q)
            | Q(description__icontains=q)
            | Q(address__icontains=q)
            | Q(barangay__icontains=q)
        )

        concerns = []
        for c in queryset[:50]:
            concerns.append({
                "id": c.pk,
                "tracking_id": c.tracking_id,
                "category": c.category,
                "title": c.title,
                "status": c.status,
                "created_at": c.created_at.isoformat() if c.created_at else "",
            })

        return Response({"concerns": concerns})