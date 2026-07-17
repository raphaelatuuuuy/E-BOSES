from rest_framework import serializers
from django.core.exceptions import ValidationError as DjangoValidationError

from apps.accounts.models import User
from apps.accounts.services import validate_concern_media_file

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernAppeal,
    ConcernAssignment,
    ConcernAiAssessment,
    ConcernClarification,
    ConcernComment,
    ConcernOfficialRemark,
    ContentFlag,
    ConcernMedia,
    ConcernStatusEvent,
)
from .services import validate_barangay_location


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
        return "E-Boses user"

    def get_initials(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile:
            return f"{profile.first_name[:1]}{profile.last_name[:1]}".upper() or "?"
        return obj.email[:2].upper()

    def get_street(self, obj):
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
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path

    def get_raw_url(self, obj):
        path = f"/api/concerns/media/{obj.pk}/raw/"
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
        fields = ("id", "author", "parent", "body", "created_at", "updated_at", "replies")

    def get_replies(self, obj):
        replies = obj.replies.select_related("author", "author__resident_profile").all()
        return ConcernCommentSerializer(replies, many=True, context=self.context).data

class ConcernAiAssessmentSerializer(serializers.ModelSerializer):
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
            "updated_at",
        )

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


class ConcernAssignmentSerializer(serializers.ModelSerializer):
    assignee = PublicUserSerializer(read_only=True)
    assigned_by = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernAssignment
        fields = ("id", "assignee", "assigned_by", "office", "note", "status", "created_at", "updated_at")

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

class ConcernSerializer(serializers.ModelSerializer):
    tracking_id = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()
    location_source = serializers.SerializerMethodField()
    location_accuracy = serializers.SerializerMethodField()
    reporter = PublicUserSerializer(read_only=True)
    media = ConcernMediaSerializer(many=True, read_only=True)
    status_events = ConcernStatusEventSerializer(many=True, read_only=True)
    comments = serializers.SerializerMethodField()
    ai_assessment = ConcernAiAssessmentSerializer(read_only=True)
    assignments = serializers.SerializerMethodField()
    clarifications = serializers.SerializerMethodField()
    appeals = serializers.SerializerMethodField()
    official_remarks = serializers.SerializerMethodField()
    vote_count = serializers.IntegerField(read_only=True, default=0)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    priority_score = serializers.IntegerField(read_only=True, default=0)
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
            "vote_count",
            "comment_count",
            "priority_score",
            "user_vote",
            "created_at",
            "updated_at",
        )

    def is_privacy_safe(self):
        return bool(self.context.get("privacy_safe"))

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

    def get_comments(self, obj):
        comments = obj.comments.filter(parent__isnull=True).select_related("author", "author__resident_profile")
        return ConcernCommentSerializer(comments, many=True, context=self.context).data

    def get_assignments(self, obj):
        if self.is_privacy_safe():
            return []
        queryset = obj.assignments.select_related("assignee", "assignee__resident_profile", "assigned_by", "assigned_by__resident_profile")
        return ConcernAssignmentSerializer(queryset, many=True, context=self.context).data

    def get_clarifications(self, obj):
        if self.is_privacy_safe():
            return []
        queryset = obj.clarifications.select_related("requested_by", "requested_by__resident_profile", "responded_by", "responded_by__resident_profile")
        return ConcernClarificationSerializer(queryset, many=True, context=self.context).data

    def get_appeals(self, obj):
        if self.is_privacy_safe():
            return []
        queryset = obj.appeals.select_related("appellant", "appellant__resident_profile", "reviewed_by", "reviewed_by__resident_profile")
        return ConcernAppealSerializer(queryset, many=True, context=self.context).data

    def get_official_remarks(self, obj):
        queryset = obj.official_remarks.select_related("author", "author__resident_profile")
        request = self.context.get("request")
        user = getattr(request, "user", None)
        is_official = bool(user and (user.is_staff or user.is_superuser or user.role == User.Role.BARANGAY_OFFICIAL))
        if self.is_privacy_safe() or not is_official:
            queryset = queryset.filter(visible_to_resident=True)
        return ConcernOfficialRemarkSerializer(queryset, many=True, context=self.context).data


class ConcernCreateSerializer(serializers.Serializer):
    client_request_id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=160)
    description = serializers.CharField(min_length=20, max_length=4000)
    category = serializers.ChoiceField(choices=Concern.Category.choices)
    visibility = serializers.ChoiceField(choices=Concern.Visibility.choices, default=Concern.Visibility.COMMUNITY)
    address = serializers.CharField(max_length=255)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    location_source = serializers.ChoiceField(choices=("gps", "manual_pin"))
    location_accuracy = serializers.FloatField(required=False, allow_null=True)

    def validate(self, attrs):
        try:
            validate_barangay_location(attrs.get("latitude"), attrs.get("longitude"))
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

    class Meta:
        model = Announcement
        fields = (
            "id",
            "title",
            "body",
            "tag",
            "audience",
            "barangay",
            "is_published",
            "published_at",
            "date_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_date_label(self, obj):
        target = obj.published_at or obj.created_at
        return target.strftime("%b %d, %Y")


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
