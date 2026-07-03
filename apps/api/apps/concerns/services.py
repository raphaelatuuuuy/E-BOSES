from django.core.files.base import ContentFile

from apps.accounts.media_services import build_redacted_preview_bytes


def ensure_concern_media_preview(media):
    if media.preview_file:
        return media.preview_file
    media.preview_file.save(
        f"preview-{media.pk}.txt",
        ContentFile(build_redacted_preview_bytes(media.file, media.mime_type)),
        save=True,
    )
    return media.preview_file


def user_can_access_concern_media_raw(user, media):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff or user.role == user.Role.BARANGAY_OFFICIAL:
        return True
    return user.pk == media.concern.reporter_id
