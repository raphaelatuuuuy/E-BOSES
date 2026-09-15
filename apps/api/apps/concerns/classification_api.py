import base64
import logging
from datetime import timedelta
from difflib import SequenceMatcher
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, OuterRef, Q, Subquery
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
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
from apps.concerns.ai.duplicate_detector import find_duplicate_concern, report_fingerprints
from apps.concerns.ai.gemma_analyzer import (
    INTEGRITY_FLAGGED_VERDICTS,
    compare_photo_duplicates,
    verify_street_context,
)
from apps.concerns.ai.image_prep import PreparedImage, prepare_image_for_gemma
from apps.concerns.ai.street_imagery import fetch_latest_street_imagery
from apps.concerns.models import (
    Concern,
    ConcernAiAssessment,
    ConcernCategory,
    ConcernClassificationConfiguration,
    ConcernMedia,
    ContentFlag,
    LlmDecisionLog,
)
from apps.capabilities import CONFIGURE_CLASSIFICATION, MANAGE_USERS, HasCapability, capabilities_for
from apps.geo_services import validate_report_location
from apps.media_urls import concern_media_preview_url

logger = logging.getLogger(__name__)


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
            "minimum_description_length", "flag_suspicious", "flag_duplicates",
            "flag_irrelevant", "suspicious_terms", "category_keywords",
            "report_duplicate_detection_enabled", "report_duplicate_action",
            "report_duplicate_lookback_days", "report_duplicate_distance_meters",
            "report_duplicate_similarity_threshold", "report_duplicate_location_precision",
            "content_safety_spam_action", "content_safety_abusive_action",
            "content_safety_threat_action", "content_safety_sensitive_action",
            "require_ongoing_emergency_confirmation",
            "street_imagery_enabled", "street_imagery_categories",
            "street_imagery_radius_meters", "street_imagery_action",
            "photo_duplicate_llm_enabled", "photo_duplicate_candidate_limit",
            "media_integrity_enabled", "media_integrity_action",
            "media_integrity_min_confidence", "media_integrity_second_opinion_enabled",
            "media_integrity_emergency_action",
            "categories", "metrics", "services", "updated_by", "updated_at",
        )
        read_only_fields = ("id", "updated_by", "updated_at")

    def _categories_payload(self, obj):
        category_queryset = ConcernCategory.objects.filter(is_active=True)
        if obj.community_id:
            category_queryset = category_queryset.filter(community_id=obj.community_id)
        categories = list(category_queryset.order_by("name"))
        if not categories:
            labels = dict(Concern.Category.choices)
            return [
                {
                    "key": code,
                    "label": labels[code],
                    "enabled": code in (obj.enabled_categories or Concern.Category.values),
                    "photo_required": False,
                    "description_required": True,
                    "location_required": True,
                }
                for code in Concern.Category.values
            ]
        enabled_codes = set(obj.enabled_categories or [])
        return [
            {
                "key": category.code,
                "label": category.name,
                "enabled": category.code in enabled_codes or not enabled_codes,
                "photo_required": category.photo_required,
                "description_required": category.description_required,
                "location_required": category.location_required,
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
            # Match the same source `_categories_payload` reads from — barangays
            # that have created real categories use those codes, not the legacy
            # fixed enum, so validating against the enum alone silently dropped
            # every real category's enabled/disabled choice on save.
            category_queryset = ConcernCategory.objects.filter(is_active=True)
            if instance.community_id:
                category_queryset = category_queryset.filter(community_id=instance.community_id)
            real_codes = set(category_queryset.values_list("code", flat=True))
            valid_codes = real_codes or set(Concern.Category.values)
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
        for field in ("report_duplicate_similarity_threshold", "media_integrity_min_confidence"):
            value = attrs.get(field, getattr(self.instance, field, None))
            if value is not None and not 0 <= value <= 1:
                raise serializers.ValidationError({field: "Enter a value from 0 to 1."})
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
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        return Response(ClassificationConfigurationSerializer(ConcernClassificationConfiguration.current_fresh(community)).data)

    def patch(self, request):
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        config = ConcernClassificationConfiguration.current_fresh(community)
        serializer = ClassificationConfigurationSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class OfficialClassificationStatsView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

    def get(self, request):
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        since = timezone.now() - timedelta(days=30)
        assessments = ConcernAiAssessment.objects.filter(concern__community=community, updated_at__gte=since)
        completed = assessments.filter(status=ConcernAiAssessment.Status.COMPLETED)
        flagged = completed.filter(category_match=False).count() + assessments.exclude(status=ConcernAiAssessment.Status.COMPLETED).count()
        daily = list(
            assessments.annotate(day=TruncDate("updated_at"))
            .values("day")
            .annotate(total=Count("id"))
            .order_by("day")
        )
        return Response({
            "active_categories": len(Concern.Category.choices),
            "processed": assessments.count(),
            "completed": completed.count(),
            "flagged": flagged,
            "activity": [{"date": str(row["day"]), "total": row["total"]} for row in daily],
            "accuracy": None,
            "accuracy_notice": "Accuracy is unavailable until a labeled evaluation dataset is measured.",
        })


class OfficialClassificationActivityView(APIView):
    """Recent validation activity for the Activity tab."""
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

    def get(self, request):
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        days = int(request.query_params.get("days", 30))
        category = request.query_params.get("category", "")
        since = timezone.now() - timedelta(days=days)

        concern_filter = {
            "community": community,
            "created_at__gte": since,
            "validation_status__in": [
                Concern.ValidationStatus.ACCEPTED,
                Concern.ValidationStatus.REJECTED,
                Concern.ValidationStatus.PENDING,
            ],
        }
        if category:
            concern_filter["category"] = category

        qs = (
            Concern.objects.filter(**concern_filter)
            .select_related("assigned_department")
            .order_by("-created_at")[:200]
        )

        results = []
        for concern in qs:
            if concern.validation_status == Concern.ValidationStatus.ACCEPTED:
                outcome = "accepted"
                outcome_label = "Accepted"
            elif concern.validation_status == Concern.ValidationStatus.REJECTED:
                outcome = "rejected"
                outcome_label = "Rejected"
            else:
                outcome = "held"
                outcome_label = "Held for review"

            results.append({
                "id": str(concern.pk),
                "submitted_at": concern.created_at.isoformat(),
                "description": (concern.description or "")[:120],
                "category": concern.category,
                "category_label": concern.get_category_display(),
                "location": concern.address or concern.barangay or "",
                "outcome": outcome,
                "outcome_label": outcome_label,
                "public_id": str(concern.public_id) if concern.public_id else None,
            })

        since_stats = timezone.now() - timedelta(days=days)
        base = Concern.objects.filter(community=community, created_at__gte=since_stats)
        if category:
            base = base.filter(category=category)

        return Response({
            "results": results,
            "count": len(results),
            "stats": {
                "scanned": base.count(),
                "auto_validated": base.filter(validation_status=Concern.ValidationStatus.ACCEPTED).count(),
                "flagged": base.exclude(validation_status=Concern.ValidationStatus.ACCEPTED)
                    .exclude(validation_status=Concern.ValidationStatus.REJECTED).count(),
                "held_for_review": base.filter(validation_status=Concern.ValidationStatus.PENDING).count(),
                "rejected": base.filter(validation_status=Concern.ValidationStatus.REJECTED).count(),
            },
        })


class OfficialClassificationResetView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

    def post(self, request):
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        ConcernClassificationConfiguration.objects.filter(community=community).delete()
        # Fresh fetch: current() may hand back the just-deleted cached row,
        # whose update_fields save would affect zero rows.
        config = ConcernClassificationConfiguration.current_fresh(community)
        config.updated_by = request.user
        config.save(update_fields=["updated_by", "updated_at"])
        return Response(ClassificationConfigurationSerializer(config).data)


class OfficialClassificationTextTestView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

    def post(self, request):
        from apps.community_scope import selected_community

        incident_community = selected_community(request.user, request.data.get("community_id"))
        if not incident_community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        category = str(request.data.get("category", ""))
        if category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        config = ConcernClassificationConfiguration.current(incident_community)
        result = classification_payload(title=title, description=description, selected_category=category, configuration=config)
        candidate = f"{title} {description}".strip().lower()
        duplicate_similarity = 0.0
        if config.duplicate_detection_enabled and candidate:
            for existing in Concern.objects.filter(community=incident_community).exclude(description="").only("title", "description").order_by("-created_at")[:200]:
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
            **_review_details(result, selected_category=category, image_uploaded=False, title=title, description=description, community=config.community),
        })


