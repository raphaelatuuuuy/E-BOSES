from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AccountRequest
from apps.accounts.views import touch_last_seen
from apps.concerns.models import Announcement, BarangayEvent, Concern, ContentFlag
from apps.emergencies.models import EmergencyAlert, EmergencyResponderAssignment
from apps.notifications.models import Notification

CONCERN_ACTIVE = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
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
    return {
        "unread_notifications": Notification.objects.filter(recipient=user, is_read=False).count(),
        "published_announcements": Announcement.objects.filter(is_published=True).count(),
        "events_today": BarangayEvent.objects.filter(is_published=True, starts_at__date=today).count(),
    }

class ResidentDashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        mine = Concern.objects.filter(reporter=request.user)
        emergencies = EmergencyAlert.objects.filter(reporter=request.user)
        return Response({
            **common_counts(request.user),
            "reports_total": mine.count(),
            "reports_active": mine.filter(status__in=CONCERN_ACTIVE).count(),
            "reports_resolved": mine.filter(status=Concern.Status.RESOLVED).count(),
            "reports_appealed": mine.filter(status=Concern.Status.APPEALED).count(),
            "active_emergencies": emergencies.filter(status__in=EMERGENCY_ACTIVE).count(),
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
            "pending_reviews": Concern.objects.filter(status=Concern.Status.SUBMITTED).count(),
            "active_reports": Concern.objects.filter(status__in=CONCERN_ACTIVE).count(),
            "appealed_reports": Concern.objects.filter(status=Concern.Status.APPEALED).count(),
            "active_emergencies": EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE).count(),
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
        return Response({
            **common_counts(request.user),
            "is_on_duty": request.user.is_on_duty,
            "responder_unit": request.user.responder_unit,
            "assigned_active_emergencies": assigned.filter(alert__status__in=EMERGENCY_ACTIVE).count(),
            "assigned_resolved_emergencies": assigned.filter(alert__status=EmergencyAlert.Status.RESOLVED).count(),
            "awaiting_acknowledgement": assigned.filter(status=EmergencyResponderAssignment.Status.ASSIGNED).count(),
        })
