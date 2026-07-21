import os
import tempfile
from datetime import timedelta
from difflib import SequenceMatcher

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasRolePermission
from apps.accounts.services import validate_concern_media_file
from apps.concerns.ai.classification import (
    BASE_IMAGE_MODEL,
    BASE_IMAGE_PROVIDER,
    BASE_TEXT_MODEL,
    BASE_TEXT_PROVIDER,
    classification_payload,
)
from apps.concerns.ai.image_detector import ImageDetectorNotConfigured, YOLOV8_COCO_CLASSES, YoloImageDetector
from apps.concerns.models import Concern, ConcernAiAssessment, ConcernClassificationConfiguration
from apps.emergencies.models import EmergencyAlert


class ClassificationConfigurationSerializer(serializers.ModelSerializer):
    text_model = serializers.CharField(source="nlp_model")
    text_relevance_threshold = serializers.FloatField(source="relevance_threshold")
    duplicate_similarity_threshold = serializers.FloatField(source="duplicate_threshold")
    flag_duplicates = serializers.BooleanField(source="duplicate_detection_enabled")
    categories = serializers.JSONField(required=False)
    metrics = serializers.SerializerMethodField()
    image_available = serializers.SerializerMethodField()
    text_available = serializers.SerializerMethodField()
    supported_classes = serializers.SerializerMethodField()
    mapping_targets = serializers.SerializerMethodField()

    class Meta:
        model = ConcernClassificationConfiguration
        fields = (
            "id", "image_provider", "image_model", "nlp_provider", "text_model",
            "image_confidence_threshold", "text_relevance_threshold", "duplicate_similarity_threshold",
            "minimum_description_length", "mismatch_action", "flag_suspicious", "flag_duplicates",
            "flag_irrelevant", "notify_reviewer", "suspicious_terms", "category_keywords",
            "label_mappings", "categories", "metrics", "image_available", "text_available", "supported_classes", "mapping_targets", "updated_by", "updated_at",
        )
        read_only_fields = ("id", "updated_by", "updated_at")

    def _categories_payload(self, obj):
        labels = dict(Concern.Category.choices)
        return [
            {
                "key": code,
                "label": labels[code],
                "enabled": code in (obj.enabled_categories or Concern.Category.values),
                "detected_labels": [
                    label for label, category in obj.label_mappings.items() if category == code
                ],
            }
            for code in Concern.Category.values
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["categories"] = self._categories_payload(instance)
        return data

    def update(self, instance, validated_data):
        categories = validated_data.pop("categories", None)
        if categories is not None:
            valid_codes = set(Concern.Category.values)
            enabled = [
                str(item.get("key"))
                for item in categories
                if isinstance(item, dict) and item.get("enabled") and item.get("key") in valid_codes
            ]
            if not enabled:
                raise serializers.ValidationError({"categories": "Keep at least one concern category enabled."})
            instance.enabled_categories = enabled
        validated_data["image_provider"] = BASE_IMAGE_PROVIDER
        validated_data["image_model"] = BASE_IMAGE_MODEL
        validated_data["nlp_provider"] = BASE_TEXT_PROVIDER
        validated_data["nlp_model"] = BASE_TEXT_MODEL
        return super().update(instance, validated_data)

    def get_metrics(self, obj):
        since = timezone.now() - timedelta(days=30)
        assessments = ConcernAiAssessment.objects.filter(updated_at__gte=since)
        completed = assessments.filter(status=ConcernAiAssessment.Status.COMPLETED)
        flagged = assessments.exclude(status=ConcernAiAssessment.Status.COMPLETED).count() + completed.filter(category_match=False).count()
        return {
            "image_accuracy": None,
            "text_accuracy": None,
            "auto_validated": completed.filter(category_match=True).count(),
            "flagged": flagged,
            "tested": assessments.count(),
        }

    def get_image_available(self, obj):
        model_path = getattr(settings, "EBOSES_YOLO_MODEL_PATH", "")
        return bool(model_path and os.path.exists(model_path))

    def get_text_available(self, obj):
        return True

    def get_supported_classes(self, obj):
        return YOLOV8_COCO_CLASSES

    def get_mapping_targets(self, obj):
        return [
            *[{"key": code, "label": label, "group": "concern"} for code, label in Concern.Category.choices],
            *[{"key": f"emergency:{code}", "label": label, "group": "emergency"} for code, label in EmergencyAlert.Type.choices],
        ]

    def validate(self, attrs):
        for field in ("image_confidence_threshold", "relevance_threshold", "duplicate_threshold"):
            value = attrs.get(field, getattr(self.instance, field, None))
            if value is not None and not 0 <= value <= 1:
                raise serializers.ValidationError({field: "Enter a value from 0 to 1."})
        errors = {}
        if "image_provider" in attrs and attrs["image_provider"] != BASE_IMAGE_PROVIDER:
            errors["image_provider"] = f"The base image provider must remain {BASE_IMAGE_PROVIDER}."
        if "image_model" in attrs and attrs["image_model"] != BASE_IMAGE_MODEL:
            errors["image_model"] = f"The current base detector must remain {BASE_IMAGE_MODEL}."
        if "nlp_provider" in attrs and attrs["nlp_provider"] != BASE_TEXT_PROVIDER:
            errors["nlp_provider"] = f"The base text provider must remain {BASE_TEXT_PROVIDER}."
        if "nlp_model" in attrs and attrs["nlp_model"] != BASE_TEXT_MODEL:
            errors["text_model"] = f"The current base text checker must remain {BASE_TEXT_MODEL}."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class OfficialClassificationView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission]
    required_permission = "concerns.manage"
    parser_classes = [JSONParser]

    def get(self, request):
        return Response(ClassificationConfigurationSerializer(ConcernClassificationConfiguration.current()).data)

    def patch(self, request):
        config = ConcernClassificationConfiguration.current()
        serializer = ClassificationConfigurationSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class OfficialClassificationStatsView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission]
    required_permission = "concerns.manage"

    def get(self, request):
        since = timezone.now() - timedelta(days=30)
        assessments = ConcernAiAssessment.objects.filter(updated_at__gte=since)
        completed = assessments.filter(status=ConcernAiAssessment.Status.COMPLETED)
        flagged = completed.filter(category_match=False).count() + assessments.exclude(status=ConcernAiAssessment.Status.COMPLETED).count()
        daily = list(assessments.extra(select={"day": "DATE(updated_at)"}).values("day").annotate(total=Count("id")).order_by("day"))
        return Response({
            "active_categories": len(Concern.Category.choices),
            "processed": assessments.count(),
            "completed": completed.count(),
            "flagged": flagged,
            "activity": [{"date": str(row["day"]), "total": row["total"]} for row in daily],
            "accuracy": None,
            "accuracy_notice": "Accuracy is unavailable until a labeled evaluation dataset is measured.",
        })


