from io import BytesIO
from pathlib import Path

from django.core.files.base import ContentFile
from PIL import Image, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError

from .services import create_audit_log


def _detect_sensitive_regions(image):
    """Return face/plate boxes, or None when local detection cannot run."""
    try:
        import cv2
        import numpy as np

        grayscale = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
        cascade_root = Path(cv2.data.haarcascades)
        face_detector = cv2.CascadeClassifier(str(cascade_root / "haarcascade_frontalface_default.xml"))
        if face_detector.empty():
            return None
        detectors = [
            (face_detector, {"scaleFactor": 1.1, "minNeighbors": 5, "minSize": (24, 24)}),
        ]
        plate_path = cascade_root / "haarcascade_russian_plate_number.xml"
        if plate_path.exists():
            plate_detector = cv2.CascadeClassifier(str(plate_path))
            if not plate_detector.empty():
                detectors.append(
                    (plate_detector, {"scaleFactor": 1.08, "minNeighbors": 4, "minSize": (30, 10)})
                )

        width, height = image.size
        regions = []
        for detector, options in detectors:
            for x, y, box_width, box_height in detector.detectMultiScale(grayscale, **options):
                padding_x = max(4, int(box_width * 0.15))
                padding_y = max(4, int(box_height * 0.15))
                regions.append(
                    (
                        max(0, int(x) - padding_x),
                        max(0, int(y) - padding_y),
                        min(width, int(x + box_width) + padding_x),
                        min(height, int(y + box_height) + padding_y),
                    )
                )
        return regions
    except Exception:
        return None


def _redact_sensitive_regions(image):
    regions = _detect_sensitive_regions(image)
    if regions is None:
        # Privacy must fail closed if the local detector is unavailable.
        return image.filter(ImageFilter.GaussianBlur(radius=14))
    redacted = image.copy()
    for box in regions:
        left, top, right, bottom = box
        if right <= left or bottom <= top:
            continue
        crop = redacted.crop(box)
        radius = max(8, min(right - left, bottom - top) // 5)
        redacted.paste(crop.filter(ImageFilter.GaussianBlur(radius=radius)), box)
    return redacted

def build_sanitized_preview_bytes(file_obj, mime_type="", *, blur=False, sensitive_regions=False):
    """Create a displayable JPEG preview with metadata removed."""
    position = file_obj.tell() if hasattr(file_obj, "tell") else None
    try:
        if hasattr(file_obj, "seek"):
            file_obj.seek(0)
        content = file_obj.read()
        with Image.open(BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            if blur:
                image = (
                    _redact_sensitive_regions(image)
                    if sensitive_regions
                    else image.filter(ImageFilter.GaussianBlur(radius=14))
                )
    except (UnidentifiedImageError, OSError, ValueError):
        image = Image.new("RGB", (960, 540), "#f5f5f0")
        draw = ImageDraw.Draw(image)
        draw.text((48, 48), "Preview unavailable", fill="#020c4e")
        draw.text((48, 82), mime_type or "Unsupported file format", fill="#5b6475")
    finally:
        if hasattr(file_obj, "seek"):
            file_obj.seek(position or 0)

    output = BytesIO()
    image.save(output, format="JPEG", quality=84, optimize=True)
    return output.getvalue()


def build_redacted_preview_bytes(file_obj, mime_type=""):
    return build_sanitized_preview_bytes(file_obj, mime_type, blur=True, sensitive_regions=True)


def ensure_residence_proof_preview(proof):
    if proof.blurred_preview_file and proof.blurred_preview_file.name.lower().endswith(
        (".jpg", ".jpeg", ".png", ".webp")
    ):
        return proof.blurred_preview_file
    if proof.blurred_preview_file:
        proof.blurred_preview_file.delete(save=False)
    preview_name = f"preview-{proof.pk}.jpg"
    proof.blurred_preview_file.save(
        preview_name,
        ContentFile(build_sanitized_preview_bytes(proof.file, proof.mime_type, blur=True)),
        save=True,
    )
    return proof.blurred_preview_file


def user_can_access_residence_proof_raw(user, proof):
    if not user or not user.is_authenticated:
        return False
    if not user.is_active:
        return False
    if user.is_superuser:
        return True
    if user.status != user.Status.VERIFIED:
        return False
    return user.is_staff or user.pk == proof.user_id or user.role == user.Role.BARANGAY_OFFICIAL


def log_raw_media_access(*, actor, target_user, media_type, object_id, request_meta=None):
    return create_audit_log(
        "media.raw_accessed",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        target_user=target_user,
        metadata={"media_type": media_type, "object_id": object_id},
        request_meta=request_meta,
    )
