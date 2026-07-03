"""Adapter interfaces for advisory AI validation."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence


@dataclass(frozen=True)
class ImageSeverityResult:
    severity_score: float
    model_version: str
    explanation: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class TextClassificationResult:
    relevance_score: float
    fake_report_score: float
    category_suggestion: str
    model_version: str
    explanation: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)


class ImageSeverityDetector(Protocol):
    def detect_severity(self, image_paths: Sequence[Path]) -> ImageSeverityResult:
        """Return an advisory severity score from 0.0 to 1.0 for concern images."""


class TextConcernClassifier(Protocol):
    def classify(self, *, title: str, description: str) -> TextClassificationResult:
        """Return advisory relevance, fake-report risk, and category suggestion."""


class RuleBasedImageSeverityDetector:
    model_version = "rule-based-image-severity-v1"

    def detect_severity(self, image_paths: Sequence[Path]) -> ImageSeverityResult:
        score = 0.6 if image_paths else 0.3
        return ImageSeverityResult(score, self.model_version, "Placeholder image heuristic; official review is required.", {"image_count": len(image_paths)})


class RuleBasedTextConcernClassifier:
    model_version = "rule-based-text-classifier-v1"
    category_keywords = {"waste": ("trash", "garbage", "waste"), "road": ("pothole", "road", "street"), "utilities": ("water", "power", "electric")}

    def classify(self, *, title: str, description: str) -> TextClassificationResult:
        text = f"{title} {description}".lower()
        category = next((name for name, words in self.category_keywords.items() if any(word in text for word in words)), "general")
        relevance = min(1.0, max(0.2, len(description.strip()) / 240))
        fake_risk = 0.2 if relevance >= 0.35 else 0.55
        return TextClassificationResult(relevance, fake_risk, category, self.model_version, "Placeholder text heuristic; barangay officials retain final approval authority.", {"text_length": len(text)})
