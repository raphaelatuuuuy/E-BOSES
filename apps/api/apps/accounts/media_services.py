from io import BytesIO
from pathlib import Path

from django.core.files.base import ContentFile
from PIL import Image, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError

from .services import create_audit_log


def _redaction_settings():
    return {
        "enabled": True,
        "faces": True,
        "profile_faces": True,
        "license_plates": True,
        "strength": 14,
        "padding": 0.15,
        "fallback": "blur_full_image",
    }


def _detect_sensitive_regions(image, *, faces=True, profile_faces=True, license_plates=False):
    """Return face/plate boxes, or None when local detection cannot run."""
    try:
        import cv2
        import numpy as np

        grayscale = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
        cascade_root = Path(cv2.data.haarcascades)
        detectors = []
        if faces:
            face_detector = cv2.CascadeClassifier(str(cascade_root / "haarcascade_frontalface_default.xml"))
            if not face_detector.empty():
                detectors.append(("face", face_detector, {"scaleFactor": 1.1, "minNeighbors": 5, "minSize": (24, 24)}))
            profile_path = cascade_root / "haarcascade_profileface.xml"
            if profile_faces and profile_path.exists():
                profile_detector = cv2.CascadeClassifier(str(profile_path))
                if not profile_detector.empty():
                    detectors.append(("profile face", profile_detector, {"scaleFactor": 1.08, "minNeighbors": 4, "minSize": (24, 24)}))
        if license_plates:
            for filename in ("haarcascade_russian_plate_number.xml", "haarcascade_license_plate_rus_16stages.xml"):
                plate_path = cascade_root / filename
                if plate_path.exists():
                    plate_detector = cv2.CascadeClassifier(str(plate_path))
                    if not plate_detector.empty():
                        detectors.append(("license plate", plate_detector, {"scaleFactor": 1.08, "minNeighbors": 4, "minSize": (30, 10)}))

        width, height = image.size
        regions = []
        for label, detector, options in detectors:
            for x, y, box_width, box_height in detector.detectMultiScale(grayscale, **options):
                padding_x = max(4, int(box_width * 0.15))
                padding_y = max(4, int(box_height * 0.15))
                regions.append(
                    (
                        label,
                        max(0, int(x) - padding_x),
                        max(0, int(y) - padding_y),
                        min(width, int(x + box_width) + padding_x),
                        min(height, int(y + box_height) + padding_y),
                    )
                )
        return regions
    except Exception:
        return None


def _redact_sensitive_regions(image, *, settings_map):
    regions = _detect_sensitive_regions(
        image,
        faces=settings_map["faces"],
        profile_faces=settings_map["profile_faces"],
        license_plates=settings_map["license_plates"],
    )
    if regions is None:
        # Privacy must fail closed if the local detector is unavailable.
        if settings_map["fallback"] == "grayscale":
            return ImageOps.grayscale(image).convert("RGB")
        return image.filter(ImageFilter.GaussianBlur(radius=settings_map["strength"]))
    redacted = image.copy()
    for _label, left, top, right, bottom in regions:
        if right <= left or bottom <= top:
            continue
        box = (left, top, right, bottom)
        crop = redacted.crop(box)
        radius = max(8, settings_map["strength"])
        redacted.paste(crop.filter(ImageFilter.GaussianBlur(radius=radius)), box)
    return redacted

def build_sanitized_preview_bytes(file_obj, mime_type="", *, blur=False, sensitive_regions=False, redaction_config=None):
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
                config = redaction_config or _redaction_settings()
                if sensitive_regions and config["enabled"]:
                    image = _redact_sensitive_regions(image, settings_map=config)
                elif config["fallback"] == "grayscale":
                    image = ImageOps.grayscale(image).convert("RGB")
                else:
                    image = image.filter(ImageFilter.GaussianBlur(radius=config["strength"]))
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


_PLACEHOLDER_PREVIEW_BYTES = None


