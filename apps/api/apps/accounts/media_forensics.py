"""
Media forensics for E-Boses residence proof uploads.

Primary entry: POST /auth/register/proof/check/ (ID upload time only).

  Layer 1: EXIF forensics          — editor / AI software tags
  Layer 2: PNG metadata forensics  — tEXt/iTXt/zTXt AI/editor markers
  Layer 3: C2PA forensics          — provenance / trainedAlgorithmicMedia
  Layer 4: Visual tamper forensics — ELA + noise inconsistency
  Layer 5: Image quality (soft on /proof/check) — size + blank-frame only
           (strict Laplacian blur/brightness remains available but is not used
            for residence-proof preflight in any environment)

Final /auth/register/ and OCR detect re-check file type/size only (no C2PA re-run).
"""

import json as jsonlib
import logging
import os
import struct
import tempfile
from io import BytesIO

import cv2
import numpy as np
from django.core.exceptions import ValidationError
from PIL import Image, ImageChops, ImageStat

logger = logging.getLogger(__name__)

# ── Known editing software in EXIF Software tag ──────────────────────────
EDITING_SOFTWARE = {
    "adobe photoshop",
    "adobe lightroom",
    "adobe",  # generic
    "gimp",
    "affinity photo",
    "affinity designer",
    "canva",
    "pixlr",
    "snapseed",
    "facetune",
    "meitu",
    "picsart",
    "corel",
    "paint.net",
    "photoscape",
    "photo editor",
}

# ── Known AI generators in EXIF Software tag ─────────────────────────────
AI_SOFTWARE = {
    "midjourney",
    "dalle",
    "dall-e",
    "stable diffusion",
    "gpt-image",
    "firefly",
    "dreamstudio",
    "novelai",
    "imagen",
    "runway",
}

MIN_IMAGE_WIDTH = 300
MIN_IMAGE_HEIGHT = 200
# Lowered for phone photos (was 70). Soft preflight still skips Laplacian blur.
MIN_BLUR_VARIANCE = 40.0
MIN_BRIGHTNESS = 40.0
MAX_BRIGHTNESS = 240.0
MIN_CONTRAST = 25.0
ELA_RECOMPRESSION_QUALITY = 90
ELA_MIN_MEAN = 0.15
ELA_HIGH_PERCENTILE = 1.0
ELA_RATIO_THRESHOLD = 0.6
NOISE_BLOCK_SIZE = 64
NOISE_MIN_BLOCKS = 12
NOISE_MIN_MEAN = 1.5
NOISE_CV_THRESHOLD = 0.85
NOISE_MIN_TEXTURE_STDDEV = 8.0
VISUAL_TAMPER_MESSAGE = "Proof image appears digitally manipulated. Please upload an original photo."
C2PA_INCONCLUSIVE_MESSAGE = (
    "Could not verify media authenticity (C2PA). Reinstall forensics dependencies or try another photo."
)
VIDEO_AUTHENTICITY_MAX_FRAMES = 5
VIDEO_AUTHENTICITY_MAX_FRAME_PIXELS = 4096 * 2160
VIDEO_CODEC_REVIEW_MESSAGE = (
    "The local video codec could not decode frames; manual authenticity review is required."
)
VIDEO_FRAME_REVIEW_MESSAGE = (
    "No readable video frames were available; manual authenticity review is required."
)


def _normalize_name(name: str) -> str:
    return name.strip().lower()


def _suffix_for_content(content: bytes) -> str:
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return ".webp"
    return ".bin"


def exif_forensics(content: bytes) -> str | None:
    """Layer 1: Check EXIF for editing/AI software. Returns error message or None."""
    try:
        img = Image.open(BytesIO(content))
        exif_data = img._getexif()
        if exif_data is None:
            return None
    except Exception:
        return None

    software = (exif_data.get(0x0131) or "").strip()
    if not software:
        return None

    software = _normalize_name(software)

    for keyword in AI_SOFTWARE:
        if keyword in software:
            return "AI-generated media is not allowed."

    for keyword in EDITING_SOFTWARE:
        if keyword in software:
            return "Edited or manipulated media is not allowed."

    return None


