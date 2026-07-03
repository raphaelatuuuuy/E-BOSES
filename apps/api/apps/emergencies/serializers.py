from django.utils import timezone
from rest_framework import serializers

from .models import AlertAcknowledgement, EmergencyAlert, EmergencyStatusHistory


class EmergencyAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyAlert
        fields = ["id", "resident", "barangay", "alert_type", "description", "photo_url", "latitude", "longitude", "address_text", "status", "created_at", "updated_at"]
        read_only_fields = ["resident", "status", "created_at", "updated_at"]

    def create(self, validated_data):
        alert = EmergencyAlert.objects.create(resident=self.context["request"].user, **validated_data)
        EmergencyStatusHistory.objects.create(alert=alert, updated_by=self.context["request"].user, old_status="", new_status=alert.status, note="Alert sent")
        return alert


class AlertAcknowledgementSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertAcknowledgement
        fields = ["id", "alert", "responder", "status", "acknowledged_at", "resolved_at", "outcome_note", "created_at"]
        read_only_fields = ["responder", "acknowledged_at", "resolved_at", "created_at"]


class EmergencyStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=EmergencyAlert.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True)


class EmergencyStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyStatusHistory
        fields = ["id", "updated_by", "old_status", "new_status", "note", "created_at"]
