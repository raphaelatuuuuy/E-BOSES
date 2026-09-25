from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AccountRequest
from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.accounts.views import touch_last_seen
from apps.community_scope import community_ids_for_user
from apps.concerns.models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernAppeal,
    ConcernStatusEvent,
    ContentFlag,
    Department,
)
from apps.concerns.severity import severity_label
from apps.concerns.units import assigned_unit_for
from apps.emergencies.models import (
    Community,
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyResponderAssignment,
)
from apps.notifications.models import Notification

CONCERN_ACTIVE = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.ASSIGNED,
    Concern.Status.IN_PROGRESS,
    Concern.Status.APPEALED,
}

# `CONCERN_ACTIVE` above answers "is this still someone's problem", so it lumps
# work nobody has picked up in with work already underway. The overview has to
# tell those apart — an official reads the first number as their queue and the
# second as their throughput — so the three groups are named separately here.
CONCERN_OPEN = {
    Concern.Status.SUBMITTED,
    Concern.Status.APPEALED,
}

CONCERN_WORKING = {
    Concern.Status.UNDER_REVIEW,
    Concern.Status.ASSIGNED,
    Concern.Status.IN_PROGRESS,
}

CONCERN_SETTLED = {
    Concern.Status.RESOLVED,
    Concern.Status.REJECTED,
}

ANALYTICS_WINDOW_DAYS = 30

REPORT_PERIODS = {"today", "week", "month"}

EMERGENCY_ACTIVE = {
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTING,
    EmergencyAlert.Status.ROUTED,
    EmergencyAlert.Status.AWAITING_ACKNOWLEDGMENT,
    EmergencyAlert.Status.ACKNOWLEDGED,
    EmergencyAlert.Status.EN_ROUTE,
    EmergencyAlert.Status.NEARBY,
    EmergencyAlert.Status.ARRIVED,
    EmergencyAlert.Status.RESIDENT_SAFE,
    EmergencyAlert.Status.BACKUP_REQUESTED,
    EmergencyAlert.Status.BACKUP_ASSIGNED,
    EmergencyAlert.Status.IN_PROGRESS,
    EmergencyAlert.Status.TRANSFER_REQUIRED,
    EmergencyAlert.Status.ESCALATION_REQUIRED,
}

EMERGENCY_SETTLED = {
    EmergencyAlert.Status.RESOLVED,
    EmergencyAlert.Status.CLOSED,
}

EMERGENCY_NON_COUNTABLE = {
    EmergencyAlert.Status.INVALID,
    EmergencyAlert.Status.CANCELLED,
    EmergencyAlert.Status.FALSE_ALARM,
}

EMERGENCY_REPORTABLE = EMERGENCY_ACTIVE | EMERGENCY_SETTLED
EMERGENCY_OPEN = {
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTING,
}
EMERGENCY_WORKING = EMERGENCY_ACTIVE - EMERGENCY_OPEN

def common_counts(user):
    today = timezone.localdate()
    from django.core.cache import cache

    communities = community_ids_for_user(user)
    community_key = "-".join(str(item) for item in sorted(communities)) or "none"
    shared_key = f"dashboard:shared-counts:v2:{community_key}:{today.isoformat()}"
    try:
        shared = cache.get(shared_key)
    except Exception:
        shared = None
    if shared is None:
        shared = {
            "published_announcements": Announcement.objects.filter(is_published=True, community_id__in=communities).count(),
            "events_today": BarangayEvent.objects.filter(is_published=True, community_id__in=communities, starts_at__date=today).count(),
        }
        try:
            cache.set(shared_key, shared, 10)
        except Exception:
            pass
    return {
        "unread_notifications": Notification.objects.filter(recipient=user, is_read=False).count(),
        **shared,
    }

class ResidentDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        requested_period = str(request.query_params.get("period", "week")).lower()
        period = requested_period if requested_period in REPORT_PERIODS else "week"
        mine = Concern.objects.filter(reporter=request.user)
        countable_mine = mine.exclude(status=Concern.Status.REJECTED)
        emergencies = EmergencyAlert.objects.filter(reporter=request.user)
        report_overview = resident_report_overview(request.user, period)
        resident_week = report_overview if period == "week" else resident_report_overview(request.user, "week")
        # Barangay-wide active emergencies (for home rail red state + feed banner)
        home_community = getattr(getattr(request.user, "resident_profile", None), "community_id", None)
        if home_community:
            home_name = getattr(
                getattr(getattr(request.user, "resident_profile", None), "community", None),
                "name",
                "",
            )
            barangay_active = EmergencyAlert.objects.filter(
                status__in=EMERGENCY_ACTIVE,
            ).filter(
                Q(community_id=home_community)
                | Q(community_id__isnull=True, barangay__iexact=home_name)
            ).count()
        else:
            barangay_active = EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE).count()
        return Response({
            **common_counts(request.user),
            "reports_total": countable_mine.count(),
            "reports_active": mine.filter(status__in=CONCERN_ACTIVE).count(),
            "reports_resolved": mine.filter(status=Concern.Status.RESOLVED).count(),
            "reports_appealed": mine.filter(status=Concern.Status.APPEALED).count(),
            "active_emergencies": emergencies.filter(status__in=EMERGENCY_ACTIVE).count(),
            "barangay_active_emergencies": barangay_active,
            "has_ongoing_emergencies": barangay_active > 0,
            "emergencies_resolved": emergencies.filter(status=EmergencyAlert.Status.RESOLVED).count(),
            "open_account_requests": AccountRequest.objects.filter(
                user=request.user,
                status__in=[AccountRequest.Status.SUBMITTED, AccountRequest.Status.REVIEWED],
            ).count(),
            **community_overview_counts(community_ids_for_user(request.user)),
            # Keep the old week fields for clients that have not moved to the
            # period-aware chart yet. These are now resident-scoped as well.
            "week_total": resident_week["total"],
            "delta_week_pct": resident_week["delta_pct"],
            "week_days": resident_week["days"],
            "report_overview": report_overview,
        })

