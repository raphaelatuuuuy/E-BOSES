from apps.accounts.media_services import build_sanitized_preview_bytes
from apps.geo_services import validate_barangay_location  # noqa: F401 — re-export for backward compatibility
from django.core.files.base import ContentFile

from .models import ConcernAssignment, ConcernMedia


# States in which the protected copy may be served to the public. Everything
# else means a privacy run did not finish, or finished with something a person
# has to look at, and the media stays behind an authorised request.
PUBLICLY_DISPLAYABLE_STATES = {
    ConcernMedia.PrivacyState.NOT_REQUIRED,
    ConcernMedia.PrivacyState.PROTECTED,
}


def concern_media_is_publicly_displayable(media) -> bool:
    """Whether this photo's protected copy can be shown outside the barangay office.

    Both halves must agree. `privacy_state` says the pipeline reached a
    publishable conclusion; `public_visible` is the flag the pipeline sets at the
    same moment it writes the protected file. Requiring both means a row updated
    by only one of the two — a crashed run, a hand-edited record, an old row from
    before this pipeline existed — reads as restricted.
    """
    return media.privacy_state in PUBLICLY_DISPLAYABLE_STATES and bool(media.public_visible)


def ensure_concern_media_preview(media):
    """Return the protected copy, rendering a sanitized one if none exists yet.

    This used to run an OpenCV Haar face detector over every preview, blurring
    whatever it found regardless of what the report was about. That is gone:
    Gemma decides whether a scan is needed, SAM3 finds the regions, and
    `ai.privacy.service` writes the protected file. What remains here is the
    fallback for a media row that has no protected copy at all — a photo
    uploaded before the pipeline ran, or one whose privacy run has not landed.

    The fallback still never returns the original: it re-encodes and strips
    metadata. It also does not mark anything public — `public_visible` is only
    ever set by a privacy run, so a preview produced here is served to
    authorised users only.
    """
    if media.preview_file and media.preview_file.name:
        return media.preview_file
    media.preview_file.save(
        f"protected-{media.pk}.jpg",
        ContentFile(build_sanitized_preview_bytes(media.file, media.mime_type)),
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
