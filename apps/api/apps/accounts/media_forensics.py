"""
EXIF and C2PA media authenticity checks for E-Boses.

Raises ValidationError if uploaded media is AI-generated, edited with
photo manipulation software, or contains tampered provenance data.
"""

import json as jsonlib
import struct
import tempfile
import os
from io import BytesIO

import cv2
import numpy as np
from django.core.exceptions import ValidationError
from PIL import Image, ImageChops, ImageStat

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
MIN_BLUR_VARIANCE = 70.0
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


def _normalize_name(name: str) -> str:
    return name.strip().lower()


def exif_forensics(content: bytes) -> str | None:
    """Check EXIF for editing/AI software. Returns error message or None."""
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
    """Check C2PA provenance for AI/editing assertions. Returns error message or None."""
    try:
        import c2pa
    except ImportError:
        return None

    tmp_path = None
    try:
        # c2pa-python Reader requires a file path, not bytes
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        reader = c2pa.Reader(tmp_path)
    except Exception:
        return None  # No C2PA manifest or parse error
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    if not reader.is_embedded():
        return None

    manifest = reader.get_active_manifest()
    if not manifest:
        return None

    manifest_json = jsonlib.loads(reader.json())
    return _recursive_search(manifest_json)


def png_metadata_forensics(content: bytes) -> str | None:
    """Check PNG text chunks for editing/AI software. Catches Canva, Procreate, etc."""
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
                        return "AI-generated media is not allowed." if kw in AI_SOFTWARE else "Edited or manipulated media is not allowed."
                if null_idx + 1 < len(chunk_data):
                    value = chunk_data[null_idx + 1 :].decode("latin-1", errors="replace").strip().lower()
                    for kw in AI_SOFTWARE | EDITING_SOFTWARE:
                        if kw in value:
                            return "AI-generated media is not allowed." if kw in AI_SOFTWARE else "Edited or manipulated media is not allowed."
    except Exception:
        pass
    return None


def check_image_quality(content: bytes) -> None:
    """Reject proof images too small or unreadable for OCR."""
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            if width < MIN_IMAGE_WIDTH or height < MIN_IMAGE_HEIGHT:
                raise ValidationError(f"Proof image must be at least {MIN_IMAGE_WIDTH}×{MIN_IMAGE_HEIGHT} pixels.")

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


def check_media_authenticity(content: bytes) -> None:
    """Run all forensics checks. Raises ValidationError on detection."""
    msg = exif_forensics(content) or png_metadata_forensics(content) or c2pa_forensics(content) or visual_tamper_forensics(content)
    if msg:
        raise ValidationError(msg)
