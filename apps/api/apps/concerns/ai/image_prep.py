"""Normalise an uploaded photo before it is sent to Gemma.

Officials were seeing intermittent `The read operation timed out` on image
requests while text-only requests always worked. The cause is on our side: the
old helper forwarded whatever the resident's phone produced — a 12 MP HEIC-ish
JPEG at full resolution, sometimes sideways, sometimes CMYK — base64-encoded
into the request body. A 4 MB payload over a mobile uplink to a cloud model is
simply slower than the client timeout on a bad connection, which is why the same
image succeeds on one attempt and fails on the next.

So every image is decoded, straightened, converted, and shrunk to a predictable
size first. `PreparedImage.telemetry` carries the before/after numbers so a
developer reading the log can tell whether a failure was payload size, decode,
or the network.

Returning `None` means "this image could not be prepared". The caller must treat
that as `image_review_failed` — never as "no image was submitted", and never as
"the image is fine".
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass, field
from io import BytesIO

from django.conf import settings
from PIL import Image, ImageOps


logger = logging.getLogger(__name__)

# Decompression-bomb guard: Pillow only warns past ~178MP by default. Cap at
# 20MP so a crafted image fails fast into a "could not prepare" verdict
# (handled above) instead of exploding into hundreds of MB of pixels.
Image.MAX_IMAGE_PIXELS = 20_000_000

# Gemma gains nothing from more pixels than this for civic photos, and the
# payload cost is quadratic. The floor exists so a misconfigured env cannot
# shrink evidence into uselessness.
MIN_MAX_SIDE = 768
MAX_MAX_SIDE = 1024
MIN_QUALITY = 75
MAX_QUALITY = 85

# Small images are rejected outright by the cloud vision encoder. A real
# 265x212 screenshot failed 5 times out of 5; upscaled so its shorter side
# reached 512 the same photo succeeded 4 times out of 5. Nothing is gained in
# detail by enlarging, but the request stops being refused.
DEFAULT_MIN_SIDE = 512


@dataclass(frozen=True)
class PreparedImage:
    """A photo ready to attach to a Gemma request."""

    data: str
    """Base64-encoded JPEG, no data: prefix — the ollama client wants raw base64."""

    mime_type: str = "image/jpeg"
    telemetry: dict = field(default_factory=dict)


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def prepare_image_for_gemma(raw: bytes, *, filename: str = "", mime_type: str = "") -> PreparedImage | None:
    """Decode, straighten and shrink `raw` into a Gemma-sized JPEG.

    Returns None when image analysis is switched off, when the bytes cannot be
    decoded, or when the normalised result still exceeds OLLAMA_IMAGE_MAX_BYTES.
    """
    if not getattr(settings, "OLLAMA_ENABLE_IMAGE_ANALYSIS", True):
        return None
    if not raw:
        return None

    max_side = _clamp(int(getattr(settings, "OLLAMA_IMAGE_MAX_SIDE", MAX_MAX_SIDE)), MIN_MAX_SIDE, MAX_MAX_SIDE)
    min_side = max(0, int(getattr(settings, "OLLAMA_IMAGE_MIN_SIDE", DEFAULT_MIN_SIDE)))
    quality = _clamp(int(getattr(settings, "OLLAMA_IMAGE_JPEG_QUALITY", 82)), MIN_QUALITY, MAX_QUALITY)
    max_bytes = max(0, int(getattr(settings, "OLLAMA_IMAGE_MAX_BYTES", 0)))

    try:
        with Image.open(BytesIO(raw)) as source:
            original_size = source.size
            # exif_transpose before convert: a sideways photo confuses a vision
            # model exactly as much as it confuses a person.
            image = ImageOps.exif_transpose(source).convert("RGB")
            # Enlarge first, shrink second: a thumbnail() on an already-small
            # image is a no-op, so the order matters.
            scale = max(min_side / image.width, min_side / image.height, 1.0)
            if scale > 1.0:
                image = image.resize(
                    (round(image.width * scale), round(image.height * scale)),
                    Image.Resampling.LANCZOS,
                )
            image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            normalized_size = image.size
            output = BytesIO()
            image.save(output, "JPEG", quality=quality, optimize=True)
    except Exception as exc:
        logger.warning(
            "Gemma image preparation failed filename=%s mime=%s bytes=%s error=%s",
            filename or "<unnamed>",
            mime_type or "<unknown>",
            len(raw),
            exc.__class__.__name__,
        )
        return None

    payload = output.getvalue()
    telemetry = {
        "filename": filename or "<unnamed>",
        "source_mime_type": mime_type or "<unknown>",
        "original_bytes": len(raw),
        "normalized_bytes": len(payload),
        "original_resolution": f"{original_size[0]}x{original_size[1]}",
        "normalized_resolution": f"{normalized_size[0]}x{normalized_size[1]}",
        "jpeg_quality": quality,
        "max_side": max_side,
    }

    if max_bytes and len(payload) > max_bytes:
        logger.info(
            "Skipping Gemma image analysis; normalized image is %s bytes (limit %s)",
            len(payload),
            max_bytes,
        )
        return None

    return PreparedImage(
        data=base64.b64encode(payload).decode("ascii"),
        mime_type="image/jpeg",
        telemetry=telemetry,
    )
