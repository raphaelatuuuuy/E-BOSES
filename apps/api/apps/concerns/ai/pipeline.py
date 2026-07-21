from dataclasses import asdict

from django.conf import settings
from django.db import transaction

from apps.concerns.models import Concern, ConcernAiAssessment, ConcernClassificationConfiguration

from .image_detector import ImageDetectorNotConfigured, YoloImageDetector
from .classification import MultilingualKeywordClassifier
from .duplicate_detector import find_duplicate_concern


BASE_LABEL_MAPPINGS = {
    "pothole": Concern.Category.INFRASTRUCTURE,
    "traffic light": Concern.Category.INFRASTRUCTURE,
    "bench": Concern.Category.INFRASTRUCTURE,
    "garbage": Concern.Category.ENVIRONMENT,
    "trash": Concern.Category.ENVIRONMENT,
    "floodwater": Concern.Category.ENVIRONMENT,
    "fire": Concern.Category.PUBLIC_SAFETY,
    "knife": Concern.Category.PUBLIC_SAFETY,
    "dog": Concern.Category.PUBLIC_SAFETY,
}


class StaleAiRun(RuntimeError):
    """Raised when an expired worker tries to publish over a newer run lease."""


def process_concern_ai(concern_id: int, *, expected_run_id: str | None = None) -> ConcernAiAssessment:
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
    image_payload = {
        "inference_status": "unavailable",
        "inference_succeeded": False,
        "available": False,
        "model": getattr(config, "image_model", ""),
    }
    image_status = ConcernAiAssessment.Status.COMPLETED
    label_mappings = {**BASE_LABEL_MAPPINGS, **(config.label_mappings or {})}
    try:
        image_result = YoloImageDetector(settings.EBOSES_YOLO_MODEL_PATH).detect(image_paths)
        mapped_objects = [
            {
                **item,
                "category": label_mappings.get(str(item.get("label", "")).lower(), ""),
            }
            for item in image_result.objects
        ]
        image_result = type(image_result)(
            objects=mapped_objects,
            confidence=image_result.confidence,
            model_version=image_result.model_version,
            annotated_image=image_result.annotated_image,
        )
        image_payload = {
            "inference_status": "available",
            "inference_succeeded": True,
            "available": True,
            "model": image_result.model_version,
        }
    except ImageDetectorNotConfigured as exc:
        image_payload.update({"notice": str(exc)})
        image_status = ConcernAiAssessment.Status.NOT_CONFIGURED
    except Exception as exc:
        image_payload = {
            "notice": "Image classification failed safely. Continue manual official review.",
            "error": exc.__class__.__name__,
            "inference_status": "failed",
            "inference_succeeded": False,
            "available": False,
        }
        image_status = ConcernAiAssessment.Status.FAILED

    text_result = MultilingualKeywordClassifier(config).classify(
        title=concern.title,
        description=concern.description,
    )

    text_payload = {
        **asdict(text_result),
        "provider": "keyword_baseline",
        "inference_status": "available",
        "inference_succeeded": True,
    }
    image_categories = {
        item.get("category")
        for item in (image_result.objects if image_result else [])
        if item.get("category")
    }
    text_match = bool(text_result.category) and text_result.category == concern.category
    image_match = not image_categories or concern.category in image_categories
    category_match = text_match and image_match
    suggested_category = text_result.category or next(iter(image_categories), "")
    suggested_priority = _priority_guidance(
        severity=text_result.severity,
        category_match=category_match,
        image_confidence=image_result.confidence if image_result else None,
    )
    duplicate_match = find_duplicate_concern(
        concern,
        enabled=config.duplicate_detection_enabled,
        threshold=config.duplicate_threshold,
    )
    duplicate_payload = duplicate_match.as_payload(
        enabled=config.duplicate_detection_enabled,
        threshold=config.duplicate_threshold,
    )
    recommendation = _recommendation(
        text_result.label,
        category_match,
        possible_duplicate=duplicate_match.possible_duplicate,
    )
    analysis_result = {
        "image": ({**asdict(image_result), **image_payload} if image_result else image_payload),
        "text": text_payload,
        "suggested_category": suggested_category,
        "priority": suggested_priority,
        "duplicate": duplicate_payload,
    }
    result_values = {
        "status": image_status,
        "image_objects": image_result.objects if image_result else [],
        "yolo_confidence": image_result.confidence if image_result else None,
        "severity_estimate": text_result.severity,
        "nlp_validity": text_result.label,
        "nlp_confidence": text_result.confidence,
        "category_match": category_match,
        "recommendation": recommendation,
        "explanation": _explanation(
            text_result.label,
            category_match,
            possible_duplicate=duplicate_match.possible_duplicate,
        ),
        "model_version": f"yolo:{image_result.model_version if image_result else 'unavailable'};nlp:{text_result.model_version}",
    }
    with transaction.atomic():
        current = ConcernAiAssessment.objects.select_for_update().get(pk=assessment.pk)
        execution = dict((current.raw_result or {}).get("execution") or {})
        if expected_run_id and execution.get("run_id") != expected_run_id:
            raise StaleAiRun("The AI run lease was replaced before inference completed.")
        for field, value in result_values.items():
            setattr(current, field, value)
        current.raw_result = {
            **analysis_result,
            **({"execution": execution} if execution else {}),
        }
        current.save()
    return current


def _recommendation(label: str, category_match: bool, *, possible_duplicate: bool = False) -> str:
    if possible_duplicate:
        return "Possible duplicate; compare the nearby report before routing."
    if "irrelevant" in label or "fake" in label or "suspicious" in label:
        return "Review carefully; possible irrelevant or suspicious report."
    if not category_match:
        return "Review category mismatch before assigning."
    return "Likely valid; proceed with official review."


def _explanation(label: str, category_match: bool, *, possible_duplicate: bool = False) -> str:
    if possible_duplicate:
        return "A similar report in the same category and barangay was found within 1 km. An official must decide whether to combine them."
    if not category_match:
        return f"NLP label `{label}` does not clearly match the submitted category."
    return f"NLP label `{label}` and submitted category are consistent enough for human review."


def _priority_guidance(*, severity: str, category_match: bool, image_confidence: float | None) -> dict:
    if not category_match:
        return {"level": "review", "reason": "Image/text evidence does not conclusively match the selected category."}
    if severity == "high":
        return {"level": "high", "reason": "Text baseline contains high-severity safety language."}
    if image_confidence is not None and image_confidence >= 0.85:
        return {"level": "standard", "reason": "Mapped image evidence is strong; official priority review remains required."}
    return {"level": "standard", "reason": "Evidence supports the selected category without a high-severity signal."}