def _recursive_search(obj, *, _depth=0) -> str | None:
    """Search all string values in a nested JSON structure for AI/editing keywords."""
    if _depth > 30:
        return None
    if isinstance(obj, str):
        val = _normalize_name(obj)
        for keyword in AI_SOFTWARE:
            if keyword in val:
                return "AI-generated media is not allowed."
        for keyword in EDITING_SOFTWARE:
            if keyword in val:
                return "Edited or manipulated media is not allowed."
        # Check for trainedAlgorithmicMedia digital source type
        if "trainedalgorithmicmedia" in val.replace(" ", "").lower():
            return "AI-generated media is not allowed."
    elif isinstance(obj, dict):
        for v in obj.values():
            msg = _recursive_search(v, _depth=_depth + 1)
            if msg:
                return msg
        # Also check keys (e.g. label names)
        for k in obj.keys():
            val = _normalize_name(k)
            if "trainedalgorithmicmedia" in val.replace(" ", "").lower():
                return "AI-generated media is not allowed."
    elif isinstance(obj, list):
        for item in obj:
            msg = _recursive_search(item, _depth=_depth + 1)
            if msg:
                return msg
    return None


def c2pa_forensics(content: bytes) -> str | None:
    """Layer 3: Check C2PA provenance for AI/editing assertions.

    Returns error message if AI/editing is indicated.
    Returns None if no C2PA present or library not installed (logged).
    Raises ValidationError only for hard policy failures already returned as strings.
    """
    try:
        import c2pa
    except ImportError:
        logger.warning("c2pa-python is not installed; Layer 3 C2PA checks are skipped")
        return None

    suffix = _suffix_for_content(content)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        # Keep file until reader is fully consumed
        reader = c2pa.Reader(tmp_path)
        try:
            if not reader.is_embedded():
                return None
            manifest = reader.get_active_manifest()
            if not manifest:
                return None
            try:
                manifest_json = jsonlib.loads(reader.json())
            except Exception:
                logger.exception("C2PA manifest JSON parse failed")
                return None
            return _recursive_search(manifest_json)
        finally:
            # Prefer context/close if available
            close = getattr(reader, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass
    except Exception as exc:
        # Most phone photos have no C2PA/JUMBF at all — that is normal and not a failure.
        # Only log unexpected errors at warning; "manifest not found" is expected noise.
        name = type(exc).__name__
        msg = str(exc)
        if "ManifestNotFound" in name or "no JUMBF" in msg or "ManifestNotFound" in msg:
            logger.debug("C2PA not present on image (%s)", name)
        else:
            logger.warning("C2PA read failed (%s): %s", name, exc)
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def png_metadata_forensics(content: bytes) -> str | None:
    """Layer 2: Check PNG text chunks for editing/AI software. Catches Canva, Procreate, etc."""
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        return None

    pos = 8
    try:
        while pos < len(content) - 4:
            length = struct.unpack(">I", content[pos : pos + 4])[0]
            chunk_type = content[pos + 4 : pos + 8]
            chunk_data = content[pos + 8 : pos + 8 + length]
            pos += 12 + length

            if chunk_type in (b"tEXt", b"iTXt", b"zTXt"):
                null_idx = chunk_data.find(b"\x00")
                if null_idx == -1:
                    continue
                keyword = chunk_data[:null_idx].decode("latin-1", errors="replace").strip().lower()
                for kw in AI_SOFTWARE | EDITING_SOFTWARE:
                    if kw in keyword:
                        return (
                            "AI-generated media is not allowed."
                            if kw in AI_SOFTWARE
                            else "Edited or manipulated media is not allowed."
                        )
                if null_idx + 1 < len(chunk_data):
                    value = chunk_data[null_idx + 1 :].decode("latin-1", errors="replace").strip().lower()
                    for kw in AI_SOFTWARE | EDITING_SOFTWARE:
                        if kw in value:
                            return (
                                "AI-generated media is not allowed."
                                if kw in AI_SOFTWARE
                                else "Edited or manipulated media is not allowed."
                            )
    except Exception:
        pass
    return None


def check_image_quality(content: bytes) -> None:
    """Layer 5: Reject proof images too small or unreadable for OCR (strict quality)."""
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            if width < MIN_IMAGE_WIDTH or height < MIN_IMAGE_HEIGHT:
                raise ValidationError(
                    f"Proof image must be at least {MIN_IMAGE_WIDTH}×{MIN_IMAGE_HEIGHT} pixels."
                )

            grayscale = image.convert("L")
            stats = ImageStat.Stat(grayscale)
            brightness = stats.mean[0]
            contrast = stats.stddev[0]
            blur_variance = float(cv2.Laplacian(np.array(grayscale), cv2.CV_64F).var())
    except ValidationError:
        raise
    except Exception:
        return

    if brightness < MIN_BRIGHTNESS or brightness > MAX_BRIGHTNESS:
        raise ValidationError("Proof image is too dark or too bright.")
    if contrast < MIN_CONTRAST:
        raise ValidationError("Proof image has too little contrast.")
    if blur_variance < MIN_BLUR_VARIANCE:
        raise ValidationError("Proof image is too blurry. Please upload a clearer photo.")


def check_image_quality_soft(content: bytes) -> None:
    """Lenient quality gate — only reject unusable files."""
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            if width < 120 or height < 80:
                raise ValidationError(
                    "Proof image is too small. Use a clearer, larger photo."
                )
            grayscale = image.convert("L")
            stats = ImageStat.Stat(grayscale)
            contrast = stats.stddev[0]
    except ValidationError:
        raise
    except Exception:
        # If we cannot inspect the image, let OCR attempt it.
        return

    # Only reject pure blank / solid-color frames
    if contrast < 5.0:
        raise ValidationError("Proof image has no visible detail. Upload a clearer photo.")


def ela_metrics(content: bytes) -> dict[str, float] | None:
    try:
        with Image.open(BytesIO(content)) as image:
            original = image.convert("RGB")
            recompressed_bytes = BytesIO()
            original.save(recompressed_bytes, format="JPEG", quality=ELA_RECOMPRESSION_QUALITY)
            recompressed_bytes.seek(0)
            with Image.open(recompressed_bytes) as recompressed:
                difference = ImageChops.difference(original, recompressed.convert("RGB"))
                values = np.array(difference.convert("L"), dtype=np.float32)
    except Exception:
        return None

    mean = float(values.mean())
    if mean <= 0:
        return {"mean": 0.0, "p95": 0.0, "max_region_to_mean": 0.0}

    height, width = values.shape
    region_means = []
    for row in range(4):
        for col in range(4):
            top = row * height // 4
            bottom = (row + 1) * height // 4
            left = col * width // 4
            right = (col + 1) * width // 4
            region = values[top:bottom, left:right]
            if region.size:
                region_means.append(float(region.mean()))

    return {
        "mean": mean,
        "p95": float(np.percentile(values, 95)),
        "max_region_to_mean": (max(region_means) / max(mean, 1.0)) if region_means else 0.0,
    }


def noise_inconsistency_metrics(content: bytes) -> dict[str, float] | None:
    try:
        with Image.open(BytesIO(content)) as image:
            gray = np.array(image.convert("L"), dtype=np.uint8)
    except Exception:
        return None

    residual = cv2.absdiff(gray, cv2.GaussianBlur(gray, (3, 3), 0))
    height, width = gray.shape
    noise_values = []
    for top in range(0, height - NOISE_BLOCK_SIZE + 1, NOISE_BLOCK_SIZE):
        for left in range(0, width - NOISE_BLOCK_SIZE + 1, NOISE_BLOCK_SIZE):
            original_block = gray[top : top + NOISE_BLOCK_SIZE, left : left + NOISE_BLOCK_SIZE]
            if float(original_block.std()) < NOISE_MIN_TEXTURE_STDDEV:
                continue
            noise_block = residual[top : top + NOISE_BLOCK_SIZE, left : left + NOISE_BLOCK_SIZE]
            noise_values.append(float(noise_block.std()))

    if len(noise_values) < NOISE_MIN_BLOCKS:
        return None

    values = np.array(noise_values, dtype=np.float32)
    mean = float(values.mean())
    if mean <= 0:
        return {"mean": 0.0, "std": 0.0, "cv": 0.0, "blocks": float(len(noise_values))}
    std = float(values.std())
    return {"mean": mean, "std": std, "cv": std / mean, "blocks": float(len(noise_values))}


def visual_tamper_forensics(content: bytes) -> str | None:
    """Layer 4: ELA + noise inconsistency — flags composite / manipulated photos."""
    ela = ela_metrics(content)
    noise = noise_inconsistency_metrics(content)
    if not ela or not noise:
        return None
    if (
        ela["mean"] >= ELA_MIN_MEAN
        and ela["p95"] >= ELA_HIGH_PERCENTILE
        and ela["max_region_to_mean"] >= ELA_RATIO_THRESHOLD
        and noise["cv"] >= NOISE_CV_THRESHOLD
        and noise["mean"] >= NOISE_MIN_MEAN
    ):
        return VISUAL_TAMPER_MESSAGE
    return None


def forensics_findings(content: bytes) -> dict:
    """Layers 1–4 as a verdict instead of an exception.

    `check_media_authenticity` raises, which suits an upload endpoint that only
    has to say yes or no. The ID pipeline needs the same answer as data — which
    layer objected, and to what — so it can record the stage that stopped a
    submission and skip the layers behind it.
    """
    for layer, probe in (
        ("exif", exif_forensics),
        ("png_metadata", png_metadata_forensics),
        ("c2pa", c2pa_forensics),
        ("visual_tamper", visual_tamper_forensics),
    ):
        try:
            message = probe(content)
        except Exception:
            continue
        if message:
            return {"checked": True, "flagged": True, "layer": layer, "message": message}
    return {"checked": True, "flagged": False, "layer": "", "message": ""}


def check_media_authenticity(content: bytes) -> None:
    """Run forensics Layers 1–4 in order. Raises ValidationError on detection."""
    # Layer 1 → Layer 2 → Layer 3 → Layer 4
    msg = (
        exif_forensics(content)
        or png_metadata_forensics(content)
        or c2pa_forensics(content)
        or visual_tamper_forensics(content)
    )
    if msg:
        raise ValidationError(msg)


def _video_sample_positions(frame_count: int, limit: int) -> list[int]:
    if frame_count <= 0 or limit <= 0:
        return []
    count = min(frame_count, limit)
    if count == 1:
        return [0]
    return [
        round(index * (frame_count - 1) / (count - 1))
        for index in range(count)
    ]


def analyze_video_authenticity(
    content: bytes,
    *,
    extension: str = ".mp4",
    max_frames: int = VIDEO_AUTHENTICITY_MAX_FRAMES,
) -> dict:
    """Sample a bounded set of local video frames using the base visual checks.

    This does not claim provenance or inspect every frame. A successful result
    means only that no obvious edit signal was found in the sampled frames.
    Decoder, frame, and local-analysis failures always require manual review.
    """
    sample_limit = max(1, min(int(max_frames or 1), VIDEO_AUTHENTICITY_MAX_FRAMES))
    suffix = (extension or ".mp4").lower()
    if suffix not in {".mp4", ".mov", ".webm"}:
        suffix = ".bin"

    temporary_path = None
    capture = None
    sampled_frames = 0
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(content)
            temporary_path = temporary.name

        capture = cv2.VideoCapture(temporary_path)
        if not capture or not capture.isOpened():
            return {
                "status": "review_required",
                "detail": VIDEO_CODEC_REVIEW_MESSAGE,
                "sampled_frames": 0,
            }

        width = float(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = float(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        if (
            np.isfinite(width)
            and np.isfinite(height)
            and width > 0
            and height > 0
            and width * height > VIDEO_AUTHENTICITY_MAX_FRAME_PIXELS
        ):
            return {
                "status": "review_required",
                "detail": "Video frames exceed the safe local-analysis resolution; manual review is required.",
                "sampled_frames": 0,
            }

        raw_frame_count = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        frame_count = (
            int(raw_frame_count)
            if np.isfinite(raw_frame_count) and raw_frame_count > 0
            else 0
        )
        positions = _video_sample_positions(frame_count, sample_limit)
        attempts = positions if positions else [None] * sample_limit

        for position in attempts:
            if position is not None:
                capture.set(cv2.CAP_PROP_POS_FRAMES, position)
            readable, frame = capture.read()
            if not readable or frame is None or not getattr(frame, "size", 0):
                return {
                    "status": "review_required",
                    "detail": VIDEO_FRAME_REVIEW_MESSAGE,
                    "sampled_frames": sampled_frames,
                }
            frame_height, frame_width = frame.shape[:2]
            if frame_height * frame_width > VIDEO_AUTHENTICITY_MAX_FRAME_PIXELS:
                return {
                    "status": "review_required",
                    "detail": "Video frames exceed the safe local-analysis resolution; manual review is required.",
                    "sampled_frames": sampled_frames,
                }
            encoded, frame_bytes = cv2.imencode(
                ".jpg",
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), 95],
            )
            if not encoded:
                return {
                    "status": "review_required",
                    "detail": VIDEO_FRAME_REVIEW_MESSAGE,
                    "sampled_frames": sampled_frames,
                }
            sampled_frames += 1
            detail = visual_tamper_forensics(frame_bytes.tobytes())
            if detail:
                return {
                    "status": "flagged",
                    "detail": detail,
                    "sampled_frames": sampled_frames,
                }

        if sampled_frames == 0:
            return {
                "status": "review_required",
                "detail": VIDEO_FRAME_REVIEW_MESSAGE,
                "sampled_frames": 0,
            }
        return {
            "status": "clear",
            "detail": f"No obvious edit detected in {sampled_frames} sampled video frames.",
            "sampled_frames": sampled_frames,
        }
    except Exception as exc:
        logger.warning("Local video frame authenticity analysis failed: %s", exc)
        return {
            "status": "review_required",
            "detail": "Video frame analysis was unavailable; manual authenticity review is required.",
            "sampled_frames": sampled_frames,
        }
    finally:
        if capture is not None:
            try:
                capture.release()
            except Exception:
                pass
        if temporary_path and os.path.exists(temporary_path):
            try:
                os.unlink(temporary_path)
            except Exception:
                pass


def diagnose_image_readability(content: bytes) -> dict | None:
    """Why OCR could not read this photo, in terms the resident can act on.

    "We could not read this photo" tells someone nothing they can do about it.
    The same measurements the quality gate already takes — size, focus,
    exposure, contrast — name the actual problem, so the retake fixes it
    instead of repeating it. Returns None when nothing measurable is wrong;
    the caller then falls back to its generic wording.
    """
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            grayscale = image.convert("L")
            stats = ImageStat.Stat(grayscale)
            brightness = float(stats.mean[0])
            contrast = float(stats.stddev[0])
            blur_variance = float(cv2.Laplacian(np.array(grayscale), cv2.CV_64F).var())
    except Exception:
        return None

    metrics = {
        "width": width,
        "height": height,
        "brightness": round(brightness, 1),
        "contrast": round(contrast, 1),
        "sharpness": round(blur_variance, 1),
    }

    # Ordered by what most often ruins a phone photo of a card, and by what a
    # resident can actually correct on the next try.
    if width < MIN_IMAGE_WIDTH or height < MIN_IMAGE_HEIGHT:
        reason, message = (
            "too_small",
            "The photo is too small to read. Move closer so the card fills the frame, "
            "and send the full-size photo rather than a shrunken copy.",
        )
    elif blur_variance < MIN_BLUR_VARIANCE:
        reason, message = (
            "out_of_focus",
            "The photo is out of focus. Rest the card on a flat surface, hold the phone "
            "steady, and tap the card on screen to focus before taking the shot.",
        )
    elif brightness < MIN_BRIGHTNESS:
        reason, message = (
            "too_dark",
            "The photo is too dark to read. Move somewhere brighter, or turn on a light "
            "facing the card.",
        )
    elif brightness > MAX_BRIGHTNESS:
        reason, message = (
            "too_bright",
            "The photo is washed out by glare. Turn off the flash and tilt the card away "
            "from the light.",
        )
    elif contrast < MIN_CONTRAST:
        reason, message = (
            "low_contrast",
            "The text does not stand out from the card. Try even, indirect light with no "
            "shadow across the card.",
        )
    else:
        return None

    return {"reason": reason, "message": message, "metrics": metrics}
