"""Scrolling notices and maintenance mode."""

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.throttling import SystemStatusThrottle

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.emergencies.models import EmergencyAlert

from .community_api import is_official
from .models import SystemBanner


OPEN_EMERGENCY_STATUSES = [
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTING,
    EmergencyAlert.Status.ROUTED,
    EmergencyAlert.Status.AWAITING_ACKNOWLEDGMENT,
    EmergencyAlert.Status.ACKNOWLEDGED,
    EmergencyAlert.Status.EN_ROUTE,
    EmergencyAlert.Status.NEARBY,
    EmergencyAlert.Status.ARRIVED,
    EmergencyAlert.Status.BACKUP_REQUESTED,
    EmergencyAlert.Status.BACKUP_ASSIGNED,
    EmergencyAlert.Status.IN_PROGRESS,
    EmergencyAlert.Status.TRANSFER_REQUIRED,
    EmergencyAlert.Status.ESCALATION_REQUIRED,
]


def active_emergencies():
    return EmergencyAlert.objects.filter(status__in=OPEN_EMERGENCY_STATUSES)


def serialize(banner):
    if banner is None:
        return None
    return {
        "id": banner.pk,
        "kind": banner.kind,
        "tone": banner.tone,
        "message": banner.message,
        "detail": banner.detail,
        "starts_at": banner.starts_at,
        "ends_at": banner.ends_at,
    }


class BannerSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemBanner
        fields = [
            "id",
            "kind",
            "tone",
            "message",
            "detail",
            "starts_at",
            "ends_at",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class SystemStatusView(APIView):
    """What every client needs before it renders anything."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [SystemStatusThrottle]

    def get(self, request):
        from django.core.cache import cache
        from django.conf import settings

        try:
            cached = None if getattr(settings, "IS_TEST_RUN", False) else cache.get("system-status:v1")
        except Exception:
            cached = None
        if cached is not None:
            return Response(cached)
        maintenance = SystemBanner.live(SystemBanner.Kind.MAINTENANCE)
        payload = {
            "maintenance": serialize(maintenance),
            "ticker": serialize(SystemBanner.live(SystemBanner.Kind.TICKER)),
            "server_time": timezone.now(),
        }
        if not getattr(settings, "IS_TEST_RUN", False):
            try:
                cache.set("system-status:v1", payload, 15)
            except Exception:
                pass
        return Response(payload)


class SystemBannerManageView(APIView):
    permission_classes = [IsAuthenticated]

    def deny(self):
        return Response(
            {"detail": "Only barangay officials can manage system notices."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def get(self, request):
        if not is_official(request.user):
            return self.deny()
        return Response(BannerSerializer(SystemBanner.objects.all(), many=True).data)

    def post(self, request):
        if not is_official(request.user):
            return self.deny()
        serializer = BannerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        kind = serializer.validated_data.get("kind", SystemBanner.Kind.TICKER)
        if kind == SystemBanner.Kind.MAINTENANCE and serializer.validated_data.get("is_active", True):
            open_count = active_emergencies().count()
            if open_count:
                return Response(
                    {
                        "code": "emergency_in_progress",
                        "detail": (
                            f"{open_count} emergency incident(s) are still active. "
                            "Maintenance cannot start while anyone is waiting for help."
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            SystemBanner.objects.filter(
                kind=SystemBanner.Kind.MAINTENANCE, is_active=True
            ).update(is_active=False)

        banner = serializer.save(created_by=request.user)
        return Response(BannerSerializer(banner).data, status=status.HTTP_201_CREATED)


class SystemBannerDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        if not is_official(request.user):
            return Response(
                {"detail": "Only barangay officials can manage system notices."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            banner = SystemBanner.objects.get(pk=pk)
        except SystemBanner.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        serializer = BannerSerializer(banner, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        turning_on = serializer.validated_data.get("is_active", banner.is_active)
        kind = serializer.validated_data.get("kind", banner.kind)
        if kind == SystemBanner.Kind.MAINTENANCE and turning_on and not banner.is_live():
            open_count = active_emergencies().count()
            if open_count:
                return Response(
                    {
                        "code": "emergency_in_progress",
                        "detail": (
                            f"{open_count} emergency incident(s) are still active. "
                            "Maintenance cannot start while anyone is waiting for help."
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        if not is_official(request.user):
            return Response(
                {"detail": "Only barangay officials can manage system notices."},
                status=status.HTTP_403_FORBIDDEN,
            )
        SystemBanner.objects.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
