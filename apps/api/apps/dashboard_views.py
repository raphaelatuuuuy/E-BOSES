from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AccountRequest
from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.accounts.views import touch_last_seen
from apps.concerns.models import Announcement, BarangayEvent, Concern, ConcernAppeal, ContentFlag
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

class OfficialDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        User = get_user_model()
        if not (request.user.is_staff or request.user.is_superuser or request.user.role == User.Role.BARANGAY_OFFICIAL):
            return Response({"detail": "You do not have permission to view official summaries."}, status=status.HTTP_403_FORBIDDEN)
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
