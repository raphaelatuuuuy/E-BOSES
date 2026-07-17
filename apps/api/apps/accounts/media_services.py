from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image, ImageDraw, ImageFilter, ImageOps, UnidentifiedImageError

from .services import create_audit_log

def build_sanitized_preview_bytes(file_obj, mime_type="", *, blur=False):
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
                image = image.filter(ImageFilter.GaussianBlur(radius=14))
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
    return build_sanitized_preview_bytes(file_obj, mime_type, blur=True)


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
        ContentFile(build_redacted_preview_bytes(proof.file, proof.mime_type)),
        save=True,
    )
    return proof.blurred_preview_file


def user_can_access_residence_proof_raw(user, proof):
    if not user or not user.is_authenticated:
        return False
    return user.is_superuser or user.is_staff or user.pk == proof.user_id or user.role == user.Role.BARANGAY_OFFICIAL


def log_raw_media_access(*, actor, target_user, media_type, object_id, request_meta=None):
    return create_audit_log(
        "media.raw_accessed",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        target_user=target_user,
        metadata={"media_type": media_type, "object_id": object_id},
        request_meta=request_meta,
    )
