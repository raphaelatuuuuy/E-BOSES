from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TextClassificationResult:
    label: str
    confidence: float | None
    category: str
    severity: str
    model_version: str
    # Explicit flags so pipeline-level flagging (`_flag_reasons` in
    # ai/pipeline.py) never has to sniff substrings out of `label`. Each
    # classifier owns interpreting its own label vocabulary and sets these
    # accordingly; the pipeline only reads the booleans.
    is_suspicious: bool = False
    is_irrelevant: bool = False


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
            is_suspicious=_is_suspicious_label(label),
            is_irrelevant=_is_irrelevant_label(label),
        )


def _category_from_label(label: str) -> str:
    for category in ("infrastructure", "environment", "public_safety", "vehicle", "others"):
        if category in label:
            return category
    return ""


def _severity_from_label(label: str) -> str:
    if "urgent" in label or "high" in label:
        return "high"
    if "low" in label:
        return "low"
    return "medium"


# Best-effort mapping from the fine-tuned model's own label vocabulary to the
# shared suspicious/irrelevant flags. This is separate from
# MultilingualKeywordClassifier's vocabulary on purpose: a RoBERTa checkpoint
# is free to emit whatever label strings it was trained on (e.g. "spam",
# "toxic", "off_topic", "LABEL_3"); if a deployed checkpoint's vocabulary
# doesn't match these tokens, extend this list rather than teaching the
# pipeline to sniff labels itself.
_SUSPICIOUS_LABEL_TOKENS = ("suspicious", "fake", "spam", "scam", "hoax")
_IRRELEVANT_LABEL_TOKENS = ("needs_review", "irrelevant", "off_topic", "off-topic", "unclear", "unrelated")


def _is_suspicious_label(label: str) -> bool:
    return any(token in label for token in _SUSPICIOUS_LABEL_TOKENS)


def _is_irrelevant_label(label: str) -> bool:
    return any(token in label for token in _IRRELEVANT_LABEL_TOKENS)