def is_official(user):
    User = get_user_model()
    return bool(user.is_superuser or user.role == User.Role.BARANGAY_OFFICIAL)


def pct_change(current, previous):
    if previous <= 0:
        return None if current <= 0 else 100.0
    return round((current - previous) / previous * 100, 1)


def resident_report_overview(user, period):
    """Return a resident's filed reports grouped for the selected period.

    The overview is deliberately based on ``reporter=user`` rather than the
    resident's community. A resident should never see another resident's
    filing activity in their personal dashboard chart.
    """
    today = timezone.localdate()
    if period == "today":
        current_start = today
        previous_start = today - timedelta(days=1)
        comparison_label = "yesterday"
        period_label = "Today"
    elif period == "month":
        current_start = today.replace(day=1)
        previous_start = (current_start - timedelta(days=1)).replace(day=1)
        comparison_label = "last month"
        period_label = "This month"
    else:
        period = "week"
        current_start = today - timedelta(days=6)
        previous_start = current_start - timedelta(days=7)
        comparison_label = "the previous 7 days"
        period_label = "This week"

    current_reports = list(
        Concern.objects.filter(
            reporter=user,
            created_at__date__gte=current_start,
            created_at__date__lte=today,
        ).select_related("ai_assessment", "community")
    )
    previous_reports = list(
        Concern.objects.filter(
            reporter=user,
            created_at__date__gte=previous_start,
            created_at__date__lt=current_start,
        ).select_related("ai_assessment", "community")
    )
    current_sos = list(
        EmergencyAlert.objects.filter(
            reporter=user,
            created_at__date__gte=current_start,
            created_at__date__lte=today,
            status__in=EMERGENCY_REPORTABLE,
        )
    )
    previous_sos = list(
        EmergencyAlert.objects.filter(
            reporter=user,
            created_at__date__gte=previous_start,
            created_at__date__lt=current_start,
            status__in=EMERGENCY_REPORTABLE,
        )
    )

    day_count = (today - current_start).days + 1
    by_day = {
        current_start + timedelta(days=offset): {
            "date": (current_start + timedelta(days=offset)).isoformat(),
            "submitted": 0,
            "resolved": 0,
            "critical": 0,
            "sos": 0,
            "severity": {"low": 0, "moderate": 0, "high": 0, "critical": 0},
        }
        for offset in range(day_count)
    }
    critical_total = 0
    for concern in current_reports:
        day = timezone.localtime(concern.created_at).date()
        point = by_day.get(day)
        if point is None:
            continue
        point["submitted"] += 1
        level = severity_label(concern)
        if level in point["severity"]:
            point["severity"][level] += 1
        if level == "critical":
            point["critical"] += 1
            critical_total += 1

    for sos in current_sos:
        day = timezone.localtime(sos.created_at).date()
        point = by_day.get(day)
        if point is None:
            continue
        point["submitted"] += 1
        point["critical"] += 1
        point["sos"] += 1
        point["severity"]["critical"] += 1
        critical_total += 1

    previous_critical_total = sum(
        severity_label(concern) == "critical" for concern in previous_reports
    ) + len(previous_sos)

    resolved_by_day = {
        row["day"]: row["total"]
        for row in ConcernStatusEvent.objects.filter(
            concern__reporter=user,
            status=Concern.Status.RESOLVED,
            created_at__date__gte=current_start,
            created_at__date__lte=today,
        )
        .annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(total=Count("concern_id", distinct=True))
        .order_by()
    }
    for day, total in resolved_by_day.items():
        if day in by_day:
            by_day[day]["resolved"] = total

    for sos in EmergencyAlert.objects.filter(
        reporter=user,
        status__in=EMERGENCY_SETTLED,
    ):
        resolved_at = sos.resolved_at or sos.updated_at
        day = timezone.localtime(resolved_at).date()
        if day in by_day:
            by_day[day]["resolved"] += 1

    current_total = len(current_reports) + len(current_sos)
    previous_total = len(previous_reports) + len(previous_sos)
    return {
        "period": period,
        "label": period_label,
        "comparison_label": comparison_label,
        "start_date": current_start.isoformat(),
        "end_date": today.isoformat(),
        "total": current_total,
        "previous_total": previous_total,
        "delta_count": current_total - previous_total,
        "delta_pct": pct_change(current_total, previous_total),
        "critical_total": critical_total,
        "previous_critical_total": previous_critical_total,
        "days": list(by_day.values()),
    }


