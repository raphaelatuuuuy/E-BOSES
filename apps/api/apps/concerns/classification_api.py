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

from apps.accounts.permissions import HasRolePermission, user_has_role_permission
from apps.accounts.services import validate_concern_media_file
from apps.concerns.ai.classification import (
    ALLOWED_NLP_PROVIDERS,
    BASE_IMAGE_MODEL,
    BASE_IMAGE_PROVIDER,
    BASE_TEXT_MODEL,
    classification_payload,
)
from apps.concerns.ai.duplicate_detector import report_fingerprints
from apps.concerns.ai.image_detector import ImageDetectorNotConfigured, YoloImageDetector
from apps.concerns.ai.ollama_text_classifier import display_label_for
from apps.concerns.ai.ollama_text_classifier import image_bytes_for_ollama
from apps.concerns.models import (
    Concern,
    ConcernAiAssessment,
    ConcernCategory,
    ConcernClassificationConfiguration,
    DEFAULT_SUPPORTED_YOLO_CLASSES,
)
from apps.emergencies.models import EmergencyCategory
from apps.capabilities import CONFIGURE_CLASSIFICATION, HasCapability


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
            "label_mappings", "report_duplicate_detection_enabled", "report_duplicate_action",
            "report_duplicate_lookback_days", "report_duplicate_distance_meters",
            "report_duplicate_similarity_threshold", "report_duplicate_location_precision",
            "categories", "metrics", "image_available", "text_available", "supported_classes", "mapping_targets", "updated_by", "updated_at",
        )
        read_only_fields = ("id", "updated_by", "updated_at")

    def _categories_payload(self, obj):
        categories = list(ConcernCategory.objects.filter(is_active=True).order_by("name"))
        if not categories:
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
        enabled_codes = set(obj.enabled_categories or [])
        return [
            {
                "key": category.code,
                "label": category.name,
                "enabled": category.code in enabled_codes or not enabled_codes,
                "detected_labels": [
                    label for label, mapped_category in obj.label_mappings.items() if mapped_category == category.code
                ],
            }
            for category in categories
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
        validated_data["nlp_provider"] = next(iter(ALLOWED_NLP_PROVIDERS))
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
        return bool(getattr(settings, "OLLAMA_API_KEY", ""))

    def get_supported_classes(self, obj):
        return obj.supported_classes if obj.supported_classes else DEFAULT_SUPPORTED_YOLO_CLASSES

    def get_mapping_targets(self, obj):
        return [
            *[
                {"key": category.code, "label": category.name, "group": "concern"}
                for category in ConcernCategory.objects.filter(is_active=True).order_by("name")
            ],
            *[
                {"key": f"emergency:{category.code}", "label": category.label, "group": "emergency"}
                for category in EmergencyCategory.objects.filter(is_active=True).order_by("sort_order", "label")
            ],
        ]

    def validate(self, attrs):
        for field in ("image_confidence_threshold", "relevance_threshold", "duplicate_threshold"):
            value = attrs.get(field, getattr(self.instance, field, None))
            if value is not None and not 0 <= value <= 1:
                raise serializers.ValidationError({field: "Enter a value from 0 to 1."})
        value = attrs.get("report_duplicate_similarity_threshold", getattr(self.instance, "report_duplicate_similarity_threshold", None))
        if value is not None and not 0 <= value <= 1:
            raise serializers.ValidationError({"report_duplicate_similarity_threshold": "Enter a value from 0 to 1."})
        errors = {}
        if "image_provider" in attrs and attrs["image_provider"] != BASE_IMAGE_PROVIDER:
            errors["image_provider"] = f"The base image provider must remain {BASE_IMAGE_PROVIDER}."
        if "image_model" in attrs and attrs["image_model"] != BASE_IMAGE_MODEL:
            errors["image_model"] = f"The current base detector must remain {BASE_IMAGE_MODEL}."
        if "nlp_provider" in attrs and attrs["nlp_provider"] not in ALLOWED_NLP_PROVIDERS:
            errors["nlp_provider"] = f"nlp_provider must be one of {sorted(ALLOWED_NLP_PROVIDERS)}."
        if "nlp_model" in attrs and attrs["nlp_model"] != BASE_TEXT_MODEL:
            errors["text_model"] = f"The current base text checker must remain {BASE_TEXT_MODEL}."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class OfficialClassificationView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION
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
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

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
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

    def post(self, request):
        ConcernClassificationConfiguration.objects.filter(pk=1).delete()
        config = ConcernClassificationConfiguration.current()
        config.updated_by = request.user
        config.save(update_fields=["updated_by", "updated_at"])
        return Response(ClassificationConfigurationSerializer(config).data)


class OfficialClassificationTextTestView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

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
            **_ollama_details(result),
        })


