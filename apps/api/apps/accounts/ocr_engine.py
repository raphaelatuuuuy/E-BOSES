"""Configurable, provider-neutral OCR extraction and rule evaluation.

Only predefined operators and formats are supported.  Officials can configure
aliases, keywords, thresholds and value lists, but cannot inject executable code
or unbounded regular expressions.
"""

from __future__ import annotations

import logging
import re
import time
from io import BytesIO
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from statistics import fmean
from typing import Callable, Protocol

from .ocr import OCRProviderError, OCRProviderUnavailable, OCRResponse, ocr_bytes_with_metadata


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


_EASYOCR_READER = None


def _easyocr_reader(*, gpu=False, languages=None):
    global _EASYOCR_READER
    if _EASYOCR_READER is None:
        try:
            import easyocr
        except Exception as exc:
            raise OCRProviderUnavailable("EasyOCR is not installed.") from exc
        _EASYOCR_READER = easyocr.Reader(languages or ["en"], gpu=gpu)
    return _EASYOCR_READER


class EasyOCRProvider:
    provider_name = "easyocr"

    def __init__(self, *, reader=None, gpu=False, languages=None):
        self.reader = reader
        self.gpu = bool(gpu)
        self.languages = list(languages or ["en"])

    @property
    def model(self) -> str:
        device = "gpu" if self.gpu else "cpu"
        return f"easyocr:{'-'.join(self.languages)}:{device}"

    def recognize(self, content: bytes, *, suffix: str, deskew: bool = True) -> OCRResponse:
        started = time.monotonic()
        try:
            from PIL import Image
            import numpy as np

            with Image.open(BytesIO(content)) as image:
                rgb = image.convert("RGB")
                image_width, image_height = rgb.size
                array = np.array(rgb)
        except Exception as exc:
            raise OCRProviderUnavailable("EasyOCR could not read the image.") from exc

        reader = self.reader or _easyocr_reader(gpu=self.gpu, languages=self.languages)
        try:
            raw_results = reader.readtext(array)
        except Exception as exc:
            raise OCRProviderUnavailable("EasyOCR recognition failed.") from exc

        lines = []
        for item in raw_results or []:
            if not isinstance(item, (list, tuple)) or len(item) < 3:
                continue
            box, text, confidence = item[0], item[1], item[2]
            text = str(text or "").strip()
            if not text:
                continue
            lines.append({
                "text": text,
                "confidence": float(confidence or 0.0),
                "bbox": _easyocr_bbox(box),
            })
        return OCRResponse(
            lines=lines,
            job_id="local-easyocr",
            latency_ms=int((time.monotonic() - started) * 1000),
            model=self.model,
            image_width=image_width,
            image_height=image_height,
        )


def _easyocr_bbox(box) -> list[float]:
    points = []
    for point in box or []:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            try:
                points.append((float(point[0]), float(point[1])))
            except (TypeError, ValueError):
                continue
    if not points:
        return []
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return [min(xs), min(ys), max(xs), max(ys)]

class OCRSpaceProvider:
    provider_name = "ocrspace"

    def __init__(self, *, max_retries=None):
        # Interactive callers pass 1 so a stalled OCR.space request cannot
        # burn the full retry budget while the resident waits.
        self.max_retries = max_retries

    def recognize(self, content: bytes, *, suffix: str, deskew: bool = True) -> OCRResponse:
        return ocr_bytes_with_metadata(content, suffix=suffix, deskew=deskew, max_retries=self.max_retries)


class FallbackOCRProvider:
    """Try hosted OCR.space first, then local EasyOCR for provider failures."""

    provider_name = "fallback"

    def __init__(
        self,
        *,
        primary: OCRProvider | None = None,
        fallback: OCRProvider | None = None,
        fallback_factory: Callable[[], OCRProvider] | None = None,
        caller: str = "ocr",
    ):
        self.primary = primary or OCRSpaceProvider()
        self._fallback = fallback
        self._fallback_factory = fallback_factory or (lambda: EasyOCRProvider(gpu=False))
        self.caller = caller

    @property
    def fallback(self) -> OCRProvider:
        if self._fallback is None:
            self._fallback = self._fallback_factory()
        return self._fallback

    def recognize(self, content: bytes, *, suffix: str, deskew: bool = True) -> OCRResponse:
        import sys
        try:
            response = self.primary.recognize(content, suffix=suffix, deskew=deskew)
            print(
                f"[OCR] {self.caller} used OCR.space (model={response.model}, {response.latency_ms} ms)",
                file=sys.stderr, flush=True,
            )
            return response
        except OCRProviderError as exc:
            print(
                f"[OCR] {self.caller} OCR.space failed ({exc}); falling back to EasyOCR",
                file=sys.stderr, flush=True,
            )
            response = self.fallback.recognize(content, suffix=suffix, deskew=deskew)
            print(
                f"[OCR] {self.caller} used EasyOCR fallback (model={response.model}, {response.latency_ms} ms)",
                file=sys.stderr, flush=True,
            )
            return response


