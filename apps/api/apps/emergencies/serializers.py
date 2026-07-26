from decimal import Decimal, InvalidOperation

from rest_framework import serializers

from django.core.exceptions import ValidationError as DjangoValidationError

from apps.accounts.services import validate_emergency_media_file, validate_location_pair
from apps.concerns.serializers import PublicUserSerializer
from apps.geo_services import validate_barangay_location

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyChatAttachment,
    EmergencyChatMessage,
    EmergencyEscalation,
    EmergencyLocationPing,
    MapDispatchPolicy,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    ResponderShift,
)


class BrowserGPSDecimalField(serializers.DecimalField):
    def to_internal_value(self, data):
        try:
            data = Decimal(str(data)).quantize(Decimal("0.0000001"))
        except (InvalidOperation, TypeError, ValueError):
            pass
        return super().to_internal_value(data)


class EmergencyMediaUploadSerializer(serializers.Serializer):
    media = serializers.FileField(
        allow_empty_file=False,
        validators=[validate_emergency_media_file],
    )

    def validate_media(self, value):
        return validate_emergency_media_file(value)


class MapDispatchPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = MapDispatchPolicy
        fields = (
            "id",
            "barangay",
            "acceptance_center_latitude",
            "acceptance_center_longitude",
            "acceptance_radius_meters",
            "out_of_zone_action",
            "witness_radius_meters",
            "responder_nearby_radius_meters",
            "updated_by",
            "updated_at",
        )
        read_only_fields = ("id", "barangay", "updated_by", "updated_at")

    def validate_acceptance_radius_meters(self, value):
        if not 100 <= value <= 5000:
            raise serializers.ValidationError("Use a radius from 100 to 5000 meters.")
        return value

    def validate_witness_radius_meters(self, value):
        if not 50 <= value <= 3000:
            raise serializers.ValidationError("Use a witness radius from 50 to 3000 meters.")
        return value

    def validate_responder_nearby_radius_meters(self, value):
        if not 10 <= value <= 1000:
            raise serializers.ValidationError("Use a nearby radius from 10 to 1000 meters.")
        return value


