from django.db import transaction
from rest_framework import serializers

from .models import ConcernCategory, ConcernMedia, ConcernReport, ConcernStatusHistory, ConcernVote


class ConcernCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernCategory
        fields = ["id", "name", "description", "is_active", "created_at"]


class ConcernMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernMedia
        fields = ["id", "report", "file", "media_type", "original_filename", "mime_type", "file_size", "public_url", "is_public", "uploaded_at"]
        read_only_fields = ["original_filename", "mime_type", "file_size", "public_url", "uploaded_at"]

    def create(self, validated_data):
        file = validated_data.get("file")
        if file:
            validated_data.setdefault("original_filename", file.name)
            validated_data.setdefault("mime_type", getattr(file, "content_type", ""))
            validated_data.setdefault("file_size", file.size)
        validated_data["uploaded_by"] = self.context["request"].user
        return super().create(validated_data)


class ConcernReportSerializer(serializers.ModelSerializer):
    media = ConcernMediaSerializer(many=True, read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)

    class Meta:
        model = ConcernReport
        fields = ["id", "resident", "barangay", "tracking_number", "category", "category_name", "description", "photo_url", "latitude", "longitude", "zone", "severity_score", "ai_confidence_flag", "severity_override", "status", "vote_count", "media", "created_at", "updated_at"]
        read_only_fields = ["resident", "tracking_number", "severity_override", "status", "vote_count", "created_at", "updated_at"]

    def create(self, validated_data):
        request = self.context["request"]
        with transaction.atomic():
            report = ConcernReport.objects.create(resident=request.user, **validated_data)
            ConcernStatusHistory.objects.create(report=report, updated_by=request.user, old_status="", new_status=report.status, resolution_note="Report submitted")
        return report


class ConcernStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=ConcernReport.Status.choices)
    resolution_note = serializers.CharField(required=False, allow_blank=True)
    severity_override = serializers.IntegerField(required=False, min_value=1, max_value=5)


class ConcernStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernStatusHistory
        fields = ["id", "updated_by", "old_status", "new_status", "resolution_note", "updated_at"]


class ConcernVoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernVote
        fields = ["id", "report", "resident", "created_at"]
        read_only_fields = ["resident", "created_at"]
