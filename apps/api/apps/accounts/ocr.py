"""Small, typed PaddleOCR hosted-job client.

This module deliberately knows nothing about residents or verification rules.  It
only submits a document, waits for the provider job, and returns normalized OCR
lines plus provider metadata.  Keeping that boundary makes provider failures
safe to route to manual review instead of turning them into signup failures.
"""

import json
import os
import tempfile
import time
from dataclasses import dataclass

import requests
from django.conf import settings


class OCRProviderError(RuntimeError):
    """Base class for errors that are safe to persist without document PII."""

    retryable = False
    reason_code = "provider_error"


class OCRProviderUnavailable(OCRProviderError):
    retryable = True
    reason_code = "provider_unavailable"


class OCRProviderAuthenticationError(OCRProviderError):
    reason_code = "provider_authentication"


class OCRProviderTimeout(OCRProviderUnavailable):
    reason_code = "provider_timeout"


class OCRProviderResponseError(OCRProviderError):
    reason_code = "provider_response"


@dataclass(frozen=True)
class OCRResponse:
    lines: list[dict]
    job_id: str
    latency_ms: int
    model: str


def _request_error(exc: Exception) -> OCRProviderError:
    if isinstance(exc, requests.Timeout):
        return OCRProviderTimeout("PaddleOCR request timed out.")
    if isinstance(exc, requests.ConnectionError):
        return OCRProviderUnavailable("PaddleOCR could not be reached.")
    return OCRProviderUnavailable("PaddleOCR request failed.")


def _raise_for_status(response):
    if response.status_code in (401, 403):
        raise OCRProviderAuthenticationError("PaddleOCR credentials were rejected.")
    if response.status_code == 429 or response.status_code >= 500:
        raise OCRProviderUnavailable(f"PaddleOCR returned HTTP {response.status_code}.")
    try:
        response.raise_for_status()
    except requests.RequestException as exc:
        raise OCRProviderResponseError(
            f"PaddleOCR returned HTTP {getattr(response, 'status_code', 'unknown')}."
        ) from exc


def _response_json(response):
    try:
        payload = response.json()
    except (ValueError, TypeError) as exc:
        raise OCRProviderResponseError("PaddleOCR returned malformed JSON.") from exc
    if not isinstance(payload, dict):
        raise OCRProviderResponseError("PaddleOCR returned an unexpected response.")
    return payload


