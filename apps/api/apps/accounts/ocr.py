"""Small, typed OCR.space hosted-client.

This module deliberately knows nothing about residents or verification rules.  It
only submits a document to the OCR.space API and returns normalized OCR lines
plus provider metadata.  Keeping that boundary makes provider failures safe to
route to manual review instead of turning them into signup failures.

OCR.space Engine 2 returns word-level bounding boxes when ``isOverlayRequired``
is enabled; the free tier does not report per-word confidence, so recognized
lines are trusted with confidence=1.0.
"""

import json
import os
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
    # Pixel size of the image that was OCR'd (for accurate relative bboxes).
    image_width: int | None = None
    image_height: int | None = None


def _request_error(exc: Exception) -> OCRProviderError:
    import sys
    cause = exc.__cause__ or exc.__context__
    print(
        f"[OCR] request failed: {type(exc).__name__}: {exc!r}",
        file=sys.stderr, flush=True,
    )
    if cause is not None:
        print(
            f"[OCR]   cause: {type(cause).__name__}: {cause!r}",
            file=sys.stderr, flush=True,
        )
    if isinstance(exc, requests.Timeout):
        return OCRProviderTimeout("OCR.space request timed out.")
    if isinstance(exc, requests.ConnectionError):
        return OCRProviderUnavailable("OCR.space could not be reached.")
    return OCRProviderUnavailable("OCR.space request failed.")


def _raise_for_status(response):
    if response.status_code in (401, 403):
        raise OCRProviderAuthenticationError("OCR.space credentials were rejected.")
    if response.status_code == 429 or response.status_code >= 500:
        raise OCRProviderUnavailable(f"OCR.space returned HTTP {response.status_code}.")
    try:
        response.raise_for_status()
    except requests.RequestException as exc:
        raise OCRProviderResponseError(
            f"OCR.space returned HTTP {getattr(response, 'status_code', 'unknown')}."
        ) from exc


def _response_json(response):
    try:
        payload = response.json()
    except (ValueError, TypeError) as exc:
        raise OCRProviderResponseError("OCR.space returned malformed JSON.") from exc
    if not isinstance(payload, dict):
        raise OCRProviderResponseError("OCR.space returned an unexpected response.")
    return payload


def _request_with_retries(attempt_request, *, max_retries, what="request"):
    """Run attempt_request() (a zero-arg callable returning a requests.Response),
    retrying transient connection/timeout errors with exponential backoff.

    Transient HTTP responses (429 and 5xx) are retried here. The callable is
    invoked fresh on every attempt so file handles or streams can be reopened.
    """
    import sys
    last_exc = None
    for attempt in range(1, max_retries + 1):
        try:
            response = attempt_request()
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= max_retries:
                    return response
                retry_after = response.headers.get("Retry-After", "")
                try:
                    delay = max(0.5, min(float(retry_after), 30.0))
                except (TypeError, ValueError):
                    delay = 2 ** (attempt - 1)
                time.sleep(delay)
                continue
            return response
        except requests.RequestException as exc:
            last_exc = exc
            if attempt >= max_retries:
                break
            delay = 2 ** (attempt - 1)  # 1s, 2s, 4s…
            print(
                f"[OCR] {what} attempt {attempt}/{max_retries} failed: "
                f"{type(exc).__name__}: {exc!r}; retrying in {delay}s",
                file=sys.stderr, flush=True,
            )
            time.sleep(delay)
    raise _request_error(last_exc)


def _mime_for_suffix(suffix: str) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".pdf": "application/pdf",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
    }.get(suffix, "application/octet-stream")


def _engine_label() -> str:
    engine = getattr(settings, "OCRSPACE_ENGINE", 2)
    return f"ocrspace:engine{engine}"


