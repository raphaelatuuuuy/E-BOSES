from rest_framework import serializers
from django.core.exceptions import ValidationError as DjangoValidationError

from apps.accounts.models import User
from apps.accounts.services import validate_concern_media_file, validate_location_pair

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernAiAssessment,
    ConcernComment,
    ContentFlag,
    ConcernMedia,
    ConcernStatusEvent,
)


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
    gender = serializers.SerializerMethodField()
    date_of_birth = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "full_name",
            "initials",
            "role",
            "last_seen_at",
            "avatar",
            "gender",
            "date_of_birth",
            "responder_unit",
            "is_on_duty",
            "current_latitude",
            "current_longitude",
            "location_updated_at",
        )

    def get_full_name(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile:
            return f"{profile.first_name} {profile.last_name}".strip()
        return obj.email.split("@")[0]

    def get_initials(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile:
            return f"{profile.first_name[:1]}{profile.last_name[:1]}".upper() or "?"
        return obj.email[:2].upper()

    def get_avatar(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile and profile.avatar:
            return profile.avatar
        if profile and profile.gender and profile.gender != "prefer_not_to_say" and profile.date_of_birth:
            from datetime import date
            age = date.today().year - profile.date_of_birth.year
            bucket = "senior" if age >= 55 else "middleaged" if age >= 30 else "young"
            icon = "man" if profile.gender == "male" else "woman"
            return f"{bucket}-{icon}"
        return ""

    def get_gender(self, obj):
        profile = getattr(obj, "resident_profile", None)
        return profile.gender if profile else ""

    def get_date_of_birth(self, obj):
        profile = getattr(obj, "resident_profile", None)
        return profile.date_of_birth if profile else None


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


class ConcernSerializer(serializers.ModelSerializer):
    tracking_id = serializers.SerializerMethodField()
    validation_status = serializers.SerializerMethodField()
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
    vote_count = serializers.IntegerField(read_only=True, default=0)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    priority_score = serializers.IntegerField(read_only=True, default=0)
    user_vote = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Concern
        fields = (
            "id",
            "tracking_id",
            "validation_status",
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
        year = obj.created_at.year if obj.created_at else 0
        return f"RPT-{year}-{obj.pk:06d}"

    def get_validation_status(self, obj):
        if obj.status == Concern.Status.REJECTED:
            return "rejected"
        if obj.status == Concern.Status.SUBMITTED:
            return "pending_review"
        if obj.status == Concern.Status.RESOLVED:
            return "resolved"
        return "accepted"

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


class ConcernCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=160)
    description = serializers.CharField(allow_blank=True, required=False)
    category = serializers.ChoiceField(choices=Concern.Category.choices)
    visibility = serializers.ChoiceField(choices=Concern.Visibility.choices)
    address = serializers.CharField(max_length=255, allow_blank=True, required=False)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    location_source = serializers.CharField(max_length=32, allow_blank=True, required=False)
    location_accuracy = serializers.FloatField(required=False, allow_null=True)

    def validate(self, attrs):
        try:
            validate_location_pair(attrs.get("latitude"), attrs.get("longitude"))
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
        fields = PublicUserSerializer.Meta.fields + ("email",)
