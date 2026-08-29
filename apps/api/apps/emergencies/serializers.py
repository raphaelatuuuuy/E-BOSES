from decimal import Decimal, InvalidOperation

from rest_framework import serializers

from django.core.exceptions import ValidationError as DjangoValidationError

from apps.accounts.services import (
    validate_emergency_media_file,
    validate_icon_image_file,
    validate_location_pair,
)
from apps.concerns.models import Department
from apps.concerns.serializers import PublicUserSerializer
from apps.concerns.units import RESPONDER_UNIT_TO_DEPARTMENT, department_for_responder_unit
from apps.geo_services import validate_emergency_location

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyCategory,
    EmergencyChatAttachment,
    EmergencyChatMessage,
    EmergencyEscalation,
    EmergencyLocationPing,
    MapDispatchPolicy,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    EmergencyTypeRoleMap,
    EmergencyAssignmentLog,
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


class EmergencyCategorySerializer(serializers.ModelSerializer):
    icon_image_url = serializers.SerializerMethodField()
    is_covered = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyCategory
        fields = (
            "id",
            "code",
            "label",
            "subtext",
            "icon_key",
            "custom_icon_label",
            "icon_image",
            "icon_image_url",
            "is_covered",
            "sort_order",
            "is_active",
            "visible_to_residents",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "icon_image_url", "is_covered", "created_at", "updated_at")

    def get_icon_image_url(self, obj):
        if not obj.icon_image:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(obj.icon_image.url) if request else obj.icon_image.url

    def get_is_covered(self, obj):
        return emergency_category_is_covered(obj.code)

    def validate_code(self, value):
        code = (value or "").strip().lower().replace("-", "_")
        if not code:
            raise serializers.ValidationError("Enter a category code.")
        if not all(char.isalnum() or char == "_" for char in code):
            raise serializers.ValidationError("Use lowercase letters, numbers, and underscores only.")
        return code

    def validate_icon_key(self, value):
        value = (value or "siren").strip().lower()
        allowed = {
            "activity", "ambulance", "baby", "badge-alert", "bell", "cloud-rain-wind",
            "flame", "heart-crack", "home", "map-pin", "pill", "shield-alert",
            "siren", "stethoscope", "waves", "zap",
        }
        if value not in allowed:
            raise serializers.ValidationError("Choose one of the supported emergency icons.")
        return value

    def validate_icon_image(self, value):
        return validate_icon_image_file(value)


class MapDispatchPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = MapDispatchPolicy
        fields = (
            "id",
            "barangay",
            "acceptance_center_latitude",
            "acceptance_center_longitude",
            "acceptance_radius_meters",
            "acceptance_geometry",
            "out_of_zone_action",
            "witness_radius_meters",
            "responder_nearby_radius_meters",
            "emergency_sms_number",
            "duty_hours_start",
            "duty_hours_end",
            "hotlines",
            "updated_by",
            "updated_at",
        )
        # `barangay` is writable: the coverage screen picks which barangay this
        # station answers for. The row is keyed on pk, not on the name, so a
        # rename cannot fork a second policy.
        read_only_fields = ("id", "updated_by", "updated_at")

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
    type = serializers.CharField(max_length=80)
    note = serializers.CharField(allow_blank=True, required=False)
    # Optional since the SMS fallback: an emergency can arrive with a readable
    # area and no GPS fix. The web SOS wizard still requires a confirmed pin
    # before it will submit, so this does not loosen the in-app flow.
    latitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    longitude = BrowserGPSDecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    address = serializers.CharField(max_length=255, allow_blank=True, required=False)
    reported_area = serializers.CharField(max_length=255, allow_blank=True, required=False)
    location_source = serializers.ChoiceField(choices=("gps", "manual_pin", "network", "sms", "sms_landmark"), default="gps")
    location_accuracy = serializers.FloatField(required=False, allow_null=True)
    triage = serializers.JSONField(required=False)

    def validate(self, attrs):
        category = EmergencyCategory.objects.filter(code=attrs.get("type"), is_active=True).first()
        if not category:
            raise serializers.ValidationError({"type": ["Choose an active emergency category."]})
        if not emergency_category_is_covered(category.code):
            raise serializers.ValidationError({"type": ["This emergency category has no responding unit configured."]})

        latitude = attrs.get("latitude")
        longitude = attrs.get("longitude")
        if (latitude is None) != (longitude is None):
            raise serializers.ValidationError(
                {"location": ["Latitude and longitude must be provided together."]}
            )
        if latitude is None:
            # No pin: require *something* a responder can navigate by, rather
            # than accepting an emergency nobody can find.
            if not (attrs.get("reported_area") or attrs.get("address") or "").strip():
                raise serializers.ValidationError(
                    {"location": ["Provide a map location or describe the area."]}
                )
            return attrs

        try:
            validate_emergency_location(latitude, longitude)
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
        from apps.media_urls import emergency_media_preview_url

        return emergency_media_preview_url(obj.pk)

    def get_raw_url(self, obj):
        return f"/api/emergencies/media/{obj.pk}/raw/"