class EmergencyCreateSerializer(serializers.Serializer):
    client_request_id = serializers.UUIDField(required=False)
    type = serializers.ChoiceField(choices=EmergencyAlert.Type.choices)
    note = serializers.CharField(allow_blank=True, required=False)
    latitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7)
    longitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7)
    address = serializers.CharField(max_length=255, allow_blank=True, required=False)
    location_source = serializers.ChoiceField(choices=("gps", "manual_pin"), default="gps")
    location_accuracy = serializers.FloatField(required=False, allow_null=True)

    def validate(self, attrs):
        try:
            validate_barangay_location(attrs.get("latitude"), attrs.get("longitude"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class EmergencyMediaSerializer(serializers.ModelSerializer):
    preview_url = serializers.SerializerMethodField()
    raw_url = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyMedia
        fields = (
            "id",
            "original_filename",
            "mime_type",
            "file_size",
            "preview_url",
            "raw_url",
            "uploaded_at",
        )

    def get_preview_url(self, obj):
        path = f"/api/emergencies/media/{obj.pk}/preview/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path

    def get_raw_url(self, obj):
        path = f"/api/emergencies/media/{obj.pk}/raw/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path


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
        if obj.alert.status in {EmergencyAlert.Status.RESOLVED, EmergencyAlert.Status.CANCELLED}:
            return None
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
    active_assignments = serializers.SerializerMethodField()
    status_events = EmergencyStatusEventSerializer(many=True, read_only=True)
    appeals = EmergencyAppealSerializer(many=True, read_only=True)
    escalations = EmergencyEscalationSerializer(many=True, read_only=True)
    current_assignment = serializers.SerializerMethodField()
    witness_notification_summary = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyAlert
        fields = (
            "id",
            "public_id",
            "reporter",
            "reporter_phone",
            "type",
            "note",
            "status",
            "barangay",
            "latitude",
            "longitude",
            "location_source",
            "location_accuracy",
            "address",
            "media_warnings",
            "status_version",
            "media",
            "assignments",
            "active_assignments",
            "current_assignment",
            "status_events",
            "appeals",
            "escalations",
            "witness_notification_summary",
            "created_at",
            "updated_at",
            "routed_at",
            "resolved_at",
        )

    def _active_assignments(self, obj):
        return obj.assignments.filter(
            status__in=[
                EmergencyResponderAssignment.Status.ASSIGNED,
                EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                EmergencyResponderAssignment.Status.EN_ROUTE,
                EmergencyResponderAssignment.Status.ARRIVED,
            ]
        ).select_related("responder", "responder__resident_profile").order_by("assigned_at", "id")

    def get_active_assignments(self, obj):
        return EmergencyResponderAssignmentSerializer(
            self._active_assignments(obj), many=True, context=self.context
        ).data

    def get_current_assignment(self, obj):
        assignment = self._active_assignments(obj).first()
        return EmergencyResponderAssignmentSerializer(assignment, context=self.context).data if assignment else None

    def get_witness_notification_summary(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if not (user.is_staff or user.is_superuser or user.role == user.Role.BARANGAY_OFFICIAL):
            return None
        records = list(
            obj.witness_notifications.order_by("sent_at").values(
                "distance_meters",
                "sent_at",
                "in_app_delivered_at",
                "push_status",
                "push_attempted_at",
                "push_delivered_at",
                "push_failure_count",
                "read_at",
            )
        )
        if not records:
            return {
                "triggered": False,
                "recipient_count": 0,
                "in_app_delivered_count": 0,
                "read_count": 0,
                "push_attempted_count": 0,
                "push_delivered_count": 0,
                "push_failure_count": 0,
                "push_status_counts": {},
                "nearest_distance_meters": None,
                "farthest_distance_meters": None,
                "triggered_at": None,
            }
        distances = [record["distance_meters"] for record in records]
        push_status_counts = {}
        for record in records:
            push_status = record["push_status"]
            push_status_counts[push_status] = push_status_counts.get(push_status, 0) + 1
        return {
            "triggered": True,
            "recipient_count": len(records),
            "in_app_delivered_count": sum(1 for record in records if record["in_app_delivered_at"] is not None),
            "read_count": sum(1 for record in records if record["read_at"] is not None),
            "push_attempted_count": sum(1 for record in records if record["push_attempted_at"] is not None),
            "push_delivered_count": sum(1 for record in records if record["push_delivered_at"] is not None),
            "push_failure_count": sum(record["push_failure_count"] for record in records),
            "push_status_counts": push_status_counts,
            "nearest_distance_meters": min(distances),
            "farthest_distance_meters": max(distances),
            "triggered_at": records[0]["sent_at"],
        }


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


class EmergencyReassignSerializer(EmergencyAssignSerializer):
    note = serializers.CharField(min_length=5, max_length=255, trim_whitespace=True)
    status_version = serializers.IntegerField(required=False, min_value=0)


class EmergencyAssignmentRemoveSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, trim_whitespace=True)
    status_version = serializers.IntegerField(required=False, min_value=0)

class EmergencyAppealCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)

class EmergencyAppealReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[EmergencyAppeal.Status.APPROVED, EmergencyAppeal.Status.DENIED])
    decision_note = serializers.CharField(min_length=5, max_length=255, trim_whitespace=True)

class EmergencyEscalateSerializer(serializers.Serializer):
    minutes = serializers.IntegerField(min_value=1, max_value=120, default=5)


class EmergencyLocationPingCreateSerializer(serializers.Serializer):
    latitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7)
    longitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7)
    accuracy = serializers.FloatField(required=False, allow_null=True)

    def validate(self, attrs):
        try:
            validate_location_pair(attrs.get("latitude"), attrs.get("longitude"), required=True)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class EmergencyNoteSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=255, allow_blank=True, required=False)
    status_version = serializers.IntegerField(required=False, min_value=0)