class OfficialClassificationResetView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission]
    required_permission = "concerns.manage"

    def post(self, request):
        ConcernClassificationConfiguration.objects.filter(pk=1).delete()
        config = ConcernClassificationConfiguration.current()
        config.updated_by = request.user
        config.save(update_fields=["updated_by", "updated_at"])
        return Response(ClassificationConfigurationSerializer(config).data)


class OfficialClassificationTextTestView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission]
    required_permission = "concerns.manage"

    def post(self, request):
        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        category = str(request.data.get("category", ""))
        if category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        config = ConcernClassificationConfiguration.current()
        result = classification_payload(title=title, description=description, selected_category=category, configuration=config)
        candidate = f"{title} {description}".strip().lower()
        duplicate_similarity = 0.0
        if config.duplicate_detection_enabled and candidate:
            for existing in Concern.objects.exclude(description="").only("title", "description").order_by("-created_at")[:200]:
                existing_text = f"{existing.title} {existing.description}".strip().lower()
                duplicate_similarity = max(duplicate_similarity, SequenceMatcher(None, candidate, existing_text).ratio())
        duplicate = duplicate_similarity >= config.duplicate_threshold
        classification = result["outcome"]
        approved = classification == "related" and not duplicate
        return Response({
            "classification": classification,
            "confidence": result["confidence"],
            "category_match": result["category_match"],
            "duplicate": duplicate,
            "duplicate_similarity": round(duplicate_similarity, 4),
            "outcome": "approved" if approved else "flagged",
            "explanation": result["notice"],
            "model": result["model_version"],
            "calibrated": False,
        })


class OfficialClassificationImageTestView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission]
    required_permission = "concerns.manage"
    parser_classes = [MultiPartParser]

    def post(self, request):
        uploaded = request.FILES.get("file")
        selected_category = str(request.data.get("category", ""))
        if selected_category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        if not uploaded:
            return Response({"file": ["Upload an image."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_concern_media_file(uploaded)
        except DjangoValidationError as exc:
            return Response({"file": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        config = ConcernClassificationConfiguration.current()
        model_path = getattr(settings, "EBOSES_YOLO_MODEL_PATH", "")
        if not model_path or not os.path.exists(model_path):
            return Response({
                "detected_label": "No reliable detection",
                "detected_category": "",
                "selected_category": selected_category,
                "confidence": 0.0,
                "outcome": "needs_review",
                "message": "YOLOv8m weights are not installed on this server. The image is routed to official review.",
                "model": config.image_model,
                "available": False,
            })
        suffix = os.path.splitext(uploaded.name)[1][:10]
        path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
                for chunk in uploaded.chunks():
                    temp.write(chunk)
                path = temp.name
            result = YoloImageDetector(model_path).detect([path], include_annotation=True)
            objects = [item for item in result.objects if item["confidence"] >= config.image_confidence_threshold]
            mapped = [{**item, "category": config.label_mappings.get(item["label"].lower(), "")} for item in objects]
            best = max(mapped, key=lambda item: item["confidence"], default=None)
            detected_category = best["category"] if best else ""
            outcome = "match" if detected_category == selected_category else "mismatch" if detected_category else "needs_review"
            return Response({
                "detected_label": best["label"] if best else "No supported object",
                "detected_category": detected_category,
                "selected_category": selected_category,
                "confidence": float(best["confidence"]) if best else float(result.confidence or 0),
                "outcome": outcome,
                "message": "Base YOLOv8m evidence only; an official should review unsupported civic categories.",
                "objects": mapped,
                "annotated_image": result.annotated_image,
                "model": result.model_version,
                "available": True,
                "calibrated": False,
            })
        except ImageDetectorNotConfigured as exc:
            return Response({"detected_label": "No reliable detection", "detected_category": "", "selected_category": selected_category, "confidence": 0.0, "outcome": "needs_review", "message": str(exc), "available": False})
        except Exception:
            return Response({"detected_label": "No reliable detection", "detected_category": "", "selected_category": selected_category, "confidence": 0.0, "outcome": "needs_review", "message": "Image detection failed safely; official review is required.", "available": False})
        finally:
            if path and os.path.exists(path):
                os.unlink(path)
