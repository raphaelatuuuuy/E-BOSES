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
    BASE_TEXT_MODEL,
    classification_payload,
)
from apps.concerns.ai.duplicate_detector import report_fingerprints
from apps.concerns.ai.image_prep import prepare_image_for_gemma
from apps.concerns.models import (
    Concern,
    ConcernAiAssessment,
    ConcernCategory,
    ConcernClassificationConfiguration,
    ConcernMedia,
)
from apps.capabilities import CONFIGURE_CLASSIFICATION, HasCapability


class ClassificationConfigurationSerializer(serializers.ModelSerializer):
    text_model = serializers.CharField(source="nlp_model")
    text_relevance_threshold = serializers.FloatField(source="relevance_threshold")
    duplicate_similarity_threshold = serializers.FloatField(source="duplicate_threshold")
    flag_duplicates = serializers.BooleanField(source="duplicate_detection_enabled")
    categories = serializers.JSONField(required=False)
    metrics = serializers.SerializerMethodField()
    services = serializers.SerializerMethodField()

    class Meta:
        model = ConcernClassificationConfiguration
        fields = (
            "id", "nlp_provider", "text_model",
            "text_relevance_threshold", "duplicate_similarity_threshold",
            "minimum_description_length", "mismatch_action", "flag_suspicious", "flag_duplicates",
            "flag_irrelevant", "suspicious_terms", "category_keywords",
            "report_duplicate_detection_enabled", "report_duplicate_action",
            "report_duplicate_lookback_days", "report_duplicate_distance_meters",
            "report_duplicate_similarity_threshold", "report_duplicate_location_precision",
            "categories", "metrics", "services", "updated_by", "updated_at",
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
                }
                for code in Concern.Category.values
            ]
        enabled_codes = set(obj.enabled_categories or [])
        return [
            {
                "key": category.code,
                "label": category.name,
                "enabled": category.code in enabled_codes or not enabled_codes,
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
        validated_data["nlp_provider"] = next(iter(ALLOWED_NLP_PROVIDERS))
        validated_data["nlp_model"] = BASE_TEXT_MODEL
        return super().update(instance, validated_data)

    def get_metrics(self, obj):
        since = timezone.now() - timedelta(days=30)
        assessments = ConcernAiAssessment.objects.filter(updated_at__gte=since)
        completed = assessments.filter(status=ConcernAiAssessment.Status.COMPLETED)
        rejected = Concern.objects.filter(
            updated_at__gte=since,
            validation_status=Concern.ValidationStatus.REJECTED,
        ).count()
        return {
            "image_accuracy": None,
            "text_accuracy": None,
            "auto_validated": completed.filter(category_match=True).count(),
            "rejected": rejected,
            "tested": assessments.count(),
        }

    def get_services(self, obj):
        """Whether each service is working, in words an official can act on.

        Deliberately coarse. The config screen used to publish the model file
        name and a raw availability boolean; neither tells a barangay volunteer
        whether today's reports are being checked. "Limited" is the state worth
        naming — the key is set and text review works, but photo review or media
        protection has been failing, which is exactly the condition the old UI
        could not express.
        """
        return {
            "report_review": _report_review_status(),
            "media_protection": _media_protection_status(),
        }

    def validate(self, attrs):
        for field in ("relevance_threshold", "duplicate_threshold"):
            value = attrs.get(field, getattr(self.instance, field, None))
            if value is not None and not 0 <= value <= 1:
                raise serializers.ValidationError({field: "Enter a value from 0 to 1."})
        value = attrs.get("report_duplicate_similarity_threshold", getattr(self.instance, "report_duplicate_similarity_threshold", None))
        if value is not None and not 0 <= value <= 1:
            raise serializers.ValidationError({"report_duplicate_similarity_threshold": "Enter a value from 0 to 1."})
        errors = {}
        if "nlp_provider" in attrs and attrs["nlp_provider"] not in ALLOWED_NLP_PROVIDERS:
            errors["nlp_provider"] = f"nlp_provider must be one of {sorted(ALLOWED_NLP_PROVIDERS)}."
        if "nlp_model" in attrs and attrs["nlp_model"] != BASE_TEXT_MODEL:
            errors["text_model"] = f"The current base text checker must remain {BASE_TEXT_MODEL}."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


RECENT_WINDOW_DAYS = 7


def _report_review_status() -> dict:
    """Available / Limited / Unavailable for text-and-photo report review."""
    if not getattr(settings, "OLLAMA_API_KEY", ""):
        return {"status": "unavailable", "reason": "not_configured"}

    since = timezone.now() - timedelta(days=RECENT_WINDOW_DAYS)
    recent = ConcernAiAssessment.objects.filter(updated_at__gte=since)
    total = recent.count()
    if not total:
        return {"status": "available", "reason": "no_recent_activity"}

    failed = recent.filter(status=ConcernAiAssessment.Status.FAILED).count()
    if failed == total:
        return {"status": "unavailable", "reason": "recent_runs_failed"}

    # A run that completed but could not read the attached photo is the
    # "limited" case: descriptions are still being checked, photos are not.
    photo_failures = recent.filter(
        status=ConcernAiAssessment.Status.COMPLETED,
        image_review_succeeded=False,
    ).count()
    if failed or photo_failures:
        return {"status": "limited", "reason": "some_photo_reviews_failed"}
    return {"status": "available", "reason": ""}


def _media_protection_status() -> dict:
    """Available / Limited / Unavailable for face and plate protection."""
    if not getattr(settings, "ROBOFLOW_API_KEY", ""):
        return {"status": "unavailable", "reason": "not_configured"}

    since = timezone.now() - timedelta(days=RECENT_WINDOW_DAYS)
    recent = ConcernMedia.objects.filter(privacy_processed_at__gte=since)
    total = recent.count()
    if not total:
        return {"status": "available", "reason": "no_recent_activity"}

    failed = recent.filter(privacy_state=ConcernMedia.PrivacyState.FAILED_RESTRICTED).count()
    if failed == total:
        return {"status": "unavailable", "reason": "recent_runs_failed"}
    if failed:
        return {"status": "limited", "reason": "some_runs_failed"}
    return {"status": "available", "reason": ""}


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
            "category_match": result["category_match"],
            "duplicate": duplicate,
            "duplicate_similarity": round(duplicate_similarity, 4),
            "outcome": "approved" if approved else "flagged",
            "explanation": result["notice"],
            "image_uploaded": False,
            "image_error": "",
            **_review_details(result),
        })


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
        image, image_error = _prepared_image_from_upload(uploaded)
        result = classification_payload(
            title=title,
            description=description,
            selected_category=selected_category,
            configuration=config,
            image=image,
        )
        duplicate, duplicate_similarity = _duplicate_preview(config, title=title, description=description)
        details = result.get("details") or {}
        privacy = _privacy_dry_run(uploaded, details)
        return Response({
            "classification": result["outcome"],
            "category_match": result["category_match"],
            "duplicate": duplicate,
            "duplicate_similarity": round(duplicate_similarity, 4),
            "explanation": result["notice"],
            "image_uploaded": bool(uploaded),
            "image_error": image_error,
            "privacy": privacy,
            **_review_details(result),
        })


