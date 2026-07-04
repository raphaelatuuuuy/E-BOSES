from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.services import validate_concern_media_file

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernComment,
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

    class Meta:
        model = User
        fields = ("id", "full_name", "initials", "role", "last_seen_at")

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


class ConcernSerializer(serializers.ModelSerializer):
    tracking_id = serializers.SerializerMethodField()
    reporter = PublicUserSerializer(read_only=True)
    media = ConcernMediaSerializer(many=True, read_only=True)
    status_events = ConcernStatusEventSerializer(many=True, read_only=True)
    comments = serializers.SerializerMethodField()
    vote_count = serializers.IntegerField(read_only=True, default=0)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    user_vote = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Concern
        fields = (
            "id",
            "tracking_id",
            "reporter",
            "title",
            "description",
            "category",
            "status",
            "address",
            "barangay",
            "update_text",
            "visibility",
            "media",
            "status_events",
            "comments",
            "vote_count",
            "comment_count",
            "user_vote",
            "created_at",
            "updated_at",
        )

    def get_tracking_id(self, obj):
        return f"RPT-{obj.pk:03d}"

    def get_comments(self, obj):
        comments = obj.comments.filter(parent__isnull=True).select_related("author", "author__resident_profile")
        return ConcernCommentSerializer(comments, many=True, context=self.context).data


class ConcernCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=160)
    description = serializers.CharField(allow_blank=True, required=False)
    category = serializers.ChoiceField(choices=Concern.Category.choices)
    visibility = serializers.ChoiceField(choices=Concern.Visibility.choices)
    address = serializers.CharField(max_length=255, allow_blank=True, required=False)


class ConcernVoteSerializer(serializers.Serializer):
    value = serializers.IntegerField(min_value=0, max_value=1, default=1)


class ConcernCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=1000)
    parent = serializers.IntegerField(required=False, allow_null=True)


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
        )

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
            "time_label",
        )

    def get_time_label(self, obj):
        if not obj.starts_at:
            return ""
        return obj.starts_at.strftime("%I:%M %p").lstrip("0")


class ActiveResponderSerializer(PublicUserSerializer):
    class Meta(PublicUserSerializer.Meta):
        fields = PublicUserSerializer.Meta.fields + ("email",)
