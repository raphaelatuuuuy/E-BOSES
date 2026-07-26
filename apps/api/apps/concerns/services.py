from django.core.files.base import ContentFile

from apps.accounts.media_services import build_redacted_preview_bytes
from apps.geo_services import validate_barangay_location  # noqa: F401 — re-export for backward compatibility
from .models import ConcernAssignment


def ensure_concern_media_preview(media):
    preview_name = (media.preview_file.name or "").lower() if media.preview_file else ""
    if preview_name and "/redacted-v2-" in preview_name and preview_name.endswith(".jpg"):
        return media.preview_file
    if media.preview_file:
        media.preview_file.delete(save=False)
    media.preview_file.save(
        f"redacted-v2-{media.pk}.jpg",
        ContentFile(build_redacted_preview_bytes(media.file, media.mime_type)),
        save=True,
    )
    return media.preview_file


def user_can_access_concern_media_raw(user, media):
    if not user or not user.is_authenticated:
        return False
    if not user.is_active:
        return False
    if user.is_superuser:
        return True
    if user.status != user.Status.VERIFIED:
        return False
    if user.is_staff or user.role == user.Role.BARANGAY_OFFICIAL:
        return True
    return user.pk == media.concern.reporter_id or media.concern.assignments.filter(
        assignee=user,
        status=ConcernAssignment.Status.ACTIVE,
    ).exists()
