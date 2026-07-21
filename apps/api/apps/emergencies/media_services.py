import hashlib
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile

from apps.accounts.media_forensics import analyze_video_authenticity, check_media_authenticity
from apps.accounts.media_services import build_redacted_preview_bytes
from apps.accounts.services import phash_file, scan_uploaded_file, validate_emergency_media_file

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_MIME_BY_EXTENSION = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}
MAX_CHAT_VIDEO_SIZE = 25 * 1024 * 1024


def _read_upload(uploaded_file):
    uploaded_file.seek(0)
    content = uploaded_file.read()
    uploaded_file.seek(0)
    return content


def validate_chat_attachment(uploaded_file):
    extension = Path(uploaded_file.name or "").suffix.lower()
    if extension in IMAGE_EXTENSIONS:
        validated = validate_emergency_media_file(uploaded_file)
        content = _read_upload(validated)
        try:
            check_media_authenticity(content)
        except ValidationError as exc:
            return validated, {
                "media_type": "image",
                "mime_type": validated.content_type,
                "sha256_hash": hashlib.sha256(content).hexdigest(),
                "phash": phash_file(content),
                "analysis_status": "complete",
                "analysis": {"authenticity": "detected", "edited": True, "reason": str(exc)},
            }
        except Exception:
            analysis_status = "unavailable"
        else:
            # The detector finding nothing is not proof that media is authentic or unedited.
            analysis_status = "pending"
        return validated, {
            "media_type": "image",
            "mime_type": validated.content_type,
            "sha256_hash": hashlib.sha256(content).hexdigest(),
            "phash": phash_file(content),
            "analysis_status": analysis_status,
            "analysis": {},
        }

    expected_mime = VIDEO_MIME_BY_EXTENSION.get(extension)
    if not expected_mime:
        raise ValidationError("Chat attachments must be JPG, PNG, WebP, MP4, MOV, or WebM.")
    if uploaded_file.size > MAX_CHAT_VIDEO_SIZE:
        raise ValidationError("Chat video attachments must be 25MB or smaller.")
    content = _read_upload(uploaded_file)
    claimed_mime = (getattr(uploaded_file, "content_type", "") or "").lower()
    if extension == ".webm":
        valid_container = content.startswith(b"\x1aE\xdf\xa3")
    else:
        valid_container = len(content) >= 12 and content[4:8] == b"ftyp"
    if not valid_container or claimed_mime not in {expected_mime, "application/octet-stream"}:
        raise ValidationError("Video content does not match its extension or MIME type.")
    scan_uploaded_file(uploaded_file, content=content, detected_mime_type=expected_mime)
    authenticity = analyze_video_authenticity(content, extension=extension)
    if authenticity["status"] == "clear":
        analysis_status = "complete"
        analysis = {
            "authenticity": "clear",
            "edited": False,
            "reason": authenticity["detail"],
            "frame_tamper": "sampled_clear",
            "sampled_frames": authenticity["sampled_frames"],
            "manual_review_required": False,
        }
    elif authenticity["status"] == "flagged":
        analysis_status = "complete"
        analysis = {
            "authenticity": "detected",
            "edited": True,
            "reason": authenticity["detail"],
            "frame_tamper": "detected",
            "sampled_frames": authenticity["sampled_frames"],
            "manual_review_required": True,
        }
    else:
        analysis_status = "unavailable"
        analysis = {
            "authenticity": "unavailable",
            "edited": "unavailable",
            "reason": authenticity["detail"],
            "frame_tamper": "review_required",
            "sampled_frames": authenticity["sampled_frames"],
            "manual_review_required": True,
        }
    return uploaded_file, {
        "media_type": "video",
        "mime_type": expected_mime,
        "sha256_hash": hashlib.sha256(content).hexdigest(),
        "phash": "",
        "analysis_status": analysis_status,
        "analysis": analysis,
    }


def ensure_emergency_media_preview(media):
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


def user_can_access_emergency_media(user, media):
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
    return media.alert.reporter_id == user.pk or media.alert.assignments.filter(
        responder=user,
        status__in=["assigned", "acknowledged", "en_route", "arrived"],
    ).exists()


def ensure_chat_attachment_preview(attachment):
    if attachment.media_type != "image":
        return None
    return ensure_emergency_media_preview(attachment)
