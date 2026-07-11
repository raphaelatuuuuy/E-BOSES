from rest_framework import serializers

from django.core.exceptions import ValidationError as DjangoValidationError

from apps.accounts.services import validate_emergency_media_file, validate_location_pair
from apps.concerns.serializers import PublicUserSerializer

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyEscalation,
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
)


class EmergencyMediaUploadSerializer(serializers.Serializer):
    media = serializers.FileField(
        allow_empty_file=False,
        validators=[validate_emergency_media_file],
    )

    def validate_media(self, value):
        return validate_emergency_media_file(value)


class EmergencyCreateSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=EmergencyAlert.Type.choices)
    note = serializers.CharField(allow_blank=True, required=False)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    address = serializers.CharField(max_length=255, allow_blank=True, required=False)

    def validate(self, attrs):
        try:
            validate_location_pair(attrs.get("latitude"), attrs.get("longitude"), required=True)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class EmergencyMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyMedia
        fields = ("id", "original_filename", "mime_type", "file_size", "uploaded_at")


class EmergencyStatusEventSerializer(serializers.ModelSerializer):
    actor = PublicUserSerializer(read_only=True)

    class Meta:
        model = EmergencyStatusEvent
        fields = ("id", "status", "note", "actor", "created_at")


class EmergencyLocationPingSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyLocationPing
        fields = ("id", "latitude", "longitude", "accuracy", "created_at")


class EmergencyResponderAssignmentSerializer(serializers.ModelSerializer):
    responder = PublicUserSerializer(read_only=True)
    last_location = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyResponderAssignment
        fields = (
            "id",
            "responder",
            "status",
            "assigned_at",
            "acknowledged_at",
            "arrived_at",
            "last_location",
        )

    def get_last_location(self, obj):
        ping = obj.location_pings.order_by("-created_at", "-id").first()
        return EmergencyLocationPingSerializer(ping).data if ping else None

class EmergencyAppealSerializer(serializers.ModelSerializer):
    appellant = PublicUserSerializer(read_only=True)
    reviewed_by = PublicUserSerializer(read_only=True)
    alert_id = serializers.IntegerField(read_only=True)
    alert_type = serializers.CharField(source="alert.type", read_only=True)
    alert_status = serializers.CharField(source="alert.status", read_only=True)

    class Meta:
        model = EmergencyAppeal
        fields = ("id", "alert_id", "alert_type", "alert_status", "appellant", "reason", "status", "decision_note", "reviewed_by", "created_at", "decided_at")

class EmergencyEscalationSerializer(serializers.ModelSerializer):
    escalated_to = PublicUserSerializer(read_only=True)
    triggered_by = PublicUserSerializer(read_only=True)

    class Meta:
        model = EmergencyEscalation
        fields = ("id", "previous_assignment", "escalated_to", "triggered_by", "reason", "created_at")


class EmergencyAlertSerializer(serializers.ModelSerializer):
    reporter = PublicUserSerializer(read_only=True)
    reporter_phone = serializers.CharField(source="reporter.phone_number", read_only=True)
    media = EmergencyMediaSerializer(many=True, read_only=True)
    assignments = EmergencyResponderAssignmentSerializer(many=True, read_only=True)
    status_events = EmergencyStatusEventSerializer(many=True, read_only=True)
    appeals = EmergencyAppealSerializer(many=True, read_only=True)
    escalations = EmergencyEscalationSerializer(many=True, read_only=True)
    current_assignment = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyAlert
        fields = (
            "id",
            "reporter",
            "reporter_phone",
            "type",
            "note",
            "status",
            "barangay",
            "latitude",
            "longitude",
            "address",
            "media",
            "assignments",
            "current_assignment",
            "status_events",
            "appeals",
            "escalations",
            "created_at",
            "updated_at",
            "resolved_at",
        )

    def get_current_assignment(self, obj):
        assignment = obj.assignments.select_related("responder", "responder__resident_profile").order_by("-assigned_at", "-id").first()
        return EmergencyResponderAssignmentSerializer(assignment, context=self.context).data if assignment else None


class EmergencyAssignSerializer(serializers.Serializer):
    responder_id = serializers.IntegerField(required=False)
    responder_ids = serializers.ListField(child=serializers.IntegerField(), required=False, allow_empty=False)

    def validate(self, attrs):
        ids = []
        if attrs.get("responder_id"):
            ids.append(attrs["responder_id"])
        ids.extend(attrs.get("responder_ids") or [])
        ids = list(dict.fromkeys(ids))
        if not ids:
            raise serializers.ValidationError("Choose at least one responder.")
        attrs["responder_ids"] = ids
        return attrs

class EmergencyAppealCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)

class EmergencyAppealReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[EmergencyAppeal.Status.APPROVED, EmergencyAppeal.Status.DENIED])
    decision_note = serializers.CharField(max_length=255, allow_blank=True, required=False)

class EmergencyEscalateSerializer(serializers.Serializer):
    minutes = serializers.IntegerField(min_value=1, max_value=120, default=5)


class EmergencyLocationPingCreateSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    accuracy = serializers.FloatField(required=False, allow_null=True)

    def validate(self, attrs):
        try:
            validate_location_pair(attrs.get("latitude"), attrs.get("longitude"), required=True)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class EmergencyNoteSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=255, allow_blank=True, required=False)