class OfficialClassificationImageTestView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION
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
            result = YoloImageDetector(model_path).detect(
                [path],
                include_annotation=True,
                supported_classes=config.supported_classes,
                confidence_threshold=config.image_confidence_threshold,
            )
            supported_classes = {str(item).lower() for item in (config.supported_classes or DEFAULT_SUPPORTED_YOLO_CLASSES)}
            objects = [item for item in result.objects if str(item.get("label", "")).lower() in supported_classes]
            mapped = [
                {
                    **item,
                    "display_label": display_label_for(item["label"]),
                    "category": config.label_mappings.get(item["label"].lower(), ""),
                }
                for item in objects
            ]
            best = max(mapped, key=lambda item: item["confidence"], default=None)
            detected_category = best["category"] if best else ""
            outcome = "match" if detected_category == selected_category else "mismatch" if detected_category else "needs_review"
            return Response({
                "detected_label": best["display_label"] if best else "No supported object",
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


class OfficialClassificationSubmissionTestView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION
    parser_classes = [MultiPartParser]

    def post(self, request):
        selected_category = str(request.data.get("category", ""))
        if selected_category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        if not description.strip():
            return Response({"description": ["Enter a sample description."]}, status=status.HTTP_400_BAD_REQUEST)

        config = ConcernClassificationConfiguration.current()
        uploaded = request.FILES.get("file")
        image_data, image_mime_type = _image_data_from_upload(uploaded)
        image_payload = _detect_test_image(uploaded, selected_category, config)
        objects = image_payload.get("objects", [])
        result = classification_payload(
            title=title,
            description=description,
            selected_category=selected_category,
            configuration=config,
            image_objects=objects,
            image_data=image_data,
            image_mime_type=image_mime_type,
        )
        duplicate, duplicate_similarity = _duplicate_preview(config, title=title, description=description)
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
            "image": image_payload,
            **_ollama_details(result),
        })


class ResidentConcernPrecheckView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        if not user_has_role_permission(request.user, "concerns.create"):
            return Response({"detail": "Only residents can check reports."}, status=status.HTTP_403_FORBIDDEN)
        selected_category = str(request.data.get("category", ""))
        if selected_category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        if not description.strip():
            return Response({"description": ["Describe the issue before submitting."]}, status=status.HTTP_400_BAD_REQUEST)

        config = ConcernClassificationConfiguration.current()
        uploaded = request.FILES.get("media") or request.FILES.get("file")
        image_data, image_mime_type = _image_data_from_upload(uploaded)
        image_payload = _detect_test_image(uploaded, selected_category, config)
        result = classification_payload(
            title=title,
            description=description,
            selected_category=selected_category,
            configuration=config,
            image_objects=image_payload.get("objects", []),
            image_data=image_data,
            image_mime_type=image_mime_type,
        )
        duplicate_feedback = _report_duplicate_feedback(config, request=request, selected_category=selected_category, title=title, description=description)
        return Response(_resident_feedback(result, selected_category=selected_category, image_payload=image_payload, duplicate_feedback=duplicate_feedback))


def _duplicate_preview(config, *, title: str, description: str) -> tuple[bool, float]:
    candidate = f"{title} {description}".strip().lower()
    duplicate_similarity = 0.0
    if config.duplicate_detection_enabled and candidate:
        for existing in Concern.objects.exclude(description="").only("title", "description").order_by("-created_at")[:200]:
            existing_text = f"{existing.title} {existing.description}".strip().lower()
            duplicate_similarity = max(duplicate_similarity, SequenceMatcher(None, candidate, existing_text).ratio())
    return duplicate_similarity >= config.duplicate_threshold, duplicate_similarity