class EmergencyChatAttachmentSerializer(serializers.ModelSerializer):
    raw_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()
    authenticity = serializers.SerializerMethodField()
    edited = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyChatAttachment
        fields = ("id", "media_type", "original_filename", "mime_type", "file_size", "analysis_status", "authenticity", "edited", "raw_url", "preview_url", "uploaded_at")

    def _value(self, obj, key):
        if obj.analysis_status == EmergencyChatAttachment.AnalysisStatus.PENDING:
            return "pending"
        if obj.analysis_status == EmergencyChatAttachment.AnalysisStatus.UNAVAILABLE:
            return "unavailable"
        return obj.analysis.get(key, "unavailable")

    def get_authenticity(self, obj):
        return self._value(obj, "authenticity")

    def get_edited(self, obj):
        return self._value(obj, "edited")

    def get_raw_url(self, obj):
        path = f"/api/emergencies/chat-attachments/{obj.pk}/raw/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path

    def get_preview_url(self, obj):
        if obj.media_type != EmergencyChatAttachment.MediaType.IMAGE:
            return None
        path = f"/api/emergencies/chat-attachments/{obj.pk}/preview/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path


class EmergencyChatMessageSerializer(serializers.ModelSerializer):
    sender = PublicUserSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()
    attachment = EmergencyChatAttachmentSerializer(read_only=True)

    class Meta:
        model = EmergencyChatMessage
        fields = ("id", "alert", "sender", "body", "attachment", "created_at", "is_mine")
        read_only_fields = ("id", "alert", "sender", "created_at", "is_mine")

    def get_is_mine(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and obj.sender_id == user.pk)


class EmergencyChatCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000, trim_whitespace=True, required=False, allow_blank=True)
    attachment = serializers.FileField(required=False, allow_empty_file=False)

    def validate(self, attrs):
        attrs["body"] = (attrs.get("body") or "").strip()
        if not attrs["body"] and not attrs.get("attachment"):
            raise serializers.ValidationError("A message needs text or one attachment.")
        return attrs


RESPONDER_UNIT_CHOICES = ("tanod", "bhw", "bdrrmo", "other", "")


class ResponderShiftSerializer(serializers.ModelSerializer):
    responder = PublicUserSerializer(read_only=True)
    duration_seconds = serializers.SerializerMethodField()

    class Meta:
        model = ResponderShift
        fields = (
            "id",
            "responder",
            "responder_unit",
            "status",
            "started_at",
            "ended_at",
            "duration_seconds",
            "start_latitude",
            "start_longitude",
            "end_latitude",
            "end_longitude",
            "incidents_assigned",
            "incidents_acknowledged",
            "incidents_resolved",
            "false_alarms",
            "average_response_seconds",
            "created_at",
            "updated_at",
        )

    def get_duration_seconds(self, obj):
        from django.utils import timezone

        end = obj.ended_at or timezone.now()
        return max(0, int((end - obj.started_at).total_seconds()))


class ResponderShiftStartSerializer(serializers.Serializer):
    responder_unit = serializers.ChoiceField(choices=RESPONDER_UNIT_CHOICES, required=False, allow_blank=True)
    latitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7)
    longitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7)

    def validate(self, attrs):
        try:
            validate_location_pair(attrs.get("latitude"), attrs.get("longitude"), required=True)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class ResponderShiftEndSerializer(serializers.Serializer):
    latitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7, required=False)
    longitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7, required=False)

    def validate(self, attrs):
        has_lat = attrs.get("latitude") is not None
        has_lng = attrs.get("longitude") is not None
        if has_lat != has_lng:
            raise serializers.ValidationError("Latitude and longitude must be sent together.")
        if has_lat and has_lng:
            try:
                validate_location_pair(attrs.get("latitude"), attrs.get("longitude"), required=True)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(exc) from exc
        return attrs