def document_uses_field_regions(document_type) -> bool:
    """True when any enabled field has a drawn canvas region (needs geometry-stable OCR)."""
    if document_type is None:
        return False
    fields = getattr(document_type, "fields", None)
    if fields is None:
        return False
    try:
        iterator = fields.filter(enabled=True) if hasattr(fields, "filter") else fields
    except Exception:
        iterator = fields
    for field in iterator:
        if not getattr(field, "enabled", True):
            continue
        hints = field.extraction_hints if isinstance(getattr(field, "extraction_hints", None), dict) else {}
        region = hints.get("region") if isinstance(hints, dict) else None
        if isinstance(region, dict):
            try:
                if float(region.get("w") or 0) > 0 and float(region.get("h") or 0) > 0:
                    return True
            except (TypeError, ValueError):
                continue
    return False


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
    failure_action: str = "manual_review"
    template_match: dict | None = None


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
    """Parse common OCR / form date strings into a date.

    Handles formats like:
    - 2024-02-29, 2024/02/29
    - 02/29/2024, 2-29-24
    - FEBRUARY 29, 2024 / Feb 29 2024
    - 29 FEBRUARY 2024 / 29 Feb 2024
    - 29th February 2024
    """
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()

    text = str(value or "").strip()
    if not text:
        return None

    # Normalize OCR noise
    cleaned = text.upper()
    cleaned = cleaned.replace(".", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.replace(",", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # Strip ordinal suffixes: 1ST, 2ND, 3RD, 29TH
    cleaned = re.sub(r"\b(\d{1,2})(ST|ND|RD|TH)\b", r"\1", cleaned)

    candidates = [cleaned, cleaned.replace(" ", "")]
    # Also try original with only commas removed (preserve spaces for month names)
    candidates.append(re.sub(r",", "", text).strip())
    candidates.append(re.sub(r"\s+", " ", re.sub(r",", " ", text)).strip())

    formats = (
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%Y.%m.%d",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%m.%d.%Y",
        "%m/%d/%y",
        "%m-%d-%y",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d.%m.%Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%B %d %Y",
        "%b %d %Y",
        "%d %B %Y",
        "%d %b %Y",
        "%B%d%Y",
        "%b%d%Y",
        "%d%B%Y",
        "%d%b%Y",
        "%Y%m%d",
    )

    def _safe_date(year: int, month: int, day: int) -> date | None:
        """Build a date; clamp Feb 29 → Feb 28 on non-leap years (common OCR/ID quirk)."""
        try:
            return date(year, month, day)
        except ValueError:
            if month == 2 and day == 29:
                try:
                    return date(year, 2, 28)
                except ValueError:
                    return None
            return None

    def _try_strptime(variant: str, fmt: str) -> date | None:
        try:
            return datetime.strptime(variant, fmt).date()
        except ValueError:
            # Common ID OCR quirk: Feb 29 printed on a non-leap year → use Feb 28
            if re.search(r"(?i)FEB.*\b29\b|\b29\b.*FEB", variant) or (
                fmt.startswith("%Y") and re.search(r"-02-29|/02/29", variant)
            ):
                fixed = re.sub(r"\b29\b", "28", variant, count=1)
                try:
                    return datetime.strptime(fixed, fmt).date()
                except ValueError:
                    return None
            return None

    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.upper()
        if not key or key in seen:
            continue
        seen.add(key)
        variants = [candidate, candidate.title(), candidate.upper(), candidate.lower()]
        for variant in variants:
            for fmt in formats:
                parsed = _try_strptime(variant, fmt)
                if parsed:
                    return parsed

    # Regex fallback: MONTH DD YYYY / DD MONTH YYYY
    month_pat = (
        r"(?P<mon>JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|"
        r"JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)"
    )
    m = re.search(
        rf"(?i)\b{month_pat}\s+(?P<day>\d{{1,2}})(?:ST|ND|RD|TH)?,?\s+(?P<year>\d{{4}})\b",
        text,
    )
    if m:
        mon, day, year = m.group("mon"), int(m.group("day")), int(m.group("year"))
        for fmt in ("%B", "%b"):
            try:
                month = datetime.strptime(mon.title(), fmt).month
                parsed = _safe_date(year, month, day)
                if parsed:
                    return parsed
            except ValueError:
                continue
    m = re.search(
        rf"(?i)\b(?P<day>\d{{1,2}})(?:ST|ND|RD|TH)?\s+{month_pat},?\s+(?P<year>\d{{4}})\b",
        text,
    )
    if m:
        mon, day, year = m.group("mon"), int(m.group("day")), int(m.group("year"))
        for fmt in ("%B", "%b"):
            try:
                month = datetime.strptime(mon.title(), fmt).month
                parsed = _safe_date(year, month, day)
                if parsed:
                    return parsed
            except ValueError:
                continue

    # Numeric fallback: YYYY-MM-DD or M/D/YYYY or D/M/YYYY
    m = re.search(r"\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b", text)
    if m:
        parsed = _safe_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if parsed:
            return parsed
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", text)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if a > 12:
            parsed = _safe_date(y, b, a)
            if parsed:
                return parsed
        parsed = _safe_date(y, a, b)
        if parsed:
            return parsed
        parsed = _safe_date(y, b, a)
        if parsed:
            return parsed

    return None


def _normalize_bbox(bbox) -> list[float] | None:
    if not bbox:
        return None
    try:
        values = [float(item) for item in bbox]
    except (TypeError, ValueError):
        return None
    if len(values) >= 8:
        xs = values[0::2]
        ys = values[1::2]
        return [min(xs), min(ys), max(xs), max(ys)]
    if len(values) >= 4:
        return [min(values[0], values[2]), min(values[1], values[3]), max(values[0], values[2]), max(values[1], values[3])]
    return None


def _infer_page_size(bboxes: list[list[float]]) -> tuple[float, float]:
    """Infer page size from absolute pixel bboxes (providers usually return pixels)."""
    max_x = 1.0
    max_y = 1.0
    for box in bboxes:
        if not box or len(box) < 4:
            continue
        max_x = max(max_x, float(box[0]), float(box[2]))
        max_y = max(max_y, float(box[1]), float(box[3]))
    # If values already look normalized, keep unit square.
    if max_x <= 1.5 and max_y <= 1.5:
        return 1.0, 1.0
    # Pad slightly so edge boxes don't clamp to 1.0 incorrectly.
    return max_x * 1.02, max_y * 1.02


def _to_relative_bbox(bbox: list[float] | None, page_w: float, page_h: float) -> list[float] | None:
    if not bbox or len(bbox) < 4 or page_w <= 0 or page_h <= 0:
        return None
    x1, y1, x2, y2 = bbox[:4]
    return [
        max(0.0, min(1.0, x1 / page_w)),
        max(0.0, min(1.0, y1 / page_h)),
        max(0.0, min(1.0, x2 / page_w)),
        max(0.0, min(1.0, y2 / page_h)),
    ]


def _region_to_bbox(region: dict | None, *, inset: float = 0.0) -> list[float] | None:
    """Convert {x,y,w,h} region to [x1,y1,x2,y2]. Optional inset shrinks the box
    slightly so neighboring label text is less likely to leak in."""
    if not isinstance(region, dict):
        return None
    try:
        x = float(region.get("x", 0))
        y = float(region.get("y", 0))
        w = float(region.get("w", 0))
        h = float(region.get("h", 0))
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    if inset > 0 and w > inset * 2 and h > inset * 2:
        x += inset
        y += inset
        w -= inset * 2
        h -= inset * 2
    return [
        max(0.0, min(1.0, x)),
        max(0.0, min(1.0, y)),
        max(0.0, min(1.0, x + w)),
        max(0.0, min(1.0, y + h)),
    ]


def _bbox_center(bbox: list[float]) -> tuple[float, float]:
    return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)


def _bbox_overlap_ratio(inner: list[float], outer: list[float]) -> float:
    """Fraction of `inner` area that overlaps `outer`."""
    ix1 = max(inner[0], outer[0])
    iy1 = max(inner[1], outer[1])
    ix2 = min(inner[2], outer[2])
    iy2 = min(inner[3], outer[3])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area = max(1e-9, (inner[2] - inner[0]) * (inner[3] - inner[1]))
    return inter / area


def _center_in_bbox(point: tuple[float, float], bbox: list[float], pad: float = 0.01) -> bool:
    x, y = point
    return (bbox[0] - pad) <= x <= (bbox[2] + pad) and (bbox[1] - pad) <= y <= (bbox[3] + pad)


def _line_values(lines, page_size: tuple[float, float] | None = None) -> list[dict]:
    raw = []
    for line in lines or []:
        text = str(line.get("text") or "").strip()
        if not text:
            continue
        try:
            confidence = max(0.0, min(1.0, float(line.get("confidence") or 0)))
        except (TypeError, ValueError):
            confidence = 0.0
        raw.append(
            {
                "text": text,
                "normalized": normalized_text(text),
                "confidence": confidence,
                "bbox_abs": _normalize_bbox(line.get("bbox")),
            }
        )
    # Prefer real image pixel size so relative boxes match Mark Areas canvas (0–1 of full photo).
    if page_size and page_size[0] > 1.5 and page_size[1] > 1.5:
        page_w, page_h = float(page_size[0]), float(page_size[1])
    else:
        page_w, page_h = _infer_page_size([item["bbox_abs"] for item in raw if item.get("bbox_abs")])
    clean = []
    for item in raw:
        rel = _to_relative_bbox(item.get("bbox_abs"), page_w, page_h)
        clean.append(
            {
                "text": item["text"],
                "normalized": item["normalized"],
                "confidence": item["confidence"],
                "bbox": rel,
                "bbox_abs": item.get("bbox_abs"),
            }
        )
    return clean


SAFE_REGEX_MAX = 120
_UNSAFE_REGEX = re.compile(r"\(\?|[\*\+]{2}|\{\d{3,}")


def is_safe_regex(pattern: str) -> bool:
    if not pattern or len(pattern) > SAFE_REGEX_MAX:
        return False
    if _UNSAFE_REGEX.search(pattern):
        return False
    try:
        re.compile(pattern)
    except re.error:
        return False
    return True


def _apply_field_post_process(value: str, field) -> str:
    hints = field.extraction_hints if isinstance(field.extraction_hints, dict) else {}
    result = value or ""
    if hints.get("remove_special_chars"):
        result = re.sub(r"[^A-Za-z0-9\s./'-]", "", result)
    case_mode = str(hints.get("case_normalization") or field.normalization or "none").lower()
    if case_mode in {"uppercase", "upper"}:
        result = result.upper()
    elif case_mode in {"lowercase", "lower"}:
        result = result.lower()
    elif case_mode in {"name", "title"}:
        result = " ".join(part.capitalize() for part in result.split())
    if hints.get("auto_correct"):
        result = re.sub(r"\s+", " ", result).strip()
    return result.strip()


def evaluate_template_match(document_type, lines, overall_confidence: float) -> dict:
    """Score whether OCR output matches the document template expectations."""
    all_text = " ".join(str(item.get("text") or "") for item in lines or [])
    normalized = normalized_text(all_text)
    checks = []

    keywords = list(document_type.keywords or [])
    if keywords:
        # Whitespace-insensitive containment: "BONAFIDE RESIDENT" must satisfy
        # the "bona fide resident" keyword (and vice versa).
        compacted_text = normalized.replace(" ", "")
        missing = [kw for kw in keywords if normalized_text(kw).replace(" ", "") not in compacted_text]
        passed = not missing
        checks.append(
            {
                "key": "required_keywords",
                "label": "Required Keywords",
                "passed": passed,
                "detail": "All keywords found." if passed else f"Missing: {', '.join(missing)}",
            }
        )

    expected_title = (getattr(document_type, "expected_title", None) or "").strip()
    if expected_title:
        score = similarity(expected_title, all_text[:200])
        # Also accept when title tokens appear in document text.
        title_tokens = [token for token in normalized_text(expected_title).split() if len(token) > 2]
        token_hit = all(token in normalized for token in title_tokens) if title_tokens else False
        passed = score >= 0.45 or token_hit
        checks.append(
            {
                "key": "expected_title",
                "label": "Expected Document Title",
                "passed": passed,
                "detail": expected_title if passed else f"Expected “{expected_title}” was not detected.",
            }
        )

    min_conf = float(getattr(document_type, "min_ocr_confidence", None) or 0.9)
    conf_passed = overall_confidence >= min_conf
    checks.append(
        {
            "key": "minimum_confidence",
            "label": "Minimum OCR Confidence",
            "passed": conf_passed,
            "detail": f"{round(overall_confidence * 100)}% vs required {round(min_conf * 100)}%",
        }
    )

    passed = all(item["passed"] for item in checks) if checks else True
    score = round(sum(1 for item in checks if item["passed"]) / max(1, len(checks)), 4)
    return {"passed": passed, "score": score, "checks": checks}


def _profile_value(field, profile, profile_key: str | None = None) -> str:
    """Resolve the resident profile value to compare against OCR text.

    `profile_key` comes from rule.value.profile when set (first_name, last_name, …).
    Without it, the key is inferred from the field code/label.
    """
    if profile is None:
        return ""
    key = (profile_key or "").strip().lower()
    if not key and field is not None:
        code = (field.code or "").lower()
        label = (getattr(field, "label", None) or "").lower()
        if code in {"first_name", "firstname"} or label in {"first name", "given name"}:
            key = "first_name"
        elif code in {"middle_name", "middlename"} or label in {"middle name"}:
            key = "middle_name"
        elif code in {"last_name", "lastname", "surname"} or label in {"last name", "surname", "family name"}:
            key = "last_name"
        elif code in {"full_name", "resident_name", "account_name", "name"} or (
            "name" in code or "name" in label
        ):
            if "place" not in code and "place" not in label:
                key = "name"
        elif "address" in code or "address" in label:
            key = "address"
        elif code in {"date_of_birth", "birth_date", "dob", "birthdate"} or (
            "birth" in code and "place" not in code
        ):
            key = "date_of_birth"
        elif code in {"gender", "sex"} or label in {"gender", "sex"}:
            key = "gender"

    if key in {"first_name", "firstname"}:
        return str(getattr(profile, "first_name", "") or "")
    if key in {"middle_name", "middlename"}:
        return str(getattr(profile, "middle_name", "") or "")
    if key in {"last_name", "lastname", "surname"}:
        return str(getattr(profile, "last_name", "") or "")
    if key in {"name", "full_name"}:
        return " ".join(
            part for part in (
                getattr(profile, "first_name", None),
                getattr(profile, "middle_name", None),
                getattr(profile, "last_name", None),
            ) if part
        )
    if key == "address":
        return str(getattr(profile, "address", "") or "")
    if key in {"date_of_birth", "birth_date", "dob"}:
        dob = getattr(profile, "date_of_birth", None)
        if isinstance(dob, str):
            dob = parse_date(dob)
        return dob.isoformat() if dob else ""
    if key in {"gender", "sex"}:
        return str(getattr(profile, "gender", "") or "")
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


def _looks_like_label(text: str, aliases: list[str] | None = None) -> bool:
    """Reject OCR snippets that are field labels rather than values."""
    normalized = normalized_text(text)
    if not normalized:
        return True
    alias_set = {normalized_text(alias) for alias in (aliases or []) if alias}
    if normalized in alias_set:
        return True
    # Common ID form labels (EN + Filipino PhilSys / government IDs)
    label_phrases = {
        "LAST NAME FIRST NAME MIDDLE NAME",
        "LAST FIRST NAME MIDDLE NAME",
        "GIVEN NAME MIDDLE NAME LAST NAME",
        "GIVEN NAME MIDDLE NAME",
        "GIVEN NAME",
        "MIDDLE NAME",
        "LAST NAME",
        "FIRST NAME",
        "NAME",
        "FULL NAME",
        "ADDRESS",
        "BIRTHDATE",
        "DATE OF BIRTH",
        "PLACE OF BIRTH",
        "KAPANGANAKAN",
        "PETSA NG KAPANGANAKAN",
        "PETSANG KAPANGANAKAN",
        "PETSANG",
        "GENDER",
        "SEX",
        "KASARIAN",
        "KASARIAN SEX",
        "CIVIL STATUS",
        "DATE ISSUED",
        "VALID UNTIL",
        "EXPIRY DATE",
        "ID NO",
        "ID NUMBER",
        "DOCUMENT NUMBER",
        "DIGITAL NUMBER",
        "PCN",
        "PHILSYS",
        "PHILIPPINE IDENTIFICATION CARD",
        "PHILIPPINE IDENTIFICATION",
        "REPUBLIC OF THE PHILIPPINES",
        "BONAFIDE RESIDENT",
        "MARITAL STATUS",
        "BLOOD TYPE",
        "URI NG DUGO",
    }
    if normalized in label_phrases:
        return True
    # Substring / multi-label header lines (e.g. "Given name, Middle Name, Last Name")
    label_tokens = {
        "GIVEN NAME",
        "MIDDLE NAME",
        "LAST NAME",
        "FIRST NAME",
        "KASARIAN",
        "KAPANGANAKAN",
        "PETSA NG KAPANGANAKAN",
        "PETSANG KAPANGANAKAN",
        "PETSANG",
        "PHILIPPINE IDENTIFICATION",
        "REPUBLIC OF THE PHILIPPINES",
        "BLOOD TYPE",
        "CIVIL STATUS",
        "DATE OF BIRTH",
        "PLACE OF BIRTH",
    }
    label_hits = sum(1 for token in label_tokens if token in normalized)
    if label_hits >= 2 and not re.search(r"\d", normalized):
        return True
    if any(normalized == token or normalized.startswith(token + " ") for token in label_tokens):
        if not re.search(r"\d", normalized) and len(normalized.split()) <= 6:
            return True
    # Short all-caps words that end with label punctuation
    stripped = text.strip(" :.-")
    if stripped.isupper() and len(stripped.split()) <= 4 and not re.search(r"\d", stripped):
        if any(
            token in normalized
            for token in ("NAME", "ADDRESS", "GENDER", "STATUS", "BIRTH", "ISSUED", "VALID", "SEX", "KASARIAN")
        ):
            return True
    return False


def _candidate_after_alias(lines, aliases):
    best = None
    alias_list = [alias for alias in aliases if alias]
    for index, line in enumerate(lines):
        for alias in alias_list:
            alias_normalized = normalized_text(alias)
            if not alias_normalized or alias_normalized not in line["normalized"]:
                continue
            raw = re.sub(re.escape(str(alias)), "", line["text"], count=1, flags=re.IGNORECASE)
            raw = raw.lstrip(" :-#.").strip()
            candidates = []
            if raw and not _looks_like_label(raw, alias_list):
                candidates.append((raw, line["confidence"], index, line.get("bbox"), 0.9))
            # Prefer next line(s) under the label (common on PH IDs)
            for offset in (1, 2):
                if index + offset >= len(lines):
                    break
                nxt = lines[index + offset]
                if _looks_like_label(nxt["text"], alias_list):
                    continue
                # Same-column preference: next line should not jump too far left/right
                score_boost = 0.85 - (offset - 1) * 0.1
                if line.get("bbox") and nxt.get("bbox"):
                    lx = (line["bbox"][0] + line["bbox"][2]) / 2
                    nx = (nxt["bbox"][0] + nxt["bbox"][2]) / 2
                    if abs(lx - nx) < 0.25:
                        score_boost += 0.1
                    # Prefer values below the label
                    if nxt["bbox"][1] >= line["bbox"][1] - 0.02:
                        score_boost += 0.05
                candidates.append((nxt["text"], nxt["confidence"] * score_boost, index + offset, nxt.get("bbox"), score_boost))
            for candidate in candidates:
                rank = (candidate[4], candidate[1])
                if best is None or rank > (best[4], best[1]):
                    best = candidate
    if best:
        return best[0], min(1.0, float(best[1])), {"source_line": best[2], "bbox": best[3], "method": "alias"}
    return "", 0.0, {}


def _intersection_bbox(a: list[float], b: list[float]) -> list[float] | None:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    if x2 <= x1 or y2 <= y1:
        return None
    return [x1, y1, x2, y2]


def _clip_text_to_region(text: str, line_bbox: list[float], region_bbox: list[float]) -> str:
    """Keep only the tokens whose estimated position falls inside the drawn region.

    OCR often returns one wide line like "ID NO. MH2024-5148". When the official
    draws a box only over the number, we keep tokens whose midpoints lie inside
    the box (using proportional x mapping along the line bbox).
    """
    raw = (text or "").strip()
    if not raw or not line_bbox or not region_bbox:
        return ""

    inter = _intersection_bbox(line_bbox, region_bbox)
    if not inter:
        return ""

    line_w = max(1e-9, line_bbox[2] - line_bbox[0])
    line_h = max(1e-9, line_bbox[3] - line_bbox[1])
    inter_w = inter[2] - inter[0]
    inter_h = inter[3] - inter[1]

    # Reject snippets that barely graze the box.
    if (inter_w / line_w) < 0.10 and (inter_h / line_h) < 0.30:
        return ""

    # Fully contained line — keep whole text.
    fully_inside = (
        line_bbox[0] >= region_bbox[0] - 0.008
        and line_bbox[2] <= region_bbox[2] + 0.008
        and line_bbox[1] >= region_bbox[1] - 0.012
        and line_bbox[3] <= region_bbox[3] + 0.012
    )
    if fully_inside:
        return raw

    n = max(1, len(raw))
    kept: list[str] = []
    # Tokenize keeping punctuation attached (MH2024-5148, NO.)
    for match in re.finditer(r"\S+", raw):
        token = match.group(0)
        # Midpoint of token along the line, mapped to x in page coords.
        mid = (match.start() + match.end()) / 2.0 / n
        token_x = line_bbox[0] + mid * line_w
        token_y = (line_bbox[1] + line_bbox[3]) / 2.0
        # Require the token center to sit inside (or barely on the edge of) the box.
        if (
            region_bbox[0] - 0.012 <= token_x <= region_bbox[2] + 0.012
            and region_bbox[1] - 0.02 <= token_y <= region_bbox[3] + 0.02
        ):
            kept.append(token.strip(" \t:-#|"))

    clipped = " ".join(part for part in kept if part).strip(" \t:-#.|")

    # Drop pure label tokens that still snuck in at the edge of the box.
    label_tokens = {
        "ID", "NO", "NO.", "NUMBER", "DOC", "DOCUMENT", "NAME", "ADDRESS",
        "GENDER", "SEX", "STATUS", "CIVIL", "BIRTHDATE", "BIRTH", "DATE",
        "ISSUED", "VALID", "UNTIL", "PLACE", "OF",
    }
    filtered = [
        token
        for token in clipped.split()
        if token.upper().strip(".") not in label_tokens and not _looks_like_label(token, [])
    ]
    if filtered:
        clipped = " ".join(filtered)

    # Identifier-aware rescue: if the line is "ID NO. XXX" and the box is on the
    # right side, return only the identifier even when token midpoints are fuzzy.
    if not clipped or _looks_like_label(clipped, []):
        id_match = re.search(
            r"(?i)(?:ID\s*NO\.?|ID\s*NUMBER|DOC(?:UMENT)?\s*NO\.?)\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/]*)",
            raw,
        )
        start_frac = max(0.0, (inter[0] - line_bbox[0]) / line_w)
        if id_match and start_frac >= 0.22:
            clipped = id_match.group(1)

    return clipped.strip(" \t:-#.|")


def _expected_matcher(hints) -> callable | None:
    """Build a matcher that recognizes the expected VALUE of a configured field.

    Fields that declare regex_pattern / expected_keywords have a "ground truth"
    value. A snippet that matches this expected value must never be rejected as a
    label (e.g. id_type expects "Philippine Identification Card" — exactly the
    string that _looks_like_label otherwise treats as a card header).

    The returned callable has a `.strong(text)` helper that reports whether the
    expected text essentially IS the line (high coverage), used so multi-line
    fields whose regex is only a partial keyword (e.g. address "MARIKINA
    HEIGHTS") keep their full value instead of being truncated.
    """
    hints = hints if isinstance(hints, dict) else {}
    patterns: list[re.Pattern] = []
    regex = str(hints.get("regex_pattern") or "").strip()
    if regex and _is_usable_field_regex(regex):
        try:
            patterns.append(re.compile(regex, re.IGNORECASE))
        except re.error:
            patterns = []
    keywords = [str(k or "").strip() for k in (hints.get("expected_keywords") or []) if str(k or "").strip()]
    if not patterns and not keywords:
        return None

    def matches(text) -> bool:
        raw = str(text or "").strip()
        if not raw:
            return False
        if any(pattern.search(raw) for pattern in patterns):
            return True
        if keywords:
            norm = normalized_text(raw)
            if any(normalized_text(kw) in norm for kw in keywords):
                return True
        return False

    def strong(text) -> bool:
        raw = str(text or "").strip()
        if not raw:
            return False
        text_norm = normalized_text(raw)
        span = 0
        for pattern in patterns:
            match = pattern.search(raw)
            if match:
                span = max(span, match.end() - match.start())
        for kw in keywords:
            kw_norm = normalized_text(kw)
            if kw_norm and kw_norm in text_norm:
                span = max(span, len(kw_norm))
        return bool(span) and (span / max(1, len(text_norm))) >= 0.6

    matches.strong = strong
    return matches


def _candidate_from_region(
    lines,
    region: dict | None,
    aliases: list[str],
    multi_line: bool = False,
    expected: callable | None = None,
    join_dates: bool = False,
):
    """Extract only text that intersects the drawn template region (relative 0–1)."""
    # Bounding region with a slight inset reduces label bleed from neighbors
    # section of code uses the original region coordinates.
    region_bbox = _region_to_bbox(region, inset=0.008)
    if not region_bbox:
        return "", 0.0, {}

    hits = []
    for index, line in enumerate(lines):
        bbox = line.get("bbox")
        if not bbox or len(bbox) < 4:
            continue

        inter = _intersection_bbox(bbox, region_bbox)
        if not inter:
            continue

        line_area = max(1e-9, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
        inter_area = max(0.0, (inter[2] - inter[0]) * (inter[3] - inter[1]))
        line_overlap = inter_area / line_area  # how much of the OCR line is inside the box
        region_area = max(1e-9, (region_bbox[2] - region_bbox[0]) * (region_bbox[3] - region_bbox[1]))
        region_coverage = inter_area / region_area  # how much of the box this line fills
        center = _bbox_center(bbox)
        center_hit = _center_in_bbox(center, region_bbox, pad=0.004)
        inter_center = _bbox_center(inter)
        inter_center_hit = _center_in_bbox(inter_center, region_bbox, pad=0.002)

        # Stricter gate: prefer lines whose center sits in the box.
        if not inter_center_hit:
            continue
        if not center_hit and line_overlap < 0.40 and region_coverage < 0.18:
            continue

        clipped = _clip_text_to_region(line["text"], bbox, region_bbox)
        if not clipped:
            continue
        matches_expected = bool(expected and expected(clipped))
        if _looks_like_label(clipped, aliases) and not matches_expected:
            continue

        # Distance of line center from region center — prefer centered content.
        region_center = _bbox_center(region_bbox)
        dist = ((center[0] - region_center[0]) ** 2 + (center[1] - region_center[1]) ** 2) ** 0.5
        center_score = max(0.0, 1.0 - dist * 4.0)

        # Score prefers text whose geometry is centered in the box and highly overlapping.
        score = (
            line_overlap * 0.35
            + region_coverage * 0.15
            + center_score * 0.30
            + (0.12 if center_hit else 0.0)
            + line["confidence"] * 0.08
        )
        hits.append(
            {
                "index": index,
                "text": clipped,
                "confidence": line["confidence"],
                "bbox": inter,  # report the in-box intersection, not the full OCR line
                "y": inter[1],
                "x": inter[0],
                "score": score,
                "line_overlap": line_overlap,
                "expected": matches_expected,
            }
        )

    if not hits:
        # Retry once with a slightly looser region (no inset) if the tight box missed.
        loose = _region_to_bbox(region, inset=0.0)
        if loose and loose != region_bbox:
            return _candidate_from_region_loose(
                lines, loose, aliases, multi_line=multi_line, expected=expected, join_dates=join_dates
            )
        return "", 0.0, {"method": "region", "region": region_bbox, "hits": 0, "strict": True}

    hits.sort(key=lambda item: (item["y"], item["x"]))
    if multi_line:
        # Keep pure-label fragments that match the field's expected value, otherwise
        # drop label fragments before joining.
        value_hits = [
            item for item in hits
            if not _looks_like_label(item["text"], aliases) or item.get("expected")
        ]
        # Lines that ARE the expected value (high coverage) win — they replace any
        # partial/label fragments instead of merely being appended.
        strong = getattr(expected, "strong", None) if expected else None
        strong_hits = [item for item in value_hits if strong and strong(item["text"])] if strong else []
        use_hits = strong_hits or value_hits or hits
        text = " ".join(item["text"] for item in use_hits).strip()
        if _looks_like_label(text, aliases) and not expected:
            return "", 0.0, {"method": "region", "region": region_bbox, "hits": len(hits), "rejected": "label"}
        conf = fmean(item["confidence"] for item in use_hits)
        bbox = [
            min(item["bbox"][0] for item in use_hits),
            min(item["bbox"][1] for item in use_hits),
            max(item["bbox"][2] for item in use_hits),
            max(item["bbox"][3] for item in use_hits),
        ]
        return text, conf, {"method": "region", "region": region_bbox, "hits": len(use_hits), "bbox": bbox, "strict": True}

    if join_dates and len(hits) > 1:
        # OCR.space often splits "JULY 24, 2004" into separate lines ("JULY 24," + "2004").
        ordered = sorted(hits, key=lambda item: (item["y"], item["x"]))
        joined_text = " ".join(item["text"] for item in ordered).strip()
        if parse_date(joined_text):
            conf = fmean(item["confidence"] for item in ordered)
            joined_bbox = [
                min(item["bbox"][0] for item in ordered),
                min(item["bbox"][1] for item in ordered),
                max(item["bbox"][2] for item in ordered),
                max(item["bbox"][3] for item in ordered),
            ]
            return (
                joined_text,
                conf,
                {
                    "method": "region",
                    "region": region_bbox,
                    "hits": len(ordered),
                    "bbox": joined_bbox,
                    "source_line": ordered[-1]["index"],
                    "joined_date_fragments": True,
                },
            )

    expected_hits = [item for item in hits if item.get("expected")]
    best = max(expected_hits or hits, key=lambda item: item["score"])
    return (
        best["text"],
        best["confidence"],
        {
            "method": "region",
            "region": region_bbox,
            "hits": len(hits),
            "bbox": best["bbox"],
            "source_line": best["index"],
            "strict": True,
            "line_overlap": best.get("line_overlap"),
        },
    )


def _candidate_from_region_loose(
    lines,
    region_bbox: list[float],
    aliases: list[str],
    multi_line: bool = False,
    expected: callable | None = None,
    join_dates: bool = False,
):
    """Fallback region extract without inset — still rejects labels except expected value."""
    hits = []
    for index, line in enumerate(lines):
        bbox = line.get("bbox")
        if not bbox or len(bbox) < 4:
            continue
        inter = _intersection_bbox(bbox, region_bbox)
        if not inter:
            continue
        line_area = max(1e-9, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
        inter_area = max(0.0, (inter[2] - inter[0]) * (inter[3] - inter[1]))
        line_overlap = inter_area / line_area
        if line_overlap < 0.2:
            continue
        center = _bbox_center(bbox)
        if not _center_in_bbox(center, region_bbox, pad=0.02) and line_overlap < 0.45:
            continue
        clipped = _clip_text_to_region(line["text"], bbox, region_bbox)
        matches_expected = bool(expected and expected(clipped))
        if not clipped or (_looks_like_label(clipped, aliases) and not matches_expected):
            continue
        hits.append(
            {
                "index": index,
                "text": clipped,
                "confidence": line["confidence"],
                "bbox": inter,
                "y": inter[1],
                "x": inter[0],
                "score": line_overlap + line["confidence"] * 0.1,
                "expected": matches_expected,
            }
        )
    if not hits:
        return "", 0.0, {"method": "region", "region": region_bbox, "hits": 0, "strict": False}
    if multi_line:
        value_hits = [
            item for item in hits
            if not _looks_like_label(item["text"], aliases) or item.get("expected")
        ]
        strong = getattr(expected, "strong", None) if expected else None
        strong_hits = [item for item in value_hits if strong and strong(item["text"])] if strong else []
        use_hits = strong_hits or value_hits or hits
        text = " ".join(item["text"] for item in sorted(use_hits, key=lambda i: (i["y"], i["x"]))).strip()
        if _looks_like_label(text, aliases) and not expected:
            return "", 0.0, {"method": "region", "rejected": "label"}
        conf = fmean(item["confidence"] for item in use_hits)
        return text, conf, {"method": "region", "hits": len(use_hits), "strict": False}
    if join_dates and len(hits) > 1:
        ordered = sorted(hits, key=lambda item: (item["y"], item["x"]))
        joined_text = " ".join(item["text"] for item in ordered).strip()
        if parse_date(joined_text):
            conf = fmean(item["confidence"] for item in ordered)
            joined_bbox = [
                min(item["bbox"][0] for item in ordered),
                min(item["bbox"][1] for item in ordered),
                max(item["bbox"][2] for item in ordered),
                max(item["bbox"][3] for item in ordered),
            ]
            return (
                joined_text,
                conf,
                {
                    "method": "region",
                    "bbox": joined_bbox,
                    "source_line": ordered[-1]["index"],
                    "joined_date_fragments": True,
                    "strict": False,
                },
            )
    expected_hits = [item for item in hits if item.get("expected")]
    best = max(expected_hits or hits, key=lambda item: item["score"])
    return best["text"], best["confidence"], {
        "method": "region",
        "bbox": best["bbox"],
        "source_line": best["index"],
        "strict": False,
    }


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


# Document / ID numbers on PH cards (e.g. MH2024-5148, BRGY-2025-00128, MH 2025-10296)
# Allow optional spaces around letter/digit runs and hyphens (common OCR noise).
ID_NUMBER_TOKEN = re.compile(
    r"\b(?=[A-Z0-9\-\s]*\d)(?=[A-Z0-9\-\s]*[A-Z])"
    r"[A-Z]{1,6}\s*\d{2,}(?:\s*-\s*[A-Z0-9]+)*\b",
    re.IGNORECASE,
)
ID_LABELED_VALUE = re.compile(
    r"(?i)(?:ID\s*NO\.?|ID\s*NUMBER|IDENTIFICATION\s*NO\.?|DOC(?:UMENT)?\s*(?:NO\.?|NUMBER))\s*[:.\-]?\s*"
    r"([A-Z0-9][A-Z0-9\-/ ]{3,})",
)
DATE_FRAGMENT = re.compile(
    r"(?i)^(?:"
    r"\d{1,2}[,/]\s*\d{2,4}$|"
    r"\d{1,2}\s+\d{4}$|"
    r"(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|"
    r"JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)"
    r"(?:\s+\d{1,2})?(?:,?\s*\d{2,4})?$"
    r")$"
)


def _looks_like_date_fragment(value: str) -> bool:
    text = (value or "").strip().rstrip(",.")
    if not text:
        return False
    if parse_date(text):
        return True
    if DATE_FRAGMENT.match(text):
        return True
    # "29, 2004" / "24, 2004" style OCR slices from full dates
    if re.fullmatch(r"\d{1,2},\s*\d{4}", text):
        return True
    if DATE_PATTERN.fullmatch(text):
        return True
    return False


def _is_identifier_field(field) -> bool:
    """Heuristic from field code/label only — no UI data-type dependency."""
    code = (field.code or "").lower()
    label = (getattr(field, "label", None) or "").lower()
    blob = f"{code} {label}"
    return any(
        token in blob
        for token in (
            "document_number",
            "id_number",
            "id_no",
            "identification",
            "id number",
            "document number",
            "id no",
        )
    )


def _is_date_field(field) -> bool:
    """Heuristic from field code/label only — used to join split date fragments."""
    code = str(getattr(field, "code", "") or "").lower()
    label = str(getattr(field, "label", "") or "").lower()
    blob = f"{code} {label}"
    if any(
        token in blob
        for token in (
            "birth",
            "dob",
            "issued",
            "issue date",
            "date of issue",
            "expir",
            "valid until",
            "valid thru",
        )
    ):
        return True
    data_type = str(getattr(field, "data_type", "") or "").lower()
    return data_type == "date" or data_type.startswith("date")


def _enlarge_region(region: dict, scale: float = 1.2) -> dict:
    """Scale a relative (0–1) region around its center — alignment tolerance only."""
    if not isinstance(region, dict):
        return dict(region or {})
    try:
        x = float(region.get("x") or 0.0)
        y = float(region.get("y") or 0.0)
        w = float(region.get("w") or region.get("width") or 0.0)
        h = float(region.get("h") or region.get("height") or 0.0)
    except (TypeError, ValueError):
        return dict(region)
    cx, cy = x + w / 2.0, y + h / 2.0
    nw = min(1.0, max(0.0, w * scale))
    nh = min(1.0, max(0.0, h * scale))
    out = {
        "x": max(0.0, cx - nw / 2.0),
        "y": max(0.0, cy - nh / 2.0),
        "w": nw,
        "h": nh,
    }
    if "width" in region:
        out["width"] = nw
    if "height" in region:
        out["height"] = nh
    return out


def _complete_date_fragment(clean_lines, value, region: dict | None = None, evidence: dict | None = None):
    """Join a date fragment ("JULY 24," or "2004") with a neighboring fragment that completes it.

    Only lines inside the drawn region (or near the evidence bbox) are considered —
    a split date must never be completed from text elsewhere on the card.
    """
    candidate = str(value or "").strip()
    if not candidate or parse_date(candidate):
        return None
    box = None
    if region:
        box = _region_to_bbox(_enlarge_region(region, 1.2), inset=0.0)
    else:
        ev_bbox = (evidence or {}).get("bbox") if isinstance(evidence, dict) else None
        if isinstance(ev_bbox, (list, tuple)) and len(ev_bbox) == 4:
            x0, y0, x1, y1 = (float(v) for v in ev_bbox)
            pad_y = max(0.01, (y1 - y0) * 1.0)
            box = [x0, max(0.0, y0 - pad_y), x1, y1 + pad_y]
    fragments = [candidate]
    for line in clean_lines:
        text = str(line.get("text") or "").strip()
        if not text or normalized_text(text) == normalized_text(candidate):
            continue
        line_bbox = line.get("bbox")
        if box and (not isinstance(line_bbox, (list, tuple)) or not _intersection_bbox(line_bbox, box)):
            continue
        if _looks_like_date_fragment(text) or re.fullmatch(r"\d{2,4}", text) or normalized_text(candidate) in normalized_text(text):
            fragments.append(text)
    for left in fragments:
        for right in fragments:
            if left is right:
                continue
            joined = f"{left} {right}".replace(", ,", ",").replace("  ", " ")
            if parse_date(joined):
                return joined
    return None


def _normalize_id_number_token(value: str) -> str:
    """Collapse OCR spaces around letters/digits/hyphens: 'MH 2025 - 10296' → 'MH2025-10296'."""
    text = (value or "").strip().upper()
    if not text:
        return ""
    text = re.sub(r"\s*-\s*", "-", text)
    text = re.sub(r"\s+", "", text)
    return text


def _extract_id_number_from_text(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    labeled = ID_LABELED_VALUE.search(raw)
    if labeled:
        normalized = _normalize_id_number_token(labeled.group(1))
        if normalized and not _looks_like_date_fragment(normalized):
            return normalized
    token = ID_NUMBER_TOKEN.search(raw)
    if token:
        normalized = _normalize_id_number_token(token.group(0))
        if normalized and not _looks_like_date_fragment(normalized):
            return normalized
    # Last resort: strip spaces and retry (handles "MH 2025-10296" fully)
    compact = _normalize_id_number_token(raw)
    if compact and ID_NUMBER_TOKEN.search(compact):
        found = ID_NUMBER_TOKEN.search(compact)
        if found:
            return _normalize_id_number_token(found.group(0))
    return ""


def _is_usable_field_regex(pattern: str) -> bool:
    """A pattern the official configured is always enforced when it compiles safely.

    Patterns like a bare "2026" are intentional (e.g. "document number must contain
    2026"), so they must NOT be silently skipped — an official who set the pattern
    expects a mismatch to be flagged.
    """
    text = (pattern or "").strip()
    return bool(text) and is_safe_regex(text)


def _find_id_number_near_region(lines, region: dict | None = None, confine: bool = False):
    """Find the best ID-number candidate, optionally nearest to a drawn region.

    confine=True limits the search to lines that intersect the region bbox — used
    when a template box is drawn, so a blank box never pulls an ID from elsewhere.
    """
    region_bbox = _region_to_bbox(region)
    region_center = _bbox_center(region_bbox) if region_bbox else None
    best = None  # (score, value, confidence, bbox, index)

    for index, line in enumerate(lines or []):
        bbox = line.get("bbox")
        if confine and (not bbox or len(bbox) < 4 or not _intersection_bbox(bbox, region_bbox)):
            continue
        value = _extract_id_number_from_text(line.get("text") or "")
        if not value or _looks_like_date_fragment(value):
            continue
        conf = float(line.get("confidence") or 0)
        bbox = line.get("bbox")
        score = conf
        if region_center and bbox and len(bbox) >= 4:
            cx, cy = _bbox_center(bbox)
            dist = ((cx - region_center[0]) ** 2 + (cy - region_center[1]) ** 2) ** 0.5
            # Prefer closer geometry; still allow global best if region is far.
            score += max(0.0, 1.0 - dist) * 0.8
            if _intersection_bbox(bbox, region_bbox):
                score += 0.5
        elif not region_center:
            score += 0.1
        if "ID" in (line.get("text") or "").upper() and "NO" in (line.get("text") or "").upper():
            score += 0.25
        if best is None or score > best[0]:
            best = (score, value, conf, bbox, index)

    if not best:
        return "", 0.0, {}
    return (
        best[1],
        best[2],
        {"method": "id_pattern", "bbox": best[3], "source_line": best[4], "score": best[0]},
    )


def field_side(field) -> str:
    """Return which sample side a field belongs to: front | back | single."""
    hints = field.extraction_hints if isinstance(getattr(field, "extraction_hints", None), dict) else {}
    hint_side = str(hints.get("side") or "").strip().lower()
    if hint_side in {"front", "back", "single"}:
        return hint_side
    sides = [str(s).strip().lower() for s in (getattr(field, "sides", None) or []) if str(s).strip()]
    if "back" in sides and "front" not in sides and "single" not in sides:
        return "back"
    if "single" in sides and "front" not in sides and "back" not in sides:
        return "single"
    if "front" in sides:
        return "front"
    # Legacy fields without side metadata default to front.
    return "front"


def field_matches_side(field, side: str | None) -> bool:
    """Whether this field should be extracted from a photo of the given side.

    - side None / "" / "all": all fields (legacy single-pass)
    - side "single": one-photo document — all fields apply
    - side "front": only front (and single) fields
    - side "back": only back fields
    """
    if side is None:
        return True
    requested = str(side).strip().lower()
    if not requested or requested in {"all", "any"}:
        return True
    if requested == "single":
        return True
    actual = field_side(field)
    if requested == "front":
        return actual in {"front", "single"}
    if requested == "back":
        return actual == "back"
    return True


def extract_fields(
    document_type,
    lines,
    profile,
    *,
    side: str | None = None,
    page_size: tuple[float, float] | None = None,
) -> dict:
    clean_lines = _line_values(lines, page_size=page_size)
    all_text = " ".join(item["text"] for item in clean_lines)
    date_matches = [match.group(0) for match in DATE_PATTERN.finditer(all_text)]
    extracted = {}
    used_line_indexes: set[int] = set()

    fields = list(document_type.fields.filter(enabled=True).order_by("display_order", "id"))
    # Only read fields that belong to this photo side (front vs back).
    fields = [field for field in fields if field_matches_side(field, side)]

    for field in fields:
        aliases = [field.label, field.code.replace("_", " "), *(field.aliases or [])]
        hints = field.extraction_hints if isinstance(field.extraction_hints, dict) else {}
        aliases.extend(value for value in hints.get("labels", []) if isinstance(value, str))
        aliases.extend(value for value in hints.get("expected_keywords", []) if isinstance(value, str))
        # Expand common synonyms so alias fallback still works when regions miss.
        code = field.code.lower()
        if code in {"first_name", "firstname", "given_name", "given_names"}:
            # PhilSys National ID uses "Given Names", not "First Name".
            aliases.extend(
                [
                    "given name",
                    "given names",
                    "first name",
                    "pangalan",
                    "mga pangalan",
                ]
            )
        elif code in {"last_name", "lastname", "surname", "family_name"}:
            aliases.extend(
                [
                    "last name",
                    "surname",
                    "family name",
                    "apelyido",
                ]
            )
        elif code in {"middle_name", "middlename", "middle_initial"}:
            aliases.extend(
                [
                    "middle name",
                    "middle initial",
                    "gitnang pangalan",
                ]
            )
        elif "name" in code and "place" not in code:
            aliases.extend(
                [
                    "last name first name middle name",
                    "given name middle name last name",
                    "given names",
                    "full name",
                    "name",
                ]
            )
        if "birth" in code and "place" not in code:
            aliases.extend(["birthdate", "date of birth", "birthday", "dob", "petsa ng kapanganakan", "kapanganakan"])
        if "place" in code and "birth" in code:
            aliases.extend(["place of birth", "pob"])
        if "civil" in code:
            aliases.extend(["civil status", "status"])
        if "gender" in code or code == "sex":
            aliases.extend(["gender", "sex", "kasarian"])
        if "document" in code or "id" in code or "number" in code or "digital" in code or "pcn" in code:
            aliases.extend(
                [
                    "id no",
                    "id number",
                    "identification no",
                    "document number",
                    "digital number",
                    "pcn",
                    "philsys number",
                ]
            )
        if "issue" in code:
            aliases.extend(["date issued", "issued", "date of issue"])
        if "expir" in code or "valid" in code:
            aliases.extend(["valid until", "expiry date", "expiration date", "valid thru"])

        region = hints.get("region") if isinstance(hints.get("region"), dict) else None
        multi_line = bool(hints.get("multi_line"))
        has_region = _region_to_bbox(region) is not None
        expected = _expected_matcher(hints)
        value = ""
        confidence = 0.0
        evidence: dict = {}

        is_id_field = _is_identifier_field(field)
        is_date_field = _is_date_field(field)

        # Primary path: text inside the drawn box only (no data-type reinterpretation).
        if has_region:
            value, confidence, evidence = _candidate_from_region(
                clean_lines, region, aliases, multi_line=multi_line, expected=expected, join_dates=is_date_field
            )
            if value and _looks_like_label(value, aliases) and not (expected and expected(value)):
                value, confidence, evidence = "", 0.0, {"method": "region", "rejected": "label"}
            # Soft cleanup for ID-like fields: prefer the ID token inside the box text.
            if value and is_id_field:
                id_from_region = _extract_id_number_from_text(value)
                if id_from_region:
                    value = id_from_region
                elif _looks_like_date_fragment(value):
                    # Box hit a date; search for a real ID near this region.
                    id_value, id_conf, id_ev = _find_id_number_near_region(clean_lines, region)
                    if id_value:
                        value, confidence, evidence = id_value, id_conf, id_ev
                    else:
                        value, confidence, evidence = "", 0.0, {"method": "region", "rejected": "date_fragment"}
                else:
                    # Region text was not a usable ID token — search nearby, then the
                    # enlarged box only (never page-wide, so a blank box can't "lie").
                    id_value, id_conf, id_ev = _find_id_number_near_region(clean_lines, region)
                    if not id_value:
                        id_value, id_conf, id_ev = _find_id_number_near_region(
                            clean_lines, _enlarge_region(region), confine=True
                        )
                    if id_value:
                        value, confidence, evidence = id_value, id_conf, id_ev
                    else:
                        value, confidence, evidence = "", 0.0, {
                            "method": "region",
                            "rejected": "no_id_token",
                        }
            # Region miss (empty box): confinement to the enlarged box only.
            if is_id_field and not value:
                id_value, id_conf, id_ev = _find_id_number_near_region(clean_lines, region)
                if not id_value:
                    id_value, id_conf, id_ev = _find_id_number_near_region(
                        clean_lines, _enlarge_region(region), confine=True
                    )
                if id_value:
                    value, confidence, evidence = id_value, id_conf, id_ev

            # Non-ID region miss: retry with a slightly enlarged box (alignment
            # tolerance). Never fall back to page-wide label/alias search — a drawn
            # box is the source of truth; a blank box must yield an honest empty.
            if not value and not is_id_field:
                enlarged_value, enlarged_conf, enlarged_ev = _candidate_from_region(
                    clean_lines,
                    _enlarge_region(region),
                    aliases,
                    multi_line=multi_line,
                    expected=expected,
                    join_dates=is_date_field,
                )
                if enlarged_value and not _looks_like_label(enlarged_value, aliases):
                    value, confidence, evidence = (
                        enlarged_value,
                        enlarged_conf,
                        {**(enlarged_ev or {}), "method": "region_enlarged"},
                    )
                if not value:
                    evidence = {"method": "region_miss", "region": _region_to_bbox(region)}
        else:
            # No canvas box: alias proximity (legacy / incomplete templates).
            if is_id_field:
                id_value, id_conf, id_ev = _find_id_number_near_region(clean_lines, None)
                if id_value:
                    value, confidence, evidence = id_value, id_conf, id_ev
            if not value:
                value, confidence, evidence = _candidate_after_alias(clean_lines, aliases)
                if value and _looks_like_label(value, aliases):
                    value, confidence, evidence = "", 0.0, {}
                if value and is_id_field:
                    id_from_alias = _extract_id_number_from_text(value) or (
                        value if ID_NUMBER_TOKEN.fullmatch(value.strip()) else ""
                    )
                    if id_from_alias and not _looks_like_date_fragment(id_from_alias):
                        value = _normalize_id_number_token(id_from_alias)
                    else:
                        value, confidence, evidence = "", 0.0, {}

            profile_value = _profile_value(field, profile)
            if profile_value and confidence < 0.55 and not is_id_field:
                profile_candidate = _candidate_matching_profile(clean_lines, profile_value)
                if profile_candidate[1] > confidence and not _looks_like_label(profile_candidate[0], aliases):
                    value, confidence, evidence = (
                        profile_candidate[0],
                        profile_candidate[1],
                        {**profile_candidate[2], "method": "profile", "bbox": (evidence or {}).get("bbox")},
                    )

        if field.code in {"provider", "provider_name", "issuer"} and not value:
            for provider in document_type.provider_names or []:
                if normalized_text(provider) in normalized_text(all_text):
                    value = str(provider)
                    matching = next(
                        (item for item in clean_lines if normalized_text(provider) in item["normalized"]),
                        None,
                    )
                    confidence = matching["confidence"] if matching else 0.0
                    evidence = {"provider_match": True, "bbox": matching.get("bbox") if matching else None, "method": "provider"}
                    break

        # Avoid assigning the same OCR line to multiple fields when possible.
        source_line = evidence.get("source_line") if isinstance(evidence, dict) else None
        if isinstance(source_line, int) and source_line in used_line_indexes and confidence < 0.95:
            # Try region-only re-pick excluding used lines
            if region:
                filtered = [line for i, line in enumerate(clean_lines) if i not in used_line_indexes]
                alt_value, alt_conf, alt_ev = _candidate_from_region(
                    filtered, region, aliases, multi_line=multi_line, expected=expected, join_dates=is_date_field
                )
                if alt_value and not (_looks_like_label(alt_value, aliases) and not (expected and expected(alt_value))):
                    value, confidence, evidence = alt_value, alt_conf, alt_ev
                    source_line = evidence.get("source_line")
        if isinstance(source_line, int):
            used_line_indexes.add(source_line)

        # Date fields: OCR may split "JULY 24, 2004" into "JULY 24," + "2004" lines,
        # or bleed the label onto the value (e.g. "Petsa ng kapanganakan: JULY 24, 2004").
        # Complete a fragment only with neighboring fragments inside the box/evidence area.
        if is_date_field and value and not parse_date(str(value).strip()):
            date_only = [m.group(0) for m in DATE_PATTERN.finditer(str(value))]
            if len(date_only) == 1:
                value = date_only[0]
                evidence = {**(evidence or {}), "date_label_stripped": True}
            else:
                completed = _complete_date_fragment(clean_lines, value, region=region, evidence=evidence)
                if completed:
                    value = completed
                    evidence = {**(evidence or {}), "completed_date_fragment": True}

        if value and _looks_like_label(value, aliases) and not (expected and expected(value)):
            value, confidence = "", 0.0

        bbox = None
        if isinstance(evidence, dict):
            bbox = evidence.get("bbox")
        if not bbox:
            region_bbox = _region_to_bbox(region)
            if region_bbox:
                bbox = region_bbox

        # Light cleanup only (case / special chars from field settings) — not data-type transforms.
        value = _apply_field_post_process(value, field)
        normalized = value

        pattern = str(hints.get("regex_pattern") or "").strip()
        pattern_ok = True
        # Use search (not fullmatch) and ignore accidental year-only patterns like "2024".
        if pattern and value and _is_usable_field_regex(pattern):
            pattern_ok = bool(re.search(pattern, value, flags=re.IGNORECASE))

        extracted[field.code] = {
            "label": field.label,
            "value": value,
            "normalized": normalized,
            "confidence": round(float(confidence or 0), 4),
            "required": field.required,
            "min_confidence": float(field.min_confidence),
            "side": field_side(field),
            "evidence": evidence if isinstance(evidence, dict) else {},
            "bbox": bbox,
            "pattern_ok": pattern_ok,
            "extraction_method": (evidence or {}).get("method") if isinstance(evidence, dict) else None,
        }
    return extracted


def merge_extracted_fields(*parts: dict) -> dict:
    """Merge per-side extraction results. Prefer non-empty / higher-confidence values."""
    merged: dict = {}
    for part in parts:
        if not isinstance(part, dict):
            continue
        for code, item in part.items():
            if code.startswith("__"):
                continue
            if not isinstance(item, dict):
                continue
            existing = merged.get(code)
            if not existing:
                merged[code] = dict(item)
                continue
            new_val = str(item.get("value") or "").strip()
            old_val = str(existing.get("value") or "").strip()
            if new_val and not old_val:
                merged[code] = dict(item)
            elif new_val and old_val:
                if float(item.get("confidence") or 0) > float(existing.get("confidence") or 0):
                    merged[code] = dict(item)
    return merged


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


def _field_is_expiry(field) -> bool:
    code = (getattr(field, "code", None) or "").lower()
    label = (getattr(field, "label", None) or "").lower()
    blob = f"{code} {label}"
    return any(
        token in blob
        for token in (
            "expiry",
            "expiration",
            "expires",
            "valid_until",
            "valid until",
            "valid_thru",
            "valid thru",
            "valid_to",
        )
    )


def _field_is_dob(field) -> bool:
    code = (getattr(field, "code", None) or "").lower()
    label = (getattr(field, "label", None) or "").lower()
    blob = f"{code} {label}"
    return any(
        token in blob
        for token in ("date_of_birth", "birth_date", "birthdate", "dob", "birth date", "birthday")
    )


def _friendly_field_label(label: str | None, code: str | None = None) -> str:
    """Human label for resident-facing errors (never dump machine codes)."""
    text = (label or "").strip()
    if text and not re.fullmatch(r"[a-z0-9_]+", text):
        return text
    raw = (code or text or "this detail").replace("_", " ").strip()
    return raw.lower() if raw else "this detail"


def resident_validation_message(
    *,
    rule: str,
    label: str | None = None,
    code: str | None = None,
    custom_message: str | None = None,
) -> str:
    """Plain-language validation failures for residents (no regex/pattern jargon)."""
    custom = (custom_message or "").strip()
    # Officials may set short friendly copy like "ID mismatched."
    if custom and custom.lower() not in {
        "id mismatched.",
        "id mismatched",
        "required value was not extracted.",
        "value is not in the allowed list.",
        "expected document keyword was not found.",
        "numeric threshold failed.",
    }:
        if "pattern" not in custom.lower() and "regex" not in custom.lower():
            return custom

    name = _friendly_field_label(label, code)
    rule_key = (rule or "").lower()

    if rule_key in {"required", "exists", "missing"}:
        return f"Please retake a clearer photo, we could not find the {name}."
    if rule_key in {"regex", "pattern", "format", "format_mismatch"}:
        return f"Please retake a clearer photo, we could not read the {name} clearly."
    if rule_key in {"not_expired", "expiry", "expired"}:
        return "Please use a valid ID, this one is expired or the date could not be read."
    if rule_key in {"date_format", "date"}:
        return f"Please retake a clearer photo, we could not read the {name} as a date."
    if rule_key in {"profile_match", "matches_profile", "similarity"}:
        return f"Please check your details, your {name.lower()} does not match what you entered."
    if rule_key in {"recency"}:
        return "Please use a more recent document, this one looks too old."
    if rule_key in {"allowed_value", "contains_keyword"}:
        return f"Please retake a clearer photo, we could not confirm the {name}."
    return f"Please retake a clearer photo, we could not verify the {name}."


def normalize_extracted_dates(document_type, extracted: dict) -> dict:
    """Rewrite date field values to ISO (YYYY-MM-DD) when parseable; keep raw if not."""
    fields = list(getattr(document_type, "fields", None).all()) if hasattr(getattr(document_type, "fields", None), "all") else []
    if not fields and isinstance(getattr(document_type, "fields", None), list):
        fields = document_type.fields

    field_by_code = {getattr(f, "code", None) or getattr(f, "key", None): f for f in fields}
    out = dict(extracted or {})
    for code, item in list(out.items()):
        if not isinstance(item, dict):
            continue
        field = field_by_code.get(code)
        raw = str(item.get("value") or "").strip()
        if not raw:
            continue
        should_parse = False
        if field is not None:
            should_parse = _field_is_expiry(field) or _field_is_dob(field) or (getattr(field, "normalization", "") == "date")
        else:
            should_parse = any(
                token in code.lower()
                for token in ("date", "expiry", "expiration", "birth", "dob", "issue")
            )
        if not should_parse:
            continue
        parsed = parse_date(raw)
        if parsed:
            item = dict(item)
            item["value"] = parsed.isoformat()
            item["normalized"] = parsed.isoformat()
            item["raw_value"] = raw
            out[code] = item
    return out


def validate_extracted_field_rules(
    document_type,
    extracted: dict,
    *,
    configuration=None,
    side: str | None = None,
) -> list[dict]:
    """Run simple per-field checks used at sign-up detect time.

    Returns list of {field, passed, detail, rule} failures-first friendly results.
    When ``side`` is set, only fields for that photo side are validated.
    """
    results = []
    fields = list(getattr(document_type, "fields", None).all()) if hasattr(getattr(document_type, "fields", None), "all") else []
    if not fields and isinstance(getattr(document_type, "fields", None), list):
        fields = document_type.fields
    fields = [field for field in fields if field_matches_side(field, side)]

    # Collect not_expired field codes from configuration rules when available
    not_expired_fields: set[str] = set()
    if configuration is not None:
        try:
            for rule in configuration.rules.filter(enabled=True, document_type__in=[None, document_type]).select_related("field"):
                if rule.rule_type == "not_expired" or rule.operator == "not_expired":
                    if rule.field_id:
                        not_expired_fields.add(rule.field.code)
        except Exception:
            pass

    for field in fields:
        code = getattr(field, "code", None) or getattr(field, "key", None)
        if not code:
            continue
        item = extracted.get(code) or {}
        if not isinstance(item, dict):
            item = {"value": str(item or "")}
        value = str(item.get("value") or "").strip()
        raw_value = str(item.get("raw_value") or value).strip()
        label = getattr(field, "label", None) or code
        required = bool(getattr(field, "required", False))
        hints = getattr(field, "extraction_hints", None) or {}
        if not isinstance(hints, dict):
            hints = {}

        friendly_label = _friendly_field_label(label, code)

        # Required — plain language for residents
        if required and not value:
            results.append(
                {
                    "field": code,
                    "label": label,
                    "passed": False,
                    "rule": "required",
                    "detail": f"Please retake a clearer photo, we could not find the {friendly_label}.",
                }
            )
            continue

        # Expiry / not expired
        is_expiry = _field_is_expiry(field) or code in not_expired_fields
        if is_expiry and value:
            parsed = parse_date(value) or parse_date(raw_value)
            if parsed is None:
                results.append(
                    {
                        "field": code,
                        "label": label,
                        "passed": False,
                        "rule": "not_expired",
                        "detail": "Please retake a clearer photo, we could not read the expiry date.",
                    }
                )
            elif parsed < date.today():
                results.append(
                    {
                        "field": code,
                        "label": label,
                        "passed": False,
                        "rule": "not_expired",
                        "detail": "Please use a valid ID, this one has already expired.",
                    }
                )
            else:
                results.append(
                    {
                        "field": code,
                        "label": label,
                        "passed": True,
                        "rule": "not_expired",
                        "detail": f"Valid until {parsed.strftime('%B %d, %Y')}.",
                    }
                )
        elif is_expiry and required and not value:
            results.append(
                {
                    "field": code,
                    "label": label,
                    "passed": False,
                    "rule": "not_expired",
                    "detail": "Please retake a clearer photo, we could not find the expiry date.",
                }
            )

        # DOB must parse when present
        if _field_is_dob(field) and value:
            parsed = parse_date(value) or parse_date(raw_value)
            if parsed is None:
                results.append(
                    {
                        "field": code,
                        "label": label,
                        "passed": False,
                        "rule": "date_format",
                        "detail": "Please retake a clearer photo, we could not read the date of birth.",
                    }
                )
            elif parsed > date.today():
                results.append(
                    {
                        "field": code,
                        "label": label,
                        "passed": False,
                        "rule": "date_format",
                        "detail": "Please retake a clearer photo, the date of birth looks incorrect.",
                    }
                )
            else:
                # Reasonable age bounds for residents (optional soft check)
                age_days = (date.today() - parsed).days
                if age_days > 365 * 120:
                    results.append(
                        {
                            "field": code,
                            "label": label,
                            "passed": False,
                            "rule": "date_format",
                            "detail": "Please retake a clearer photo, the date of birth looks incorrect.",
                        }
                    )

        pattern = str(hints.get("regex_pattern") or "").strip()
        custom_failure_message = str(hints.get("failure_message") or "").strip()
        if pattern and value and _is_usable_field_regex(pattern):
            try:
                if not re.search(pattern, value, flags=re.IGNORECASE):
                    results.append(
                        {
                            "field": code,
                            "label": label,
                            "passed": False,
                            "rule": "regex",
                            "detail": custom_failure_message or "ID is mismatched.",
                        }
                    )
            except re.error:
                # Invalid official-configured regex — skip rather than crash signup
                pass
    return results


def evaluate_rules(
    configuration,
    document_type,
    extracted,
    profile,
    lines,
    *,
    side: str | None = None,
) -> list[dict]:
    results = []
    all_text = " ".join(str(item.get("text") or "") for item in lines or [])
    rules = configuration.rules.filter(enabled=True, document_type__in=[None, document_type]).select_related("field")
    for rule in rules.order_by("display_order", "id"):
        # Skip rules for fields that belong to a different photo side.
        if rule.field_id and side and not field_matches_side(rule.field, side):
            continue
        field_result = extracted.get(rule.field.code, {}) if rule.field_id else {}
        value = str(field_result.get("value") or "")
        configured = _rule_value(rule)
        threshold = float(rule.threshold) if rule.threshold is not None else None
        score = None
        passed = True
        detail = "Rule passed."

        # Prefer custom rule message for resident-facing failures when it is plain language.
        custom_message = (getattr(rule, "message", None) or "").strip()
        field_label = rule.field.label if rule.field_id else None
        field_code = rule.field.code if rule.field_id else None

        if rule.operator == "exists" or rule.rule_type == "required":
            configured_fields = (
                rule.value.get("fields", [])
                if isinstance(rule.value, dict)
                else configured if isinstance(configured, list) else []
            )
            if configured_fields:
                # When side-scoped, only require fields that were extracted for this side.
                codes_in_scope = [
                    code
                    for code in configured_fields
                    if not side or code in extracted
                ]
                missing_fields = [
                    code
                    for code in codes_in_scope
                    if not str((extracted.get(code) or {}).get("value") or "").strip()
                ]
                # No in-scope fields → skip (other side's required group)
                if not codes_in_scope:
                    continue
                passed = not missing_fields
                detail = (
                    "All required values are present."
                    if passed
                    else resident_validation_message(
                        rule="required",
                        label=field_label,
                        code=field_code or (missing_fields[0] if missing_fields else None),
                        custom_message=custom_message,
                    )
                )
            else:
                passed = bool(value.strip())
                detail = (
                    "Required value is present."
                    if passed
                    else resident_validation_message(
                        rule="required",
                        label=field_label,
                        code=field_code,
                        custom_message=custom_message,
                    )
                )
        elif rule.operator == "matches_profile" or rule.rule_type in {"profile_match", "similarity"}:
            profile_key = None
            if isinstance(rule.value, dict):
                profile_key = rule.value.get("profile") or rule.value.get("match")
            profile_key = str(profile_key or "").strip().lower()
            # Legacy "full name" match is no longer offered — treat as no-op pass
            if profile_key in {"name", "full_name"}:
                passed = True
                detail = "Full-name profile match is disabled; use first/middle/last name rules."
                score = 1.0
            else:
                expected = _profile_value(rule.field, profile, profile_key=profile_key or None)
                field_label = getattr(rule.field, "label", None) or (rule.field.code if rule.field_id else "Field")
                form_label = {
                    "first_name": "first name",
                    "middle_name": "middle name",
                    "last_name": "last name",
                    "gender": "gender",
                    "date_of_birth": "date of birth",
                    "address": "address",
                }.get(profile_key, profile_key or "form field")

                mismatch_msg = resident_validation_message(
                    rule="profile_match",
                    label=field_label,
                    code=field_code or profile_key,
                    custom_message=custom_message,
                )
                if not value.strip():
                    # Missing OCR value for a match rule
                    passed = False
                    score = 0.0
                    detail = mismatch_msg
                elif not str(expected or "").strip():
                    if profile_key == "middle_name":
                        passed = True
                        score = 1.0
                        detail = "Middle name not provided on the form; skip match."
                    else:
                        passed = None
                        score = None
                        detail = "Not tested. Fill the resident details form to check this."
                elif profile_key == "date_of_birth":
                    ocr_date = parse_date(value)
                    profile_dob = getattr(profile, "date_of_birth", None)
                    if isinstance(profile_dob, str):
                        profile_dob = parse_date(profile_dob)
                    if ocr_date and profile_dob:
                        passed = ocr_date == profile_dob
                        score = 1.0 if passed else 0.0
                        detail = (
                            "Date of birth matches your form."
                            if passed
                            else mismatch_msg
                        )
                    else:
                        score = similarity(value, expected)
                        min_score = threshold if threshold is not None else 0.85
                        passed = score >= min_score
                        detail = (
                            "Date of birth matches your form."
                            if passed
                            else mismatch_msg
                        )
                elif profile_key == "gender":
                    def _norm_gender(raw: str) -> str:
                        g = normalized_text(raw)
                        if g in {"m", "male", "lalaki", "man"}:
                            return "male"
                        if g in {"f", "female", "babae", "woman"}:
                            return "female"
                        if "prefer" in g or g in {"x", "other", "n/a"}:
                            return "prefer_not_to_say"
                        return g

                    passed = _norm_gender(value) == _norm_gender(str(expected))
                    score = 1.0 if passed else 0.0
                    detail = (
                        "Gender matches your form."
                        if passed
                        else mismatch_msg
                    )
                else:
                    # first / middle / last / address — token containment + similarity
                    score = similarity(value, expected)
                    if profile_key in {"first_name", "middle_name", "last_name", "firstname", "lastname", "middlename"}:
                        if normalized_text(expected) in normalized_text(value):
                            score = max(score, 0.92)
                        if normalized_text(value) in normalized_text(expected):
                            score = max(score, 0.9)
                    min_score = threshold if threshold is not None else (0.8 if profile_key == "address" else 0.85)
                    passed = score >= min_score
                    detail = (
                        f"{field_label or form_label.title()} matches your form."
                        if passed
                        else mismatch_msg
                    )
        elif rule.operator == "within_days" or rule.rule_type == "recency":
            parsed = parse_date(value)
            try:
                days = int(configured or 90)
            except (TypeError, ValueError):
                days = 90
            delta = (date.today() - parsed).days if parsed else None
            passed = delta is not None and 0 <= delta <= days
            detail = (
                "This document is recent enough."
                if passed
                else resident_validation_message(
                    rule="recency",
                    label=field_label,
                    code=field_code,
                    custom_message=custom_message,
                )
            )
        elif rule.operator == "not_expired" or rule.rule_type == "not_expired":
            parsed = parse_date(value)
            # Expiry is optional only when the field is not required and empty.
            # When a value is present it must parse and be today or later.
            is_optional = bool(rule.field_id and not rule.field.required)
            if not value.strip():
                passed = is_optional
                detail = (
                    "Expiry was not supplied (optional)."
                    if is_optional
                    else resident_validation_message(
                        rule="not_expired",
                        label=field_label,
                        code=field_code,
                        custom_message=custom_message,
                    )
                )
            elif parsed is None:
                passed = False
                detail = "Please retake a clearer photo, we could not read the expiry date."
            elif parsed < date.today():
                passed = False
                detail = "Please use a valid ID, this one has already expired."
            else:
                passed = True
                detail = f"Valid until {parsed.strftime('%B %d, %Y')}."
        elif rule.operator in {"one_of", "equals"} or rule.rule_type == "allowed_value":
            allowed = configured if isinstance(configured, list) else [configured]
            if rule.operator == "equals":
                allowed = allowed[:1]
            passed = normalized_text(value) in {normalized_text(item) for item in allowed}
            detail = (
                "Value is allowed."
                if passed
                else resident_validation_message(
                    rule="allowed_value",
                    label=field_label,
                    code=field_code,
                    custom_message=custom_message,
                )
            )
        elif rule.operator == "contains_any" or rule.rule_type == "contains_keyword":
            keywords = configured if isinstance(configured, list) else [configured]
            passed = any(normalized_text(item) in normalized_text(all_text) for item in keywords if item)
            detail = (
                "Document keyword found."
                if passed
                else resident_validation_message(
                    rule="contains_keyword",
                    label=field_label,
                    code=field_code,
                    custom_message=custom_message,
                )
            )
        elif rule.rule_type == "format":
            format_name = str(configured or getattr(rule.field, "format", "none"))
            passed = _format_passes(value, format_name)
            detail = (
                "Value format is valid."
                if passed
                else resident_validation_message(
                    rule="format",
                    label=field_label,
                    code=field_code,
                    custom_message=custom_message,
                )
            )
        elif rule.operator in {"gte", "lte"}:
            try:
                numeric = float(value.replace(",", ""))
                expected = float(configured)
                passed = numeric >= expected if rule.operator == "gte" else numeric <= expected
            except (TypeError, ValueError):
                passed = False
            detail = (
                "Numeric threshold passed."
                if passed
                else resident_validation_message(
                    rule="format",
                    label=field_label,
                    code=field_code,
                    custom_message=custom_message,
                )
            )
        elif rule.operator == "equals":
            passed = normalized_text(value) == normalized_text(configured)

        # Soften any remaining technical failure copy
        if not passed:
            technical_markers = (
                "pattern",
                "regex",
                "threshold",
                "similarity is",
                "does not match",
                "was not extracted",
                "allowed list",
            )
            if any(marker in (detail or "").lower() for marker in technical_markers):
                detail = resident_validation_message(
                    rule=str(rule.rule_type or rule.operator or "format"),
                    label=field_label,
                    code=field_code,
                    custom_message=custom_message,
                )
            elif custom_message and detail in {
                "Required value was not extracted.",
                "Value is not in the allowed list.",
                "Expected document keyword was not found.",
                "Numeric threshold failed.",
            }:
                detail = custom_message

        # Also expose the rule's field reference from `value.field` when the FK
        # is missing, and the rule_type / value.profile so the frontend can
        # match rules to extracted fields defensively (e.g. resolve profile
        # matches by profile key when field codes drift between templates).
        value_field = None
        value_profile = None
        if isinstance(rule.value, dict):
            raw_field = rule.value.get("field")
            if isinstance(raw_field, str) and raw_field.strip():
                value_field = raw_field.strip()
            raw_profile = rule.value.get("profile")
            if isinstance(raw_profile, str) and raw_profile.strip():
                value_profile = raw_profile.strip()
        results.append(
            {
                "code": rule.code,
                "name": rule.name,
                "field": rule.field.code if rule.field_id else value_field,
                "rule_type": rule.rule_type,
                "operator": rule.operator,
                "profile": value_profile,
                "passed": passed,
                "score": score,
                "on_failure": rule.on_failure,
                "detail": detail,
            }
        )
    return results


def _prepend_priority_failures(
    rules: list[dict],
    extracted: dict,
    missing: list[str],
    pattern_failures: list[str],
    document_type=None,
) -> list[dict]:
    """Emit synthetic per-field failures for missing-required and pattern mismatches.

    These take priority: any other rule result for the same field/side is dropped
    so the results table cannot claim Passed while the ID is actually mismatched.
    """
    failure_msg_by_field: dict[str, str] = {}
    if document_type is not None:
        fields_attr = getattr(document_type, "fields", None)
        try:
            iterator = fields_attr.all() if hasattr(fields_attr, "all") else (fields_attr or [])
        except Exception:
            iterator = []
        for field in iterator:
            hints = field.extraction_hints if isinstance(getattr(field, "extraction_hints", None), dict) else {}
            msg = str(hints.get("failure_message") or "").strip()
            if msg:
                failure_msg_by_field[field.code] = msg
    override: list[dict] = []
    override_field_codes: set[str] = set()
    for code in missing:
        item = extracted.get(code) or {}
        label = item.get("label") or code.replace("_", " ").title()
        override.append({
            "code": f"{code}_required_missing",
            "name": f"{label} is present",
            "field": code,
            "passed": False,
            "score": 0.0,
            "on_failure": "manual_review",
            "detail": failure_msg_by_field.get(code) or f"{label} was not read from this photo.",
        })
        override_field_codes.add(code)
    for code in pattern_failures:
        if code in override_field_codes:
            continue
        item = extracted.get(code) or {}
        label = item.get("label") or code.replace("_", " ").title()
        override.append({
            "code": f"{code}_pattern",
            "name": f"{label} matches the expected format",
            "field": code,
            "passed": False,
            "score": 0.0,
            "on_failure": "manual_review",
            "detail": failure_msg_by_field.get(code) or "ID is mismatched.",
        })
        override_field_codes.add(code)
    if not override:
        return rules
    filtered = [rule for rule in rules if rule.get("field") not in override_field_codes]
    return [*override, *filtered]


def run_engine(
    configuration,
    requested_document_type,
    profile,
    lines,
    *,
    side: str | None = None,
    extracted: dict | None = None,
    page_size: tuple[float, float] | None = None,
) -> EngineResult:
    settings = configuration.settings if isinstance(configuration.settings, dict) else {}
    failure_action = settings.get("failure_action", "manual_review")
    if failure_action not in {"manual_review", "reject", "request_resubmission"}:
        failure_action = "manual_review"
    detected, type_score, mismatch = classify_document_type(configuration, lines, requested_document_type)
    document_type = requested_document_type or detected
    if document_type is None:
        return EngineResult(None, "", 0.0, False, 0.0, {}, [], failure_action, "document_type_mismatch", failure_action)

    if extracted is None:
        extracted = extract_fields(
            document_type,
            lines,
            profile,
            side=side,
            page_size=page_size,
        )
    # side is set for single-photo tests / detect (skip other-side rules).
    # Case processing passes merged extracted with side=None so all rules run.
    rules = evaluate_rules(
        configuration,
        document_type,
        extracted,
        profile,
        lines,
        side=side,
    )
    confidences = [float(item["confidence"]) for item in extracted.values() if item.get("value")]
    overall_confidence = round(fmean(confidences), 4) if confidences else 0.0
    template_match = evaluate_template_match(document_type, lines, overall_confidence)
    # Only score required fields that were in scope for this extraction (side-filtered).
    missing = [code for code, item in extracted.items() if item.get("required") and not item.get("value")]
    low_confidence = [
        code
        for code, item in extracted.items()
        if item.get("required") and item.get("value") and float(item.get("confidence") or 0) < float(item.get("min_confidence") or 0)
    ]
    pattern_failures = [code for code, item in extracted.items() if item.get("value") and item.get("pattern_ok") is False]
    rules = _prepend_priority_failures(rules, extracted, missing, pattern_failures, document_type=document_type)
    blocking_rules = [item for item in rules if item["passed"] is False and item["on_failure"] == "manual_review"]
    threshold = float(
        settings.get("confidence_threshold", settings.get("ocr_confidence_threshold", 0.8))
    )
    doc_min = float(getattr(document_type, "min_ocr_confidence", None) or threshold)
    effective_threshold = max(threshold, doc_min) if getattr(document_type, "min_ocr_confidence", None) is not None else threshold

    if mismatch:
        outcome, review_reason = failure_action, "document_type_mismatch"
    elif missing:
        outcome, review_reason = failure_action, "missing_required_field"
    elif low_confidence or overall_confidence < effective_threshold:
        outcome, review_reason = failure_action, "low_confidence"
    elif pattern_failures:
        outcome, review_reason = failure_action, "format_mismatch"
    elif blocking_rules:
        outcome, review_reason = failure_action, "rule_mismatch"
    else:
        # Template match is reported for the Template Builder / test UI.
        # It does not alone reject a resident case (rules + required fields do).
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
        failure_action,
        template_match,
    )


def suffix_for_filename(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".pdf"} else ".bin"