class EmergencyStatusEventSerializer(serializers.ModelSerializer):
    actor = PublicUserSerializer(read_only=True)

    class Meta:
        model = EmergencyStatusEvent
        fields = ("id", "status", "event_key", "label", "note", "actor", "created_at")


class EmergencyLocationPingSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyLocationPing
        fields = ("id", "latitude", "longitude", "accuracy", "created_at")


LEGACY_UNIT_BY_DEPARTMENT_CODE = {code: unit for unit, code in RESPONDER_UNIT_TO_DEPARTMENT.items()}


def emergency_category_is_covered(code):
    if not code:
        return False
    return EmergencyTypeRoleMap.objects.filter(emergency_type=code, is_active=True, department__isnull=False).exists()


class EmergencyTypeRoleMapSerializer(serializers.ModelSerializer):
    """Routing rows are written by unit (Department); `responder_unit` is legacy.

    Callers may send either. `department` is what dispatch reads, so a payload
    carrying only the legacy enum is translated rather than accepted as-is —
    otherwise the row would be saved and then silently ignored when routing.
    """

    department = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    department_name = serializers.CharField(source="department.name", read_only=True)
    department_code = serializers.CharField(source="department.code", read_only=True)
    # Not required from callers: the model column is non-blank, which would make
    # DRF demand it, but `to_internal_value` derives it from the department.
    # Without this override a payload carrying only `department` — which is what
    # the Dispatch rules screen sends — is rejected before it can be translated.
    responder_unit = serializers.CharField(required=False, allow_blank=True)
    emergency_type = serializers.CharField(max_length=80)

    class Meta:
        model = EmergencyTypeRoleMap
        fields = (
            "id",
            "emergency_type",
            "department",
            "department_name",
            "department_code",
            "responder_unit",
            "priority",
            "requires_shift",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "department_name", "department_code", "created_at", "updated_at")

    def to_internal_value(self, data):
        """Resolve the legacy unit into a department before validators run.

        The `(emergency_type, department)` uniqueness constraint generates a
        UniqueTogetherValidator, and DRF runs those *before* `validate()`. A
        payload carrying only `responder_unit` would therefore be rejected as
        missing `department` before it could be translated, so the translation
        has to happen here.
        """
        attrs = super().to_internal_value(data)

        category_code = attrs.get("emergency_type") or getattr(self.instance, "emergency_type", "")
        if category_code and not EmergencyCategory.objects.filter(code=category_code, is_active=True).exists():
            raise serializers.ValidationError({"emergency_type": ["Choose an active emergency category."]})

        department = attrs.get("department") or getattr(self.instance, "department", None)
        unit = attrs.get("responder_unit") or getattr(self.instance, "responder_unit", "")

        if department is None and unit:
            department = department_for_responder_unit(unit)
            if department is None:
                raise serializers.ValidationError(
                    {"responder_unit": [f"No barangay unit is mapped to “{unit}”. Choose a unit instead."]}
                )
            attrs["department"] = department

        if department is None:
            raise serializers.ValidationError(
                {"department": ["Select the unit that answers this emergency type."]}
            )

        # Keep the legacy column populated so older serializers and the
        # responder-availability index keep working during the transition.
        if not unit:
            attrs["responder_unit"] = LEGACY_UNIT_BY_DEPARTMENT_CODE.get(department.code, "")

        return attrs


