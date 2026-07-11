"""Configurable, provider-neutral OCR extraction and rule evaluation.

Only predefined operators and formats are supported.  Officials can configure
aliases, keywords, thresholds and value lists, but cannot inject executable code
or unbounded regular expressions.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from statistics import fmean
from typing import Protocol

from .ocr import OCRResponse, ocr_bytes_with_metadata


DATE_PATTERN = re.compile(
    r"\b(?:"
    r"(?P<ymd>\d{4}[/-]\d{1,2}[/-]\d{1,2})|"
    r"(?P<mdy>\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|"
    r"(?P<word>(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|"
    r"JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)"
    r"\s+\d{1,2},?\s+\d{4})"
    r")\b",
    re.IGNORECASE,
)


class OCRProvider(Protocol):
    """Adapter seam used by tasks, tests, and any future self-hosted provider."""

    def recognize(self, content: bytes, *, suffix: str) -> OCRResponse: ...


class PaddleOCRProvider:
    def recognize(self, content: bytes, *, suffix: str) -> OCRResponse:
        return ocr_bytes_with_metadata(content, suffix=suffix)


@dataclass(frozen=True)
class EngineResult:
    detected_document_type_id: int | None
    detected_document_type_code: str
    document_type_score: float
    document_type_mismatch: bool
    confidence: float
    extracted_fields: dict
    rule_results: list[dict]
    outcome: str
    review_reason: str


def normalized_text(value) -> str:
    value = unicodedata.normalize("NFKD", str(value or ""))
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"[^A-Za-z0-9]+", " ", value).upper()
    return " ".join(value.split())


def similarity(left, right) -> float:
    left_normalized = normalized_text(left)
    right_normalized = normalized_text(right)
    if not left_normalized or not right_normalized:
        return 0.0
    sequence = SequenceMatcher(None, left_normalized, right_normalized).ratio()
    left_tokens = set(left_normalized.split())
    right_tokens = set(right_normalized.split())
    overlap = len(left_tokens & right_tokens)
    token_score = (2 * overlap / (len(left_tokens) + len(right_tokens))) if overlap else 0.0
    containment = min(1.0, overlap / max(1, min(len(left_tokens), len(right_tokens))))
    return round(max(sequence, token_score, containment), 4)


def parse_date(value) -> date | None:
    raw = str(value or "").strip().replace(",", "")
    for fmt in (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%m/%d/%y",
        "%m-%d-%y",
        "%B %d %Y",
        "%b %d %Y",
    ):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _line_values(lines) -> list[dict]:
    clean = []
    for line in lines or []:
        text = str(line.get("text") or "").strip()
        if not text:
            continue
        try:
            confidence = max(0.0, min(1.0, float(line.get("confidence") or 0)))
        except (TypeError, ValueError):
            confidence = 0.0
        clean.append({"text": text, "normalized": normalized_text(text), "confidence": confidence})
    return clean


def _profile_value(field, profile) -> str:
    code = field.code.lower()
    if field.data_type == "name" or code in {"full_name", "resident_name", "account_name", "name"}:
        return " ".join(
            part for part in (profile.first_name, profile.middle_name, profile.last_name) if part
        )
    if field.data_type == "address" or "address" in code:
        return profile.address
    if code in {"date_of_birth", "birth_date", "dob"}:
        return profile.date_of_birth.isoformat()
    return ""


def _candidate_matching_profile(lines, profile_value: str):
    best = None
    for start in range(len(lines)):
        for width in (1, 2, 3):
            window = lines[start : start + width]
            if not window:
                continue
            text = " ".join(item["text"] for item in window)
            score = similarity(text, profile_value)
            if best is None or score > best[0]:
                best = (score, text, fmean(item["confidence"] for item in window))
    if best and best[0] >= 0.62:
        return best[1], best[2], {"profile_similarity": best[0]}
    return "", 0.0, {}


def _candidate_after_alias(lines, aliases):
    best = None
    for index, line in enumerate(lines):
        for alias in aliases:
            alias_normalized = normalized_text(alias)
            if not alias_normalized or alias_normalized not in line["normalized"]:
                continue
            raw = re.sub(re.escape(str(alias)), "", line["text"], count=1, flags=re.IGNORECASE)
            raw = raw.lstrip(" :-#.").strip()
            candidates = []
            if raw and normalized_text(raw) != alias_normalized:
                candidates.append((raw, line["confidence"], index))
            if index + 1 < len(lines):
                candidates.append((lines[index + 1]["text"], lines[index + 1]["confidence"], index + 1))
            for candidate in candidates:
                if best is None or candidate[1] > best[1]:
                    best = candidate
    if best:
        return best[0], best[1], {"source_line": best[2]}
    return "", 0.0, {}


def _normalize_field_value(value: str, normalization: str) -> str:
    if normalization == "uppercase":
        return value.upper().strip()
    if normalization in {"name", "address"}:
        return normalized_text(value)
    if normalization == "digits":
        return "".join(character for character in value if character.isdigit())
    if normalization == "alphanumeric":
        return "".join(character for character in value.upper() if character.isalnum())
    if normalization == "date":
        parsed = parse_date(value)
        return parsed.isoformat() if parsed else value.strip()
    return value.strip()


def extract_fields(document_type, lines, profile) -> dict:
    clean_lines = _line_values(lines)
    all_text = " ".join(item["text"] for item in clean_lines)
    date_matches = [match.group(0) for match in DATE_PATTERN.finditer(all_text)]
    extracted = {}

    for field in document_type.fields.filter(enabled=True).order_by("display_order", "id"):
        aliases = [field.label, field.code.replace("_", " "), *(field.aliases or [])]
        hints = field.extraction_hints if isinstance(field.extraction_hints, dict) else {}
        aliases.extend(value for value in hints.get("labels", []) if isinstance(value, str))
        value, confidence, evidence = _candidate_after_alias(clean_lines, aliases)
        profile_value = _profile_value(field, profile)

        if profile_value:
            profile_candidate = _candidate_matching_profile(clean_lines, profile_value)
            if profile_candidate[1] > confidence:
                value, confidence, evidence = profile_candidate

        if field.data_type == "date":
            parsed_current = parse_date(value)
            if not parsed_current and date_matches:
                code = field.code.lower()
                if any(token in code for token in ("expiry", "expiration", "valid_until", "due")):
                    value = date_matches[-1]
                else:
                    value = date_matches[0]
                containing = next((item for item in clean_lines if value in item["text"]), None)
                confidence = containing["confidence"] if containing else confidence
                evidence = {"date_candidate_count": len(date_matches)}

        if field.code in {"provider", "provider_name", "issuer"} and not value:
            for provider in document_type.provider_names or []:
                if normalized_text(provider) in normalized_text(all_text):
                    value = str(provider)
                    matching = next(
                        (item for item in clean_lines if normalized_text(provider) in item["normalized"]),
                        None,
                    )
                    confidence = matching["confidence"] if matching else 0.0
                    evidence = {"provider_match": True}
                    break

        normalized = _normalize_field_value(value, field.normalization)
        extracted[field.code] = {
            "label": field.label,
            "value": value,
            "normalized": normalized,
            "confidence": round(confidence, 4),
            "required": field.required,
            "min_confidence": float(field.min_confidence),
            "evidence": evidence,
        }
    return extracted


def classify_document_type(configuration, lines, requested_document_type=None):
    text = normalized_text(" ".join(str(item.get("text") or "") for item in lines or []))
    scored = []
    for document_type in configuration.document_types.filter(enabled=True).order_by("display_order", "id"):
        terms = [
            document_type.name,
            document_type.code.replace("_", " "),
            *(document_type.keywords or []),
            *(document_type.provider_names or []),
            *(document_type.aliases or []),
        ]
        normalized_terms = {normalized_text(term) for term in terms if normalized_text(term)}
        matched = [term for term in normalized_terms if term in text]
        score = len(matched) / max(1, len(normalized_terms))
        if any(normalized_text(provider) in text for provider in document_type.provider_names or []):
            score += 0.35
        scored.append((min(1.0, score), document_type))
    scored.sort(key=lambda item: (item[0], -item[1].display_order), reverse=True)
    detected_score, detected = scored[0] if scored else (0.0, None)
    mismatch = bool(
        requested_document_type
        and detected
        and detected.pk != requested_document_type.pk
        and detected_score >= 0.2
        and detected_score > next(
            (score for score, item in scored if item.pk == requested_document_type.pk),
            0.0,
        )
    )
    return detected, round(detected_score, 4), mismatch


def _rule_value(rule):
    if isinstance(rule.value, dict):
        for key in ("value", "values", "days", "keywords", "format"):
            if key in rule.value:
                return rule.value[key]
    return rule.value


def _format_passes(value: str, format_name: str) -> bool:
    if format_name in {"", "none", "text"}:
        return bool(value.strip())
    if format_name == "date_mdy":
        return bool(re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", value.strip()))
    if format_name == "date_ymd":
        return bool(re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", value.strip()))
    if format_name == "alphanumeric":
        return bool(value.strip()) and all(character.isalnum() or character in " -" for character in value)
    if format_name == "numeric":
        return bool(value.strip()) and all(character.isdigit() or character in ",." for character in value)
    return False


def evaluate_rules(configuration, document_type, extracted, profile, lines) -> list[dict]:
    results = []
    all_text = " ".join(str(item.get("text") or "") for item in lines or [])
    rules = configuration.rules.filter(enabled=True, document_type__in=[None, document_type]).select_related("field")
    for rule in rules.order_by("display_order", "id"):
        field_result = extracted.get(rule.field.code, {}) if rule.field_id else {}
        value = str(field_result.get("value") or "")
        configured = _rule_value(rule)
        threshold = float(rule.threshold) if rule.threshold is not None else None
        score = None
        passed = True
        detail = "Rule passed."

        if rule.operator == "exists" or rule.rule_type == "required":
            passed = bool(value.strip())
            detail = "Required value is present." if passed else "Required value was not extracted."
        elif rule.operator == "matches_profile" or rule.rule_type in {"profile_match", "similarity"}:
            expected = _profile_value(rule.field, profile) if rule.field_id else ""
            score = similarity(value, expected)
            passed = bool(expected) and score >= (threshold if threshold is not None else 0.85)
            detail = f"Profile similarity is {round(score * 100)}%."
        elif rule.operator == "within_days" or rule.rule_type == "recency":
            parsed = parse_date(value)
            try:
                days = int(configured or 90)
            except (TypeError, ValueError):
                days = 90
            delta = (date.today() - parsed).days if parsed else None
            passed = delta is not None and 0 <= delta <= days
            detail = f"Document age is {delta} days." if delta is not None else "Date could not be parsed."
        elif rule.operator == "not_expired" or rule.rule_type == "not_expired":
            parsed = parse_date(value)
            passed = bool(parsed and parsed >= date.today())
            detail = "Document is not expired." if passed else "Document is expired or expiry was not parsed."
        elif rule.operator in {"one_of", "equals"} or rule.rule_type == "allowed_value":
            allowed = configured if isinstance(configured, list) else [configured]
            if rule.operator == "equals":
                allowed = allowed[:1]
            passed = normalized_text(value) in {normalized_text(item) for item in allowed}
            detail = "Value is allowed." if passed else "Value is not in the allowed list."
        elif rule.operator == "contains_any" or rule.rule_type == "contains_keyword":
            keywords = configured if isinstance(configured, list) else [configured]
            passed = any(normalized_text(item) in normalized_text(all_text) for item in keywords if item)
            detail = "Document keyword found." if passed else "Expected document keyword was not found."
        elif rule.rule_type == "format":
            format_name = str(configured or getattr(rule.field, "format", "none"))
            passed = _format_passes(value, format_name)
            detail = "Value format is valid." if passed else f"Value does not match {format_name}."
        elif rule.operator in {"gte", "lte"}:
            try:
                numeric = float(value.replace(",", ""))
                expected = float(configured)
                passed = numeric >= expected if rule.operator == "gte" else numeric <= expected
            except (TypeError, ValueError):
                passed = False
            detail = "Numeric threshold passed." if passed else "Numeric threshold failed."
        elif rule.operator == "equals":
            passed = normalized_text(value) == normalized_text(configured)

        results.append(
            {
                "code": rule.code,
                "name": rule.name,
                "field": rule.field.code if rule.field_id else None,
                "passed": passed,
                "score": score,
                "on_failure": rule.on_failure,
                "detail": detail,
            }
        )
    return results


def run_engine(configuration, requested_document_type, profile, lines) -> EngineResult:
    detected, type_score, mismatch = classify_document_type(configuration, lines, requested_document_type)
    document_type = requested_document_type or detected
    if document_type is None:
        return EngineResult(None, "", 0.0, False, 0.0, {}, [], "manual_review", "document_type_mismatch")

    extracted = extract_fields(document_type, lines, profile)
    rules = evaluate_rules(configuration, document_type, extracted, profile, lines)
    confidences = [float(item["confidence"]) for item in extracted.values() if item.get("value")]
    overall_confidence = round(fmean(confidences), 4) if confidences else 0.0
    missing = [code for code, item in extracted.items() if item["required"] and not item["value"]]
    low_confidence = [
        code
        for code, item in extracted.items()
        if item["required"] and item["value"] and float(item["confidence"]) < float(item["min_confidence"])
    ]
    blocking_rules = [item for item in rules if not item["passed"] and item["on_failure"] == "manual_review"]
    settings = configuration.settings if isinstance(configuration.settings, dict) else {}
    threshold = float(settings.get("ocr_confidence_threshold", 0.8))

    if mismatch:
        outcome, review_reason = "manual_review", "document_type_mismatch"
    elif missing:
        outcome, review_reason = "manual_review", "missing_required_field"
    elif low_confidence or overall_confidence < threshold:
        outcome, review_reason = "manual_review", "low_confidence"
    elif blocking_rules:
        outcome, review_reason = "manual_review", "rule_mismatch"
    else:
        outcome, review_reason = "passed", ""

    return EngineResult(
        detected.pk if detected else None,
        detected.code if detected else "",
        type_score,
        mismatch,
        overall_confidence,
        extracted,
        rules,
        outcome,
        review_reason,
    )


def suffix_for_filename(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".pdf"} else ".bin"
