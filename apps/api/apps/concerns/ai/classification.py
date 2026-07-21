import re
from dataclasses import asdict

from apps.concerns.models import ConcernClassificationConfiguration

from .text_classifier import TextClassificationResult

BASE_IMAGE_PROVIDER = "ultralytics"
BASE_IMAGE_MODEL = "yolov8m.pt"
BASE_TEXT_PROVIDER = "keyword_baseline"
BASE_TEXT_MODEL = "multilingual-keyword-v1"


class MultilingualKeywordClassifier:
    """Dependency-free Tagalog/Taglish baseline until the fine-tuned model exists."""

    def __init__(self, configuration=None):
        self.configuration = configuration or ConcernClassificationConfiguration.current()

    def classify(self, *, title: str, description: str) -> TextClassificationResult:
        text = re.sub(r"\s+", " ", f"{title} {description}".lower()).strip()
        tokens = re.findall(r"[a-z0-9]+", text)
        suspicious = any(term.lower() in text for term in self.configuration.suspicious_terms)
        repetitive = bool(tokens) and len(set(tokens)) <= max(1, len(tokens) // 4)
        too_short = len(description.strip()) < self.configuration.minimum_description_length

        scores = {}
        for category, keywords in self.configuration.category_keywords.items():
            matches = [keyword for keyword in keywords if keyword.lower() in text]
            scores[category] = len(matches) / max(1, min(3, len(keywords)))
        category = max(scores, key=scores.get, default="")
        confidence = min(0.95, 0.55 + scores.get(category, 0) * 0.4) if scores.get(category, 0) else 0.35
        if suspicious or repetitive:
            label = "suspicious"
            category = ""
            confidence = 0.9
        elif too_short or not scores.get(category, 0):
            label = "needs_review"
            category = ""
            confidence = 0.4
        else:
            label = f"related_{category}"
        severity = "high" if any(word in text for word in ("sunog", "fire", "aksidente", "accident", "danger", "delikado")) else "medium"
        return TextClassificationResult(label=label, confidence=confidence, category=category, severity=severity, model_version=BASE_TEXT_MODEL)


def classification_payload(*, title, description, selected_category, configuration=None):
    config = configuration or ConcernClassificationConfiguration.current()
    result = MultilingualKeywordClassifier(config).classify(title=title, description=description)
    category_match = bool(result.category) and result.category == selected_category
    if result.label == "suspicious":
        outcome = "suspicious"
    elif not result.category or result.confidence < config.relevance_threshold or not category_match:
        outcome = "irrelevant"
    else:
        outcome = "related"
    return {
        **asdict(result),
        "selected_category": selected_category,
        "category_match": category_match,
        "outcome": outcome,
        "action": "manual_review" if outcome != "related" else "continue",
        "calibrated": False,
        "notice": "Baseline score is not calibrated accuracy; an official must review flagged reports.",
    }
