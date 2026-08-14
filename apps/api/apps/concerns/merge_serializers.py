from rest_framework import serializers

from .models import ConcernMergeEvent, ConcernMergeSuggestion


def reporter_name(concern):
    profile = getattr(concern.reporter, "resident_profile", None)
    if profile:
        return f"{profile.first_name} {profile.last_name}".strip()
    return concern.reporter.email


def candidate_brief(concern):
    return {
        "id": concern.pk,
        "tracking_id": concern.tracking_id,
        "title": concern.title,
        "description": concern.description or "",
        "status": concern.status,
        "category": concern.category,
        "address": concern.address or "",
        "created_at": concern.created_at,
        "photo_count": concern.media.count(),
        "reporter_name": reporter_name(concern),
    }


class MergeSuggestionSerializer(serializers.ModelSerializer):
    concern = serializers.SerializerMethodField()
    primary = serializers.SerializerMethodField()

    class Meta:
        model = ConcernMergeSuggestion
        fields = [
            "id",
            "concern",
            "primary",
            "confidence",
            "method",
            "distance_meters",
            "rationale",
            "status",
            "created_at",
        ]

    def get_concern(self, obj):
        return candidate_brief(obj.concern)

    def get_primary(self, obj):
        return candidate_brief(obj.primary)


class MergeEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    concern_tracking_id = serializers.SerializerMethodField()
    primary_tracking_id = serializers.SerializerMethodField()

    class Meta:
        model = ConcernMergeEvent
        fields = [
            "id",
            "action",
            "actor_name",
            "confidence",
            "method",
            "reason",
            "concern_tracking_id",
            "primary_tracking_id",
            "created_at",
        ]

    def get_actor_name(self, obj):
        if not obj.actor:
            return "System"
        profile = getattr(obj.actor, "resident_profile", None)
        if profile:
            return f"{profile.first_name} {profile.last_name}".strip()
        return obj.actor.email

    def get_concern_tracking_id(self, obj):
        return obj.concern.tracking_id

    def get_primary_tracking_id(self, obj):
        return obj.primary.tracking_id if obj.primary else ""


class MergeDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approve", "reject"])
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class MergeRequestSerializer(serializers.Serializer):
    primary_id = serializers.IntegerField()
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255)


class UnmergeRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255)