def _parse_ocrspace_payload(payload: dict, image_width=None, image_height=None) -> OCRResponse:
    """Convert an OCR.space JSON payload into normalized OCR lines."""
    job_id = "ocrspace"
    exit_code = payload.get("OCRExitCode")
    if exit_code not in {1, 2}:
        message = payload.get("ErrorMessage") or payload.get("ErrorDetails") or "OCR.space failed to parse the image."
        raise OCRProviderResponseError(f"OCR.space parse failed: {message}")

    results = payload.get("ParsedResults") or []
    lines: list[dict] = []
    for page in results:
        if page.get("FileParseExitCode") not in {1, "1", None}:
            message = page.get("ErrorMessage") or "OCR.space page parse failed."
            raise OCRProviderResponseError(f"OCR.space page failed: {message}")
        overlay = page.get("TextOverlay") or {}
        overlay_lines = overlay.get("Lines") or []
        if overlay_lines:
            for item in overlay_lines:
                text = str(item.get("LineText") or "").strip()
                if not text:
                    continue
                words = item.get("Words") or []
                if words:
                    lefts = [float(word.get("Left") or 0) for word in words]
                    tops = [float(word.get("Top") or 0) for word in words]
                    rights = [float(word.get("Left") or 0) + float(word.get("Width") or 0) for word in words]
                    bottoms = [float(word.get("Top") or 0) + float(word.get("Height") or 0) for word in words]
                    bbox = [min(lefts), min(tops), max(rights), max(bottoms)]
                else:
                    bbox = []
                lines.append({"text": text, "confidence": 1.0, "bbox": bbox})
        else:
            parsed_text = str(page.get("ParsedText") or "")
            for raw_line in parsed_text.splitlines():
                text = raw_line.strip()
                if not text:
                    continue
                lines.append({"text": text, "confidence": 1.0, "bbox": []})
    return OCRResponse(
        lines=lines,
        job_id=job_id,
        latency_ms=0,
        model=_engine_label(),
        image_width=image_width,
        image_height=image_height,
    )


def _submit_payload(
    payload: bytes | None,
    *,
    filename: str,
    mime: str,
    source_url: str | None = None,
) -> OCRResponse:
    started = time.monotonic()
    api_key = getattr(settings, "OCRSPACE_API_KEY", "")
    endpoint = getattr(settings, "OCRSPACE_URL", "https://api.ocr.space/parse/image")
    engine = getattr(settings, "OCRSPACE_ENGINE", 2)
    language = getattr(settings, "OCRSPACE_LANGUAGE", "eng")
    overlay = bool(getattr(settings, "OCRSPACE_OVERLAY", True))
    connect_timeout = getattr(settings, "OCRSPACE_CONNECT_TIMEOUT", 10)
    read_timeout = getattr(settings, "OCRSPACE_READ_TIMEOUT", 60)
    max_retries = max(1, int(getattr(settings, "OCRSPACE_MAX_RETRIES", 3) or 3))

    if not api_key:
        raise OCRProviderAuthenticationError("OCR.space is not configured.")
    if not endpoint.startswith(("https://", "http://")):
        raise OCRProviderResponseError("OCR.space API URL is invalid.")

    headers = {"apikey": api_key}
    data = {
        "language": language,
        "OCREngine": str(engine),
        "isOverlayRequired": "true" if overlay else "false",
    }

    def attempt_post() -> requests.Response:
        if source_url:
            return requests.post(
                endpoint,
                headers=headers,
                data={**data, "url": source_url, "filetype": mime.split("/")[-1].upper()},
                timeout=(connect_timeout, read_timeout),
            )
        return requests.post(
            endpoint,
            headers=headers,
            data=data,
            files={"file": (filename, payload, mime)},
            timeout=(connect_timeout, read_timeout),
        )

    resp = _request_with_retries(attempt_post, max_retries=max_retries, what="submit")
    _raise_for_status(resp)
    payload_json = _response_json(resp)
    response = _parse_ocrspace_payload(payload_json)
    response = OCRResponse(
        lines=response.lines,
        job_id=response.job_id,
        latency_ms=int((time.monotonic() - started) * 1000),
        model=response.model,
        image_width=response.image_width,
        image_height=response.image_height,
    )
    return response


