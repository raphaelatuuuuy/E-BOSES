from django.core.files.base import ContentFile

from apps.accounts.media_services import build_sanitized_preview_bytes


def ensure_emergency_media_preview(media):
    if media.preview_file and media.preview_file.name.lower().endswith(
        (".jpg", ".jpeg", ".png", ".webp")
    ):
        return media.preview_file
    if media.preview_file:
        media.preview_file.delete(save=False)
    media.preview_file.save(
        f"preview-{media.pk}.jpg",
        ContentFile(build_sanitized_preview_bytes(media.file, media.mime_type)),
        save=True,
    )
    return media.preview_file


def user_can_access_emergency_media(user, media):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff or user.role == user.Role.BARANGAY_OFFICIAL:
        return True
    return media.alert.reporter_id == user.pk or media.alert.assignments.filter(responder=user).exists()
