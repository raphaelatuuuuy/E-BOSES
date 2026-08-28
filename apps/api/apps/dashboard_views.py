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
)
from apps.concerns.units import assigned_unit_for
from apps.emergencies.models import EmergencyAlert, EmergencyAppeal, EmergencyResponderAssignment
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

EMERGENCY_ACTIVE = {
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTED,
    EmergencyAlert.Status.ACKNOWLEDGED,
    EmergencyAlert.Status.EN_ROUTE,
    EmergencyAlert.Status.NEARBY,
    EmergencyAlert.Status.ARRIVED,
}

def common_counts(user):
    today = timezone.localdate()
    from django.core.cache import cache

    shared_key = f"dashboard:shared-counts:v1:{today.isoformat()}"
    try:
        shared = cache.get(shared_key)
    except Exception:
        shared = None
    if shared is None:
        shared = {
            "published_announcements": Announcement.objects.filter(is_published=True).count(),
            "events_today": BarangayEvent.objects.filter(is_published=True, starts_at__date=today).count(),
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
        mine = Concern.objects.filter(reporter=request.user)
        emergencies = EmergencyAlert.objects.filter(reporter=request.user)
        # Barangay-wide active emergencies (for home rail red state + feed banner)
        barangay_active = EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE).count()
        return Response({
            **common_counts(request.user),
            "reports_total": mine.count(),
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
        })

def is_official(user):
    User = get_user_model()
    return bool(user.is_staff or user.is_superuser or user.role == User.Role.BARANGAY_OFFICIAL)


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


class OfficialDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not is_official(request.user):
            return Response({"detail": "You do not have permission to view official summaries."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        return Response({
            **common_counts(request.user),
            "new_concerns": Concern.objects.filter(
                status=Concern.Status.SUBMITTED,
                validation_status=Concern.ValidationStatus.ACCEPTED,
            ).count(),
            "active_reports": Concern.objects.filter(status__in=CONCERN_ACTIVE).count(),
            "appealed_reports": Concern.objects.filter(status=Concern.Status.APPEALED).count(),
            "pending_appeals": ConcernAppeal.objects.filter(status=ConcernAppeal.Status.SUBMITTED).count(),
            "active_emergencies": EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE).count(),
            "pending_emergency_appeals": EmergencyAppeal.objects.filter(status=EmergencyAppeal.Status.SUBMITTED).count(),
            "responders_on_duty": User.objects.filter(role=User.Role.FIRST_RESPONDER, status=User.Status.VERIFIED, is_on_duty=True).count(),
            "pending_resident_verifications": User.objects.filter(role=User.Role.RESIDENT, status=User.Status.PENDING_VERIFICATION).count(),
            "pending_content_flags": ContentFlag.objects.filter(status=ContentFlag.Status.SUBMITTED).count(),
            "pending_account_requests": AccountRequest.objects.filter(status=AccountRequest.Status.SUBMITTED).count(),
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

        User = get_user_model()
        communities = community_ids_for_user(request.user)
        today = timezone.localdate()
        start = today - timedelta(days=ANALYTICS_WINDOW_DAYS - 1)

        # Merged children and archived rows are excluded for the same reason the
        # page excluded them client-side: a recurrence filed against an existing
        # incident is not a second piece of work. Concerns still awaiting
        # validation are excluded to match `/api/concerns/manage/`
        # (concerns/views.py:890), so these figures reconcile with the queue the
        # official clicks through to.
        concerns = Concern.objects.filter(
            community_id__in=communities,
            archived_at__isnull=True,
            duplicate_of__isnull=True,
        ).exclude(validation_status=Concern.ValidationStatus.PENDING)
        window = concerns.filter(created_at__date__gte=start)

        counts = concerns.aggregate(
            open=Count("id", filter=Q(status__in=CONCERN_OPEN)),
            working=Count("id", filter=Q(status__in=CONCERN_WORKING)),
            settled=Count("id", filter=Q(status__in=CONCERN_SETTLED)),
            new_today=Count("id", filter=Q(created_at__date=today)),
            filed_window=Count("id", filter=Q(created_at__date__gte=start)),
        )

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

        emergencies = EmergencyAlert.objects.filter(community_id__in=communities)
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

        settled = closure["settled"]
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
                    "rate_percent": round(closure["resolved"] / settled * 100) if settled else 0,
                    "resolved": closure["resolved"],
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
            }
        )


class ResponderDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        User = get_user_model()
        if not (request.user.is_staff or request.user.is_superuser or request.user.role == User.Role.FIRST_RESPONDER):
            return Response({"detail": "You do not have permission to view responder summaries."}, status=status.HTTP_403_FORBIDDEN)
        assigned = EmergencyResponderAssignment.objects.filter(responder=request.user)
        newly_routed = assigned.filter(
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            alert__status=EmergencyAlert.Status.ROUTED,
        ).count()
        return Response({
            **common_counts(request.user),
            "is_on_duty": request.user.is_on_duty,
            "responder_unit": request.user.responder_unit,
            # The unit as the barangay configured it in the Units screen. The
            # responder screens show this rather than the legacy enum, so a unit
            # an official created appears under its real name. None means nobody
            # has placed this responder in a unit yet.
            "assigned_unit": assigned_unit_for(request.user),
            "assigned_active_emergencies": assigned.filter(alert__status__in=EMERGENCY_ACTIVE).count(),
            "assigned_resolved_emergencies": assigned.filter(alert__status=EmergencyAlert.Status.RESOLVED).count(),
            "newly_routed": newly_routed,
            # Transitional response key for older clients. No acknowledgement
            # action exists; this now carries the same newly-routed count.
            "awaiting_acknowledgement": newly_routed,
        })