class ResidentConcernPrecheckView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        if not user_has_role_permission(request.user, "concerns.create"):
            return Response({"detail": "Only residents can check reports."}, status=status.HTTP_403_FORBIDDEN)
        selected_category = str(request.data.get("category", ""))
        category_ref = ConcernCategory.objects.filter(code=selected_category, is_active=True).first()
        if not category_ref and selected_category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        if category_ref and category_ref.description_required and len(description.strip()) < 20:
            return Response({"description": ["Describe the issue before submitting."]}, status=status.HTTP_400_BAD_REQUEST)
        uploaded = request.FILES.get("media") or request.FILES.get("file")
        if category_ref and category_ref.photo_required and not uploaded:
            return Response({"media": ["Add at least one clear photo as evidence."]}, status=status.HTTP_400_BAD_REQUEST)
        if category_ref and category_ref.location_required and (request.data.get("latitude") is None or request.data.get("longitude") is None):
            return Response({"address": ["Pin where the issue is located."]}, status=status.HTTP_400_BAD_REQUEST)

        config = ConcernClassificationConfiguration.current()
        image, _image_error = _prepared_image_from_upload(uploaded)
        result = classification_payload(
            title=title,
            description=description,
            selected_category=selected_category,
            configuration=config,
            image=image,
        )
        duplicate_feedback = _report_duplicate_feedback(config, request=request, selected_category=selected_category, title=title, description=description)
        return Response(
            _resident_feedback(
                result,
                selected_category=selected_category,
                image_uploaded=bool(uploaded),
                duplicate_feedback=duplicate_feedback,
            )
        )


