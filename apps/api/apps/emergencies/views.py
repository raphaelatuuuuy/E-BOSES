from django.utils import timezone
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User
from .models import AlertAcknowledgement, EmergencyAlert, EmergencyStatusHistory
from .serializers import AlertAcknowledgementSerializer, EmergencyAlertSerializer, EmergencyStatusHistorySerializer, EmergencyStatusUpdateSerializer


class IsResponderOrStaff(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_staff or request.user.role in [User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL]


class EmergencyAlertViewSet(viewsets.ModelViewSet):
    serializer_class = EmergencyAlertSerializer

    def get_queryset(self):
        qs = EmergencyAlert.objects.select_related("resident").prefetch_related("acknowledgements", "status_history")
        user = self.request.user
        if user.is_staff or user.role in [User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL]:
            return qs
        return qs.filter(resident=user)

    @action(detail=True, methods=["post"], permission_classes=[IsResponderOrStaff])
    def assign(self, request, pk=None):
        alert = self.get_object()
        responder = request.user
        ack, _ = AlertAcknowledgement.objects.get_or_create(alert=alert, responder=responder, defaults={"status": "assigned"})
        if alert.status == EmergencyAlert.Status.SENT:
            old = alert.status
            alert.status = EmergencyAlert.Status.DISPATCHED
            alert.save(update_fields=["status", "updated_at"])
            EmergencyStatusHistory.objects.create(alert=alert, updated_by=request.user, old_status=old, new_status=alert.status, note="Responder assigned")
        return Response(AlertAcknowledgementSerializer(ack).data)

    @action(detail=True, methods=["post"], permission_classes=[IsResponderOrStaff])
    def acknowledge(self, request, pk=None):
        alert = self.get_object()
        ack, _ = AlertAcknowledgement.objects.get_or_create(alert=alert, responder=request.user)
        ack.status = "acknowledged"
        ack.acknowledged_at = timezone.now()
        ack.save(update_fields=["status", "acknowledged_at"])
        old = alert.status
        alert.status = EmergencyAlert.Status.ACKNOWLEDGED
        alert.save(update_fields=["status", "updated_at"])
        EmergencyStatusHistory.objects.create(alert=alert, updated_by=request.user, old_status=old, new_status=alert.status, note="Responder acknowledged")
        return Response(AlertAcknowledgementSerializer(ack).data)

    @action(detail=True, methods=["post"], permission_classes=[IsResponderOrStaff], url_path="status")
    def update_status(self, request, pk=None):
        alert = self.get_object()
        serializer = EmergencyStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        old = alert.status
        alert.status = serializer.validated_data["status"]
        alert.save(update_fields=["status", "updated_at"])
        EmergencyStatusHistory.objects.create(alert=alert, updated_by=request.user, old_status=old, new_status=alert.status, note=serializer.validated_data.get("note", ""))
        if alert.status == EmergencyAlert.Status.RESOLVED:
            AlertAcknowledgement.objects.filter(alert=alert, responder=request.user).update(status="resolved", resolved_at=timezone.now(), outcome_note=serializer.validated_data.get("note", ""))
        return Response(self.get_serializer(alert).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        return Response(EmergencyStatusHistorySerializer(self.get_object().status_history.all(), many=True).data)
