from dataclasses import asdict

from django.conf import settings

from apps.concerns.models import Concern, ConcernAiAssessment, ConcernClassificationConfiguration

from .image_detector import ImageDetectorNotConfigured, YoloImageDetector
from .classification import MultilingualKeywordClassifier
from .text_classifier import RobertaTagalogClassifier


def process_concern_ai(concern_id: int) -> ConcernAiAssessment:
    concern = Concern.objects.prefetch_related("media").get(pk=concern_id)
    assessment, _ = ConcernAiAssessment.objects.get_or_create(
        concern=concern,
        defaults={"status": ConcernAiAssessment.Status.PENDING},
    )

    config = ConcernClassificationConfiguration.current()
    image_paths = [
        media.file.path
        for media in concern.media.all()
        if media.mime_type.startswith("image/") and hasattr(media.file, "path")
    ]
    image_result = None
    image_notice = ""
    try:
        image_result = YoloImageDetector(settings.EBOSES_YOLO_MODEL_PATH).detect(image_paths)
    except ImageDetectorNotConfigured as exc:
        image_notice = str(exc)
    except Exception as exc:
        assessment.status = ConcernAiAssessment.Status.FAILED
        assessment.explanation = "Image classification failed safely. Continue manual official review."
        assessment.recommendation = "Manual review required."
        assessment.raw_result = {"image_error": exc.__class__.__name__}
        assessment.save(update_fields=["status", "explanation", "recommendation", "raw_result", "updated_at"])
        return assessment

    classifier = (
        RobertaTagalogClassifier(settings.EBOSES_NLP_MODEL_PATH)
        if settings.EBOSES_NLP_MODEL_PATH
        else MultilingualKeywordClassifier(config)
    )
    try:
        text_result = classifier.classify(title=concern.title, description=concern.description)
    except Exception:
        # A configured-but-unready RoBERTa checkpoint must not stop report
        # validation; use the working multilingual keyword baseline instead.
        text_result = MultilingualKeywordClassifier(config).classify(title=concern.title, description=concern.description)

    category_match = not text_result.category or text_result.category == concern.category
    recommendation = _recommendation(text_result.label, category_match)
    assessment.status = ConcernAiAssessment.Status.COMPLETED
    assessment.image_objects = image_result.objects if image_result else []
    assessment.yolo_confidence = image_result.confidence if image_result else None
    assessment.severity_estimate = text_result.severity
    assessment.nlp_validity = text_result.label
    assessment.nlp_confidence = text_result.confidence
    assessment.category_match = category_match
    assessment.recommendation = recommendation
    assessment.explanation = _explanation(text_result.label, category_match)
    assessment.model_version = f"yolo:{image_result.model_version if image_result else 'unavailable'};nlp:{text_result.model_version}"
    assessment.raw_result = {"image": asdict(image_result) if image_result else {"notice": image_notice}, "text": asdict(text_result)}
    assessment.save()
    return assessment


def _recommendation(label: str, category_match: bool) -> str:
    if "irrelevant" in label or "fake" in label or "suspicious" in label:
        return "Review carefully; possible irrelevant or suspicious report."
    if not category_match:
        return "Review category mismatch before assigning."
    return "Likely valid; proceed with official review."


def _explanation(label: str, category_match: bool) -> str:
    if not category_match:
        return f"NLP label `{label}` does not clearly match the submitted category."
    return f"NLP label `{label}` and submitted category are consistent enough for human review."