def community_overview_counts(communities):
    today = timezone.localdate()
    month_start = today.replace(day=1)
    prev_start = (month_start - timedelta(days=1)).replace(day=1)
    week_start = today - timedelta(days=6)
    prev_week_start = week_start - timedelta(days=7)
    visible = Concern.objects.filter(
        community_id__in=communities,
        archived_at__isnull=True,
        duplicate_of__isnull=True,
    ).exclude(validation_status=Concern.ValidationStatus.PENDING)
    settled = ConcernStatusEvent.objects.filter(
        concern__in=visible, status=Concern.Status.RESOLVED
    )
    filed_month = visible.filter(created_at__date__gte=month_start).count()
    filed_prev = visible.filter(
        created_at__date__gte=prev_start, created_at__date__lt=month_start
    ).count()
    closed_month = (
        settled.filter(created_at__date__gte=month_start)
        .values("concern_id")
        .distinct()
        .count()
    )
    closed_prev = (
        settled.filter(
            created_at__date__gte=prev_start, created_at__date__lt=month_start
        )
        .values("concern_id")
        .distinct()
        .count()
    )
    community_active = visible.filter(status__in=CONCERN_ACTIVE).count()
    active_start = community_active - (filed_month - closed_month)
    filed_by_day = {
        row["day"]: row["total"]
        for row in visible.filter(created_at__date__gte=week_start)
        .annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(total=Count("id"))
        .order_by()
    }
    closed_by_day = {
        row["day"]: row["total"]
        for row in settled.filter(created_at__date__gte=week_start)
        .annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(total=Count("concern_id", distinct=True))
        .order_by()
    }
    week_days = []
    for offset in range(7):
        day = week_start + timedelta(days=offset)
        week_days.append(
            {
                "date": day.isoformat(),
                "submitted": filed_by_day.get(day, 0),
                "resolved": closed_by_day.get(day, 0),
            }
        )
    week_total = sum(point["submitted"] for point in week_days)
    week_prev_total = visible.filter(
        created_at__date__gte=prev_week_start, created_at__date__lt=week_start
    ).count()
    return {
        "community_total": visible.count(),
        "community_active": community_active,
        "community_in_progress": visible.filter(
            status=Concern.Status.IN_PROGRESS
        ).count(),
        "community_resolved": visible.filter(
            status=Concern.Status.RESOLVED
        ).count(),
        "delta_total_pct": pct_change(filed_month, filed_prev),
        "delta_active_pct": pct_change(community_active, active_start),
        "delta_resolved_pct": pct_change(closed_month, closed_prev),
        "week_total": week_total,
        "delta_week_pct": pct_change(week_total, week_prev_total),
        "week_days": week_days,
    }


def median(values):
    """Middle value, or None for an empty sequence.

    Deliberately not `Avg` in the database: the test lane runs on SQLite, which
    has no percentile function, and a mean would let one concern that sat open
    for six months describe a barangay that closes everything else in a day.
    """
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def elapsed_seconds(pairs):
    """Positive durations from (start, end) pairs, skipping reversed clocks."""
    return [
        (end - start).total_seconds()
        for start, end in pairs
        if start and end and end >= start
    ]


def official_units_for_user(user, communities):
    """Return the active units an official is allowed to use as a scope."""
    units = Department.objects.filter(
        community_id__in=communities,
        is_active=True,
    )
    if not user.is_superuser:
        units = units.filter(
            designations__user=user,
            designations__is_active=True,
        )
    return units.distinct().order_by("sort_order", "name")


