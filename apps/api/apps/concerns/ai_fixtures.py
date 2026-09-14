"""Builders for fake Gemma results, shared across the concern test modules.

Not named `tests_*` on purpose: Django's discovery pattern is `test*.py`, and a
module of helpers is not a test module.

`gemma_result` fills every schema key with a safe default so a test only has to
state the one or two fields it is actually about. That matters here because the
pipeline branches on several of them at once — a test that forgets
`image_review_succeeded` would silently exercise the "no photo" path.
"""

from apps.concerns.ai.gemma_analyzer import empty_details
from apps.concerns.ai.text_classifier import TextClassificationResult


def gemma_details(**overrides) -> dict:
    return {**empty_details(), **overrides}


def gemma_result(
    *,
    category: str = "",
    severity: str = "medium",
    model_version: str = "gemma4:cloud",
    relevance: str = "VALID",
    **detail_overrides,
) -> TextClassificationResult:
    """A parsed Gemma result, as `GemmaAnalyzer.analyze` would return it.

    Caller overrides win over the defaults, so a test can say
    `recommended_action="manual_review"` without also having to restate the
    fields it does not care about.
    """
    defaults = {
        "relevance": relevance,
        "primary_category": category,
        "severity": severity,
        "recommended_action": "accept" if category else "manual_review",
        "short_explanation": "The description and the photo were reviewed.",
    }
    details = gemma_details(**{**defaults, **detail_overrides})
    return TextClassificationResult(
        label=f"related_{category}" if category and relevance == "VALID" else "needs_review",
        confidence=1.0 if category and relevance == "VALID" else 0.0,
        category=category,
        severity=severity,
        model_version=model_version,
        is_suspicious=False,
        is_irrelevant=relevance != "VALID" or not category,
        details=details,
    )


def privacy_scan_result(
    *,
    classes: list[str],
    category: str = "environment",
    **overrides,
) -> TextClassificationResult:
    """A Gemma result that asks for a SAM3 privacy scan on `classes`."""
    return gemma_result(
        category=category,
        detected_objects=["vehicle"],
        evidence_relationship="supports_report",
        image_review_succeeded=True,
        privacy_scan_required=True,
        privacy_scan_reasons=["A person may be visible in the photo."],
        suspected_sensitive_classes=classes,
        recommended_action="accept_with_privacy_review",
        **overrides,
    )
