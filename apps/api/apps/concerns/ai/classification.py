from .gemma_analyzer import (
    OLLAMA_CLOUD_PROVIDER,
    OLLAMA_TEXT_MODEL,
    GemmaAnalyzer,
    payload_from_result,
    safe_needs_review,
)
from .text_classifier import TextClassifierNotConfigured


BASE_TEXT_PROVIDER = OLLAMA_CLOUD_PROVIDER
BASE_TEXT_MODEL = OLLAMA_TEXT_MODEL
ALLOWED_NLP_PROVIDERS = {OLLAMA_CLOUD_PROVIDER}


def classification_payload(
    *, title, description, selected_category, configuration=None, image=None, images=None, image_uploaded=None,
    text_timeout=None,
):
    """One-shot analysis for the config screen's sample tester and resident precheck.

    Same analyzer the real pipeline uses, so what an official sees when they try
    a sample report is what a resident's report will actually get. `text_timeout`
    lets interactive callers bound the wait; the pipeline default is unchanged.
    """
    prepared = images if images is not None else ([image] if image is not None else None)
    image_was_submitted = bool(prepared) or bool(image_uploaded)
    try:
        result = GemmaAnalyzer(configuration=configuration, text_timeout=text_timeout).analyze(
            title=title,
            description=description,
            selected_category=selected_category,
            images=prepared,
            image_uploaded=image_uploaded,
        )
    except TextClassifierNotConfigured as exc:
        result = safe_needs_review(
            model_version=BASE_TEXT_MODEL,
            reason=str(exc),
            image_attached=image_was_submitted,
        )
    except Exception as exc:
        result = safe_needs_review(
            model_version=BASE_TEXT_MODEL,
            reason="The automatic review could not run, so this report needs a manual look.",
            image_attached=image_was_submitted,
        )
        result.details["failure_type"] = exc.__class__.__name__
    return payload_from_result(result, selected_category=selected_category)
