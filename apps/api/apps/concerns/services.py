from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile

from apps.accounts.media_services import build_sanitized_preview_bytes
from apps.geo_services import classify_location


def validate_barangay_location(latitude, longitude):
    """
    Accept pins inside Marikina Heights or within a small edge buffer (~280 m).
    Reject locations that are far outside the barangay / Marikina City.
    """
    if latitude is None or longitude is None:
        raise ValidationError("Latitude and longitude must be provided together.")
    result = classify_location(latitude, longitude)
    if not result.get("accepted"):
        raise ValidationError(result.get("message") or "Location must be inside Barangay Marikina Heights.")


def ensure_concern_media_preview(media):
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


def user_can_access_concern_media_raw(user, media):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff or user.role == user.Role.BARANGAY_OFFICIAL:
        return True
    return user.pk == media.concern.reporter_id
