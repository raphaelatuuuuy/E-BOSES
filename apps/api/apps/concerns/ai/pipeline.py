from dataclasses import asdict

from django.conf import settings
from django.db import transaction

from apps.concerns.models import Concern, ConcernAiAssessment, ConcernClassificationConfiguration

from . import text_classifier
from .image_detector import ImageDetectorNotConfigured, YoloImageDetector
from .classification import BASE_TEXT_PROVIDER, ROBERTA_TAGALOG_PROVIDER, MultilingualKeywordClassifier
from .duplicate_detector import find_duplicate_concern
from .text_classifier import TextClassifierNotConfigured


BASE_LABEL_MAPPINGS = {
    "traffic light": Concern.Category.INFRASTRUCTURE,
    "bench": Concern.Category.INFRASTRUCTURE,
    "garbage": Concern.Category.ENVIRONMENT,
    "trash": Concern.Category.ENVIRONMENT,
    "knife": Concern.Category.PUBLIC_SAFETY,
    "dog": Concern.Category.PUBLIC_SAFETY,
    "cat": Concern.Category.PUBLIC_SAFETY,
    "car": Concern.Category.VEHICLE,
    "truck": Concern.Category.VEHICLE,
    "motorcycle": Concern.Category.VEHICLE,
    "bus": Concern.Category.VEHICLE,
    "bicycle": Concern.Category.VEHICLE,
    "person": Concern.Category.OTHERS,
}


class StaleAiRun(RuntimeError):
    """Raised when an expired worker tries to publish over a newer run lease."""


# Module-level memo so the (heavy) RoBERTa pipeline is loaded once per process
# rather than per concern. Keyed by (id(RobertaTagalogClassifier), model_path)
# so tests that patch the class get a fresh cache slot instead of a stale
# instance left behind by an earlier test/config.
_roberta_classifier_cache: dict[tuple[int, str], object] = {}


def _get_roberta_classifier(model_path: str):
    # Looked up via the module (not a direct name import) so tests that patch
    # apps.concerns.ai.text_classifier.RobertaTagalogClassifier take effect.
    roberta_cls = text_classifier.RobertaTagalogClassifier
    cache_key = (id(roberta_cls), model_path)
    classifier = _roberta_classifier_cache.get(cache_key)
    if classifier is None:
        classifier = roberta_cls(model_path)
        _roberta_classifier_cache[cache_key] = classifier
    return classifier


def _classify_text(config, *, title: str, description: str):
    """Returns (result, provider_name, fallback_reason|None).

    Uses the fine-tuned Tagalog RoBERTa classifier when configured; falls
    back to the dependency-free keyword baseline on any failure (model not
    configured, import error, inference error) so text classification never
    blocks the AI pipeline.
    """
    if config.nlp_provider == ROBERTA_TAGALOG_PROVIDER:
        model_path = getattr(settings, "EBOSES_NLP_MODEL_PATH", "")
        if model_path:
            try:
                classifier = _get_roberta_classifier(model_path)
                result = classifier.classify(title=title, description=description)
                return result, ROBERTA_TAGALOG_PROVIDER, None
            except TextClassifierNotConfigured as exc:
                fallback_reason = str(exc)
            except Exception as exc:
                fallback_reason = f"roberta_tagalog inference failed: {exc.__class__.__name__}"
        else:
            fallback_reason = "EBOSES_NLP_MODEL_PATH is not configured."
        return (
            MultilingualKeywordClassifier(config).classify(title=title, description=description),
            BASE_TEXT_PROVIDER,
            fallback_reason,
        )
    return (
        MultilingualKeywordClassifier(config).classify(title=title, description=description),
        BASE_TEXT_PROVIDER,
        None,
    )


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
    supported_classes = {s.lower() for s in (config.supported_classes or [])}
    try:
        image_result = YoloImageDetector(settings.EBOSES_YOLO_MODEL_PATH).detect(image_paths)
        mapped_objects = [
            {
                **item,
                "category": label_mappings.get(str(item.get("label", "")).lower(), ""),
            }
            for item in image_result.objects
            if not supported_classes or str(item.get("label", "")).lower() in supported_classes
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

    text_result, text_provider, text_fallback_reason = _classify_text(
        config,
        title=concern.title,
        description=concern.description,
    )

    text_payload = {
        **asdict(text_result),
        "provider": text_provider,
        "inference_status": "available",
        "inference_succeeded": True,
    }
    if text_fallback_reason:
        text_payload["fallback_reason"] = text_fallback_reason
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
    flag_reasons = _flag_reasons(
        config,
        label=text_result.label,
        is_suspicious=text_result.is_suspicious,
        is_irrelevant=text_result.is_irrelevant,
        category_match=category_match,
        possible_duplicate=duplicate_match.possible_duplicate,
    )
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
        "flagged": bool(flag_reasons),
        "flag_reasons": flag_reasons,
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
        # Soft gate only: this advisory summary never changes validation_status
        # or status. AI findings flag reports for official review, they never
        # auto-reject and never move the concern's real workflow state.
        summary = (
            "AI review flagged: " + ", ".join(reason["reason"].replace("_", " ") for reason in flag_reasons)
            if flag_reasons
            else "AI checks passed; cleared for official review."
        )
        Concern.objects.filter(pk=concern.pk).update(validation_summary=summary)
    return current


def _flag_reasons(
    config,
    *,
    label: str,
    is_suspicious: bool,
    is_irrelevant: bool,
    category_match: bool,
    possible_duplicate: bool,
) -> list[dict]:
    # Driven by the classifier-reported `is_suspicious`/`is_irrelevant`
    # booleans, not by sniffing substrings out of `label` — the label
    # vocabulary is classifier-specific (keyword baseline vs. RoBERTa), the
    # flags are not. `label` is kept only for the human-readable payload.
    reasons: list[dict] = []
    if config.flag_suspicious and is_suspicious:
        reasons.append({"reason": "suspicious_text", "label": label})
    if config.flag_irrelevant and is_irrelevant:
        reasons.append({"reason": "irrelevant_text", "label": label})
    if not category_match:
        reasons.append({"reason": "category_mismatch", "configured_action": config.mismatch_action})
    if possible_duplicate:
        reasons.append({"reason": "possible_duplicate"})
    return reasons


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