def _duplicate_preview(config, *, title: str, description: str) -> tuple[bool, float]:
    candidate = f"{title} {description}".strip().lower()
    duplicate_similarity = 0.0
    if config.duplicate_detection_enabled and candidate:
        for existing in Concern.objects.exclude(description="").only("title", "description").order_by("-created_at")[:200]:
            existing_text = f"{existing.title} {existing.description}".strip().lower()
            duplicate_similarity = max(duplicate_similarity, SequenceMatcher(None, candidate, existing_text).ratio())
    return duplicate_similarity >= config.duplicate_threshold, duplicate_similarity


def _privacy_dry_run(uploaded, details: dict) -> dict:
    """Run the real privacy stage against a sample photo and return the result.

    The tester exists so an official can see what the system would do before
    trusting it on a resident's report — and "would the face actually get
    blurred" is the question they most need answered. Without this the sample
    stopped at Gemma's suspicion and there was no way to check the blur worked
    at all.

    Same gate, same SAM3 call, same OpenCV blur as the live pipeline. Nothing is
    written: the file never leaves memory, no ConcernMedia row is created, and
    the protected image comes back as a data URI for display only.
    """
    from apps.concerns.ai.pipeline import privacy_classes_for

    review_ok = details.get("image_review_succeeded") is True
    classes = privacy_classes_for(
        details,
        image_uploaded=bool(uploaded),
        gemma_image_review_succeeded=review_ok,
    )
    if not classes:
        return {
            "state": "not_required" if review_ok else "unchecked",
            "requested_classes": [],
            "detected_classes": [],
            "protected_image": "",
        }

    import base64
    import os
    import tempfile
    from io import BytesIO

    from PIL import Image, ImageOps

    from apps.concerns.ai.privacy.masks import blur_regions, detected_classes, parse_regions
    from apps.concerns.ai.privacy.sam3_client import Sam3NotConfigured, Sam3Unavailable, run_segmentation

    path = ""
    try:
        uploaded.seek(0)
        raw = uploaded.read()
        uploaded.seek(0)
        suffix = os.path.splitext(getattr(uploaded, "name", "") or "")[1][:10] or ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
            temp.write(raw)
            path = temp.name

        payload = run_segmentation(path, classes)
        with Image.open(BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            image.load()
        regions = parse_regions(payload, image_width=image.size[0], image_height=image.size[1])
        found = detected_classes(regions)
        blurrable = [region for region in regions if "blood" not in (region.label or "")]

        output = BytesIO()
        blur_regions(image, blurrable).save(output, format="JPEG", quality=84, optimize=True)
        encoded = base64.b64encode(output.getvalue()).decode("ascii")

        if any("blood" in (region.label or "") for region in regions):
            state = "sensitive_review_required"
        elif blurrable:
            # Blurred is blurred, whether Gemma asked for the scan or we ran it
            # ourselves because Gemma could not read the photo.
            state = "protected"
        else:
            state = "no_match_found"
        return {
            "state": state,
            "requested_classes": classes,
            "detected_classes": found,
            "blurred_count": len(blurrable),
            # Only show the blurred render when something was actually blurred,
            # so the panel can never present the original as "protected".
            "protected_image": f"data:image/jpeg;base64,{encoded}" if blurrable else "",
        }
    except Sam3NotConfigured:
        return {"state": "not_configured", "requested_classes": classes, "detected_classes": [], "protected_image": ""}
    except (Sam3Unavailable, Exception):
        return {"state": "failed", "requested_classes": classes, "detected_classes": [], "protected_image": ""}
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


def _prepared_image_from_upload(uploaded):
    """Validate and normalise an uploaded sample photo for Gemma.

    Returns (PreparedImage|None, error_code). The error code distinguishes "no
    file was sent" from "a file was sent and we could not use it" — the two must
    never collapse into one message, or a resident who did attach a photo is
    told they did not.
    """
    if not uploaded:
        return None, ""
    try:
        validate_concern_media_file(uploaded)
        uploaded.seek(0)
        data = uploaded.read()
        uploaded.seek(0)
    except DjangoValidationError:
        _rewind(uploaded)
        return None, "rejected"
    except Exception:
        _rewind(uploaded)
        return None, "unreadable"

    image = prepare_image_for_gemma(
        data,
        filename=getattr(uploaded, "name", ""),
        mime_type=getattr(uploaded, "content_type", "") or "",
    )
    return image, "" if image else "unreadable"


def _rewind(uploaded) -> None:
    try:
        uploaded.seek(0)
    except Exception:
        pass


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


def _resident_feedback(result: dict, *, selected_category: str, image_uploaded: bool, duplicate_feedback: dict | None = None) -> dict:
    details = result.get("details") or {}
    primary = details.get("primary_category") or ""
    relationship = details.get("evidence_relationship") or ""
    field_errors = {}
    messages = []
    can_submit = True
    needs_revision = False
    if result.get("outcome") == "needs_review" and not primary:
        field_errors["description"] = "Add a clearer description of the issue."
        can_submit = False
        needs_revision = True
    if primary and primary != selected_category:
        messages.append(f"Your description sounds like {primary.replace('_', ' ')}, but you selected {selected_category.replace('_', ' ')}.")
        needs_revision = True
    if relationship in {"contradicts_report", "no_useful_image_evidence"}:
        messages.append("The photo does not clearly show the issue described.")
        needs_revision = True
    elif relationship == "image_review_failed":
        # The resident did attach something. Say so, and do not block them:
        # our inability to read it is not their problem to fix.
        messages.append("Your photo could not be checked automatically. An official will review it.")
    elif not image_uploaded:
        messages.append("No photo was attached. A clear photo helps confirm your report.")
    if details.get("privacy_scan_required"):
        messages.append("This may show private details. Sensitive parts may be blurred before public display.")
    if details.get("urgent_attention"):
        messages.append("This may need urgent attention. Submit it now or use Emergency Alert if someone is in immediate danger.")
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
        "photo_feedback": details.get("photo_assessment") or "",
        "result": {
            "classification": result.get("outcome"),
            "evidence_relationship": relationship,
            "recommended_action": details.get("recommended_action"),
            "short_explanation": details.get("short_explanation"),
        },
    }


def _review_details(result: dict) -> dict:
    """The sample-test payload, mirroring the fields the real assistant shows.

    No model name, no provider, no confidence number. What an official sees when
    they try a sample is the same vocabulary they see on a real report.
    """
    details = result.get("details") or {}
    return {
        "relevance": details.get("relevance"),
        "primary_category": details.get("primary_category"),
        "possible_categories": details.get("possible_categories") or [],
        "detected_objects": details.get("detected_objects") or [],
        "text_assessment": details.get("text_assessment"),
        "photo_assessment": details.get("photo_assessment"),
        "evidence_relationship": details.get("evidence_relationship"),
        "missing_information": details.get("missing_information") or [],
        "urgent_attention": bool(details.get("urgent_attention")),
        "severity": details.get("severity"),
        "privacy_scan_required": bool(details.get("privacy_scan_required")),
        "suspected_sensitive_classes": details.get("suspected_sensitive_classes") or [],
        "ai_result_uncertain": bool(details.get("ai_result_uncertain")),
        "recommended_action": details.get("recommended_action"),
        "short_explanation": details.get("short_explanation"),
        "image_review_succeeded": details.get("image_review_succeeded"),
    }
