"""Services for storing advisory AI outputs on concern records."""

from pathlib import Path

from django.db import transaction
from django.utils import timezone

from apps.concerns.models import Concern

from .adapters import ImageSeverityDetector, RuleBasedImageSeverityDetector, RuleBasedTextConcernClassifier, TextConcernClassifier


def validate_concern(concern_id: int, *, image_detector: ImageSeverityDetector | None = None, text_classifier: TextConcernClassifier | None = None) -> Concern:
    image_detector = image_detector or RuleBasedImageSeverityDetector()
    text_classifier = text_classifier or RuleBasedTextConcernClassifier()
    concern = Concern.objects.prefetch_related("media").get(pk=concern_id)
    image_paths = [Path(media.file.path) for media in concern.media.all() if media.file]
    image_result = image_detector.detect_severity(image_paths)
    text_result = text_classifier.classify(title=concern.title, description=concern.description)
    model_versions = ",".join(filter(None, {image_result.model_version, text_result.model_version}))
    metadata = {"image": dict(image_result.metadata), "text": dict(text_result.metadata), "advisory_only": True}
    explanation = " ".join(filter(None, [image_result.explanation, text_result.explanation, "AI scores are advisory only; officials make final approval decisions."]))
    with transaction.atomic():
        concern.ai_severity_score = image_result.severity_score
        concern.ai_category_suggestion = text_result.category_suggestion
        concern.ai_relevance_score = text_result.relevance_score
        concern.ai_fake_report_score = text_result.fake_report_score
        concern.ai_model_version = model_versions
        concern.ai_explanation = explanation
        concern.ai_metadata = metadata
        concern.ai_reviewed_at = timezone.now()
        concern.save(update_fields=["ai_severity_score", "ai_category_suggestion", "ai_relevance_score", "ai_fake_report_score", "ai_model_version", "ai_explanation", "ai_metadata", "ai_reviewed_at", "updated_at"])
    return concern
