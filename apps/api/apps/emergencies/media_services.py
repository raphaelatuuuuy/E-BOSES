import hashlib
import os
import tempfile
from io import BytesIO
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile

from apps.accounts.media_forensics import analyze_video_authenticity, check_media_authenticity
from apps.accounts.media_services import build_redacted_preview_bytes
from apps.accounts.services import scan_uploaded_file, validate_emergency_media_file
from apps.media_utils import phash_file

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
    if preview_name and "/redacted-v4-sam3-" in preview_name and preview_name.endswith(".jpg"):
        return media.preview_file
    if media.preview_file:
        media.preview_file.delete(save=False)
    # The FieldFile caches the handle it opens for the read, and the preview
    # FileField keeps a reference back to the model instance, so the raw file
    # can stay locked on Windows until the cyclic garbage collector runs. Close
    # it explicitly or deleting the file in tests (or rotating it in prod)
    # hits WinError 32.
    with media.file.open("rb") as source:
        raw = source.read()
    protected = None
    try:
        from PIL import Image, ImageOps
        from apps.concerns.ai.privacy.masks import blur_regions, parse_regions
        from apps.concerns.ai.privacy.sam3_client import run_segmentation

        suffix = os.path.splitext(getattr(media, "original_filename", "") or "")[1] or ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(raw)
            temp_path = temporary.name
        try:
            payload = run_segmentation(temp_path, ["face", "person", "license plate"])
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        with Image.open(BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            image.load()
        regions = parse_regions(payload, image_width=image.width, image_height=image.height)
        if regions:
            output = BytesIO()
            blur_regions(image, regions).save(output, format="JPEG", quality=84, optimize=True)
            protected = output.getvalue()
    except Exception:
        protected = None
    if protected is None:
        from io import BytesIO as _BytesIO
        protected = build_redacted_preview_bytes(_BytesIO(raw), media.mime_type)
    media.preview_file.save(
        f"redacted-v4-sam3-{media.pk}.jpg",
        ContentFile(protected),
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
