from django.core.files.base import ContentFile

from .services import create_audit_log

PREVIEW_PREFIX = b"E-BOSES SAFE PREVIEW\n"


def build_redacted_preview_bytes(_file_obj, mime_type=""):
    """Create a deterministic privacy-safe preview placeholder for sensitive media."""
    return PREVIEW_PREFIX + f"redacted:{mime_type or 'application/octet-stream'}".encode("utf-8")


def ensure_residence_proof_preview(proof):
    if proof.blurred_preview_file:
        return proof.blurred_preview_file
    preview_name = f"preview-{proof.pk}.txt"
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