class EmergencyAssignmentLogSerializer(serializers.ModelSerializer):
    responder = PublicUserSerializer(read_only=True)
    actor = PublicUserSerializer(read_only=True)

    class Meta:
        model = EmergencyAssignmentLog
        fields = ("id", "assignment", "responder", "actor", "action", "old_status", "new_status", "note", "metadata", "created_at")


class EmergencyAssignmentStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        EmergencyResponderAssignment.Status.ACKNOWLEDGED,
        EmergencyResponderAssignment.Status.EN_ROUTE,
        EmergencyResponderAssignment.Status.ARRIVED,
        EmergencyResponderAssignment.Status.ASSISTING,
        EmergencyResponderAssignment.Status.RESOLVED,
        EmergencyResponderAssignment.Status.DECLINED,
    ])
    note = serializers.CharField(min_length=5, max_length=255, trim_whitespace=True)
    status_version = serializers.IntegerField(required=False, min_value=0)


class EmergencyResponderAssignmentSerializer(serializers.ModelSerializer):
    responder = PublicUserSerializer(read_only=True)
    responding_community = serializers.SerializerMethodField()
    is_cross_community = serializers.BooleanField(read_only=True)
    last_location = serializers.SerializerMethodField()
    location_history = serializers.SerializerMethodField()
    route = serializers.SerializerMethodField()

    class Meta:
        model = EmergencyResponderAssignment
        fields = (
            "id",
            "responder",
            "status",
            "source",
            "role_map",
            "responding_community",
            "is_cross_community",
            "status_note",
            "assigned_at",
            "acknowledged_at",
            "arrived_at",
            "last_location",
            "location_history",
            "route",
        )

    def get_responding_community(self, obj):
        community = getattr(obj, "responding_community", None)
        if not community:
            return None
        return {
            "id": community.pk,
            "name": community.name,
            "code": community.code,
        }

    def get_last_location(self, obj):
        pings = list(obj.location_pings.all())
        if not pings:
            return None
        ping = max(pings, key=lambda item: (item.created_at, item.pk))
        return EmergencyLocationPingSerializer(ping).data if ping else None

    def get_location_history(self, obj):
        pings = sorted(obj.location_pings.all(), key=lambda item: (item.created_at, item.pk))
        return EmergencyLocationPingSerializer(pings, many=True).data

    def get_route(self, obj):
        from apps.live_map import route_for_responder_assignment

        alert = getattr(obj, "_parent_alert", None) or obj.alert
        return route_for_responder_assignment(alert, obj)

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
    # Masked for every reader. The full number is available only from
    # GET /api/emergencies/{pk}/reporter-contact/, which checks the caller is
    # actually working this incident and writes an audit row. Before this, any
    # viewer of an alert received the resident's complete mobile number.
    reporter_phone = serializers.SerializerMethodField()
    display_location = serializers.SerializerMethodField()
    media = EmergencyMediaSerializer(many=True, read_only=True)
    assignments = EmergencyResponderAssignmentSerializer(many=True, read_only=True)
    active_assignments = serializers.SerializerMethodField()
    status_events = EmergencyStatusEventSerializer(many=True, read_only=True)
    appeals = EmergencyAppealSerializer(many=True, read_only=True)
    escalations = EmergencyEscalationSerializer(many=True, read_only=True)
    assignment_logs = EmergencyAssignmentLogSerializer(many=True, read_only=True)
    current_assignment = serializers.SerializerMethodField()
    responding_unit = serializers.SerializerMethodField()
    is_public = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    route = serializers.SerializerMethodField()
    witness_notification_summary = serializers.SerializerMethodField()
    response_duration_seconds = serializers.SerializerMethodField()
    disposition_reason = serializers.SerializerMethodField()

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
            "location_freshness",
            "location_age_seconds",
            "canonical_street",
            "location_evidence",
            "location_accuracy",
            "address",
            "reported_area",
            "resolved_location",
            "display_location",
            "reverse_geocoding_status",
            "location_confidence",
            "reporter_verification",
            "triage",
            "category_needs_confirmation",
            "unresolved_fields",
            "media_warnings",
            "media_integrity",
            "resolution_report",
            "status_version",
            "media",
            "assignments",
            "active_assignments",
            "current_assignment",
            "responding_unit",
            "is_public",
            "comment_count",
            "route",
            "status_events",
            "appeals",
            "escalations",
            "assignment_logs",
            "witness_notification_summary",
            "response_duration_seconds",
            "disposition_reason",
            "created_at",
            "updated_at",
            "routed_at",
            "resolved_at",
        )

    def get_reporter_phone(self, obj):
        from apps.sms.normalize import mask_ph_mobile

        number = (obj.reporter_contact_number or "").strip() or getattr(obj.reporter, "phone_number", "")
        return mask_ph_mobile(number) if number else ""

    def get_display_location(self, obj):
        from .location_services import display_location

        return display_location(obj)

    def _active_assignments(self, obj):
        # Python-filter over the prefetched relation: chaining .filter() on
        # the manager bypasses the prefetch cache and re-queries per alert.
        active = [
            assignment
            for assignment in obj.assignments.all()
            if assignment.status
            in {
                EmergencyResponderAssignment.Status.ASSIGNED,
                EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                EmergencyResponderAssignment.Status.EN_ROUTE,
                EmergencyResponderAssignment.Status.ARRIVED,
                EmergencyResponderAssignment.Status.ASSISTING,
            }
        ]
        active.sort(key=lambda item: (item.assigned_at, item.pk))
        return active

    def get_active_assignments(self, obj):
        assignments = self._active_assignments(obj)
        # Stash the parent so the nested route getter does not re-fetch the
        # alert once per assignment row.
        for assignment in assignments:
            assignment._parent_alert = obj
        serializer = EmergencyResponderAssignmentSerializer(
            assignments, many=True, context=self.context
        )
        return serializer.data

    def get_current_assignment(self, obj):
        assignments = self._active_assignments(obj)
        assignment = assignments[0] if assignments else None
        if assignment:
            assignment._parent_alert = obj
        return EmergencyResponderAssignmentSerializer(assignment, context=self.context).data if assignment else None

    def _scope_cache(self) -> dict:
        """Per-request memo.

        `serialize_alert()` builds a fresh serializer for every alert, so the
        serializer's own context cannot cache across a page. The request can.
        """
        request = self.context.get("request")
        holder = request if request is not None else self.context
        cache = getattr(holder, "_emergency_serializer_cache", None)
        if cache is None:
            cache = {}
            try:
                setattr(holder, "_emergency_serializer_cache", cache)
            except (AttributeError, TypeError):
                self.context["_emergency_serializer_cache"] = cache
        return cache

    def _public_types(self) -> set:
        cache = self._scope_cache()
        if "public_types" not in cache:
            cache["public_types"] = set(
                EmergencyCategory.objects.filter(
                    is_active=True, visible_to_residents=True
                ).values_list("code", flat=True)
            )
        return cache["public_types"]

    def get_is_public(self, obj) -> bool:
        return obj.type in self._public_types()

    def get_comment_count(self, obj) -> int:
        # Annotated by alert_queryset() so a page of alerts costs no extra
        # queries; the fallback only runs for an unannotated single read.
        annotated = getattr(obj, "visible_comment_count", None)
        if annotated is not None:
            return annotated
        from .models import EmergencyCommunityComment

        return obj.community_comments.filter(
            status=EmergencyCommunityComment.Status.VISIBLE
        ).count()

    def get_responding_unit(self, obj):
        from .views import preferred_departments_for

        scope = self._scope_cache()
        if "role_map" not in scope:
            # One query for the whole active routing table beats three per
            # distinct emergency type on a page of alerts.
            rows = (
                EmergencyTypeRoleMap.objects.filter(is_active=True, department__isnull=False)
                .select_related("department")
                .order_by("priority", "pk")
            )
            table: dict = {}
            for row in rows:
                table.setdefault((row.emergency_type, row.department.community_id), row.department)
                table.setdefault((row.emergency_type, None), row.department)
            scope["role_map"] = table

        cache = scope.setdefault("responding_units", {})
        key = (obj.type, getattr(obj, "community_id", None))
        if key not in cache:
            department = scope["role_map"].get(key) or scope["role_map"].get((obj.type, None))
            if department is None:
                departments = preferred_departments_for(obj.type, getattr(obj, "community", None))
                department = departments[0] if departments else None
            cache[key] = (
                {
                    "id": department.pk,
                    "code": department.code,
                    "name": department.name,
                    "short_name": department.short_name,
                }
                if department
                else None
            )
        return cache[key]

    def get_route(self, obj):
        if obj.route is not None:
            return obj.route
        # Same candidate rule as live_map.route_for_assignment, but over the
        # prefetched assignment cache: its internal .filter() would re-query
        # the assignment table once per alert row.
        from apps.live_map import route_for_responder_assignment

        candidates = self._active_assignments(obj)
        return route_for_responder_assignment(obj, candidates[0] if candidates else None)

    def get_response_duration_seconds(self, obj):
        if not obj.resolved_at:
            return None
        return int((obj.resolved_at - obj.created_at).total_seconds())

    def get_disposition_reason(self, obj):
        if obj.status not in {
            EmergencyAlert.Status.CANCELLED,
            EmergencyAlert.Status.FALSE_ALARM,
            EmergencyAlert.Status.INVALID,
        }:
            return ""
        matching = [event for event in obj.status_events.all() if event.status == obj.status]
        if not matching:
            return obj.resolution_report
        event = max(matching, key=lambda item: (item.created_at, item.pk))
        return event.note if event else obj.resolution_report

    def get_witness_notification_summary(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if not (user.is_staff or user.is_superuser or user.role == user.Role.BARANGAY_OFFICIAL):
            return None
        rows = sorted(obj.witness_notifications.all(), key=lambda item: item.sent_at)
        records = [
            {
                "distance_meters": record.distance_meters,
                "sent_at": record.sent_at,
                "in_app_delivered_at": record.in_app_delivered_at,
                "push_status": record.push_status,
                "push_attempted_at": record.push_attempted_at,
                "push_delivered_at": record.push_delivered_at,
                "push_failure_count": record.push_failure_count,
                "read_at": record.read_at,
            }
            for record in rows
        ]
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


class EmergencyReassignSerializer(serializers.Serializer):
    # responder_id is functionally required (enforced in validate() below).
    # It is declared required=False at the field level so that legacy
    # clients posting only `responder_ids` don't fail DRF's field-level
    # validation before validate() gets a chance to backfill it.
    responder_id = serializers.IntegerField(required=False)
    responder_ids = serializers.ListField(child=serializers.IntegerField(), required=False, allow_empty=False)
    note = serializers.CharField(min_length=5, max_length=255, trim_whitespace=True)
    status_version = serializers.IntegerField(required=False, min_value=0)

    def validate(self, attrs):
        # Backward compat: some in-flight clients may still post `responder_ids`
        # (a list) instead of the single `responder_id`. Accept it during
        # rollout, but only when it unambiguously identifies one responder.
        responder_id = attrs.get("responder_id")
        responder_ids = attrs.pop("responder_ids", None)
        if responder_id is None:
            if responder_ids is not None:
                if len(responder_ids) != 1:
                    raise serializers.ValidationError(
                        {"responder_ids": ["Reassignment accepts exactly one responder."]}
                    )
                responder_id = responder_ids[0]
            else:
                raise serializers.ValidationError({"responder_id": ["This field is required."]})
        attrs["responder_id"] = responder_id
        return attrs


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
            validate_location_pair(
                attrs.get("latitude"),
                attrs.get("longitude"),
                required=True,
                allow_outside_service_area=True,
            )
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class EmergencyNoteSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000, allow_blank=True, required=False)
    status_version = serializers.IntegerField(required=False, min_value=0)


class EmergencyDispositionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[EmergencyAlert.Status.FALSE_ALARM, EmergencyAlert.Status.INVALID])
    note = serializers.CharField(min_length=5, max_length=2000, trim_whitespace=True)
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


RESPONDER_UNIT_CHOICES = ("tanod", "bhw", "bdrrmo", "")


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
            validate_location_pair(
                attrs.get("latitude"),
                attrs.get("longitude"),
                required=True,
                allow_outside_service_area=True,
            )
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
                validate_location_pair(
                    attrs.get("latitude"),
                    attrs.get("longitude"),
                    required=True,
                    allow_outside_service_area=True,
                )
            except DjangoValidationError as exc:
                raise serializers.ValidationError(exc) from exc
        return attrs
