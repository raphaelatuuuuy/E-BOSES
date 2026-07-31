from .ollama_text_classifier import (
    OLLAMA_CLOUD_PROVIDER,
    OLLAMA_TEXT_MODEL,
    OllamaTextClassifier,
    payload_from_result,
    safe_needs_review,
)
from .text_classifier import TextClassifierNotConfigured


BASE_IMAGE_PROVIDER = "ultralytics"
BASE_IMAGE_MODEL = "yolov8m.pt"
BASE_TEXT_PROVIDER = OLLAMA_CLOUD_PROVIDER
BASE_TEXT_MODEL = OLLAMA_TEXT_MODEL
ALLOWED_NLP_PROVIDERS = {OLLAMA_CLOUD_PROVIDER}


def classification_payload(*, title, description, selected_category, configuration=None, image_objects=None, image_data=None, image_mime_type=""):
    image_objects = image_objects or []
    try:
        result = OllamaTextClassifier(configuration=configuration).classify(
            title=title,
            description=description,
            selected_category=selected_category,
            image_objects=image_objects,
            image_data=image_data,
            image_mime_type=image_mime_type,
        )
    except TextClassifierNotConfigured as exc:
        result = safe_needs_review(model_version=BASE_TEXT_MODEL, reason=str(exc), image_objects=image_objects)
    except Exception as exc:
        result = safe_needs_review(
            model_version=BASE_TEXT_MODEL,
            reason=f"Ollama text classification failed: {exc.__class__.__name__}",
            image_objects=image_objects,
        )
    return payload_from_result(result, selected_category=selected_category)
