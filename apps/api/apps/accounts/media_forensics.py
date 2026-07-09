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

from django.core.exceptions import ValidationError
from PIL import Image

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


def check_media_authenticity(content: bytes) -> None:
    """Run all forensics checks. Raises ValidationError on detection."""
    msg = exif_forensics(content) or png_metadata_forensics(content) or c2pa_forensics(content)
    if msg:
        raise ValidationError(msg)
