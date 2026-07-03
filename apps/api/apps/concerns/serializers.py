"""Concerns serializers for E-Boses."""

from rest_framework import serializers

from .models import Category, Concern, ConcernMedia, ConcernStatusLog


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "description", "is_active"]


class ConcernMediaSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernMedia
        fields = ["id", "file", "mime_type", "uploaded_at"]
        read_only_fields = ["id", "uploaded_at"]


class ConcernSerializer(serializers.ModelSerializer):
    media = ConcernMediaSerializer(many=True, read_only=True)
    final_severity_score = serializers.FloatField(read_only=True)
    final_category = CategorySerializer(read_only=True)

    class Meta:
        model = Concern
        fields = [
            "id", "title", "description", "category", "status", "latitude", "longitude", "media",
            "ai_severity_score", "ai_category_suggestion", "ai_relevance_score", "ai_fake_report_score",
            "ai_model_version", "ai_explanation", "ai_metadata", "ai_reviewed_at",
            "reviewer_severity_score", "reviewer_category", "reviewer_relevance_score",
            "reviewer_fake_report_score", "reviewer_override_reason", "reviewer", "reviewed_at",
            "final_severity_score", "final_category", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "ai_severity_score", "ai_category_suggestion", "ai_relevance_score",
            "ai_fake_report_score", "ai_model_version", "ai_explanation", "ai_metadata", "ai_reviewed_at",
            "reviewer", "reviewed_at", "final_severity_score", "final_category", "created_at", "updated_at",
        ]


class ConcernStatusLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernStatusLog
        fields = ["id", "concern", "status", "actor", "note", "created_at"]
        read_only_fields = ["id", "created_at"]
