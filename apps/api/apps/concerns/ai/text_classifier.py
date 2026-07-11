from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TextClassificationResult:
    label: str
    confidence: float | None
    category: str
    severity: str
    model_version: str


class TextClassifierNotConfigured(RuntimeError):
    pass


class RobertaTagalogClassifier:
    def __init__(self, model_path: str):
        self.model_path = model_path

    def classify(self, *, title: str, description: str) -> TextClassificationResult:
        if not self.model_path or not Path(self.model_path).exists():
            raise TextClassifierNotConfigured("Tagalog RoBERTa model path is not configured.")

        from transformers import pipeline

        classifier = pipeline("text-classification", model=self.model_path, tokenizer=self.model_path)
        text = f"{title}\n{description}".strip()
        result = classifier(text[:2000], truncation=True)[0]
        label = str(result.get("label", "needs_review")).lower()
        score = float(result.get("score", 0))
        return TextClassificationResult(
            label=label,
            confidence=score,
            category=_category_from_label(label),
            severity=_severity_from_label(label),
            model_version=Path(self.model_path).name,
        )


def _category_from_label(label: str) -> str:
    for category in ("infrastructure", "environment", "public_safety", "others"):
        if category in label:
            return category
    return ""


def _severity_from_label(label: str) -> str:
    if "urgent" in label or "high" in label:
        return "high"
    if "low" in label:
        return "low"
    return "medium"