def _map_image_objects(result, config) -> list[dict]:
    supported_classes = {str(item).lower() for item in (config.supported_classes or DEFAULT_SUPPORTED_YOLO_CLASSES)}
    return [
        {
            **item,
            "display_label": display_label_for(item["label"]),
            "category": config.label_mappings.get(item["label"].lower(), ""),
        }
        for item in result.objects
        if str(item.get("label", "")).lower() in supported_classes
    ]


def _detect_test_image(uploaded, selected_category: str, config) -> dict:
    if not uploaded:
        return {
            "available": False,
            "detected_label": "No image uploaded",
            "detected_category": "",
            "selected_category": selected_category,
            "confidence": 0.0,
            "outcome": "needs_review",
            "message": "No image was included in this sample.",
            "objects": [],
            "annotated_image": "",
            "model": config.image_model,
        }
    try:
        validate_concern_media_file(uploaded)
    except DjangoValidationError as exc:
        return {
            "available": False,
            "detected_label": "Image could not be checked",
            "detected_category": "",
            "selected_category": selected_category,
            "confidence": 0.0,
            "outcome": "needs_review",
            "message": " ".join(exc.messages),
            "objects": [],
            "annotated_image": "",
            "model": config.image_model,
        }
    model_path = getattr(settings, "EBOSES_YOLO_MODEL_PATH", "")
    if not model_path or not os.path.exists(model_path):
        return {
            "detected_label": "No reliable detection",
            "detected_category": "",
            "selected_category": selected_category,
            "confidence": 0.0,
            "outcome": "needs_review",
            "message": "YOLOv8m weights are not installed on this server. The image is routed to official review.",
            "model": config.image_model,
            "available": False,
            "objects": [],
            "annotated_image": "",
        }
    suffix = os.path.splitext(uploaded.name)[1][:10]
    path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
            for chunk in uploaded.chunks():
                temp.write(chunk)
            path = temp.name
        result = YoloImageDetector(model_path).detect(
            [path],
            include_annotation=True,
            supported_classes=config.supported_classes,
            confidence_threshold=config.image_confidence_threshold,
        )
        mapped = _map_image_objects(result, config)
        best = max(mapped, key=lambda item: item["confidence"], default=None)
        detected_category = best["category"] if best else ""
        outcome = "match" if detected_category == selected_category else "mismatch" if detected_category else "needs_review"
        return {
            "detected_label": best["display_label"] if best else "No supported object",
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
        }
    except ImageDetectorNotConfigured as exc:
        return {"detected_label": "No reliable detection", "detected_category": "", "selected_category": selected_category, "confidence": 0.0, "outcome": "needs_review", "message": str(exc), "available": False, "objects": [], "annotated_image": ""}
    except Exception:
        return {"detected_label": "No reliable detection", "detected_category": "", "selected_category": selected_category, "confidence": 0.0, "outcome": "needs_review", "message": "Image detection failed safely; official review is required.", "available": False, "objects": [], "annotated_image": ""}
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


def _image_data_from_upload(uploaded) -> tuple[str | None, str]:
    if not uploaded:
        return None, ""
    try:
        validate_concern_media_file(uploaded)
        uploaded.seek(0)
        data = uploaded.read()
        uploaded.seek(0)
    except Exception:
        try:
            uploaded.seek(0)
        except Exception:
            pass
        return None, ""
    return image_bytes_for_ollama(data)


def _report_duplicate_feedback(config, *, request, selected_category: str, title: str, description: str) -> dict:
    if not config.report_duplicate_detection_enabled:
        return {"found": False}
    fingerprints = report_fingerprints(
        barangay=getattr(getattr(request.user, "resident_profile", None), "barangay", "") or "Marikina Heights",
        category=selected_category,
        title=title,
        description=description,
        latitude=request.data.get("latitude"),
        longitude=request.data.get("longitude"),
        precision=config.report_duplicate_location_precision,
    )
    match = None
    if fingerprints["report_fingerprint"]:
        match = Concern.objects.filter(report_fingerprint=fingerprints["report_fingerprint"]).exclude(status=Concern.Status.REJECTED).order_by("-created_at").first()
    if not match:
        return {"found": False}
    return {
        "found": True,
        "action": config.report_duplicate_action,
        "tracking_id": match.tracking_id,
        "message": "A similar report may already exist near this location. Check it first or continue if this is a new issue.",
    }