def placeholder_preview_jpeg(message="Preview is being prepared."):
    """Tiny neutral JPEG served while a preview has not been generated yet.

    Never leaks the original: it is a generated image, not derived from any
    upload. Cached at module level so hot endpoints do not re-encode it.
    """
    global _PLACEHOLDER_PREVIEW_BYTES
    if _PLACEHOLDER_PREVIEW_BYTES is None:
        image = Image.new("RGB", (960, 540), "#eef0f4")
        draw = ImageDraw.Draw(image)
        draw.text((48, 48), message, fill="#5b6475")
        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=70)
        _PLACEHOLDER_PREVIEW_BYTES = buffer.getvalue()
    return _PLACEHOLDER_PREVIEW_BYTES


def detect_redaction_regions(file_obj, *, faces=True, profile_faces=True, license_plates=False, padding=0.15):
    position = file_obj.tell() if hasattr(file_obj, "tell") else None
    try:
        if hasattr(file_obj, "seek"):
            file_obj.seek(0)
        content = file_obj.read()
        with Image.open(BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            regions = _detect_sensitive_regions(
                image,
                faces=faces,
                profile_faces=profile_faces,
                license_plates=license_plates,
            )
            if regions is None:
                return None, image
            width, height = image.size
            padded = []
            for label, left, top, right, bottom in regions:
                box_width = right - left
                box_height = bottom - top
                padding_x = max(4, int(box_width * padding))
                padding_y = max(4, int(box_height * padding))
                padded.append(
                    {
                        "label": label,
                        "bbox": [
                            max(0, left - padding_x),
                            max(0, top - padding_y),
                            min(width, right + padding_x),
                            min(height, bottom + padding_y),
                        ],
                    }
                )
            return padded, image
    finally:
        if hasattr(file_obj, "seek"):
            file_obj.seek(position or 0)


def render_redaction_preview(image, detections, *, blur_radius=14):
    annotated = image.copy()
    redacted = image.copy()
    for detection in detections or []:
        left, top, right, bottom = [int(value) for value in detection["bbox"]]
        label = detection.get("label", "face")
        crop = redacted.crop((left, top, right, bottom))
        redacted.paste(crop.filter(ImageFilter.GaussianBlur(radius=blur_radius)), (left, top, right, bottom))
        draw = ImageDraw.Draw(annotated)
        draw.rectangle((left, top, right, bottom), outline="#ff6a00", width=4)
        text = label
        text_box = draw.textbbox((left, top), text)
        text_height = text_box[3] - text_box[1]
        text_width = text_box[2] - text_box[0]
        label_top = max(0, top - text_height - 10)
        label_bg = (left, label_top, min(annotated.size[0], left + text_width + 16), label_top + text_height + 8)
        draw.rectangle(label_bg, fill="#ff6a00")
        draw.text((label_bg[0] + 8, label_bg[1] + 3), text, fill="#ffffff")
    return annotated, redacted


def ensure_residence_proof_preview(proof):
    if proof.blurred_preview_file and proof.blurred_preview_file.name.lower().endswith(
        (".jpg", ".jpeg", ".png", ".webp")
    ):
        return proof.blurred_preview_file
    if proof.blurred_preview_file:
        proof.blurred_preview_file.delete(save=False)
    preview_name = f"preview-{proof.pk}.jpg"
    with proof.file.open("rb") as source:
        proof.blurred_preview_file.save(
            preview_name,
            ContentFile(build_sanitized_preview_bytes(source, proof.mime_type, blur=True)),
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
    if user.is_superuser or user.pk == proof.user_id:
        return True
    from apps.capabilities import MANAGE_USERS, user_has_capability

    return user.role == user.Role.BARANGAY_OFFICIAL and user_has_capability(user, MANAGE_USERS)


def log_raw_media_access(*, actor, target_user, media_type, object_id, request_meta=None):
    return create_audit_log(
        "media.raw_accessed",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        target_user=target_user,
        metadata={"media_type": media_type, "object_id": object_id},
        request_meta=request_meta,
    )