def _media_integrity_preview(config, *, details: dict, images: list[PreparedImage]) -> dict:
    """Run the real picture check against the sample photos.

    Same function, same confidence floor as the live pipeline — the point of
    the tester is that an official can trust what it shows, so nothing here
    is a simulation of the behaviour.
    """
    from apps.concerns.ai.pipeline import _media_integrity_check

    return _media_integrity_check(
        config,
        details=details,
        prepared_images=images or [],
        image_review_succeeded=details.get("image_review_succeeded"),
    )


def _street_imagery_preview(config, *, category: str, latitude, longitude, images: list[PreparedImage]) -> dict | None:
    """Run the street-imagery ground-truth check on a sample report.

    Mirrors `_street_imagery_check` from the real pipeline but also returns the
    panorama as a data URI so the tester can see exactly which image was judged.
    Every uploaded sample photo is sent, not just the first.
    """
    if not config.street_imagery_enabled:
        return None
    if category not in (config.street_imagery_categories or []):
        return None
    if not images or latitude in (None, "") or longitude in (None, ""):
        return {"status": "skipped", "reason": "missing_photo_or_location"}
    try:
        imagery = fetch_latest_street_imagery(
            latitude=float(latitude),
            longitude=float(longitude),
            radius_meters=config.street_imagery_radius_meters,
        )
    except Exception as exc:
        logger.warning("Street imagery preview failed: %s", exc.__class__.__name__)
        return {"status": "no_coverage"}
    if imagery is None:
        return {"status": "no_coverage"}

    street_prepared = PreparedImage(data=imagery.image_b64, mime_type="image/jpeg", telemetry={})
    verdict = verify_street_context(submitted=images, street=street_prepared)
    payload = {
        "status": "checked" if verdict else "skipped",
        "verdict": verdict["verdict"] if verdict else "inconclusive",
        "explanation": verdict["explanation"] if verdict else "The street comparison could not run right now.",
        "pano_id": imagery.pano_id,
        "captured_date": imagery.captured_date,
        "distance_meters": imagery.distance_meters,
        "latitude": imagery.latitude,
        "longitude": imagery.longitude,
        "image": f"data:image/jpeg;base64,{imagery.image_b64}",
    }
    return payload


def _photo_dedup_llm_preview(config, *, category: str, latitude, longitude, images: list[PreparedImage]) -> dict | None:
    """Visually compare the sample photo(s) against recent real concern photos."""
    if not config.photo_duplicate_llm_enabled or not images:
        return None
    origin_lat = float(latitude) if latitude not in (None, "") else None
    origin_lon = float(longitude) if longitude not in (None, "") else None
    # Without a pin there is nothing to bound the candidate pool by distance —
    # comparing against same-category reports from anywhere, however old or
    # far away, produced misleading "possible match" results. No location
    # means the check cannot run, not "check against everything."
    if origin_lat is None or origin_lon is None:
        return None

    limit = max(1, int(config.photo_duplicate_candidate_limit))
    since = timezone.now() - timedelta(days=config.report_duplicate_lookback_days)
    pool = (
        Concern.objects.filter(community=config.community, category=category, created_at__gte=since)
        .exclude(status=Concern.Status.REJECTED)
        .prefetch_related("media")
        .order_by("-created_at")[:200]
    )

    candidates: list[dict] = []
    for other in pool:
        if len(candidates) >= limit:
            break
        if other.latitude is None or other.longitude is None:
            continue
        distance = _preview_haversine(origin_lat, origin_lon, float(other.latitude), float(other.longitude))
        if distance > config.report_duplicate_distance_meters:
            continue
        media = next((m for m in other.media.all() if m.mime_type.startswith("image/")), None)
        if media is None:
            continue
        try:
            with media.file.open("rb") as handle:
                raw = handle.read()
        except (OSError, ValueError, NotImplementedError):
            continue
        prepared = prepare_image_for_gemma(raw, filename=media.original_filename, mime_type=media.mime_type)
        if prepared is None:
            continue
        candidates.append({
            "concern_id": other.pk,
            "tracking_id": other.tracking_id,
            "captured_at": other.created_at.date().isoformat(),
            "image": prepared,
        })
    if not candidates:
        return None

    comparisons = compare_photo_duplicates(submitted_images=images, candidates=candidates)
    # The candidate's own photo is only worth sending back for a genuine
    # duplicate suspicion — attaching it to "different" verdicts (the common
    # case, since candidates are picked by category/proximity, not looks)
    # would bloat the response for a comparison nobody needs to see.
    candidates_by_id = {candidate["concern_id"]: candidate for candidate in candidates}
    for comparison in comparisons or []:
        if comparison.get("verdict") == "different":
            continue
        candidate = candidates_by_id.get(comparison.get("concern_id"))
        if candidate is None:
            continue
        image = candidate["image"]
        comparison["image"] = f"data:{image.mime_type};base64,{image.data}"
    return {
        "checked": bool(comparisons),
        "skip_reason": "" if comparisons else "vision_check_unavailable",
        "candidate_count": len(candidates),
        "comparisons": comparisons or [],
    }


def _preview_haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math

    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


class OfficialClassificationSubmissionTestView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION
    parser_classes = [MultiPartParser]

    def post(self, request):
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        selected_category = str(request.data.get("category", ""))
        if selected_category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        if not description.strip():
            return Response({"description": ["Enter a sample description."]}, status=status.HTTP_400_BAD_REQUEST)

        config = ConcernClassificationConfiguration.current(community)
        # A sample can carry several photos (the tester allows up to three) —
        # every one of them is prepared and sent, not just the first, so
        # classification, street imagery, and photo dedup all see the whole set.
        uploaded_files = request.FILES.getlist("files") or (
            [request.FILES.get("file")] if request.FILES.get("file") else []
        )
        images, image_errors, _prepared_indices = _prepared_images_from_uploads(uploaded_files)
        result = classification_payload(
            title=title,
            description=description,
            selected_category=selected_category,
            configuration=config,
            images=images or None,
            image_uploaded=bool(uploaded_files),
        )
        duplicate, duplicate_similarity = _duplicate_preview(config, title=title, description=description)
        details = result.get("details") or {}
        effective_category = str(details.get("primary_category") or selected_category)
        # The privacy preview demonstrates blur behaviour, not evidentiary
        # review — kept to the first photo to avoid returning N protected
        # images the tester UI has no multi-photo panel for yet.
        privacy = _privacy_dry_run(uploaded_files[0] if uploaded_files else None, details)
        latitude = request.data.get("latitude")
        longitude = request.data.get("longitude")
        image_error = next(iter(image_errors.values()), "")
        return Response({
            "classification": result["outcome"],
            "category_match": result["category_match"],
            "duplicate": duplicate,
            "duplicate_similarity": round(duplicate_similarity, 4),
            "explanation": result["notice"],
            "image_uploaded": bool(uploaded_files),
            "image_error": image_error,
            "privacy": privacy,
            "location": _location_dry_run(request),
            "media_integrity": _media_integrity_preview(config, details=details, images=images),
            "street_imagery": _street_imagery_preview(config, category=effective_category, latitude=latitude, longitude=longitude, images=images),
            "photo_duplicate_llm": _photo_dedup_llm_preview(config, category=effective_category, latitude=latitude, longitude=longitude, images=images),
            **_review_details(result, selected_category=selected_category, image_uploaded=bool(uploaded_files), title=title, description=description, community=config.community),
        })