def _resident_feedback(result: dict, *, selected_category: str, image_payload: dict, duplicate_feedback: dict | None = None) -> dict:
    details = result.get("details") or {}
    flags = set(details.get("content_flags") or [])
    primary = details.get("primary_category") or ""
    relationship = details.get("evidence_relationship") or ""
    field_errors = {}
    messages = []
    can_submit = True
    needs_revision = False
    if "low_information_text" in flags or result.get("outcome") == "needs_review" and not primary:
        field_errors["description"] = "Add a clearer description of the issue."
        can_submit = False
        needs_revision = True
    if primary and primary != selected_category:
        messages.append(f"Your description sounds like {primary.replace('_', ' ')}, but you selected {selected_category.replace('_', ' ')}.")
        needs_revision = True
    if relationship in {"contradicts_report", "no_useful_image_evidence"} and image_payload.get("available"):
        messages.append("The photo does not clearly show the issue described.")
        needs_revision = True
    if relationship == "image_unavailable" and not image_payload.get("available"):
        messages.append("No photo was detected for review. A clear photo helps confirm your report.")
    if details.get("privacy_sensitive_information_detected"):
        messages.append("This may show private details. Sensitive parts may be blurred before public display.")
    if details.get("urgent_attention"):
        messages.append("This may need urgent attention. Submit it now or use Emergency Alert if someone is in immediate danger.")
    if "profanity" in flags:
        messages.append("Strong language was detected, but the report can still continue if it describes a real issue.")
    if duplicate_feedback and duplicate_feedback.get("found"):
        action = duplicate_feedback.get("action")
        if action == ConcernClassificationConfiguration.ReportDuplicateAction.BLOCK:
            field_errors["description"] = "A similar report already exists near this location."
            can_submit = False
            needs_revision = True
            messages.append("A similar report already exists near this location. Add new details only if this is a different issue.")
        elif action == ConcernClassificationConfiguration.ReportDuplicateAction.OFFICIAL_REVIEW:
            messages.append("A similar report may already exist. It will be checked by an official.")
        else:
            messages.append(duplicate_feedback.get("message") or "A similar report may already exist near this location.")
            needs_revision = True
    return {
        "can_submit": can_submit,
        "needs_revision": needs_revision,
        "field_errors": field_errors,
        "message": " ".join(messages) or details.get("short_explanation") or "Report check completed.",
        "suggested_category": primary,
        "photo_feedback": details.get("photo_assessment") or image_payload.get("message") or "",
        "result": {
            "classification": result.get("outcome"),
            "evidence_relationship": relationship,
            "recommended_action": details.get("recommended_action"),
            "short_explanation": details.get("short_explanation"),
        },
    }


def _ollama_details(result: dict) -> dict:
    details = result.get("details") or {}
    return {
        "relevance": details.get("relevance"),
        "primary_category": details.get("primary_category"),
        "possible_categories": details.get("possible_categories") or [],
        "content_flags": details.get("content_flags") or [],
        "image_flags": details.get("image_flags") or [],
        "text_assessment": details.get("text_assessment"),
        "photo_assessment": details.get("photo_assessment"),
        "recognized_photo_items": details.get("recognized_photo_items") or [],
        "visual_summary": details.get("visual_summary"),
        "mismatch_reason": details.get("mismatch_reason"),
        "image_review_limited": details.get("image_review_limited"),
        "image_review_message": details.get("image_review_message"),
        "privacy_sensitive_information_detected": details.get("privacy_sensitive_information_detected"),
        "disturbing_content_detected": details.get("disturbing_content_detected"),
        "urgent_attention": details.get("urgent_attention"),
        "evidence_relationship": details.get("evidence_relationship"),
        "severity": details.get("severity"),
        "ai_result_uncertain": details.get("ai_result_uncertain"),
        "recommended_action": details.get("recommended_action"),
        "public_media_treatment": details.get("public_media_treatment"),
    }
