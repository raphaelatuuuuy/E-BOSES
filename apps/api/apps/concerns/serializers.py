import re

from rest_framework import serializers
from django.core.exceptions import ValidationError as DjangoValidationError

from apps.accounts.models import User
from apps.accounts.services import validate_concern_media_file

from .models import (
    Announcement,
    BarangayEvent,
    ChatMessageRead,
    ChatTypingIndicator,
    Concern,
    ConcernAppeal,
    ConcernAssignment,
    ConcernAiAssessment,
    ConcernCategory,
    ConcernChatMessage,
    ConcernChatAttachment,
    ConcernClarification,
    ConcernComment,
    ConcernFormField,
    ConcernFormValue,
    ConcernOfficialRemark,
    ConcernResolutionEvidence,
    ConcernTimelineEntry,
    ContentFlag,
    ConcernMedia,
    ConcernStatusEvent,
    Department,
    DepartmentChatMessage,
    DepartmentChatThread,
    Designation,
    Position,
    RoutingRule,
)
from apps.geo_services import validate_report_location


class ConcernMediaUploadSerializer(serializers.Serializer):
    media = serializers.FileField(
        allow_empty_file=False,
        validators=[validate_concern_media_file],
    )

    def validate_media(self, value):
        return validate_concern_media_file(value)


class PublicUserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    initials = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    # Street line only (first segment of residence address) for feed identity
    street = serializers.SerializerMethodField()
    barangay = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "full_name",
            "initials",
            "role",
            "last_seen_at",
            "avatar",
            "responder_unit",
            "is_on_duty",
            "street",
            "barangay",
        )

    def get_full_name(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile:
            first_name = profile.first_name.strip()
            last_initial = profile.last_name.strip()[:1]
            return f"{first_name} {last_initial}.".strip() if last_initial else first_name
        return (obj.email.split("@", 1)[0] or "E-Boses user").replace(".", " ")

    def get_initials(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile:
            return f"{profile.first_name[:1]}{profile.last_name[:1]}".upper() or "?"
        return obj.email[:2].upper()

    def get_street(self, obj):
        if self.context.get("privacy_safe"):
            return ""
        profile = getattr(obj, "resident_profile", None)
        if not profile or not (profile.address or "").strip():
            return ""
        # Prefer street line: "123 Champaca St, Marikina Heights, ..." → first segment
        street = profile.address.split(",")[0].strip()
        # Never surface placeholder defaults as a street label
        if street.lower() in {"pending", "n/a", "none", "null"}:
            return ""
        return street

    def get_barangay(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if not profile:
            return ""
        value = (profile.barangay or "").strip()
        # Model default is "Pending" until verification fills a real barangay
        if not value or value.lower() == "pending":
            return "Marikina Heights"
        return value

    def get_avatar(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile and profile.avatar:
            return profile.avatar
        role_prefix_map = {
            User.Role.BARANGAY_OFFICIAL: "official",
        }
        responder_unit_map = {
            User.ResponderUnit.TANOD: "tanod",
            User.ResponderUnit.BHW: "bhw",
            User.ResponderUnit.BDRRMO: "bdrmmo",
        }
        prefix = None
        if obj.role in role_prefix_map:
            prefix = role_prefix_map[obj.role]
        elif obj.role == User.Role.FIRST_RESPONDER and obj.responder_unit:
            prefix = responder_unit_map.get(obj.responder_unit)
        if prefix:
            return prefix
        return ""

class DepartmentSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()

    def get_member_count(self, obj):
        return obj.designations.filter(is_active=True).count()

    class Meta:
        model = Department
        fields = (
            "id",
            "name",
            "code",
            "short_name",
            "description",
            "emergency_role",
            "sort_order",
            "is_active",
            # Emergency dispatch reads these; the Units screen edits them.
            "responds_to_emergencies",
            "emergency_types",
            "contact_number",
            "member_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "member_count", "created_at", "updated_at")

    def validate_emergency_types(self, value):
        from apps.emergencies.models import EmergencyCategory

        allowed = set(EmergencyCategory.objects.filter(is_active=True).values_list("code", flat=True))
        invalid = [item for item in value if item not in allowed]
        if invalid:
            raise serializers.ValidationError(
                f"Unknown emergency type(s): {', '.join(sorted(invalid))}."
            )
        return value

    def validate(self, attrs):
        responds = attrs.get(
            "responds_to_emergencies",
            getattr(self.instance, "responds_to_emergencies", False),
        )
        types = attrs.get("emergency_types", getattr(self.instance, "emergency_types", None)) or []
        if responds and not types:
            raise serializers.ValidationError(
                {
                    "emergency_types": [
                        "Choose at least one emergency type, or this unit will never be dispatched to."
                    ]
                }
            )
        return attrs


class PositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Position
        fields = ("id", "name", "code", "permissions", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class DesignationSerializer(serializers.ModelSerializer):
    user_detail = PublicUserSerializer(source="user", read_only=True)
    department_detail = DepartmentSerializer(source="department", read_only=True)
    position_detail = PositionSerializer(source="position", read_only=True)

    class Meta:
        model = Designation
        fields = ("id", "user", "department", "position", "title", "is_active", "user_detail", "department_detail", "position_detail", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ConcernFormFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernFormField
        fields = ("id", "category", "field_key", "label", "field_type", "is_required", "options", "sort_order", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ConcernCategorySerializer(serializers.ModelSerializer):
    department_detail = DepartmentSerializer(source="department", read_only=True)
    form_fields = ConcernFormFieldSerializer(many=True, read_only=True)
    icon_image_url = serializers.SerializerMethodField()

    class Meta:
        model = ConcernCategory
        fields = ("id", "name", "code", "description", "icon_key", "custom_icon_label", "icon_image", "icon_image_url", "department", "department_detail", "is_active", "form_fields", "created_at", "updated_at")
        read_only_fields = ("id", "icon_image_url", "created_at", "updated_at")

    def get_icon_image_url(self, obj):
        if not obj.icon_image:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(obj.icon_image.url) if request else obj.icon_image.url

    def validate_icon_key(self, value):
        value = (value or "tag").strip().lower()
        allowed = {
            "tag", "wrench", "leaf", "shield-alert", "trash", "lightbulb",
            "road", "droplets", "home", "map-pin", "paw-print", "megaphone",
        }
        if value not in allowed:
            raise serializers.ValidationError("Choose one of the supported concern icons.")
        return value

    def validate_icon_image(self, value):
        if not value:
            return value
        name = value.name.lower()
        if not name.endswith((".png", ".jpg", ".jpeg", ".webp", ".ico")):
            raise serializers.ValidationError("Use PNG, JPG, WEBP, or ICO.")
        if value.size > 512 * 1024:
            raise serializers.ValidationError("Use an icon image up to 512 KB.")
        return value


class RoutingRuleSerializer(serializers.ModelSerializer):
    category_detail = ConcernCategorySerializer(source="category", read_only=True)
    department_detail = DepartmentSerializer(source="department", read_only=True)

    class Meta:
        model = RoutingRule
        fields = ("id", "name", "category", "department", "priority", "is_active", "category_detail", "department_detail", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ConcernFormValueSerializer(serializers.ModelSerializer):
    field_key = serializers.CharField(source="field.field_key", read_only=True)
    label = serializers.CharField(source="field.label", read_only=True)

    class Meta:
        model = ConcernFormValue
        fields = ("id", "field", "field_key", "label", "value", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ConcernTimelineEntrySerializer(serializers.ModelSerializer):
    actor = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernTimelineEntry
        fields = ("id", "event_type", "status", "message", "actor", "visible_to_resident", "is_custom", "metadata", "created_at")
        read_only_fields = ("id", "actor", "created_at")


class ConcernTimelineEntryCreateSerializer(serializers.Serializer):
    event_type = serializers.ChoiceField(choices=ConcernTimelineEntry.EventType.choices, default=ConcernTimelineEntry.EventType.CUSTOM)
    status = serializers.CharField(max_length=32, allow_blank=True, required=False)
    message = serializers.CharField(max_length=2000)
    visible_to_resident = serializers.BooleanField(default=True, required=False)
    is_custom = serializers.BooleanField(default=True, required=False)
    metadata = serializers.JSONField(default=dict, required=False)


class ChatReadSerializer(serializers.Serializer):
    last_read_message_id = serializers.IntegerField(min_value=1)


class ChatTypingSerializer(serializers.Serializer):
    is_typing = serializers.BooleanField()


class DepartmentChatThreadSerializer(serializers.ModelSerializer):
    department_detail = DepartmentSerializer(source="department", read_only=True)
    created_by = PublicUserSerializer(read_only=True)

    class Meta:
        model = DepartmentChatThread
        fields = ("id", "department", "department_detail", "title", "created_by", "created_at", "updated_at")
        read_only_fields = ("id", "created_by", "created_at", "updated_at")


class DepartmentChatMessageSerializer(serializers.ModelSerializer):
    sender = PublicUserSerializer(read_only=True)

    class Meta:
        model = DepartmentChatMessage
        fields = ("id", "thread", "sender", "body", "created_at")
        read_only_fields = ("id", "sender", "created_at")



class ConcernMediaSerializer(serializers.ModelSerializer):
    preview_url = serializers.SerializerMethodField()
    raw_url = serializers.SerializerMethodField()

    class Meta:
        model = ConcernMedia
        fields = (
            "id",
            "original_filename",
            "mime_type",
            "file_size",
            "preview_url",
            "raw_url",
            "validation_status",
            "validation_detail",
            "uploaded_at",
        )

    def get_preview_url(self, obj):
        path = f"/api/concerns/media/{obj.pk}/preview/"
        return path

    def get_raw_url(self, obj):
        if self.context.get("privacy_safe"):
            return ""
        path = f"/api/concerns/media/{obj.pk}/raw/"
        return path


class ConcernResolutionEvidenceSerializer(serializers.ModelSerializer):
    uploaded_by = PublicUserSerializer(read_only=True)
    raw_url = serializers.SerializerMethodField()

    class Meta:
        model = ConcernResolutionEvidence
        fields = (
            "id",
            "uploaded_by",
            "original_filename",
            "mime_type",
            "file_size",
            "note",
            "raw_url",
            "created_at",
        )

    def get_raw_url(self, obj):
        path = f"/api/concerns/resolution-evidence/{obj.pk}/raw/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path


class ConcernStatusEventSerializer(serializers.ModelSerializer):
    actor = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernStatusEvent
        fields = ("id", "status", "note", "actor", "created_at")


class ConcernCommentSerializer(serializers.ModelSerializer):
    author = PublicUserSerializer(read_only=True)
    replies = serializers.SerializerMethodField()

    class Meta:
        model = ConcernComment
        fields = (
            "id",
            "author",
            "parent",
            "body",
            "original_body",
            "is_edited",
            "created_at",
            "updated_at",
            "replies",
        )

    def get_replies(self, obj):
        # One-level stack only: never nest replies under replies
        if obj.parent_id is not None:
            return []
        replies = obj.replies.select_related("author", "author__resident_profile").all()
        return ConcernCommentSerializer(replies, many=True, context=self.context).data

class ConcernAiAssessmentSerializer(serializers.ModelSerializer):
    official_reviewer = PublicUserSerializer(read_only=True)
    possible_duplicate = serializers.SerializerMethodField()
    duplicate_similarity = serializers.SerializerMethodField()
    duplicate_distance_meters = serializers.SerializerMethodField()
    duplicate_match = serializers.SerializerMethodField()

    class Meta:
        model = ConcernAiAssessment
        fields = (
            "status",
            "image_objects",
            "yolo_confidence",
            "severity_estimate",
            "nlp_validity",
            "nlp_confidence",
            "category_match",
            "recommendation",
            "explanation",
            "model_version",
            "flagged",
            "flag_reasons",
            "possible_duplicate",
            "duplicate_similarity",
            "duplicate_distance_meters",
            "duplicate_match",
            "official_decision",
            "official_reason",
            "official_reviewer",
            "official_reviewed_at",
            "updated_at",
        )

    def _duplicate_payload(self, obj):
        return (obj.raw_result or {}).get("duplicate") or {}

    def get_possible_duplicate(self, obj):
        return bool(self._duplicate_payload(obj).get("possible_duplicate"))

    def get_duplicate_similarity(self, obj):
        return self._duplicate_payload(obj).get("similarity")

    def get_duplicate_distance_meters(self, obj):
        return self._duplicate_payload(obj).get("distance_meters")

    def get_duplicate_match(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or not (
            getattr(user, "is_staff", False) or getattr(user, "role", "") == "barangay_official"
        ):
            return None
        payload = self._duplicate_payload(obj)
        matched_id = payload.get("matched_concern_id")
        if not matched_id:
            return None
        match = Concern.objects.filter(pk=matched_id).only("id", "public_id", "title", "status", "tracking_number", "created_at").first()
        if not match:
            return None
        return {
            "id": match.pk,
            "public_id": str(match.public_id),
            "tracking_id": match.tracking_id,
            "title": match.title,
            "status": match.status,
        }


class ConcernAiReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=ConcernAiAssessment.OfficialDecision.choices)
    reason = serializers.CharField(min_length=10, max_length=2000, trim_whitespace=True)

class ContentFlagSerializer(serializers.ModelSerializer):
    reporter = PublicUserSerializer(read_only=True)
    comment = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = ContentFlag
        fields = (
            "id",
            "concern",
            "comment",
            "reporter",
            "reason",
            "note",
            "status",
            "staff_note",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "concern", "reporter", "status", "staff_note", "created_at", "updated_at")


class ContentFlagReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            ContentFlag.Status.REVIEWED,
            ContentFlag.Status.DISMISSED,
            ContentFlag.Status.ACTION_TAKEN,
        ]
    )
    staff_note = serializers.CharField(min_length=5, max_length=255, trim_whitespace=True)


class ConcernAssignmentSerializer(serializers.ModelSerializer):
    assignee = PublicUserSerializer(read_only=True)
    assigned_by = PublicUserSerializer(read_only=True)
    department = DepartmentSerializer(read_only=True)

    class Meta:
        model = ConcernAssignment
        fields = ("id", "assignee", "assigned_by", "department", "office", "note", "status", "created_at", "updated_at")

class ConcernClarificationSerializer(serializers.ModelSerializer):
    requested_by = PublicUserSerializer(read_only=True)
    responded_by = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernClarification
        fields = ("id", "requested_by", "request_text", "response_text", "responded_by", "status", "created_at", "responded_at")

class ConcernAppealSerializer(serializers.ModelSerializer):
    appellant = PublicUserSerializer(read_only=True)
    reviewed_by = PublicUserSerializer(read_only=True)
    concern_id = serializers.IntegerField(read_only=True)
    concern_title = serializers.CharField(source="concern.title", read_only=True)
    concern_status = serializers.CharField(source="concern.status", read_only=True)
    concern_tracking_id = serializers.SerializerMethodField()

    class Meta:
        model = ConcernAppeal
        fields = ("id", "concern_id", "concern_title", "concern_status", "concern_tracking_id", "appellant", "reason", "status", "decision_note", "reviewed_by", "created_at", "decided_at")

    def get_concern_tracking_id(self, obj):
        return obj.concern.tracking_id

class ConcernOfficialRemarkSerializer(serializers.ModelSerializer):
    author = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernOfficialRemark
        fields = ("id", "author", "body", "visible_to_resident", "created_at")

class ConcernAssignSerializer(serializers.Serializer):
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    department_id = serializers.IntegerField(required=False, allow_null=True)
    office = serializers.CharField(max_length=120, allow_blank=True, required=False)
    note = serializers.CharField(max_length=255, allow_blank=True, required=False)

    def validate(self, attrs):
        if not attrs.get("assignee_id") and not (attrs.get("office") or "").strip():
            raise serializers.ValidationError("Choose an assignee or office.")
        return attrs

class ClarificationRequestSerializer(serializers.Serializer):
    request_text = serializers.CharField(max_length=500)

class ClarificationReplySerializer(serializers.Serializer):
    response_text = serializers.CharField(max_length=2000)

class ConcernAppealCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)

class ConcernAppealReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[ConcernAppeal.Status.APPROVED, ConcernAppeal.Status.DENIED])
    decision_note = serializers.CharField(max_length=255, allow_blank=True, required=False)

class ConcernOfficialRemarkCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000)
    visible_to_resident = serializers.BooleanField(required=False, default=True)


class ConcernChatMessageSerializer(serializers.ModelSerializer):
    sender = PublicUserSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()
    attachment = serializers.SerializerMethodField()

    class Meta:
        model = ConcernChatMessage
        fields = ("id", "concern", "sender", "body", "attachment", "created_at", "is_mine")
        read_only_fields = ("id", "concern", "sender", "created_at", "is_mine")

    def get_is_mine(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and obj.sender_id == user.pk)

    def get_attachment(self, obj):
        attachment = getattr(obj, "attachment", None)
        if not attachment:
            return None
        path = f"/api/concerns/chat-media/{attachment.pk}/"
        request = self.context.get("request")
        return {
            "id": attachment.pk,
            "original_filename": attachment.original_filename,
            "mime_type": attachment.mime_type,
            "kind": attachment.kind,
            "file_size": attachment.file_size,
            "authenticity_status": attachment.authenticity_status,
            "authenticity_detail": attachment.authenticity_detail,
            "raw_url": request.build_absolute_uri(path) if request else path,
            "created_at": attachment.created_at,
        }


class ConcernChatCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000, trim_whitespace=True, allow_blank=True, required=False, default="")
    media = serializers.FileField(required=False, write_only=True, allow_empty_file=False)

    def validate_body(self, value):
        return (value or "").strip()


class ConcernSerializer(serializers.ModelSerializer):
    tracking_id = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()
    location_source = serializers.SerializerMethodField()
    location_accuracy = serializers.SerializerMethodField()
    reporter = PublicUserSerializer(read_only=True)
    media = ConcernMediaSerializer(many=True, read_only=True)
    status_events = serializers.SerializerMethodField()
    comments = serializers.SerializerMethodField()
    ai_assessment = ConcernAiAssessmentSerializer(read_only=True)
    assignments = serializers.SerializerMethodField()
    category_ref = ConcernCategorySerializer(read_only=True)
    assigned_department = DepartmentSerializer(read_only=True)
    form_values = serializers.SerializerMethodField()
    timeline = serializers.SerializerMethodField()
    clarifications = serializers.SerializerMethodField()
    appeals = serializers.SerializerMethodField()
    official_remarks = serializers.SerializerMethodField()
    resolution_evidence = serializers.SerializerMethodField()
    conversation = serializers.SerializerMethodField()
    vote_count = serializers.IntegerField(read_only=True, default=0)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    priority_score = serializers.IntegerField(read_only=True, default=0)
    # Severity band, derived from the AI assessment. Exposed so clients can
    # show it without recomputing, and so API ordering and UI ordering agree.
    severity = serializers.CharField(read_only=True, default="low")
    user_vote = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Concern
        fields = (
            "id",
            "public_id",
            "tracking_id",
            "validation_status",
            "validation_summary",
            "rejection_code",
            "status_version",
            "reporter",
            "title",
            "description",
            "category",
            "category_ref",
            "assigned_department",
            "form_values",
            "timeline",
            "status",
            "address",
            "latitude",
            "longitude",
            "location_source",
            "location_accuracy",
            "barangay",
            "update_text",
            "visibility",
            "media",
            "status_events",
            "comments",
            "ai_assessment",
            "assignments",
            "clarifications",
            "appeals",
            "official_remarks",
            "resolution_evidence",
            "conversation",
            "vote_count",
            "comment_count",
            "priority_score",
            "severity",
            "user_vote",
            "created_at",
            "updated_at",
        )

    def is_privacy_safe(self):
        return bool(self.context.get("privacy_safe"))

    def _viewer(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def _viewer_roles(self, obj):
        user = self._viewer()
        if not user or not user.is_authenticated:
            return False, False, False
        is_official = bool(
            user.is_staff
            or user.is_superuser
            or user.role == User.Role.BARANGAY_OFFICIAL
        )
        is_owner = user.pk == obj.reporter_id
        is_assignee = obj.assignments.filter(
            assignee=user,
            status=ConcernAssignment.Status.ACTIVE,
        ).exists()
        return is_official, is_owner, is_assignee

    def _can_view_case(self, obj):
        if self.is_privacy_safe():
            return False
        return any(self._viewer_roles(obj))

    def _public_user(self, user):
        if not user:
            return None
        return PublicUserSerializer(user, context=self.context).data

    def _date(self, value):
        return serializers.DateTimeField().to_representation(value) if value else None

    def get_tracking_id(self, obj):
        return obj.tracking_id

    def get_address(self, obj):
        if self.is_privacy_safe():
            return obj.barangay
        return obj.address

    def get_latitude(self, obj):
        if self.is_privacy_safe() or obj.latitude is None:
            return None
        return str(obj.latitude)

    def get_longitude(self, obj):
        if self.is_privacy_safe() or obj.longitude is None:
            return None
        return str(obj.longitude)

    def get_location_source(self, obj):
        if self.is_privacy_safe():
            return ""
        return obj.location_source

    def get_location_accuracy(self, obj):
        if self.is_privacy_safe():
            return None
        return obj.location_accuracy

    def get_status_events(self, obj):
        queryset = obj.status_events.select_related("actor", "actor__resident_profile")
        if self._can_view_case(obj):
            return ConcernStatusEventSerializer(queryset, many=True, context=self.context).data
        return [
            {
                "id": event.pk,
                "status": event.status,
                "note": "",
                "actor": None,
                "created_at": self._date(event.created_at),
            }
            for event in queryset
        ]

    def get_comments(self, obj):
        comments = obj.comments.filter(parent__isnull=True).select_related("author", "author__resident_profile")
        return ConcernCommentSerializer(comments, many=True, context=self.context).data

    def get_form_values(self, obj):
        if not self._can_view_case(obj):
            return []
        return ConcernFormValueSerializer(obj.form_values.select_related("field"), many=True, context=self.context).data

    def get_timeline(self, obj):
        queryset = obj.timeline_entries.select_related("actor", "actor__resident_profile")
        is_official, is_owner, is_assignee = self._viewer_roles(obj)
        if not (is_official or is_owner or is_assignee):
            queryset = queryset.filter(visible_to_resident=True)
        return ConcernTimelineEntrySerializer(queryset, many=True, context=self.context).data

    def get_assignments(self, obj):
        if not self._can_view_case(obj):
            return []
        queryset = obj.assignments.select_related("assignee", "assignee__resident_profile", "assigned_by", "assigned_by__resident_profile")
        return ConcernAssignmentSerializer(queryset, many=True, context=self.context).data

    def get_clarifications(self, obj):
        if not self._can_view_case(obj):
            return []
        queryset = obj.clarifications.select_related("requested_by", "requested_by__resident_profile", "responded_by", "responded_by__resident_profile")
        return ConcernClarificationSerializer(queryset, many=True, context=self.context).data

    def get_appeals(self, obj):
        is_official, is_owner, _ = self._viewer_roles(obj)
        if self.is_privacy_safe() or not (is_official or is_owner):
            return []
        queryset = obj.appeals.select_related("appellant", "appellant__resident_profile", "reviewed_by", "reviewed_by__resident_profile")
        return ConcernAppealSerializer(queryset, many=True, context=self.context).data

    def get_official_remarks(self, obj):
        queryset = obj.official_remarks.select_related("author", "author__resident_profile")
        is_official, is_owner, is_assignee = self._viewer_roles(obj)
        if self.is_privacy_safe() or not (is_official or is_owner or is_assignee):
            return []
        if not is_official:
            queryset = queryset.filter(visible_to_resident=True)
        return ConcernOfficialRemarkSerializer(queryset, many=True, context=self.context).data

    def get_resolution_evidence(self, obj):
        if not self._can_view_case(obj):
            return []
        queryset = obj.resolution_evidence.select_related(
            "uploaded_by",
            "uploaded_by__resident_profile",
        )
        return ConcernResolutionEvidenceSerializer(queryset, many=True, context=self.context).data

    def get_conversation(self, obj):
        is_official, is_owner, is_assignee = self._viewer_roles(obj)
        if self.is_privacy_safe() or not (is_official or is_owner or is_assignee):
            return []

        items = []

        def add(*, item_id, kind, body, created_at, actor=None, visibility="participants", status="", attachments=None, metadata=None):
            if not created_at:
                return
            items.append({
                "id": item_id,
                "kind": kind,
                "body": body or "",
                "created_at": self._date(created_at),
                "actor": self._public_user(actor),
                "visibility": visibility,
                "status": status or "",
                "attachments": attachments or [],
                "metadata": metadata or {},
                "_sort_at": created_at,
            })

        for event in obj.status_events.select_related("actor", "actor__resident_profile"):
            add(
                item_id=f"status-{event.pk}",
                kind="status",
                body=event.note or event.get_status_display(),
                created_at=event.created_at,
                actor=event.actor,
                status=event.status,
                metadata={"phase": "status_change"},
            )

        assignments = obj.assignments.select_related(
            "assignee",
            "assignee__resident_profile",
            "assigned_by",
            "assigned_by__resident_profile",
        )
        for assignment in assignments:
            assignee_name = (
                self._public_user(assignment.assignee).get("full_name")
                if assignment.assignee
                else "the assigned response team"
            )
            assignment_context = " · ".join(
                part for part in (assignee_name, assignment.office.strip()) if part
            )
            body = f"Assigned to {assignment_context}."
            if assignment.note.strip():
                body = f"{body} {assignment.note.strip()}"
            add(
                item_id=f"assignment-{assignment.pk}-assigned",
                kind="assignment",
                body=body,
                created_at=assignment.created_at,
                actor=assignment.assigned_by,
                status=ConcernAssignment.Status.ACTIVE,
                metadata={
                    "phase": "assigned",
                    "assignment_id": assignment.pk,
                    "assignee_id": assignment.assignee_id,
                    "assignee_name": assignee_name,
                    "office": assignment.office,
                },
            )
            if assignment.status != ConcernAssignment.Status.ACTIVE:
                add(
                    item_id=f"assignment-{assignment.pk}-{assignment.status}",
                    kind="assignment",
                    body=f"Assignment for {assignment_context} was {assignment.get_status_display().lower()}.",
                    created_at=assignment.updated_at,
                    # The current schema records who opened the assignment but
                    # not who closed it. Do not attribute the closing action to
                    # the original assigning official.
                    actor=None,
                    status=assignment.status,
                    metadata={
                        "phase": assignment.status,
                        "assignment_id": assignment.pk,
                        "assignee_id": assignment.assignee_id,
                        "assignee_name": assignee_name,
                        "office": assignment.office,
                    },
                )

        messages = obj.chat_messages.select_related(
            "sender", "sender__resident_profile", "attachment"
        )
        for message in messages:
            serialized = ConcernChatMessageSerializer(message, context=self.context).data
            attachment = serialized.get("attachment")
            add(
                item_id=f"chat-{message.pk}",
                kind="chat",
                body=message.body,
                created_at=message.created_at,
                actor=message.sender,
                attachments=[attachment] if attachment else [],
                metadata={"phase": "message"},
            )

        clarifications = obj.clarifications.select_related(
            "requested_by", "requested_by__resident_profile",
            "responded_by", "responded_by__resident_profile",
        )
        for clarification in clarifications:
            add(
                item_id=f"clarification-{clarification.pk}-request",
                kind="clarification",
                body=clarification.request_text,
                created_at=clarification.created_at,
                actor=clarification.requested_by,
                status=clarification.status,
                metadata={"phase": "request", "clarification_id": clarification.pk},
            )
            if clarification.response_text and clarification.responded_at:
                add(
                    item_id=f"clarification-{clarification.pk}-reply",
                    kind="clarification",
                    body=clarification.response_text,
                    created_at=clarification.responded_at,
                    actor=clarification.responded_by,
                    status=clarification.status,
                    metadata={"phase": "reply", "clarification_id": clarification.pk},
                )

        remarks = obj.official_remarks.select_related("author", "author__resident_profile")
        if not is_official:
            remarks = remarks.filter(visible_to_resident=True)
        for remark in remarks:
            add(
                item_id=f"official-remark-{remark.pk}",
                kind="official_remark",
                body=remark.body,
                created_at=remark.created_at,
                actor=remark.author,
                visibility="resident" if remark.visible_to_resident else "official",
                metadata={"visible_to_resident": remark.visible_to_resident},
            )

        if is_official or is_owner:
            appeals = obj.appeals.select_related(
                "appellant", "appellant__resident_profile",
                "reviewed_by", "reviewed_by__resident_profile",
            )
            for appeal in appeals:
                add(
                    item_id=f"appeal-{appeal.pk}-submitted",
                    kind="appeal",
                    body=appeal.reason,
                    created_at=appeal.created_at,
                    actor=appeal.appellant,
                    visibility="resident",
                    status=appeal.status,
                    metadata={"phase": "submitted", "appeal_id": appeal.pk},
                )
                if appeal.decided_at:
                    add(
                        item_id=f"appeal-{appeal.pk}-decision",
                        kind="appeal",
                        body=appeal.decision_note or f"Appeal {appeal.get_status_display().lower()}.",
                        created_at=appeal.decided_at,
                        actor=appeal.reviewed_by,
                        visibility="resident",
                        status=appeal.status,
                        metadata={"phase": "decision", "appeal_id": appeal.pk},
                    )

        items.sort(key=lambda item: (item["_sort_at"], item["kind"], item["id"]))
        for item in items:
            item.pop("_sort_at", None)
        return items


class ConcernCreateSerializer(serializers.Serializer):
    client_request_id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=160)
    description = serializers.CharField(min_length=20, max_length=4000)
    category = serializers.ChoiceField(choices=Concern.Category.choices, required=False)
    category_id = serializers.IntegerField(required=False)
    dynamic_fields = serializers.JSONField(required=False, default=dict)
    visibility = serializers.ChoiceField(choices=Concern.Visibility.choices, default=Concern.Visibility.COMMUNITY)
    address = serializers.CharField(max_length=255)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    location_source = serializers.ChoiceField(choices=("gps", "manual_pin"))
    location_accuracy = serializers.FloatField(required=False, allow_null=True)

    def validate_address(self, value: str) -> str:
        """Persist a human street line with the report — reject Lat/Lng placeholders."""
        text = (value or "").strip()
        if not text:
            raise serializers.ValidationError("Pin a location with a street name.")
        lower = text.lower()
        if lower in {"pending", "selected location", "finding street…", "finding street..."}:
            raise serializers.ValidationError("Pin a location with a street name.")
        if lower.startswith("lat ") or lower.startswith("lat:") or lower.startswith("lat,"):
            raise serializers.ValidationError("Pin a location with a street name.")
        # "14.65, 121.12" style
        if re.match(r"^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$", text):
            raise serializers.ValidationError("Pin a location with a street name.")
        return text[:255]

    def validate(self, attrs):
        if not attrs.get("category") and not attrs.get("category_id"):
            raise serializers.ValidationError({"category": "Choose a concern category."})
        dynamic_fields = attrs.get("dynamic_fields")
        if isinstance(dynamic_fields, str):
            import json
            try:
                attrs["dynamic_fields"] = json.loads(dynamic_fields or "{}")
            except ValueError as exc:
                raise serializers.ValidationError({"dynamic_fields": "Enter valid JSON."}) from exc
        try:
            attrs["_location_review"] = validate_report_location(attrs.get("latitude"), attrs.get("longitude"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class ConcernVoteSerializer(serializers.Serializer):
    value = serializers.IntegerField(min_value=0, max_value=1, default=1)


class ConcernCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=1000)
    parent = serializers.IntegerField(required=False, allow_null=True)


class ConcernStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Concern.Status.choices)
    note = serializers.CharField(max_length=255, allow_blank=True, required=False)
    status_version = serializers.IntegerField(min_value=0, required=False)

    def validate_status(self, value):
        if value == Concern.Status.SUBMITTED:
            raise serializers.ValidationError("Use a progress, resolved, rejected, or appealed status.")
        return value


class AnnouncementSerializer(serializers.ModelSerializer):
    date_label = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            "id",
            "title",
            "body",
            "tag",
            "audience",
            "barangay",
            "urgency",
            "is_pinned",
            "is_published",
            "published_at",
            "starts_at",
            "expires_at",
            "notification_sent_at",
            "image",
            "image_url",
            "image_alt",
            "date_label",
            "status_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at", "notification_sent_at", "image_url")
        extra_kwargs = {"image": {"required": False, "write_only": True}}

    def validate_image(self, value):
        if not value:
            return value
        mime_type = (getattr(value, "content_type", "") or "").lower()
        if not mime_type.startswith("image/"):
            raise serializers.ValidationError("Announcement media must be an image.")
        if getattr(value, "size", 0) > 8 * 1024 * 1024:
            raise serializers.ValidationError("Announcement image must be 8MB or smaller.")
        return value

    def validate(self, attrs):
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        expires_at = attrs.get("expires_at", getattr(self.instance, "expires_at", None))
        if starts_at and expires_at and expires_at <= starts_at:
            raise serializers.ValidationError({"expires_at": "Expiry must be after the scheduled start."})
        return attrs

    def get_date_label(self, obj):
        target = obj.starts_at or obj.published_at or obj.created_at
        return target.strftime("%b %d, %Y")

    def get_status_label(self, obj):
        from django.utils import timezone

        now = timezone.now()
        if not obj.is_published:
            return "draft"
        if obj.starts_at and obj.starts_at > now:
            return "scheduled"
        if obj.expires_at and obj.expires_at <= now:
            return "expired"
        return "published"

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get("request")
        url = obj.image.url
        return request.build_absolute_uri(url) if request else url


class BarangayEventSerializer(serializers.ModelSerializer):
    time_label = serializers.SerializerMethodField()

    class Meta:
        model = BarangayEvent
        fields = (
            "id",
            "title",
            "detail",
            "barangay",
            "starts_at",
            "ends_at",
            "is_published",
            "time_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def validate(self, attrs):
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError({"ends_at": "The event must end after it starts."})
        return attrs

    def get_time_label(self, obj):
        if not obj.starts_at:
            return ""
        return obj.starts_at.strftime("%I:%M %p").lstrip("0")


class ActiveResponderSerializer(PublicUserSerializer):
    class Meta(PublicUserSerializer.Meta):
        fields = PublicUserSerializer.Meta.fields + (
            "current_latitude",
            "current_longitude",
            "location_updated_at",
        )

    def get_fields(self):
        fields = super().get_fields()
        if not self.context.get("include_location", False):
            fields.pop("current_latitude", None)
            fields.pop("current_longitude", None)
            fields.pop("location_updated_at", None)
        return fields