def ocr_file_with_metadata(file_path: str) -> OCRResponse:
    """Submit a local or remote image to PaddleOCR and return OCR results.

    Accepts a local file path or an http(s) URL.
    Returns a list of OCR result dicts, each containing:
        - text (str): recognised text
        - confidence (float)
        - bbox (list[float]): [x1, y1, x2, y2, x3, y3, x4, y4]
        - image_url (str | None): cropped image of this text region
    """
    started = time.monotonic()
    token = getattr(settings, "PADDLEOCR_TOKEN", "")
    job_url = getattr(settings, "PADDLEOCR_JOB_URL", "")
    model = getattr(settings, "PADDLEOCR_MODEL", "PP-OCRv6")
    poll_interval = getattr(settings, "PADDLEOCR_POLL_INTERVAL_SECONDS", 2.0)
    max_polls = getattr(settings, "PADDLEOCR_MAX_POLLS", 30)
    connect_timeout = getattr(settings, "PADDLEOCR_CONNECT_TIMEOUT", 10)
    read_timeout = getattr(settings, "PADDLEOCR_READ_TIMEOUT", 30)

    if not token:
        raise OCRProviderAuthenticationError("PaddleOCR is not configured.")
    if not job_url.startswith(("https://", "http://")):
        raise OCRProviderResponseError("PaddleOCR job URL is invalid.")

    headers = {"Authorization": f"bearer {token}"}
    optional_payload = {
        "useDocOrientationClassify": False,
        "useDocUnwarping": False,
        "useTextlineOrientation": False,
    }

    is_url = file_path.startswith(("http://", "https://"))

    if is_url:
        headers["Content-Type"] = "application/json"
        payload = {
            "fileUrl": file_path,
            "model": model,
            "optionalPayload": optional_payload,
        }
        try:
            resp = requests.post(
                job_url, json=payload, headers=headers,
                timeout=(connect_timeout, read_timeout),
            )
        except requests.RequestException as exc:
            raise _request_error(exc) from exc
    else:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"OCR file not found: {file_path}")
        data = {
            "model": model,
            "optionalPayload": json.dumps(optional_payload),
        }
        with open(file_path, "rb") as f:
            files = {"file": f}
            try:
                resp = requests.post(
                    job_url, headers=headers, data=data, files=files,
                    timeout=(connect_timeout, read_timeout),
                )
            except requests.RequestException as exc:
                raise _request_error(exc) from exc

    _raise_for_status(resp)
    try:
        job_id = str(_response_json(resp)["data"]["jobId"])
    except (KeyError, TypeError) as exc:
        raise OCRProviderResponseError("PaddleOCR did not return a job identifier.") from exc

    # Poll until done
    jsonl_url = None
    for _ in range(max_polls):
        try:
            status_resp = requests.get(
                f"{job_url}/{job_id}", headers=headers,
                timeout=(connect_timeout, read_timeout),
            )
        except requests.RequestException as exc:
            raise _request_error(exc) from exc
        _raise_for_status(status_resp)
        try:
            data = _response_json(status_resp)["data"]
            state = data["state"]
        except (KeyError, TypeError) as exc:
            raise OCRProviderResponseError("PaddleOCR returned an invalid job status.") from exc

        if state == "done":
            jsonl_url = data["resultUrl"]["jsonUrl"]
            break
        elif state == "failed":
            error_msg = data.get("errorMsg", "unknown error")
            raise OCRProviderResponseError(f"PaddleOCR job failed: {error_msg}")

        time.sleep(poll_interval)
    else:
        raise OCRProviderTimeout("PaddleOCR job did not complete within the poll limit.")

    if not jsonl_url:
        return OCRResponse([], job_id, int((time.monotonic() - started) * 1000), model)

    # Fetch and parse JSONL results
    try:
        jsonl_resp = requests.get(
            jsonl_url, timeout=(connect_timeout, read_timeout),
        )
    except requests.RequestException as exc:
        raise _request_error(exc) from exc
    _raise_for_status(jsonl_resp)

    results = []
    for line in jsonl_resp.text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            page_result = json.loads(line)["result"]
        except (ValueError, KeyError, TypeError) as exc:
            raise OCRProviderResponseError("PaddleOCR returned malformed result data.") from exc
        for ocr_entry in page_result.get("ocrResults", []):
            pruned = ocr_entry.get("prunedResult", {})
            rec_texts = pruned.get("rec_texts", [])
            rec_scores = pruned.get("rec_scores", [])
            rec_boxes = pruned.get("rec_boxes", [])
            image_url = ocr_entry.get("ocrImage", None)
            for i, text in enumerate(rec_texts):
                text = text.strip()
                confidence = rec_scores[i] if i < len(rec_scores) else 0.0
                bbox = rec_boxes[i] if i < len(rec_boxes) else []
                results.append({
                    "text": text,
                    "confidence": confidence,
                    "bbox": bbox,
                    "image_url": image_url,
                })

    return OCRResponse(
        lines=results,
        job_id=job_id,
        latency_ms=int((time.monotonic() - started) * 1000),
        model=model,
    )


def ocr_file(file_path: str) -> list[dict]:
    """Backward-compatible wrapper returning only recognized lines."""

    return ocr_file_with_metadata(file_path).lines