class OfficialClassificationSampleGeneratorView(APIView):
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION
    parser_classes = [MultiPartParser]

    SAMPLE_MODES = {
        "matching": "a report that matches the selected category and any attached photo",
        "unrelated": "a report that is clearly about something else, not the selected category",
        "harassment": "an abusive or harassing message",
        "spam": "an obvious spam or promotional message",
        "urgent": "a report of an immediate danger or serious incident needing urgent attention",
        "low_quality": "a vague, short, low-information message",
    }
    SAMPLE_LANGUAGES = {
        "filipino": "Filipino",
        "english": "English",
        "hybrid": "Taglish (a natural Filipino-English mix, as residents write)",
        "bisaya": "Bisaya (Cebuano)",
        "ilocano": "Ilocano",
        "hiligaynon": "Hiligaynon",
        "kapampangan": "Kapampangan",
        "waray": "Waray",
    }

    def post(self, request):
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        domain = str(request.data.get("domain", "concern"))
        language = str(request.data.get("language", "filipino"))

        if domain == "community":
            reason = str(request.data.get("reason", ""))
            if reason not in ContentFlag.Reason.values:
                return Response({"reason": ["Choose a valid flag reason."]}, status=status.HTTP_400_BAD_REQUEST)
            if language not in self.SAMPLE_LANGUAGES:
                return Response({"language": ["Unknown sample language."]}, status=status.HTTP_400_BAD_REQUEST)
            if not getattr(settings, "OLLAMA_API_KEY", ""):
                return Response({"detail": "Sample generation is not configured. Set OLLAMA_API_KEY."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            try:
                description = _generate_community_sample_content(reason=reason, language=language)
            except Exception as exc:
                logger.warning("Community sample generation failed: %s", exc.__class__.__name__)
                return Response({"detail": "The sample could not be generated right now. Try again later."}, status=status.HTTP_502_BAD_GATEWAY)
            return Response({"description": description})

        category = str(request.data.get("category", ""))
        mode = str(request.data.get("mode", "matching"))
        if category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        if mode not in self.SAMPLE_MODES:
            return Response({"mode": ["Unknown sample mode."]}, status=status.HTTP_400_BAD_REQUEST)
        if language not in self.SAMPLE_LANGUAGES:
            return Response({"language": ["Unknown sample language."]}, status=status.HTTP_400_BAD_REQUEST)
        if not getattr(settings, "OLLAMA_API_KEY", ""):
            return Response({"detail": "Sample generation is not configured. Set OLLAMA_API_KEY."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        image = None
        uploaded = _first_uploaded(request)
        if mode == "matching" and uploaded:
            image, _ = _prepared_image_from_upload(uploaded)

        try:
            description = _generate_sample_description(
                category=category,
                mode=mode,
                language=language,
                image=image,
                minimum_length=ConcernClassificationConfiguration.current(community).minimum_description_length,
                community_name=community.name,
            )
        except Exception as exc:
            logger.warning("Sample generation failed: %s", exc.__class__.__name__)
            return Response({"detail": "The sample could not be generated right now. Try again later."}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"description": description})


def _generate_sample_description(*, category: str, mode: str, language: str, image, minimum_length, community_name: str) -> str:
    """Ask Gemma to write one resident-style sample report. Plain text, not JSON."""
    from ollama import Client

    from apps.concerns.ai.gemma_analyzer import _response_content

    client = Client(
        host=getattr(settings, "OLLAMA_HOST", "https://ollama.com"),
        headers={"Authorization": f"Bearer {getattr(settings, 'OLLAMA_API_KEY', '')}"},
        timeout=float(getattr(settings, "OLLAMA_TIMEOUT_SECONDS", 120)),
    )
    category_label = dict(Concern.Category.choices).get(category, category)
    scenario = OfficialClassificationSampleGeneratorView.SAMPLE_MODES[mode]
    if mode == "matching" and image is None:
        scenario = "a report that matches the selected category"
    language_label = OfficialClassificationSampleGeneratorView.SAMPLE_LANGUAGES[language]
    photo_note = " Describe only issues consistent with what you can actually see in the attached photo." if image is not None else ""
    prompt = (
        "You write sample test reports for E-Boses, a barangay civic concern system in the Philippines.\n"
        f"Write the text exactly as a resident of {community_name} would type it into the app.\n"
        f"Category the report will be filed under: {category_label}\n"
        f"Scenario: {scenario}.\n"
        f"Write it in {language_label}.\n"
        f"The report must be at least {int(minimum_length)} characters long, one to three short sentences, "
        "with enough detail to sound real but nothing that names a real person."
        f"{photo_note}\n"
        "Return the report text only. No quotes, no labels, no Markdown."
    )
    message = {"role": "user", "content": prompt}
    if image is not None:
        message["images"] = [image.data]
    response = client.chat(
        getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b"),
        messages=[
            {"role": "system", "content": "Return plain text only. No Markdown, no JSON, no surrounding quotes."},
            message,
        ],
        options={"temperature": 0.9},
        stream=False,
    )
    return _response_content(response).strip()


COMMUNITY_FLAG_SCENARIOS = {
    "irrelevant": "a community post or comment that is completely off-topic and unrelated to barangay matters",
    "false_info": "a community post or comment that spreads false or misleading information",
    "sensitive": "a community post or comment that shares private or sensitive details about another resident without their consent",
    "abusive": "a community post or comment using insulting, abusive, or harassing language toward a resident or barangay official",
    "other": "a community post or comment a resident flagged for an unclear or unusual reason",
}


def _generate_community_sample_content(*, reason: str, language: str) -> str:
    """Ask Gemma to write one sample flagged community post/comment. Plain text, not JSON."""
    from ollama import Client

    from apps.concerns.ai.gemma_analyzer import _response_content

    client = Client(
        host=getattr(settings, "OLLAMA_HOST", "https://ollama.com"),
        headers={"Authorization": f"Bearer {getattr(settings, 'OLLAMA_API_KEY', '')}"},
        timeout=float(getattr(settings, "OLLAMA_TIMEOUT_SECONDS", 120)),
    )
    scenario = COMMUNITY_FLAG_SCENARIOS.get(reason, COMMUNITY_FLAG_SCENARIOS["other"])
    language_label = OfficialClassificationSampleGeneratorView.SAMPLE_LANGUAGES[language]
    prompt = (
        "You write sample flagged content for E-Boses, a barangay community feed in the Philippines.\n"
        "Write the text exactly as a resident's post or comment would appear in the app.\n"
        f"Scenario: {scenario}.\n"
        f"Write it in {language_label}.\n"
        "One to two short sentences, realistic in tone, and it must not name a real real-world public figure.\n"
        "Return the post text only. No quotes, no labels, no Markdown."
    )
    response = client.chat(
        getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b"),
        messages=[
            {"role": "system", "content": "Return plain text only. No Markdown, no JSON, no surrounding quotes."},
            {"role": "user", "content": prompt},
        ],
        options={"temperature": 0.9},
        stream=False,
    )
    return _response_content(response).strip()


def _first_uploaded(request):
    """The primary sample photo: a legacy single `file` field, or the first of
    the `files` list the tester sends when an official attaches several."""
    files = request.FILES.getlist("files")
    return request.FILES.get("file") or (files[0] if files else None)


def _location_dry_run(request):
    """Run the same barangay-boundary + acceptance-zone check a real report
    gets, without saving anything. None when no pin was sent."""
    latitude = request.data.get("latitude")
    longitude = request.data.get("longitude")
    if latitude in (None, "") or longitude in (None, ""):
        return None
    try:
        validated = validate_report_location(latitude, longitude)
    except DjangoValidationError as error:
        return {"accepted": False, "action": "block", "message": "; ".join(error.messages)}
    return {"accepted": validated.get("action") == "accept", **validated}


class ResidentConcernPrecheckView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        if not user_has_role_permission(request.user, "concerns.create"):
            return Response({"detail": "Only residents can check reports."}, status=status.HTTP_403_FORBIDDEN)
        selected_category = str(request.data.get("category", ""))
        resident_community = getattr(getattr(request.user, "resident_profile", None), "community", None)
        incident_community = resident_community
        location_review = _location_dry_run(request)
        if location_review and location_review.get("community_id"):
            from apps.emergencies.models import Community

            incident_community = Community.objects.filter(
                pk=location_review["community_id"], status=Community.Status.ACTIVE
            ).first()
        if location_review and location_review.get("accepted") is False:
            return Response({"location": [location_review.get("message") or "Choose a served location."]}, status=status.HTTP_400_BAD_REQUEST)
        category_queryset = ConcernCategory.objects.filter(code=selected_category, is_active=True)
        if incident_community is not None:
            category_queryset = category_queryset.filter(Q(community=incident_community) | Q(community__isnull=True))
        category_ref = category_queryset.first()
        if selected_category and not category_ref and selected_category not in Concern.Category.values:
            return Response({"category": ["Choose a valid concern category."]}, status=status.HTTP_400_BAD_REQUEST)
        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        if category_ref and category_ref.description_required and len(description.strip()) < 20:
            return Response({"description": ["Describe the issue before submitting."]}, status=status.HTTP_400_BAD_REQUEST)
        uploaded_files = request.FILES.getlist("media") or (
            [request.FILES.get("file")] if request.FILES.get("file") else []
        )
        if category_ref and category_ref.photo_required and not uploaded_files:
            return Response({"media": ["Add at least one clear photo as evidence."]}, status=status.HTTP_400_BAD_REQUEST)
        if category_ref and category_ref.location_required and (request.data.get("latitude") is None or request.data.get("longitude") is None):
            return Response({"address": ["Pin where the issue is located."]}, status=status.HTTP_400_BAD_REQUEST)

        if not incident_community:
            return Response({"location": ["Choose a location inside an active community."]}, status=status.HTTP_400_BAD_REQUEST)
        config = ConcernClassificationConfiguration.current(incident_community)
        images, image_errors, prepared_indices = _prepared_images_from_uploads(uploaded_files)
        result = classification_payload(
            title=title,
            description=description,
            selected_category=selected_category,
            configuration=config,
            images=images or None,
            image_uploaded=bool(uploaded_files),
            text_timeout=getattr(settings, "OLLAMA_PRECHECK_TEXT_TIMEOUT_SECONDS", 8),
        )
        details = result.get("details") or {}
        enabled_categories = config.enabled_categories or list(Concern.Category.values)
        fallback_category = (
            Concern.Category.OTHERS
            if Concern.Category.OTHERS in enabled_categories
            else str(enabled_categories[0] if enabled_categories else Concern.Category.OTHERS)
        )
        inferred_category = str(details.get("primary_category") or selected_category or fallback_category)
        inferred_category_queryset = ConcernCategory.objects.filter(code=inferred_category, is_active=True)
        inferred_category_queryset = inferred_category_queryset.filter(
            Q(community=incident_community) | Q(community__isnull=True)
        )
        inferred_category_ref = inferred_category_queryset.select_related("department").first() or category_ref
        # Category-specific requirements are evaluated after the model has
        # selected the category. This is what allows the resident form to omit
        # the category picker while preserving the configured safeguards.
        inferred_errors = {}
        if inferred_category_ref and inferred_category_ref.description_required and len(description.strip()) < 20:
            inferred_errors["description"] = "Describe the issue in at least 20 characters."
        if inferred_category_ref and inferred_category_ref.photo_required and not uploaded_files:
            inferred_errors["media"] = "Add at least one clear photo as evidence."
        if inferred_category_ref and inferred_category_ref.location_required and (
            request.data.get("latitude") is None or request.data.get("longitude") is None
        ):
            inferred_errors["address"] = "Pin where the issue is located."
        payload = _resident_feedback(
            result,
            image_uploaded=bool(uploaded_files),
            photo_count=len(uploaded_files),
            image_errors=image_errors,
            prepared_indices=prepared_indices,
            duplicate_feedback=None,
        )
        if inferred_errors:
            payload["field_errors"] = {**payload.get("field_errors", {}), **inferred_errors}
            payload["can_submit"] = False
            payload["needs_revision"] = True
        duplicate_feedback = None
        if payload["can_submit"]:
            duplicate_feedback = _report_duplicate_feedback(
                config,
                request=request,
                selected_category=inferred_category,
                title=title,
                description=description,
            )
            if duplicate_feedback:
                payload = _resident_feedback(
                    result,
                    image_uploaded=bool(uploaded_files),
                    photo_count=len(uploaded_files),
                    image_errors=image_errors,
                    prepared_indices=prepared_indices,
                    duplicate_feedback=duplicate_feedback,
                )
        payload.update(
            _precheck_extras(
                request,
                result,
                selected_category=inferred_category,
                category_ref=inferred_category_ref,
                config=config,
                uploaded_files=uploaded_files,
                image_errors=image_errors,
                duplicate_feedback=duplicate_feedback,
            )
        )
        payload["category"] = inferred_category
        payload["category_label"] = (
            inferred_category_ref.name
            if inferred_category_ref
            else dict(Concern.Category.choices).get(inferred_category, inferred_category.replace("_", " ").title())
        )
        payload["public_feed_allowed"] = bool(
            not inferred_category_ref or inferred_category_ref.public_feed_allowed
        )
        return Response(payload)


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

    from apps.concerns.ai.privacy.masks import blur_regions, detected_classes, parse_regions, privacy_sensitive_regions
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
        sensitive_regions = privacy_sensitive_regions(regions)
        found = detected_classes(sensitive_regions)
        blood_found = any("blood" in (region.label or "") for region in regions)
        if blood_found:
            found = sorted(set(found + ["blood"]))
        blurrable = sensitive_regions

        output = BytesIO()
        blur_regions(image, blurrable).save(output, format="JPEG", quality=84, optimize=True)
        encoded = base64.b64encode(output.getvalue()).decode("ascii")

        if blood_found:
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


def _prepared_images_from_uploads(uploaded_files):
    """Prepare every attached photo for one multi-image Gemma call.

    Returns (images, errors_by_file_index, prepared_indices). `prepared_indices`
    maps each prepared image's position in `images` back to its original file
    index, so a photo that failed to prepare never shifts the verdicts of the
    ones that followed it.
    """
    images = []
    errors = {}
    prepared_indices = []
    for index, uploaded in enumerate(uploaded_files):
        image, error = _prepared_image_from_upload(uploaded)
        if image is not None:
            images.append(image)
            prepared_indices.append(index)
        elif error:
            errors[index] = error
    return images, errors, prepared_indices


def _rewind(uploaded) -> None:
    try:
        uploaded.seek(0)
    except Exception:
        pass


def _report_duplicate_feedback(config, *, request, selected_category: str, title: str, description: str) -> dict:
    if not config.report_duplicate_detection_enabled:
        return {"found": False}
    fingerprints = report_fingerprints(
        barangay=config.community.name,
        category=selected_category,
        title=title,
        description=description,
        latitude=request.data.get("latitude"),
        longitude=request.data.get("longitude"),
        precision=config.report_duplicate_location_precision,
    )
    candidate = Concern(
        community=config.community,
        barangay=config.community.name,
        category=selected_category,
        title=title,
        description=description,
        latitude=request.data.get("latitude"),
        longitude=request.data.get("longitude"),
        report_fingerprint=fingerprints["report_fingerprint"],
        report_text_fingerprint=fingerprints["report_text_fingerprint"],
        report_location_bucket=fingerprints["report_location_bucket"],
    )
    duplicate = find_duplicate_concern(
        candidate,
        enabled=True,
        threshold=getattr(config, "report_duplicate_similarity_threshold", config.duplicate_threshold),
        lookback_days=getattr(config, "report_duplicate_lookback_days", 180),
        distance_meters=getattr(config, "report_duplicate_distance_meters", 1000),
    )
    if not duplicate.possible_duplicate or not duplicate.matched_concern_id:
        return {"found": False}
    match = Concern.objects.filter(
        pk=duplicate.matched_concern_id,
        community=config.community,
    ).exclude(status=Concern.Status.REJECTED).first()
    if not match:
        return {"found": False}
    return {
        "found": True,
        "action": config.report_duplicate_action,
        "tracking_id": match.tracking_id,
        "message": "A similar report may already exist near this location. Check it first or continue if this is a new issue.",
        "concern_id": match.pk,
        "title": match.title,
        "summary": match.summary or match.description[:160],
        "reporter_count": 1 + Concern.objects.filter(duplicate_of_id=match.pk).count(),
        "status": match.status,
        "distance_meters": duplicate.distance_meters,
    }


def _resident_message_text(
    details: dict,
    *,
    image_uploaded: bool,
    duplicate_feedback: dict | None = None,
) -> str:
    relationship = details.get("evidence_relationship") or ""
    messages = []
    if details.get("failure_type"):
        # The model itself could not run. Nothing was actually reviewed, so a
        # "clearer description" demand would be a lie — the report is routed
        # to an official instead.
        messages.append("The automatic review could not run. An official will review it.")
    if relationship in {"contradicts_report", "no_useful_image_evidence"}:
        messages.append("The photo does not clearly show the issue described.")
    elif relationship == "image_review_failed":
        # The resident did attach something. Say so, and do not block them:
        # our inability to read it is not their problem to fix.
        messages.append("Your photo could not be checked automatically. An official will review it.")
    elif not image_uploaded:
        messages.append("No photo was attached. A clear photo helps confirm your report.")
    if details.get("privacy_scan_required"):
        messages.append("This may show private details. Sensitive parts may be blurred before public display.")
    if details.get("urgent_attention"):
        messages.append("This report may need urgent attention. It will be sent as a high-priority concern for official review.")
    if duplicate_feedback and duplicate_feedback.get("found"):
        action = duplicate_feedback.get("action")
        if action == ConcernClassificationConfiguration.ReportDuplicateAction.BLOCK:
            messages.append("A similar report already exists near this location. Add new details only if this is a different issue.")
        elif action == ConcernClassificationConfiguration.ReportDuplicateAction.WARN:
            messages.append("A similar report may already exist near this location.")
        else:
            messages.append(duplicate_feedback.get("message") or "A similar report may already exist near this location.")
    return " ".join(messages) or details.get("short_explanation") or "Report check completed."


def _resident_feedback(
    result: dict,
    *,
    image_uploaded: bool,
    photo_count: int = 0,
    image_errors: dict | None = None,
    prepared_indices: list | None = None,
    duplicate_feedback: dict | None = None,
) -> dict:
    details = result.get("details") or {}
    primary = details.get("primary_category") or ""
    relationship = details.get("evidence_relationship") or ""
    field_errors = {}
    can_submit = True
    needs_revision = False
    photo_error = (
        "Please remove photos that don't show the reported issue and upload clear ones."
        if photo_count > 1
        else "Please submit a photo that clearly shows the reported issue."
    )
    text_feedback = None
    try:
        issue_count = int(details.get("issue_count", 1))
    except (TypeError, ValueError):
        issue_count = 1
    if not details.get("failure_type") and issue_count > 1:
        text_feedback = "Please report one issue at a time only"
    elif not details.get("failure_type") and issue_count == 0:
        text_feedback = "Please describe one concern clearly and include only relevant details about the issue."
    elif not details.get("failure_type") and result.get("outcome") == "irrelevant":
        text_feedback = "Please describe one concern clearly and include only relevant details about the issue."
    elif not details.get("failure_type") and result.get("outcome") == "needs_review" and not primary:
        text_feedback = "Please describe one concern clearly and include only relevant details about the issue."
    if text_feedback:
        field_errors["description"] = text_feedback
        can_submit = False
        needs_revision = True
    photo_evidence_contradicted = relationship == "contradicts_report" or any(
        isinstance(item, dict)
        and str(item.get("relevance") or "").lower() == "contradicts_report"
        for item in details.get("photo_verdicts") or []
    )
    if not text_feedback and photo_evidence_contradicted:
        field_errors["media"] = photo_error
        can_submit = False
        needs_revision = True
    elif not text_feedback and image_uploaded and image_errors:
        field_errors["media"] = photo_error
        can_submit = False
        needs_revision = True
    elif not text_feedback and image_uploaded and details.get("image_review_succeeded") is not True:
        field_errors["media"] = photo_error
        can_submit = False
        needs_revision = True
    elif not text_feedback and details.get("image_review_succeeded") is True:
        reviewed_verdicts = [
            item
            for item in details.get("photo_verdicts") or []
            if isinstance(item, dict)
        ]
        if (
            relationship != "supports_report"
            or len(reviewed_verdicts) < len(prepared_indices or [])
            or not reviewed_verdicts
            or any(
            str(item.get("relevance") or "").lower() != "supports_report"
            for item in reviewed_verdicts
            )
        ):
            field_errors["media"] = photo_error
            can_submit = False
            needs_revision = True
    elif not text_feedback and relationship == "no_useful_image_evidence":
        needs_revision = True
    if (
        can_submit
        and not details.get("failure_type")
        and details.get("recommended_action") == "request_more_information"
    ):
        field_errors["media" if image_uploaded else "description"] = (
            photo_error
            if image_uploaded
            else "Add more detail about the issue before submitting."
        )
        can_submit = False
        needs_revision = True
    if can_submit and duplicate_feedback and duplicate_feedback.get("found"):
        action = duplicate_feedback.get("action")
        if action == ConcernClassificationConfiguration.ReportDuplicateAction.BLOCK:
            field_errors["description"] = "A similar report already exists near this location."
            can_submit = False
            needs_revision = True
        elif action != ConcernClassificationConfiguration.ReportDuplicateAction.WARN:
            needs_revision = True
    message = _resident_message_text(
        details,
        image_uploaded=image_uploaded,
        duplicate_feedback=duplicate_feedback,
    )
    return {
        "can_submit": can_submit,
        "needs_revision": needs_revision,
        "field_errors": field_errors,
        "message": message,
        "suggested_category": primary,
        "suggested_category_label": "",
        "category_confirm_required": False,
        "photo_required": False,
        "photo_verdicts": []
        if text_feedback
        else _photo_verdict_payload(
            details,
            photo_count=photo_count,
            image_errors=image_errors or {},
            prepared_indices=prepared_indices or [],
        ),
        "assigned_unit": None,
        "photo_feedback": details.get("photo_assessment") or "",
        "result": {
            "classification": result.get("outcome"),
            "evidence_relationship": relationship,
            "recommended_action": details.get("recommended_action"),
            "short_explanation": details.get("short_explanation"),
        },
    }


def _photo_verdict_payload(details: dict, *, photo_count: int, image_errors: dict, prepared_indices: list) -> list[dict]:
    """Return one frontend verdict per attached photo in file order."""
    if photo_count <= 0:
        return []
    relationship = details.get("evidence_relationship") or ""
    review_failed = details.get("image_review_succeeded") is False
    raw_model_verdicts = details.get("photo_verdicts") or []
    model_verdicts = {item["index"]: item for item in raw_model_verdicts}

    relevance_to_state = {
        "supports_report": "relevant",
        "contradicts_report": "unrelated",
        "neutral": "unclear",
        "unclear": "unclear",
    }
    unclear_message = "The photo does not clearly show the issue described."
    review_failed_message = "Your photo could not be checked automatically. An official will review it."
    integrity_message = (
        "This photo appears to be AI-generated or edited. "
        "Please upload a genuine photo taken with your camera."
    )
    # Only flagged verdicts land here — the parser has already dropped anything
    # below the confidence floor to "inconclusive", and an inconclusive photo
    # must never show the resident a message.
    flagged_indices = {
        int(item.get("index", -1))
        for item in details.get("media_integrity") or []
        if item.get("verdict") in INTEGRITY_FLAGGED_VERDICTS
    }
    payload = []
    for index in range(photo_count):
        if index in image_errors:
            payload.append(
                {"index": index, "state": "unsupported", "message": "This photo could not be read. An official will review it."}
            )
            continue
        if review_failed:
            payload.append({"index": index, "state": "unclear", "message": review_failed_message})
            continue
        model_index = prepared_indices.index(index) if index in prepared_indices else None
        if model_index is not None and model_index in flagged_indices:
            # Outranks relevance: a photo that may be fabricated is worth
            # saying more than "this does not show the issue".
            payload.append({"index": index, "state": "flagged", "message": integrity_message})
            continue
        verdict = model_verdicts.get(model_index) if model_index is not None else None
        if verdict is None:
            # A mixed upload can contain one locally unreadable file while the
            # remaining files are valid but still waiting for post-submit vision
            # review. Keep the valid files neutral instead of borrowing the
            # unrelated fallback message from the reviewed path.
            if not review_failed and details.get("image_review_succeeded") is None:
                continue
            state = "unrelated" if relationship == "contradicts_report" else "unclear"
            payload.append({"index": index, "state": state, "message": unclear_message})
            continue
        state = relevance_to_state.get(verdict.get("relevance"), "unclear")
        if state == "relevant" and relationship != "supports_report" and photo_count == 1:
            state = "unclear"
        message = "" if state == "relevant" else (verdict.get("note") or unclear_message)
        payload.append({"index": index, "state": state, "message": message})
    return payload


def _assigned_unit_for_category(category_ref: ConcernCategory | None) -> dict | None:
    """The unit a report under this category would be routed to, per the
    barangay's configured routing rules. The category's default department is
    the fallback used when no active override rule exists. None only when the
    category has no configured department at all."""
    if not category_ref:
        return None
    rule = category_ref.routing_rules.filter(is_active=True).select_related("department").first()
    department = rule.department if rule and rule.department_id else category_ref.department
    if not department:
        return None
    return {"code": department.code, "name": department.name}


def _precheck_extras(request, result, *, selected_category, category_ref, config, uploaded_files, image_errors, duplicate_feedback) -> dict:
    """The fields the frontend reads: inferred routing, duplicate/resolved
    checks, resolved address, privacy preview, assigned unit, and category
    requirements. Each has a safe None/false default so the chain simply skips
    when there is nothing to show."""
    details = result.get("details") or {}
    payload = {
        "description_required": bool(category_ref and category_ref.description_required),
        "location_required": bool(category_ref and category_ref.location_required),
        "photo_required": bool(category_ref and category_ref.photo_required),
    }

    payload["assigned_unit"] = _assigned_unit_for_category(category_ref)

    active_duplicate = None
    if duplicate_feedback and duplicate_feedback.get("found"):
        if duplicate_feedback.get("action") == ConcernClassificationConfiguration.ReportDuplicateAction.WARN:
            active_duplicate = {
                "concern_id": duplicate_feedback.get("concern_id"),
                "tracking_id": duplicate_feedback.get("tracking_id"),
                "title": duplicate_feedback.get("title"),
                "summary": duplicate_feedback.get("summary"),
                "reporter_count": duplicate_feedback.get("reporter_count"),
                "distance_meters": duplicate_feedback.get("distance_meters"),
                "status": duplicate_feedback.get("status"),
            }
    payload["active_duplicate"] = active_duplicate

    payload["resolved_match"] = _find_resolved_match(
        config,
        selected_category=selected_category,
        title=request.data.get("title", ""),
        description=request.data.get("description", ""),
    )

    payload["resolved_address"] = _resolved_address(
        request.data.get("latitude"),
        request.data.get("longitude"),
        local_only=True,
    )
    # The resident precheck never calls SAM3 — the real privacy scan runs in
    # the pipeline after submission. Officials testing templates still get the
    # live dry run through the sample-tester endpoint.
    from apps.concerns.ai.pipeline import privacy_classes_for

    review_ok = result.get("details", {}).get("image_review_succeeded") is True
    requested = privacy_classes_for(result.get("details") or {}, image_uploaded=bool(uploaded_files), gemma_image_review_succeeded=review_ok)
    payload["privacy_preview"] = {
        "state": "deferred",
        "requested_classes": requested,
        "detected_classes": [],
        "protected_image": "",
    }
    return payload


def _find_resolved_match(config, *, selected_category: str, title, description) -> dict | None:
    """A recently resolved report about the same issue, so the resident learns
    it was already fixed instead of re-reporting it."""
    if not config.resolved_match_detection_enabled:
        return None
    candidate = f"{title} {description}".strip().lower()
    if not candidate:
        return None
    lookback = int(getattr(config, "resolved_match_lookback_days", 90) or 90)
    cutoff = timezone.now() - timedelta(days=lookback)
    pool = (
        Concern.objects.filter(
            status=Concern.Status.RESOLVED,
            category=selected_category,
            created_at__gte=cutoff,
        )
        .only("pk", "tracking_number", "created_at", "title", "description", "summary")
        .order_by("-created_at")[:200]
    )
    best = None
    best_score = 0.0
    for concern in pool:
        text = f"{concern.title} {concern.description}".strip().lower()
        score = SequenceMatcher(None, candidate, text).ratio()
        if score > best_score:
            best, best_score = concern, score
    if best is None or best_score < 0.55:
        return None
    resolved_at = None
    entry = best.timeline_entries.filter(event_type="resolution").order_by("-created_at").first()
    if entry is not None:
        resolved_at = entry.created_at.isoformat()
    return {
        "concern_id": best.pk,
        "tracking_id": best.tracking_id,
        "summary": best.summary or best.description[:160],
        "resolved_at": resolved_at,
        "preview_url": "",
    }


def _resolved_address(latitude, longitude, *, local_only=False) -> dict | None:
    """The street-level address for a pin, used to pre-fill the report form.

    `local_only` skips the Nominatim round trip (up to ~9 s with pacing) and
    answers from the local street index — that is the precheck path, where the
    resident is waiting and Nominatim would only refine an already-usable
    street guess.
    """
    if latitude in (None, "") or longitude in (None, ""):
        return None
    try:
        lat, lng = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return None
    from apps.geo_services import nearest_known_street, nominatim_reverse

    address = ""
    street = ""
    house_number = ""
    if not local_only:
        try:
            address = str((nominatim_reverse(lat, lng) or {}).get("display_name") or "")
        except Exception:
            address = ""
    if not address:
        known = nearest_known_street(lat, lng)
        if known.get("street"):
            street = known["street"]
            house_number = known.get("house_number") or ""
    primary = ""
    if house_number:
        primary = f"{house_number} {street}".strip()
    elif street:
        primary = street
    from apps.geo_services import active_community_for_point

    community = active_community_for_point(lat, lng)
    secondary = community.name if community and address else ""
    if not primary:
        primary = "Pinned location"
    return {
        "address": address or primary,
        "address_primary": primary,
        "address_secondary": secondary,
        "latitude": lat,
        "longitude": lng,
    }


def _formatted_title_preview(title, description, details) -> dict:
    official_title = (
        (details.get("report_title") or "").strip()[:140]
        or (title or "").strip()[:140]
        or (description or "").strip()[:60]
        or "Untitled sample report"
    )
    summary = (details.get("text_assessment") or "").strip() or (description or "").strip()[:300]
    return {"official_title": official_title, "summary": summary}


def _review_details(result: dict, *, selected_category: str, image_uploaded: bool, title: str = "", description: str = "", community=None) -> dict:
    """The sample-test payload, mirroring the fields the real assistant shows.

    No model name, no provider, no confidence number. What an official sees when
    they try a sample is the same vocabulary they see on a real report.
    """
    details = result.get("details") or {}
    effective_category = str(details.get("primary_category") or selected_category or "")
    category_ref = None
    if effective_category:
        category_ref = ConcernCategory.objects.filter(
            code=effective_category,
            community=community,
            is_active=True,
        ).first()
        if category_ref is None:
            category_ref = ConcernCategory.objects.filter(
                code=effective_category,
                community__isnull=True,
                is_active=True,
            ).first()
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
        "resident_message": _resident_message_text(details, image_uploaded=image_uploaded),
        "matched_emergency_type": details.get("matched_emergency_type"),
        "emergency_routing_reason": details.get("emergency_routing_reason"),
        "ongoing_emergency_confirmation_required": bool(details.get("ongoing_emergency_confirmation_required")),
        "incident_timing": details.get("incident_timing") or "unclear",
        "incident_timing_reason": details.get("incident_timing_reason") or "",
        "current_danger": bool(details.get("current_danger")),
        "title_preview": _formatted_title_preview(title, description, details),
        "assigned_unit": _assigned_unit_for_category(category_ref),
    }


LLM_DECISION_LOG_PAGE_SIZE = 25


class LlmDecisionLogListView(APIView):
    """Paginated read of automated decisions for the unified audit log."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        granted = capabilities_for(request.user)
        if CONFIGURE_CLASSIFICATION not in granted and MANAGE_USERS not in granted:
            return Response({"detail": "You do not have permission to read automated decisions."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        qs = LlmDecisionLog.objects.select_related(
            "assigned_department",
            "concern",
            "concern__reporter",
            "concern__reporter__resident_profile",
            "concern__assigned_department",
            "concern__category_ref__department",
        ).prefetch_related(
            "concern__media",
            "concern__ai_assessment",
            "concern__escalated_emergencies",
        )
        qs = qs.filter(
            Q(concern__community=community)
            | Q(concern__isnull=True, assigned_department__community=community)
        )

        domain = request.query_params.get("domain", "")
        if domain == LlmDecisionLog.Domain.CONCERN:
            qs = qs.filter(domain__in=[
                LlmDecisionLog.Domain.CONCERN,
                LlmDecisionLog.Domain.EMERGENCY,
            ])
        elif domain == LlmDecisionLog.Domain.EMERGENCY:
            # Escalated concerns are the same report at a higher priority. Keep
            # them visible in the emergency view without creating a duplicate
            # audit row for the companion EmergencyAlert.
            qs = qs.filter(
                Q(domain=LlmDecisionLog.Domain.EMERGENCY)
                | Q(concern__escalated_emergencies__isnull=False)
            ).distinct()
        elif domain in LlmDecisionLog.Domain.values:
            qs = qs.filter(domain=domain)

        run_kind = request.query_params.get("run_kind", "")
        if run_kind in LlmDecisionLog.RunKind.values:
            qs = qs.filter(run_kind=run_kind)

        if domain == LlmDecisionLog.Domain.CONCERN:
            latest_rows = LlmDecisionLog.objects.filter(
                concern_id=OuterRef("concern_id"),
                domain__in=[
                    LlmDecisionLog.Domain.CONCERN,
                    LlmDecisionLog.Domain.EMERGENCY,
                ],
            )
            if run_kind in LlmDecisionLog.RunKind.values:
                latest_rows = latest_rows.filter(run_kind=run_kind)
            qs = qs.filter(
                concern_id__isnull=False,
                pk=Subquery(latest_rows.order_by("-created_at", "-id").values("pk")[:1]),
            )

        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(resident_message__icontains=search)
                | Q(routing_reason__icontains=search)
                | Q(assigned_department__name__icontains=search)
                | Q(input_snapshot__description__icontains=search)
                | Q(input_snapshot__title__icontains=search)
                | Q(input_snapshot__location__icontains=search)
                | Q(input_snapshot__document_type__icontains=search)
            )

        days = request.query_params.get("days", "")
        if days and days != "all":
            try:
                days_value = max(1, min(3650, int(days)))
            except (TypeError, ValueError):
                days_value = 30
            qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=days_value))

        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = max(1, min(100, int(request.query_params.get("page_size", LLM_DECISION_LOG_PAGE_SIZE))))
        except (TypeError, ValueError):
            page_size = LLM_DECISION_LOG_PAGE_SIZE

        count = qs.count()
        start = (page - 1) * page_size
        rows = qs[start:start + page_size]

        results = [
            _decision_log_payload(row)
            for row in rows
        ]
        return Response({"results": results, "count": count})


def _decision_source(rejection_code: str, *, has_emergency: bool = False) -> str:
    if has_emergency:
        return "Emergency escalation"
    return {
        "automated_street_imagery": "Street-view location check",
        "automated_street_imagery_resubmit": "Street-view location check",
        "automated_street_imagery_inconclusive": "Street-view location check",
        "automated_street_imagery_inconclusive_resubmit": "Street-view location check",
        "automated_media_integrity": "Photo authenticity check",
        "automated_media_integrity_resubmit": "Photo authenticity check",
        "automated_irrelevant": "Relevance check",
        "automated_incomplete": "Required information check",
    }.get(rejection_code, "Automated validation")


def _concern_media_payload(concern) -> list[dict]:
    if not concern:
        return []
    media = []
    for index, item in enumerate(concern.media.all()):
        media.append({
            "id": item.pk,
            "label": item.original_filename or f"Submitted photo {index + 1}",
            "preview_url": concern_media_preview_url(item.pk),
            "raw_url": f"/api/concerns/media/{item.pk}/raw/",
            "privacy_state": item.privacy_state,
        })
    return media


def _decision_log_payload(row: LlmDecisionLog) -> dict:
    """Build a readable, current-state audit row without losing raw snapshots."""
    concern = row.concern
    output = row.output_snapshot if isinstance(row.output_snapshot, dict) else {}
    final_snapshot = output.get("final_decision") if isinstance(output.get("final_decision"), dict) else {}
    has_emergency = bool(concern and list(concern.escalated_emergencies.all()))

    if concern and concern.validation_status == Concern.ValidationStatus.REJECTED:
        effective_action = "rejected"
        decision_label = "Rejected"
        decision_reason = concern.validation_summary or "The report did not pass automated validation."
        decision_source = _decision_source(concern.rejection_code, has_emergency=has_emergency)
    elif has_emergency:
        effective_action = "escalated"
        decision_label = "Escalated"
        decision_reason = concern.validation_summary or "The report was routed to emergency response."
        decision_source = "Emergency escalation"
    elif concern and concern.validation_status == Concern.ValidationStatus.PENDING:
        effective_action = "held"
        decision_label = "Held for review"
        decision_reason = concern.validation_summary or "An official needs to review this report."
        decision_source = "Automated validation"
    elif concern and concern.validation_status == Concern.ValidationStatus.ACCEPTED:
        effective_action = "accepted"
        decision_label = "Accepted"
        decision_reason = concern.validation_summary or row.resident_message or "Automated validation passed."
        decision_source = "Automated validation"
    else:
        # Simulation and legacy rows without a linked concern retain the model
        # action, but are clearly marked as a model result rather than a filed
        # concern status.
        effective_action = row.recommended_action or "unknown"
        decision_label = row.recommended_action or "No decision recorded"
        decision_reason = row.resident_message or "No final concern status is linked to this run."
        decision_source = "Model simulation" if row.run_kind == LlmDecisionLog.RunKind.SIMULATION else "Automated validation"

    street_imagery = output.get("street_imagery")
    display_output = dict(output)
    if not isinstance(street_imagery, dict) or not street_imagery:
        street_imagery = None
    if street_imagery:
        street_imagery = dict(street_imagery)
        image_b64 = street_imagery.pop("image_b64", "")
        display_output["street_imagery"] = dict(street_imagery)
        if image_b64:
            street_imagery["image"] = f"data:image/jpeg;base64,{image_b64}"

    input_snapshot = row.input_snapshot if isinstance(row.input_snapshot, dict) else {}
    address = (concern.address if concern and concern.address else input_snapshot.get("location")) or ""
    category_unit = None
    if concern and concern.category_ref_id:
        category_unit = concern.category_ref.department
    assigned_unit = (
        concern.assigned_department
        if concern and concern.assigned_department_id
        else row.assigned_department or category_unit
    )
    reporter = None
    tracking_id = None
    if concern:
        profile = getattr(concern.reporter, "resident_profile", None)
        profile_name = " ".join(
            part for part in [
                getattr(profile, "first_name", ""),
                getattr(profile, "middle_name", ""),
                getattr(profile, "last_name", ""),
            ] if part
        ).strip()
        reporter_name = "Anonymous resident" if concern.is_anonymous else (
            concern.reporter.get_full_name().strip() or profile_name or concern.reporter.email
        )
        reporter = {
            "name": reporter_name,
            "initials": "".join(part[0] for part in reporter_name.split()[:2]).upper(),
            "anonymous": concern.is_anonymous,
        }
        tracking_id = concern.tracking_number or str(concern.public_id)

    priority = _concern_priority(concern)
    if not priority:
        raw_priority = output.get("priority") or output.get("severity")
        priority = {
            "medium": "moderate",
            "moderate": "moderate",
            "high": "high",
            "critical": "critical",
            "low": "low",
        }.get(str(raw_priority or "").casefold())

    return {
        "id": row.pk,
        "run_kind": row.run_kind,
        "domain": row.domain,
        "record_type": "emergency" if (has_emergency or row.domain == LlmDecisionLog.Domain.EMERGENCY) else ("verification" if row.domain == LlmDecisionLog.Domain.VERIFICATION else "concern"),
        "created_at": row.created_at.isoformat(),
        "recommended_action": row.recommended_action,
        "resident_message": row.resident_message,
        "assigned_department": (
            {"id": row.assigned_department_id, "name": row.assigned_department.name}
            if row.assigned_department_id
            else None
        ),
        "routing_reason": row.routing_reason,
        "model_version": row.model_version,
        "duration_ms": row.duration_ms,
        "location": address,
        "address": address,
        "tracking_id": tracking_id,
        "report_title": concern.title if concern else input_snapshot.get("title") or "",
        "report_description": concern.description if concern else input_snapshot.get("description") or "",
        "reporter": reporter,
        "assigned_unit": (
            {"id": assigned_unit.pk, "name": assigned_unit.name}
            if assigned_unit
            else None
        ),
        "input_snapshot": row.input_snapshot,
        "output_snapshot": display_output,
        "content_flag_id": row.content_flag_id,
        "concern_id": row.concern_id,
        # An emergency-domain audit row is already the critical path even
        # when the companion Concern record is no longer available. Keep the
        # one priority vocabulary in the UI instead of adding an Emergency
        # badge beside it.
        "priority": priority or ("critical" if row.domain == LlmDecisionLog.Domain.EMERGENCY else None),
        "final_decision": {
            "action": effective_action,
            "label": decision_label,
            "reason": decision_reason,
            "source": decision_source,
            "legacy": not bool(final_snapshot),
        },
        "submitted_media": _concern_media_payload(concern),
        "street_imagery": street_imagery,
    }


def _concern_priority(concern) -> str | None:
    if not concern:
        return None
    from apps.concerns.severity import severity_label

    return severity_label(concern)


class LlmDecisionLogStreetImageryView(APIView):
    """Retry a street-view comparison when an audit row lacks its image."""

    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

    def post(self, request, pk):
        row = (
            LlmDecisionLog.objects.select_related(
                "concern",
                "concern__community",
                "assigned_department",
                "assigned_department__community",
            )
            .prefetch_related("concern__media")
            .filter(pk=pk)
            .first()
        )
        if not row or not row.concern_id or not row.concern:
            return Response({"detail": "This log entry has no concern evidence to retry."}, status=status.HTTP_404_NOT_FOUND)

        concern = row.concern
        # The audit row is the source of truth for the incident's community.
        # Do not rely on a request-local variable here: this retry endpoint is
        # called independently from the original classification request.
        incident_community = concern.community or getattr(row.assigned_department, "community", None)
        if incident_community is None:
            # Legacy audit rows can predate community assignment. Prefer the
            # explicitly selected community, then the first active community
            # in this official's scope. This keeps the fallback data-driven
            # (and avoids coupling it to a community name such as a seed row).
            from apps.community_scope import community_ids_for_user, selected_community
            from apps.emergencies.models import Community

            incident_community = selected_community(
                request.user,
                request.query_params.get("community_id"),
            )
            if incident_community is None:
                allowed_communities = Community.objects.filter(
                    pk__in=community_ids_for_user(request.user),
                    status=Community.Status.ACTIVE,
                )
                # Match the legacy barangay text to the existing community
                # record before using a deterministic first-active fallback.
                # This resolves seeded rows such as Marikina Heights without
                # embedding that community name in the retry logic.
                barangay = (getattr(concern, "barangay", "") or "").strip()
                if barangay:
                    incident_community = allowed_communities.filter(name__iexact=barangay).first()
                if incident_community is None:
                    incident_community = allowed_communities.order_by("name").first()
        if incident_community is None:
            return Response(
                {"detail": "This concern is not assigned to a community."},
                status=status.HTTP_409_CONFLICT,
            )
        media = [item for item in concern.media.all() if item.mime_type.startswith("image/")]
        prepared_images = []
        for item in media:
            try:
                with item.file.open("rb") as handle:
                    raw = handle.read()
            except (OSError, ValueError, NotImplementedError):
                continue
            prepared = prepare_image_for_gemma(raw, filename=item.original_filename, mime_type=item.mime_type)
            if prepared is not None:
                prepared_images.append(prepared)

        config = ConcernClassificationConfiguration.current(incident_community)
        result = _street_imagery_preview(
            config,
            category=concern.category,
            latitude=concern.latitude,
            longitude=concern.longitude,
            images=prepared_images,
        )
        if result is None:
            result = {"status": "disabled", "reason": "street_imagery_not_configured"}
        return Response(result)


class CommunityModerationSimulationView(APIView):
    """Simulation of the community-content moderation pass, for the
    admin test workspace. Same analyzer call `run_content_moderation_ai_task`
    uses in production — nothing is persisted beyond the LlmDecisionLog row.
    """
    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request):
        from apps.concerns.ai.community_moderation_analyzer import (
            analyze_flagged_content,
            model_version_in_use,
        )

        content_text = str(request.data.get("content_text", ""))[:2000]
        reason = str(request.data.get("reason", ""))
        reporter_note = str(request.data.get("reporter_note", ""))[:500]
        image = request.FILES.get("image")
        image_submitted = image is not None
        image_payloads = []
        if image is not None:
            prepared = prepare_image_for_gemma(
                image.read(),
                filename=getattr(image, "name", ""),
                mime_type=getattr(image, "content_type", ""),
            )
            if prepared is not None:
                image_payloads.append(prepared.data)
        if not content_text.strip():
            return Response({"content_text": ["Enter the flagged content text."]}, status=status.HTTP_400_BAD_REQUEST)
        if reason not in ContentFlag.Reason.values:
            return Response({"reason": ["Choose a valid flag reason."]}, status=status.HTTP_400_BAD_REQUEST)

        result = analyze_flagged_content(
            content_text=content_text,
            reason=reason,
            reporter_note=reporter_note,
            images=image_payloads,
            image_submitted=image_submitted,
        )
        model_version = model_version_in_use()

        LlmDecisionLog.objects.create(
            run_kind=LlmDecisionLog.RunKind.SIMULATION,
            domain=LlmDecisionLog.Domain.COMMUNITY,
            performed_by=request.user,
            model_version=model_version,
            input_snapshot={
                "content_text": content_text,
                "reason": reason,
                "reporter_note": reporter_note,
                "image_submitted": image_submitted,
                "image_count": len(image_payloads),
            },
            output_snapshot=result,
            resident_message=result.get("short_explanation", ""),
            recommended_action=result.get("recommended_disposition", ""),
        )
        return Response({**result, "model_version": model_version})