def ocr_file_with_metadata(file_path: str) -> OCRResponse:
    """Submit a local file path or http(s) URL to OCR.space and return OCR results.

    Returns an OCRResponse with lines containing:
        - text (str): recognised text
        - confidence (float): 1.0 (OCR.space reports no per-word confidence)
        - bbox (list[float]): [x1, y1, x2, y2] in absolute pixels
    """
    image_width = None
    image_height = None
    source_url = None
    payload = None
    filename = "document.jpg"
    mime = "image/jpeg"

    is_url = file_path.startswith(("http://", "https://"))
    if is_url:
        source_url = file_path
        mime = "image/jpeg"
    else:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"OCR file not found: {file_path}")
        suffix = os.path.splitext(file_path)[1].lower() or ".jpg"
        mime = _mime_for_suffix(suffix)
        filename = os.path.basename(file_path) or "document.jpg"
        with open(file_path, "rb") as file_handle:
            payload = file_handle.read()
        if mime.startswith("image/"):
            try:
                from io import BytesIO

                from PIL import Image

                with Image.open(BytesIO(payload)) as image:
                    image_width, image_height = image.size
            except Exception:
                image_width = None
                image_height = None

    response = _submit_payload(payload, filename=filename, mime=mime, source_url=source_url)
    return OCRResponse(
        lines=response.lines,
        job_id=response.job_id,
        latency_ms=response.latency_ms,
        model=response.model,
        image_width=image_width,
        image_height=image_height,
    )


def ocr_file(file_path: str) -> list[dict]:
    """Backward-compatible wrapper returning only recognized lines."""

    return ocr_file_with_metadata(file_path).lines


def ocr_bytes_with_metadata(image_bytes: bytes, *, suffix=".png", deskew: bool = True) -> OCRResponse:
    """Submit in-memory bytes without ever exposing a public document URL.

    When ``deskew`` is True, attempts ID-card auto-crop/deskew so small or tilted
    cards OCR better. Disable deskew when template field regions were drawn on
    the original image — cropping would shift coordinates and pick wrong text.
    """
    payload = image_bytes
    out_suffix = suffix if suffix in {".png", ".jpg", ".jpeg", ".pdf"} else ".bin"
    # PDF bytes must not go through image deskew
    if deskew and out_suffix != ".pdf":
        try:
            from .document_deskew import deskew_id_card_bytes

            deskewed, meta = deskew_id_card_bytes(image_bytes)
            if meta.get("deskewed") and deskewed:
                payload = deskewed
                out_suffix = ".jpg"
        except Exception:
            payload = image_bytes

    image_width = None
    image_height = None
    if out_suffix != ".pdf":
        try:
            from io import BytesIO

            from PIL import Image

            with Image.open(BytesIO(payload)) as image:
                image_width, image_height = image.size

            # Downscale oversized uploads so the slow link to the OCR provider
            # (and the fallback engine) never has to push multi-megabyte bodies.
            max_side = 1600
            if max(image_width, image_height) > max_side:
                ratio = max_side / max(image_width, image_height)
                with Image.open(BytesIO(payload)) as image:
                    resized = image.convert("RGB").resize(
                        (max(1, int(image_width * ratio)), max(1, int(image_height * ratio))),
                        Image.LANCZOS,
                    )
                    buffer = BytesIO()
                    resized.save(buffer, format="JPEG", quality=85, optimize=True)
                    payload = buffer.getvalue()
                    out_suffix = ".jpg"
                image_width, image_height = resized.size
        except Exception:
            image_width = None
            image_height = None

    mime = _mime_for_suffix(out_suffix)
    response = _submit_payload(payload, filename=f"document{out_suffix}", mime=mime)
    return OCRResponse(
        lines=response.lines,
        job_id=response.job_id,
        latency_ms=response.latency_ms,
        model=response.model,
        image_width=image_width,
        image_height=image_height,
    )