def ocr_bytes(image_bytes: bytes) -> list[dict]:
    """Submit raw image bytes to PaddleOCR and return OCR results.

    Writes bytes to a temp file, delegates to ocr_file, then cleans up.
    """
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name
    try:
        return ocr_file(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def ocr_bytes_with_metadata(image_bytes: bytes, *, suffix=".png") -> OCRResponse:
    """Submit in-memory bytes without ever exposing a public document URL."""

    safe_suffix = suffix if suffix in {".png", ".jpg", ".jpeg", ".pdf"} else ".bin"
    with tempfile.NamedTemporaryFile(suffix=safe_suffix, delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name
    try:
        return ocr_file_with_metadata(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def validate_barangay_id_ocr(ocr_results: list[dict], user_data: dict) -> tuple[bool, str, str, dict]:
    """Validate a Barangay ID's OCR output against signup data.

    Returns (passed: bool, reason: str, failed_field: str, details: dict).
    failed_field maps to a form field: "firstName", "lastName", "dateOfBirth", "address", "proofType", or "".
    """
    import calendar
    import re
    from datetime import date as dt_date

    texts = [r["text"].upper().strip() for r in ocr_results if r["text"].strip()]
    all_text = " ".join(texts)

    MONTHS = {
        "JANUARY": 1, "FEBRUARY": 2, "MARCH": 3, "APRIL": 4, "MAY": 5, "JUNE": 6,
        "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9, "OCTOBER": 10, "NOVEMBER": 11, "DECEMBER": 12,
    }
    MONTH_NAMES = ["", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
                    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]

    details = {
        "extracted_texts": texts,
        "name": {"user_tokens": [], "ocr_tokens": [], "matched_tokens": [], "status": "pending"},
        "address": {"found": "", "status": "pending"},
        "birthdate": {"user_birth": "", "month_found": False, "year_found": False, "status": "pending"},
        "dates": {"found": [], "date_issued": None, "valid_until": None, "status": "pending"},
    }

    # ── 1. Name overlap ──────────────────────────────────────────────────
    full_name_str = f"{user_data.get('last_name', '')} {user_data.get('first_name', '')} {user_data.get('middle_name', '')}"
    user_tokens = set(full_name_str.upper().split())
    ocr_tokens = set(all_text.replace(",", " ").split())
    overlap = user_tokens & ocr_tokens

    details["name"]["user_tokens"] = sorted(user_tokens)
    details["name"]["ocr_tokens_not_in_name"] = sorted(ocr_tokens - user_tokens)
    details["name"]["matched_tokens"] = sorted(overlap)
    details["name"]["user_first_name"] = user_data.get("first_name", "").upper().strip()
    details["name"]["user_last_name"] = user_data.get("last_name", "").upper().strip()
    details["name"]["first_name_in_ocr"] = all(
        token in ocr_tokens for token in user_data.get("first_name", "").upper().split()
    )
    details["name"]["last_name_in_ocr"] = user_data.get("last_name", "").upper().strip() in ocr_tokens

    if not details["name"]["last_name_in_ocr"]:
        details["name"]["status"] = "failed"
        return False, "Your last name does not matched on the ID.", "lastName", details
    if not details["name"]["first_name_in_ocr"]:
        details["name"]["status"] = "failed"
        return False, "Your first name does not matched on the ID.", "firstName", details
    details["name"]["status"] = "passed"

    # ── 2. Address — must mention Marikina ───────────────────────────────
    if "MARIKINA HEIGHTS" in all_text:
        details["address"]["found"] = "MARIKINA HEIGHTS"
    elif "MARIKINA" in all_text:
        details["address"]["found"] = "MARIKINA"

    if not details["address"]["found"]:
        details["address"]["status"] = "failed"
        return False, "Your Marikina address does not matched on the ID.", "address", details
    details["address"]["status"] = "passed"

    # ── 3. Birthdate check ───────────────────────────────────────────────
    user_birth = user_data.get("date_of_birth", "")
    details["birthdate"]["user_birth"] = user_birth
    birth_ok = False
    if user_birth:
        try:
            ub = dt_date.fromisoformat(str(user_birth))
            month_name = MONTH_NAMES[ub.month]
            details["birthdate"]["month_found"] = month_name in all_text
            details["birthdate"]["year_found"] = str(ub.year) in all_text
            if details["birthdate"]["month_found"] and details["birthdate"]["year_found"]:
                birth_ok = True
        except Exception:
            pass
    if not birth_ok:
        details["birthdate"]["status"] = "failed"
        return False, "Your birthdate does not matched on the ID.", "dateOfBirth", details
    details["birthdate"]["status"] = "passed"

    # ── 4. Date issued / valid until ─────────────────────────────────────
    DATE_RE = re.compile(
        r"(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*"
        r"\s+(\d{1,2}),\s*(\d{4})",
        re.IGNORECASE,
    )
    raw_dates: list[tuple[int, int, int]] = []
    for text in texts:
        for m in DATE_RE.finditer(text):
            month_name = m.group(1).upper()
            for full, num in MONTHS.items():
                if month_name == full[:len(month_name)]:
                    month = num
                    break
            else:
                continue
            day = int(m.group(2))
            year = int(m.group(3))
            raw_dates.append((year, month, day))

    details["dates"]["found"] = [
        f"{MONTH_NAMES[m]}{d}, {y}" for y, m, d in raw_dates
    ]

    if raw_dates:
        birth_date_tuple = None
        if user_birth:
            try:
                ub = dt_date.fromisoformat(str(user_birth))
                birth_date_tuple = (ub.year, ub.month, ub.day)
            except Exception:
                pass

        remaining = []
        for d in raw_dates:
            if birth_date_tuple and d == birth_date_tuple:
                continue
            remaining.append(d)
        remaining = list(set(remaining))

        if len(remaining) >= 2:
            sorted_d = sorted(remaining)
            date_issued = sorted_d[0]
            valid_until = sorted_d[-1]
            details["dates"]["date_issued"] = f"{MONTH_NAMES[date_issued[1]]} {date_issued[2]}, {date_issued[0]}"
            details["dates"]["valid_until"] = f"{MONTH_NAMES[valid_until[1]]} {valid_until[2]}, {valid_until[0]}"

            max_day = calendar.monthrange(valid_until[0], valid_until[1])[1]
            clamped_day = min(valid_until[2], max_day)
            today = dt_date.today()
            vu_date = dt_date(valid_until[0], valid_until[1], clamped_day)
            if vu_date < today:
                details["dates"]["status"] = "expired"
                return False, "This ID has already expired.", "proofType", details

    details["dates"]["status"] = "passed"
    return True, "Proof validated successfully.", "", details
