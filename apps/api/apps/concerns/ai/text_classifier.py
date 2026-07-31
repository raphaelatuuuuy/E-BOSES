from dataclasses import dataclass, field


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
    details: dict = field(default_factory=dict)


class TextClassifierNotConfigured(RuntimeError):
    pass