def selected_official_unit(request, user, communities):
    """Resolve the requested unit without allowing cross-unit data access."""
    units = official_units_for_user(user, communities)
    raw_unit_id = request.query_params.get("unit_id")
    if raw_unit_id:
        try:
            unit_id = int(raw_unit_id)
        except (TypeError, ValueError):
            return None, Response(
                {"detail": "unit_id must be a valid unit id."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        unit = units.filter(pk=unit_id).first()
        if unit is None:
            return None, Response(
                {"detail": "You do not have access to that unit."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return unit, None
    # A superuser is the cross-unit overview audience. With no explicit unit
    # selected, keep the queryset unscoped so the dashboard totals represent
    # every active unit in the community; choosing a unit still scopes it.
    return (None if user.is_superuser else units.first()), None


def official_visible_concerns(communities):
    """The canonical official queue base, excluding hidden/duplicate rows."""
    return Concern.objects.filter(
        community_id__in=communities,
        archived_at__isnull=True,
        duplicate_of__isnull=True,
    ).exclude(validation_status=Concern.ValidationStatus.PENDING)


def official_unit_concerns(concerns, unit):
    """Apply the effective routing unit to an official concern queryset."""
    if unit is None:
        return concerns
    return concerns.filter(
        Q(assigned_department_id=unit.pk)
        | Q(
            assigned_department_id__isnull=True,
            category_ref__department_id=unit.pk,
        )
    )


def official_emergency_scope(communities, community_names=None):
    """Return SOS records belonging to the communities in the dashboard."""
    if community_names is None:
        community_names = Community.objects.filter(
            pk__in=communities,
        ).values_list("name", flat=True)
    return EmergencyAlert.objects.filter(
        Q(community_id__in=communities)
        | Q(community_id__isnull=True, barangay__in=community_names),
        status__in=EMERGENCY_REPORTABLE,
    )


def official_unit_emergencies(emergencies, unit):
    """Apply the configured SOS routing unit to an emergency queryset."""
    if unit is None:
        return emergencies

    # `preferred_departments_for` applies the same explicit role-map,
    # declared-unit and legacy fallback order used by dispatch. Keeping that
    # rule here prevents an SOS from disappearing from a unit simply because
    # it has no assignment yet.
    from apps.emergencies.views import preferred_departments_for

    unit_emergency_types = {
        emergency_type
        for emergency_type, _label in EmergencyAlert.Type.choices
        if unit.pk
        in {
            department.pk
            for department in preferred_departments_for(
                emergency_type,
                unit.community,
            )
        }
    }
    return emergencies.filter(
        Q(type__in=unit_emergency_types)
        | Q(assignments__role_map__department_id=unit.pk)
        | Q(
            assignments__responder__designations__department_id=unit.pk,
            assignments__responder__designations__is_active=True,
        )
    ).distinct()


def official_period_bounds(period):
    today = timezone.localdate()
    if period == "today":
        return today, today - timedelta(days=1), "yesterday", "Today"
    if period == "month":
        start = today.replace(day=1)
        return start, (start - timedelta(days=1)).replace(day=1), "last month", "This month"
    start = today - timedelta(days=6)
    return start, start - timedelta(days=7), "the previous 7 days", "This week"


def official_report_overview(concerns, period, emergencies=None):
    """Build unit activity data across routine reports and SOS alerts."""
    current_start, previous_start, comparison_label, period_label = official_period_bounds(period)
    today = timezone.localdate()
    if emergencies is None:
        emergencies = EmergencyAlert.objects.none()
    current_reports = list(
        concerns.filter(
            created_at__date__gte=current_start,
            created_at__date__lte=today,
        ).select_related("ai_assessment")
    )
    previous_reports = list(
        concerns.filter(
            created_at__date__gte=previous_start,
            created_at__date__lt=current_start,
        ).select_related("ai_assessment")
    )
    current_emergencies = list(
        emergencies.filter(
            created_at__date__gte=current_start,
            created_at__date__lte=today,
            status__in=EMERGENCY_REPORTABLE,
        )
    )
    previous_emergencies = list(
        emergencies.filter(
            created_at__date__gte=previous_start,
            created_at__date__lt=current_start,
            status__in=EMERGENCY_REPORTABLE,
        )
    )

    by_day = {
        current_start + timedelta(days=offset): {
            "date": (current_start + timedelta(days=offset)).isoformat(),
            "submitted": 0,
            "resolved": 0,
            "critical": 0,
            "sos": 0,
            "severity": {"low": 0, "moderate": 0, "high": 0, "critical": 0},
        }
        for offset in range((today - current_start).days + 1)
    }
    critical_total = 0
    for concern in current_reports:
        point = by_day.get(timezone.localtime(concern.created_at).date())
        if point is None:
            continue
        point["submitted"] += 1
        level = severity_label(concern)
        if level in point["severity"]:
            point["severity"][level] += 1
        if level == "critical":
            point["critical"] += 1
            critical_total += 1

    for emergency in current_emergencies:
        point = by_day.get(timezone.localtime(emergency.created_at).date())
        if point is None:
            continue
        point["submitted"] += 1
        # SOS reports are the critical lane by definition.
        point["critical"] += 1
        point["sos"] += 1
        point["severity"]["critical"] += 1
        critical_total += 1

    resolved_by_day = {
        row["day"]: row["total"]
        for row in ConcernStatusEvent.objects.filter(
            concern__in=concerns,
            status=Concern.Status.RESOLVED,
            created_at__date__gte=current_start,
            created_at__date__lte=today,
        )
        .annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(total=Count("concern_id", distinct=True))
        .order_by()
    }
    for day, total in resolved_by_day.items():
        if day in by_day:
            by_day[day]["resolved"] = total

    for emergency in current_emergencies:
        if emergency.status not in EMERGENCY_SETTLED:
            continue
        resolved_at = emergency.resolved_at or emergency.updated_at
        day = timezone.localtime(resolved_at).date()
        if day in by_day:
            by_day[day]["resolved"] += 1

    current_total = len(current_reports) + len(current_emergencies)
    previous_total = len(previous_reports) + len(previous_emergencies)
    return {
        "period": period,
        "label": period_label,
        "comparison_label": comparison_label,
        "start_date": current_start.isoformat(),
        "end_date": today.isoformat(),
        "total": current_total,
        "previous_total": previous_total,
        "delta_count": current_total - previous_total,
        "delta_pct": pct_change(current_total, previous_total),
        "critical_total": critical_total,
        "previous_critical_total": sum(
            severity_label(concern) == "critical" for concern in previous_reports
        ) + len(previous_emergencies),
        "days": list(by_day.values()),
    }


def official_unit_payload(unit):
    if unit is None:
        return None
    return {
        "id": unit.pk,
        "code": unit.code,
        "name": unit.name,
        "short_name": unit.short_name,
    }


def official_summary_counts(concerns, emergencies=None):
    if emergencies is None:
        emergencies = EmergencyAlert.objects.none()
    countable = concerns.exclude(status=Concern.Status.REJECTED)
    return {
        "total": countable.count()
        + emergencies.exclude(status__in=EMERGENCY_NON_COUNTABLE).count(),
        "active": concerns.filter(status__in=CONCERN_ACTIVE).count()
        + emergencies.filter(status__in=EMERGENCY_ACTIVE).count(),
        "resolved": concerns.filter(status=Concern.Status.RESOLVED).count()
        + emergencies.filter(status__in=EMERGENCY_SETTLED).count(),
    }


def official_report_payload(concern):
    category = concern.category_ref
    unit = concern.assigned_department or getattr(category, "department", None)
    return {
        "id": concern.pk,
        "record_type": "concern",
        "public_id": str(concern.public_id),
        "tracking_id": concern.tracking_id,
        "title": concern.title,
        "official_title": concern.official_title or concern.title,
        "summary": concern.summary or concern.description,
        "category": concern.category,
        "category_ref": (
            {
                "id": category.pk,
                "code": category.code,
                "name": category.name,
                "icon_key": category.icon_key,
                "custom_icon_label": category.custom_icon_label,
            }
            if category
            else None
        ),
        "status": concern.status,
        "severity": severity_label(concern),
        "address": concern.address,
        "barangay": concern.barangay,
        "assigned_department": official_unit_payload(unit),
        "created_at": concern.created_at.isoformat(),
    }


def official_emergency_payload(alert):
    """Expose an SOS in the same compact shape as an overview report row."""
    from apps.emergencies.description import title_for_display
    from apps.emergencies.location_services import display_location
    from apps.emergencies.views import preferred_departments_for

    departments = preferred_departments_for(alert.type, alert.community)
    unit = departments[0] if departments else None
    return {
        "id": alert.pk,
        "record_type": "emergency",
        "emergency_id": alert.pk,
        "public_id": str(alert.public_id),
        "tracking_id": f"E-{alert.pk}",
        "title": title_for_display(alert),
        "official_title": title_for_display(alert),
        # The row header is the generated incident title; the long resident
        # description stays inside the detail view, never on the overview row.
        "summary": "",
        "category": "public_safety",
        "category_ref": None,
        "status": (
            Concern.Status.RESOLVED
            if alert.status in EMERGENCY_SETTLED
            else Concern.Status.IN_PROGRESS
        ),
        "severity": "critical",
        "address": display_location(alert),
        "barangay": alert.barangay,
        "assigned_department": official_unit_payload(unit),
        "created_at": alert.created_at.isoformat(),
    }


def official_recent_reports(concerns, emergencies, limit=3):
    """Overview rows in the shared queue sequence: Critical → High → Moderate
    → Low → Resolved → Rejected, most recent within a band.

    Open concerns form the whole candidate pool — a recency slice would let
    newer minor reports crowd a severe older one off the card. Settled rows
    can never outrank an open band, so only the newest few of each settled
    kind are needed.
    """
    open_rows = list(
        concerns.filter(status__in=CONCERN_ACTIVE)
        .select_related(
            "ai_assessment",
            "assigned_department",
            "category_ref__department",
        )
        .order_by("-created_at", "-id")
    )
    resolved_rows = list(
        concerns.filter(status=Concern.Status.RESOLVED)
        .select_related(
            "ai_assessment",
            "assigned_department",
            "category_ref__department",
        )
        .order_by("-created_at", "-id")[:limit]
    )
    rejected_rows = list(
        concerns.filter(status=Concern.Status.REJECTED)
        .select_related(
            "ai_assessment",
            "assigned_department",
            "category_ref__department",
        )
        .order_by("-created_at", "-id")[:limit]
    )
    emergency_rows = list(
        emergencies.filter(status__in=EMERGENCY_ACTIVE)
        .select_related("community")
        .order_by("-created_at", "-id")[:limit]
    )
    settled_emergency_rows = list(
        emergencies.filter(status__in=EMERGENCY_SETTLED)
        .select_related("community")
        .order_by("-created_at", "-id")[:limit]
    )
    rows = [
        *(official_report_payload(item) for item in open_rows),
        *(official_report_payload(item) for item in resolved_rows),
        *(official_report_payload(item) for item in rejected_rows),
        *(official_emergency_payload(item) for item in emergency_rows),
        *(official_emergency_payload(item) for item in settled_emergency_rows),
    ]

    def sequence_rank(item):
        # Emergencies always arrive as criticals; a settled one is reported
        # with status "resolved"/"closed", which must rank below all open
        # severity bands, and rejected below resolved.
        status = item["status"]
        if status in ("resolved", "closed"):
            return 0
        if status == "rejected":
            return -1
        return {"critical": 4, "high": 3, "moderate": 2, "low": 1}.get(
            item["severity"], 1
        )

    rows.sort(
        key=lambda item: (
            sequence_rank(item),
            item["created_at"],
            item["id"],
        ),
        reverse=True,
    )
    return rows[:limit]


def official_critical_report(concerns, emergencies=None):
    candidates = list(
        concerns.filter(status__in=CONCERN_ACTIVE)
        .select_related(
            "ai_assessment",
            "assigned_department",
            "category_ref__department",
        )
        .annotate(vote_count=Count("votes", distinct=True))
    )
    critical = [item for item in candidates if severity_label(item) == "critical"]
    selected = (
        max(
            critical,
            key=lambda item: (item.updated_at, item.pk),
        )
        if critical
        else None
    )
    emergency = None
    if emergencies is not None:
        emergency = (
            emergencies.filter(status__in=EMERGENCY_ACTIVE)
            .order_by("-created_at", "-id")
            .first()
        )
    if emergency is not None:
        return official_emergency_payload(emergency)
    return official_report_payload(selected) if selected else None


def responder_unit_dashboard(request, user):
    """Return the responder's current unit scope for the overview page.

    Responders work from the unit they belong to, not from the reports that
    happen to be assigned directly to their individual account. The unit is
    resolved on the server so the client cannot select another responder's
    unit.
    """
    communities = set(community_ids_for_user(user))
    assigned = assigned_unit_for(user)
    unit = None
    if assigned and assigned.get("id"):
        unit = Department.objects.filter(
            pk=assigned["id"],
            is_active=True,
        ).first()
        if unit is not None:
            communities.add(unit.community_id)

    community_names = Community.objects.filter(
        pk__in=communities,
    ).values_list("name", flat=True)
    concerns = official_visible_concerns(communities)
    scoped = official_unit_concerns(concerns, unit)
    emergencies = official_emergency_scope(communities, community_names)
    scoped_emergencies = official_unit_emergencies(emergencies, unit)
    requested_period = str(request.query_params.get("period", "week")).lower()
    period = requested_period if requested_period in REPORT_PERIODS else "week"

    return {
        "unit": official_unit_payload(unit),
        "community_name": " · ".join(sorted(community_names)) or "Community",
        "unit_totals": official_summary_counts(scoped, scoped_emergencies),
        "community_totals": official_summary_counts(concerns, emergencies),
        "report_overview": official_report_overview(
            scoped,
            period,
            scoped_emergencies,
        ),
        "recent_reports": official_recent_reports(scoped, scoped_emergencies),
        "critical_report": official_critical_report(scoped, scoped_emergencies),
    }


class OfficialDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not is_official(request.user):
            return Response({"detail": "You do not have permission to view official summaries."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        communities = community_ids_for_user(request.user)
        selected_unit, unit_error = selected_official_unit(
            request,
            request.user,
            communities,
        )
        if unit_error is not None:
            return unit_error
        visible = official_visible_concerns(communities)
        scoped = official_unit_concerns(visible, selected_unit)
        from apps.emergencies.models import Community

        community_names = Community.objects.filter(pk__in=communities).values_list("name", flat=True)
        emergencies = official_emergency_scope(communities, community_names)
        scoped_emergencies = official_unit_emergencies(emergencies, selected_unit)
        community_center = (
            Community.objects.filter(pk__in=communities)
            .exclude(center_latitude__isnull=True)
            .exclude(center_longitude__isnull=True)
            .order_by("name")
            .values("center_latitude", "center_longitude")
            .first()
        )
        users = User.objects.filter(
            Q(resident_profile__community_id__in=communities)
            | Q(designations__is_active=True, designations__department__community_id__in=communities)
        ).distinct()
        return Response({
            **common_counts(request.user),
            "new_concerns": Concern.objects.filter(
                community_id__in=communities,
                status=Concern.Status.SUBMITTED,
                validation_status=Concern.ValidationStatus.ACCEPTED,
            ).count(),
            "active_reports": Concern.objects.filter(community_id__in=communities, status__in=CONCERN_ACTIVE).count(),
            "appealed_reports": Concern.objects.filter(community_id__in=communities, status=Concern.Status.APPEALED).count(),
            "pending_appeals": ConcernAppeal.objects.filter(concern__community_id__in=communities, status=ConcernAppeal.Status.SUBMITTED).count(),
            "active_emergencies": emergencies.filter(status__in=EMERGENCY_ACTIVE).count(),
            "community_center": (
                {
                    "latitude": float(community_center["center_latitude"]),
                    "longitude": float(community_center["center_longitude"]),
                }
                if community_center
                else None
            ),
            "pending_emergency_appeals": EmergencyAppeal.objects.filter(alert__community_id__in=communities, status=EmergencyAppeal.Status.SUBMITTED).count(),
            "responders_on_duty": users.filter(role=User.Role.FIRST_RESPONDER, status=User.Status.VERIFIED, is_on_duty=True).count(),
            "pending_resident_verifications": users.filter(role=User.Role.RESIDENT, status=User.Status.PENDING_VERIFICATION).count(),
            "pending_content_flags": ContentFlag.objects.filter(
                Q(concern__community_id__in=communities)
                | Q(comment__concern__community_id__in=communities)
                | Q(announcement_comment__announcement__community_id__in=communities)
                | Q(emergency_comment__alert__community_id__in=communities),
                status=ContentFlag.Status.SUBMITTED,
            ).distinct().count(),
            "pending_account_requests": AccountRequest.objects.filter(user__in=users, status=AccountRequest.Status.SUBMITTED).count(),
            # The mobile Alerts tab uses this compact target. Keep it on the
            # existing summary request so navigation does not fetch analytics.
            "critical_report": (
                official_critical_report(scoped, scoped_emergencies)
                or (
                    official_critical_report(visible, emergencies)
                    if selected_unit
                    else None
                )
            ),
        })

class OfficialAnalyticsView(APIView):
    """Every figure the official overview draws, computed in the database.

    The overview used to derive its charts from `GET /api/concerns/manage/`,
    which is paginated at twenty rows, so a card labelled "All time" was in
    fact describing the twenty most recent concerns. Aggregating here is the
    only way those numbers can be true. It also drops a payload that was
    carrying media, comments, status events and AI assessments across the wire
    purely so the browser could count rows.

    Scope is `community_ids_for_user`, not `scope_concern_queryset`. That
    helper answers "may this person see this record", so it ORs in the caller's
    own reports and every public concern — which would drop an official's
    personal filings from another barangay into their own barangay's workload.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not is_official(request.user):
            return Response(
                {"detail": "You do not have permission to view official analytics."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # The emergency board's own set, not the six-status `EMERGENCY_ACTIVE`
        # above: the masthead count has to agree with what an official sees when
        # they open `/dashboard/emergencies`. Imported inside the method because
        # `emergencies.views` pulls a large dependency graph that would make this
        # a circular import at module load.
        from apps.emergencies.views import ACTIVE_STATUSES as EMERGENCY_LIVE
        from apps.emergencies.models import Community

        User = get_user_model()
        communities = community_ids_for_user(request.user)
        community_names = Community.objects.filter(
            pk__in=communities,
        ).values_list("name", flat=True)
        requested_period = str(request.query_params.get("period", "week")).lower()
        period = requested_period if requested_period in REPORT_PERIODS else "week"
        selected_unit, unit_error = selected_official_unit(
            request,
            request.user,
            communities,
        )
        if unit_error is not None:
            return unit_error
        today = timezone.localdate()
        start = today - timedelta(days=ANALYTICS_WINDOW_DAYS - 1)

        # Merged children and archived rows are excluded for the same reason the
        # page excluded them client-side: a recurrence filed against an existing
        # incident is not a second piece of work. Concerns still awaiting
        # validation are excluded to match `/api/concerns/manage/`
        # (concerns/views.py:890), so these figures reconcile with the queue the
        # official clicks through to.
        concerns = official_visible_concerns(communities)
        emergencies = official_emergency_scope(communities, community_names)
        window = concerns.filter(created_at__date__gte=start)
        emergency_window = emergencies.filter(
            created_at__date__gte=start,
            status__in=EMERGENCY_REPORTABLE,
        )
        scoped_concerns = official_unit_concerns(concerns, selected_unit)
        scoped_emergencies = official_unit_emergencies(emergencies, selected_unit)
        unit_totals = official_summary_counts(scoped_concerns, scoped_emergencies)
        community_totals = official_summary_counts(concerns, emergencies)
        unit_recent_reports = official_recent_reports(
            scoped_concerns,
            scoped_emergencies,
        )
        unit_critical = official_critical_report(
            scoped_concerns,
            scoped_emergencies,
        )
        critical_report = unit_critical or (
            official_critical_report(concerns, emergencies)
            if selected_unit
            else None
        )

        counts = concerns.aggregate(
            open=Count("id", filter=Q(status__in=CONCERN_OPEN)),
            working=Count("id", filter=Q(status__in=CONCERN_WORKING)),
            settled=Count("id", filter=Q(status__in=CONCERN_SETTLED)),
            new_today=Count("id", filter=Q(created_at__date=today)),
            filed_window=Count("id", filter=Q(created_at__date__gte=start)),
        )
        counts["open"] += emergencies.filter(status__in=EMERGENCY_OPEN).count()
        counts["working"] += emergencies.filter(status__in=EMERGENCY_WORKING).count()
        counts["new_today"] += emergencies.filter(
            created_at__date=today,
            status__in=EMERGENCY_REPORTABLE,
        ).count()
        counts["filed_window"] += emergency_window.count()
        counts["settled"] += emergencies.filter(status__in=EMERGENCY_SETTLED).count()

        # `TruncDate` rather than the `DATE()` string this codebase reaches for
        # elsewhere: with USE_TZ on and TIME_ZONE at Asia/Manila, only the ORM
        # function converts before truncating, so a concern filed at 8am local
        # lands on today rather than yesterday.
        filed_by_day = {
            row["day"]: row["total"]
            for row in window.annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(total=Count("id"))
            .order_by()
        }
        for row in (
            emergency_window.annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(total=Count("id"))
            .order_by()
        ):
            filed_by_day[row["day"]] = filed_by_day.get(row["day"], 0) + row["total"]
        # Counted distinct on the concern, not on the event: a concern can go
        # resolved, be appealed, and be resolved again, and that is one closure
        # per day at most — not two.
        closed_by_day = {
            row["day"]: row["total"]
            for row in ConcernStatusEvent.objects.filter(
                concern__in=concerns,
                status__in=CONCERN_SETTLED,
                created_at__date__gte=start,
            )
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(total=Count("concern_id", distinct=True))
            .order_by()
        }
        for alert in emergency_window.filter(status__in=EMERGENCY_SETTLED):
            resolved_at = alert.resolved_at or alert.updated_at
            day = timezone.localtime(resolved_at).date()
            closed_by_day[day] = closed_by_day.get(day, 0) + 1

        series = []
        for offset in range(ANALYTICS_WINDOW_DAYS):
            day = start + timedelta(days=offset)
            series.append(
                {
                    "date": day.isoformat(),
                    "filed": filed_by_day.get(day, 0),
                    "closed": closed_by_day.get(day, 0),
                }
            )
        closed_window = sum(point["closed"] for point in series)

        category_labels = dict(Concern.Category.choices)
        by_category = [
            {
                "code": row["category"],
                "label": category_labels.get(row["category"], row["category"]),
                "total": row["total"],
            }
            for row in window.values("category").annotate(total=Count("id")).order_by("-total")
        ]

        # A concern has no `resolved_at` column, so the moment it was resolved
        # has to come from its status history.
        # `-id` breaks the tie because `created_at` is auto_now_add and two
        # events written in one transaction can share a timestamp; without it a
        # reopened-then-resolved concern can pick up its first resolution.
        resolved_at = Subquery(
            ConcernStatusEvent.objects.filter(
                concern=OuterRef("pk"),
                status=Concern.Status.RESOLVED,
            )
            .order_by("-created_at", "-id")
            .values("created_at")[:1]
        )
        resolution_seconds = median(
            elapsed_seconds(
                concerns.filter(status=Concern.Status.RESOLVED)
                .annotate(resolved_at=resolved_at)
                .filter(resolved_at__isnull=False, resolved_at__date__gte=start)
                .values_list("created_at", "resolved_at")[:5000]
            )
            + elapsed_seconds(
                emergencies.filter(
                    status__in=EMERGENCY_SETTLED,
                    resolved_at__isnull=False,
                    created_at__date__gte=start,
                ).values_list("created_at", "resolved_at")
            )
        )

        # The gauge is windowed like everything else on the page: of the work
        # this barangay finished in the last 30 days, how much of it ended with
        # a fix rather than a rejection.
        closure = (
            ConcernStatusEvent.objects.filter(
                concern__in=concerns,
                status__in=CONCERN_SETTLED,
                created_at__date__gte=start,
            )
            .aggregate(
                settled=Count("concern_id", distinct=True),
                resolved=Count(
                    "concern_id",
                    distinct=True,
                    filter=Q(status=Concern.Status.RESOLVED),
                ),
            )
        )

        emergency_closure = emergencies.filter(
            status__in=EMERGENCY_SETTLED,
            created_at__date__gte=start,
        ).count()
        emergency_resolved = emergencies.filter(
            status=EmergencyAlert.Status.RESOLVED,
            created_at__date__gte=start,
        ).count()
        response_seconds = median(
            elapsed_seconds(
                emergencies.filter(
                    resolved_at__isnull=False,
                    created_at__date__gte=start,
                ).values_list("created_at", "resolved_at")
            )
        )

        attention = [
            {
                "id": concern.pk,
                "tracking_id": concern.tracking_id,
                "title": concern.title,
                "unit": (
                    concern.assigned_department.name or concern.assigned_department.short_name
                    if concern.assigned_department
                    else ""
                ),
                "status": concern.status,
                "created_at": concern.created_at.isoformat(),
            }
            for concern in concerns.filter(status__in=CONCERN_OPEN | CONCERN_WORKING)
            .select_related("assigned_department")
            .order_by("created_at")[:5]
        ]

        settled = closure["settled"] + emergency_closure
        resolved = closure["resolved"] + emergency_resolved
        return Response(
            {
                "window_days": ANALYTICS_WINDOW_DAYS,
                "generated_at": timezone.now().isoformat(),
                "totals": {
                    "open": counts["open"],
                    "working": counts["working"],
                    "new_today": counts["new_today"],
                    "filed_window": counts["filed_window"],
                    "closed_window": closed_window,
                    "net_window": counts["filed_window"] - closed_window,
                },
                # The share bar answers "where does the whole caseload sit right
                # now", so unlike the charts it is not windowed.
                "share": {
                    "open": counts["open"],
                    "working": counts["working"],
                    "closed": counts["settled"],
                },
                "series": series,
                "by_category": by_category,
                "resolution": {
                    "rate_percent": round(resolved / settled * 100) if settled else 0,
                    "resolved": resolved,
                    "settled": settled,
                    "median_days": (
                        round(resolution_seconds / 86400, 1)
                        if resolution_seconds is not None
                        else None
                    ),
                },
                "emergencies": {
                    "active": emergencies.filter(status__in=EMERGENCY_LIVE).count(),
                    "responders_on_duty": User.objects.filter(
                        role=User.Role.FIRST_RESPONDER,
                        status=User.Status.VERIFIED,
                        is_on_duty=True,
                        designations__is_active=True,
                        designations__department__community_id__in=communities,
                    )
                    .distinct()
                    .count(),
                    "median_response_minutes": (
                        round(response_seconds / 60, 1) if response_seconds is not None else None
                    ),
                },
                "attention": attention,
                "unit": official_unit_payload(selected_unit),
                "community_name": " · ".join(sorted(community_names)) or "Community",
                "unit_totals": unit_totals,
                "community_totals": community_totals,
                "report_overview": official_report_overview(
                    scoped_concerns,
                    period,
                    scoped_emergencies,
                ),
                "recent_reports": unit_recent_reports,
                "critical_report": critical_report,
            }
        )


class ResponderDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        User = get_user_model()
        if not (request.user.is_superuser or request.user.role == User.Role.FIRST_RESPONDER):
            return Response({"detail": "You do not have permission to view responder summaries."}, status=status.HTTP_403_FORBIDDEN)
        assigned = EmergencyResponderAssignment.objects.filter(responder=request.user)
        newly_routed = assigned.filter(
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            alert__status=EmergencyAlert.Status.ROUTED,
        ).count()
        dashboard = responder_unit_dashboard(request, request.user)
        return Response({
            **common_counts(request.user),
            "is_on_duty": request.user.is_on_duty,
            "responder_unit": request.user.responder_unit,
            # The unit as the barangay configured it in the Units screen. The
            # responder screens show this rather than the legacy enum, so a unit
            # an official created appears under its real name. None means nobody
            # has placed this responder in a unit yet.
            "assigned_unit": assigned_unit_for(request.user),
            **dashboard,
            "assigned_active_emergencies": assigned.filter(alert__status__in=EMERGENCY_ACTIVE).count(),
            "assigned_resolved_emergencies": assigned.filter(alert__status=EmergencyAlert.Status.RESOLVED).count(),
            "newly_routed": newly_routed,
            # Transitional response key for older clients. No acknowledgement
            # action exists; this now carries the same newly-routed count.
            "awaiting_acknowledgement": newly_routed,
        })
