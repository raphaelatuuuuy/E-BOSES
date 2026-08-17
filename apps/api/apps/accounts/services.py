import hashlib
import importlib
import logging
import mimetypes
import secrets
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

import httpx

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.mail import send_mail
from django.core.signing import TimestampSigner
from django.db import transaction
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.utils import timezone

from .media_forensics import (
    analyze_video_authenticity,
    c2pa_forensics,
    check_media_authenticity,
    check_image_quality,
    check_image_quality_soft,
    exif_forensics,
    png_metadata_forensics,
    visual_tamper_forensics,
)
from apps.media_utils import (
    sha256_file,
    phash_file,
    is_similar_phash,
    phash_blocks_file,
    has_similar_phash_block,
    PHASH_DUPLICATE_THRESHOLD,
)  # noqa: F401  (re-exported for existing `from apps.accounts.services import ...` call sites)
from .models import (
    AuditLog,
    ConsentRecord,
    OTPChallenge,
    EmailOTPChallenge,
    PhoneOTPChallenge,
    ResidenceProof,
    ResidentProfile,
    User,
    VerificationCheck,
)

PASSWORD_RESET_SALT = "accounts.password-reset"
PASSWORD_RESET_MAX_AGE_SECONDS = 15 * 60

ALLOWED_PROOF_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_PROOF_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_CONCERN_MEDIA_MIME_TYPES = {"image/jpeg", "image/png"}
ALLOWED_CONCERN_MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".png"}
# Phone gallery photos are often larger than 2MB; client compresses when possible.
MAX_PROOF_FILE_SIZE = 10 * 1024 * 1024
MAX_CHAT_ATTACHMENT_SIZE = 25 * 1024 * 1024
MAX_IMAGE_WIDTH = 4000
MAX_IMAGE_HEIGHT = 4000
# Reject decompress bombs before full-res NumPy forensics
MAX_DECODE_PIXELS = 25_000_000
logger = logging.getLogger(__name__)

MARIKINA_HEIGHTS_BOUNDS = {
    "min_latitude": 14.62,
    "max_latitude": 14.68,
    "min_longitude": 121.08,
    "max_longitude": 121.15,
}


class OTPDeliveryError(Exception):
    pass


class BaseOTPProvider:
    def deliver(self, destination, code, purpose):
        raise NotImplementedError


class DevelopmentOTPProvider(BaseOTPProvider):
    def deliver(self, destination, code, purpose):
        # Allow in local development even when DEBUG is temporarily false.
        if not (settings.DEBUG or getattr(settings, "IS_LOCAL_DEVELOPMENT", False)):
            raise ImproperlyConfigured("Development OTP provider is only allowed in local development.")
        # Console only, never the log file: a log with codes in it is a
        # credential store nobody remembers to protect.
        print(f"Development OTP for {destination} ({purpose}): {code}", flush=True)


class DjangoEmailOTPProvider(BaseOTPProvider):
    def deliver(self, destination, code, purpose):
        sent = send_mail(
            subject="Your E-Boses verification code",
            message=f"Your {purpose.replace('_', ' ')} verification code is {code}. It expires in 10 minutes.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[destination],
            fail_silently=False,
        )
        if sent != 1:
            raise OTPDeliveryError("Unable to deliver email OTP.")


class ResendOTPProvider(BaseOTPProvider):
    def deliver(self, destination, code, purpose):
        api_key = getattr(settings, "RESEND_API_KEY", "")
        if not api_key:
            raise ImproperlyConfigured("RESEND_API_KEY is not configured.")

        label = purpose.replace("_", " ")
        sender_name = getattr(settings, "RESEND_FROM_NAME", "") or "E-Boses"
        sender_email = getattr(settings, "RESEND_FROM_EMAIL", "") or settings.DEFAULT_FROM_EMAIL
        expiry_text = getattr(settings, "OTP_EMAIL_EXPIRY_TEXT", "") or "This code expires shortly."

        payload = {
            "from": f"{sender_name} <{sender_email}>",
            "to": [destination],
            "subject": "Your E-Boses verification code",
            "text": (
                f"Your {label} verification code is {code}.\n\n"
                f"{expiry_text}\n\n"
                "If you did not request this code, you can ignore this message."
            ),
            "html": _otp_email_html(code, label, expiry_text),
        }
        reply_to = getattr(settings, "RESEND_REPLY_TO", "")
        if reply_to:
            payload["reply_to"] = [reply_to]

        try:
            response = httpx.post(
                getattr(settings, "RESEND_API_URL", "https://api.resend.com/emails"),
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=getattr(settings, "RESEND_DELIVERY_TIMEOUT_SECONDS", 20.0),
            )
        except httpx.HTTPError as exc:
            logger.warning("resend delivery failed: %s", exc.__class__.__name__)
            raise OTPDeliveryError("Unable to deliver email OTP.") from exc

        if response.status_code >= 400:
            logger.warning("resend returned HTTP %s", response.status_code)
            raise OTPDeliveryError("Unable to deliver email OTP.")


def _otp_email_html(code, label, expiry_text):
    logo_url = getattr(settings, "OTP_EMAIL_LOGO_URL", "")
    logo = (
        f'<img src="{logo_url}" alt="E-Boses" height="40" style="display:block;margin-bottom:24px" />'
        if logo_url
        else ""
    )
    return (
        '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1c;'
        'max-width:480px;margin:0 auto;padding:32px 24px">'
        f"{logo}"
        '<p style="font-size:16px;line-height:1.6;margin:0 0 16px">'
        f"Your {label} verification code is:</p>"
        '<p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 16px">'
        f"{code}</p>"
        f'<p style="font-size:14px;color:#6b6b6b;line-height:1.6;margin:0 0 24px">{expiry_text}</p>'
        '<p style="font-size:13px;color:#8a8a8a;line-height:1.6;margin:0">'
        "If you did not request this code, you can safely ignore this message.</p>"
        "</div>"
    )


class GatewaySMSOTPProvider(BaseOTPProvider):
    """Send every SMS code through the one barangay gateway.

    Password reset and OTP resend used to post to their own
    SMS_OTP_WEBHOOK_URL, so a deployment that configured only the emergency
    gateway had a working registration flow and a silently broken password
    reset. There is now a single outbound path: OUTBOUND_SMS_*.
    """

    def deliver(self, destination, code, purpose):
        deliver_registration_otp(destination, code)


# Kept so an existing SMS_OTP_PROVIDER=http_sms setting does not crash on boot.
HTTPSMSOTPProvider = GatewaySMSOTPProvider


class DisabledOTPProvider(BaseOTPProvider):
    def deliver(self, destination, code, purpose):
        raise ImproperlyConfigured("No OTP provider is configured for this channel.")


def get_otp_provider(channel):
    if channel == OTPChallenge.Channel.SMS:
        # SMS always goes through the gateway; there is nothing else to pick.
        provider_name = settings.SMS_OTP_PROVIDER
        if provider_name in {"http_sms", "gateway"}:
            return GatewaySMSOTPProvider()
    provider_name = (
        settings.EMAIL_OTP_PROVIDER
        if channel == OTPChallenge.Channel.EMAIL
        else settings.SMS_OTP_PROVIDER
    )
    providers = {
        "development": DevelopmentOTPProvider,
        "django_email": DjangoEmailOTPProvider,
        "resend": ResendOTPProvider,
        "http_sms": GatewaySMSOTPProvider,
        "gateway": GatewaySMSOTPProvider,
        "disabled": DisabledOTPProvider,
    }
    try:
        return providers[provider_name]()
    except KeyError as exc:
        raise ImproperlyConfigured(f"Unknown OTP provider: {provider_name}") from exc


def deliver_otp(channel, destination, code, purpose):
    get_otp_provider(channel).deliver(destination, code, purpose)


@dataclass(frozen=True)
class UploadValidationProfile:
    label: str
    allowed_mime_types: frozenset[str]
    allowed_extensions: frozenset[str]
    max_size: int


RESIDENCE_PROOF_UPLOAD_PROFILE = UploadValidationProfile(
    label="Proof",
    allowed_mime_types=frozenset(ALLOWED_PROOF_MIME_TYPES),
    allowed_extensions=frozenset(ALLOWED_PROOF_EXTENSIONS),
    max_size=MAX_PROOF_FILE_SIZE,
)
CONCERN_MEDIA_UPLOAD_PROFILE = UploadValidationProfile(
    label="Report attachment",
    allowed_mime_types=frozenset(ALLOWED_CONCERN_MEDIA_MIME_TYPES),
    allowed_extensions=frozenset(ALLOWED_CONCERN_MEDIA_EXTENSIONS),
    max_size=MAX_PROOF_FILE_SIZE,
)
EMERGENCY_MEDIA_UPLOAD_PROFILE = UploadValidationProfile(
    label="Emergency attachment",
    allowed_mime_types=frozenset(ALLOWED_PROOF_MIME_TYPES),
    allowed_extensions=frozenset(ALLOWED_PROOF_EXTENSIONS),
    max_size=MAX_PROOF_FILE_SIZE,
)
CHAT_VIDEO_MIME_TYPES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
_SIGNATURE_MIME_TYPES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}
_EXTENSION_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _read_upload(uploaded_file):
    current_position = uploaded_file.tell() if hasattr(uploaded_file, "tell") else None
    if hasattr(uploaded_file, "seek"):
        uploaded_file.seek(0)
    content = uploaded_file.read()
    if hasattr(uploaded_file, "seek"):
        uploaded_file.seek(current_position or 0)
    return content


def detect_file_signature(content):
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    for signature, mime_type in _SIGNATURE_MIME_TYPES.items():
        if content.startswith(signature):
            return mime_type
    return ""


def _extension(uploaded_file):
    return Path(getattr(uploaded_file, "name", "") or "").suffix.lower()


def _scanner_callable():
    scanner_path = getattr(settings, "FILE_UPLOAD_SCANNER", "")
    if not scanner_path:
        return None
    module_path, function_name = scanner_path.rsplit(".", 1)
    return getattr(importlib.import_module(module_path), function_name)


def scan_uploaded_file(uploaded_file, *, content, detected_mime_type):
    scanner = _scanner_callable()
    if scanner is None:
        return
    verdict = scanner(uploaded_file=uploaded_file, content=content, detected_mime_type=detected_mime_type)
    if verdict is False or verdict == "infected":
        raise ValidationError("Uploaded file failed malware scanning.")


def _as_uploaded_file(original, *, content, content_type, extension=None):
    safe_name = f"{secrets.token_hex(16)}{extension or Path(getattr(original, 'name', 'upload') or 'upload').suffix}"
    normalized = InMemoryUploadedFile(
        file=BytesIO(content),
        field_name=getattr(original, "field_name", None),
        name=safe_name,
        content_type=content_type,
        size=len(content),
        charset=getattr(original, "charset", None),
    )
    normalized._validated_upload = True
    normalized._detected_mime_type = content_type
    return normalized


def normalize_uploaded_file(uploaded_file, *, content, detected_mime_type, deskew=True):
    """Validate and normalize proof images for storage/OCR.

    Handles:
    - EXIF orientation (phone photos)
    - Downscale if larger than MAX_IMAGE_WIDTH/HEIGHT (too big in pixels)
    - Optional auto card detect + perspective warp (deskew=True for resident proofs)
    - Re-encode to clean JPEG

    Template builder samples should pass deskew=False so official sample photos
    are not warped (which can introduce a slight slant on back-side images).
    """
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            # Downscale oversized photos instead of rejecting (gallery often exceeds limits)
            if width > MAX_IMAGE_WIDTH or height > MAX_IMAGE_HEIGHT:
                image.thumbnail((MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT), Image.Resampling.LANCZOS)
                width, height = image.size
            output = BytesIO()
            # Always prefer JPEG for OCR proofs after normalize (smaller, consistent)
            if detected_mime_type == "image/png" and image.mode in ("RGBA", "LA", "P"):
                clean = image.convert("RGBA") if image.mode in ("RGBA", "LA") else image.convert("P")
                if clean.mode == "P":
                    clean = clean.convert("RGBA")
                background = Image.new("RGB", clean.size, (255, 255, 255))
                if clean.mode == "RGBA":
                    background.paste(clean, mask=clean.split()[-1])
                else:
                    background.paste(clean)
                background.save(output, format="JPEG", quality=90, optimize=True)
            else:
                image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
            jpeg_bytes = output.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError("Image uploads must be valid JPG or PNG files.") from exc

    # Auto-crop / deskew only for resident proof photos (not template samples)
    if deskew:
        try:
            from .document_deskew import deskew_id_card_bytes

            deskewed, deskew_meta = deskew_id_card_bytes(jpeg_bytes)
            if deskew_meta.get("deskewed"):
                jpeg_bytes = deskewed
                logger.info("Proof image auto-deskewed: %s", deskew_meta)
        except Exception:
            logger.exception("Proof deskew skipped due to error")

    return _as_uploaded_file(
        uploaded_file,
        content=jpeg_bytes,
        content_type="image/jpeg",
        extension=".jpg",
    )


def _assert_pixel_budget(content: bytes) -> None:
    """Reject decompress bombs before full-res forensics / normalize."""
    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
    except Exception:
        return
    if width * height > MAX_DECODE_PIXELS:
        raise ValidationError(
            f"Image resolution is too high ({width}×{height}). Use a smaller photo."
        )


def validate_uploaded_media_file(
    uploaded_file,
    *,
    profile=RESIDENCE_PROOF_UPLOAD_PROFILE,
    strict=True,
    authenticity=None,
    quality=None,
    deskew=True,
    normalize=True,
):
    """
    authenticity: run media_forensics Layers 1–4 (default True when strict else False)
    quality: "strict" | "soft" | "none" (default "strict" when strict else "soft")
    """
    if authenticity is None:
        authenticity = bool(strict)
    if quality is None:
        quality = "strict" if strict else "soft"

    if uploaded_file.size > profile.max_size:
        raise ValidationError(
            f"{profile.label} files must be {profile.max_size // (1024 * 1024)}MB or smaller."
        )
    extension = _extension(uploaded_file)
    if extension not in profile.allowed_extensions:
        formats = "JPG, JPEG, or PNG" if profile is CONCERN_MEDIA_UPLOAD_PROFILE else "JPG, JPEG, PNG, or WebP"
        raise ValidationError(f"{profile.label} files must be {formats}.")
    content = _read_upload(uploaded_file)
    detected_mime_type = detect_file_signature(content)
    expected_mime_type = _EXTENSION_MIME_TYPES.get(extension)
    claimed_mime_type = (
        getattr(uploaded_file, "content_type", "") or mimetypes.guess_type(uploaded_file.name)[0] or ""
    ).lower()
    if detected_mime_type not in profile.allowed_mime_types:
        formats = "JPG, JPEG, or PNG" if profile is CONCERN_MEDIA_UPLOAD_PROFILE else "JPG, JPEG, PNG, or WebP"
        raise ValidationError(f"{profile.label} files must be valid {formats} files.")
    # Allow empty claimed MIME (common for gallery picks); only reject hard mismatches.
    if expected_mime_type and detected_mime_type != expected_mime_type:
        raise ValidationError("Uploaded file content does not match its extension or MIME type.")
    if claimed_mime_type and claimed_mime_type not in profile.allowed_mime_types and claimed_mime_type != detected_mime_type:
        # Some browsers send application/octet-stream for gallery files — allow if signature is valid.
        if claimed_mime_type not in {"application/octet-stream", "binary/octet-stream", ""}:
            if claimed_mime_type != detected_mime_type:
                raise ValidationError("Uploaded file content does not match its extension or MIME type.")

    _assert_pixel_budget(content)

    # Layers 1–4 authenticity (optional, independent of quality mode)
    if authenticity:
        check_media_authenticity(content)

    if quality == "strict":
        check_image_quality(content)
    elif quality == "soft":
        check_image_quality_soft(content)

    if not normalize:
        scan_uploaded_file(uploaded_file, content=content, detected_mime_type=detected_mime_type)
        return uploaded_file

    normalized_file = normalize_uploaded_file(
        uploaded_file,
        content=content,
        detected_mime_type=detected_mime_type,
        deskew=deskew,
    )
    scan_uploaded_file(
        normalized_file,
        content=_read_upload(normalized_file),
        detected_mime_type="image/jpeg",
    )
    return normalized_file


def validate_residence_proof_file(uploaded_file, *, strict=True, deskew=True, authenticity=None, quality=None, normalize=True):
    return validate_uploaded_media_file(
        uploaded_file,
        profile=RESIDENCE_PROOF_UPLOAD_PROFILE,
        strict=strict,
        authenticity=authenticity,
        quality=quality,
        deskew=deskew,
        normalize=normalize,
    )


def validate_residence_proof_file_preflight(uploaded_file):
    """Per-file preflight for /proof/check (ID upload): authenticity + soft quality.

    Layers 1–4 (C2PA / EXIF / tamper) stay on; Layer 5 uses soft quality for all
    environments (local and production) so phone photos are not over-rejected.
    Does not enforce multi-side completeness (front+back). Completeness is final registration.
    """
    return validate_residence_proof_file(
        uploaded_file,
        strict=True,
        authenticity=True,
        quality="soft",
        deskew=False,
        normalize=False,
    )


def validate_residence_proof_file_light(uploaded_file):
    """Type/size/signature only — no C2PA/authenticity (already done at ID upload)."""
    return validate_residence_proof_file(
        uploaded_file,
        strict=False,
        authenticity=False,
        quality="none",
        deskew=False,
        normalize=False,
    )


def validate_residence_proof_uploads_preflight(proof_files):
    """Preflight all files with forensics; optional SHA-256 / pHash duplicate rejection."""
    if not proof_files:
        raise ValidationError({"proof": ["Upload at least one valid government-issued ID or bill."]})
    if len(proof_files) > 2:
        raise ValidationError({"proof": ["You can upload a maximum of 2 files."]})
    for proof_file in proof_files:
        validate_residence_proof_file_preflight(proof_file)

    proof_hashes = [sha256_file(proof_file) for proof_file in proof_files]
    if len(set(proof_hashes)) != len(proof_hashes):
        raise DuplicateProofError("Duplicate proof upload detected.")
    if ResidenceProof.objects.filter(sha256_hash__in=proof_hashes).exists():
        raise DuplicateProofError("Duplicate proof upload detected.")

    proof_phashes = []
    proof_phash_blocks = []
    for proof_file in proof_files:
        content = _read_upload(proof_file)
        phash = phash_file(content)
        if phash:
            proof_phashes.append(phash)
        blocks = phash_blocks_file(content)
        if blocks:
            proof_phash_blocks.append(blocks)
    if any(
        is_similar_phash(left, right)
        for index, left in enumerate(proof_phashes)
        for right in proof_phashes[index + 1 :]
    ):
        raise DuplicateProofError("Duplicate proof upload detected.")
    if any(duplicate_phash_exists(phash) for phash in proof_phashes):
        raise DuplicateProofError("Duplicate proof upload detected.")
    if any(
        has_similar_phash_block(phash, blocks)
        for index, phash in enumerate(proof_phashes)
        for block_index, blocks in enumerate(proof_phash_blocks)
        if index != block_index
    ):
        raise DuplicateProofError("Duplicate proof upload detected.")
    if any(duplicate_phash_blocks_exists(phash) for phash in proof_phashes):
        raise DuplicateProofError("Duplicate proof upload detected.")
    return proof_files


def validate_residence_proof_uploads_for_detect(proof_files):
    """Detect/OCR path: soft quality only. Authenticity (incl. C2PA) already ran at upload."""
    return [
        validate_residence_proof_file(
            proof_file,
            authenticity=False,
            quality="soft",
            deskew=False,
            normalize=True,
            strict=False,
        )
        for proof_file in proof_files
    ]


def validate_concern_media_file(uploaded_file):
    return validate_uploaded_media_file(
        uploaded_file,
        profile=CONCERN_MEDIA_UPLOAD_PROFILE,
        authenticity=True,
        quality="soft",
        deskew=False,
    )


def validate_concern_chat_attachment(uploaded_file):
    """Validate a private concern-chat image/video and return review metadata.

    Images reuse the existing report quality and malware checks. Supported
    videos are container/scanner checked, then a bounded set of decoded frames
    is assessed locally. Any decoder or frame failure remains manual review.
    """
    if not uploaded_file or uploaded_file.size <= 0:
        raise ValidationError("Attach a non-empty image or video file.")
    if uploaded_file.size > MAX_CHAT_ATTACHMENT_SIZE:
        raise ValidationError("Chat attachments must be 25MB or smaller.")

    extension = _extension(uploaded_file)
    content = _read_upload(uploaded_file)
    detected_mime_type = detect_file_signature(content)
    if extension in CONCERN_MEDIA_UPLOAD_PROFILE.allowed_extensions:
        validated = validate_uploaded_media_file(
            uploaded_file,
            profile=CONCERN_MEDIA_UPLOAD_PROFILE,
            authenticity=False,
            quality="soft",
            deskew=False,
            normalize=False,
        )
        authenticity_detail = (
            exif_forensics(content)
            or png_metadata_forensics(content)
            or c2pa_forensics(content)
            or visual_tamper_forensics(content)
        )
        return (
            validated,
            detected_mime_type or getattr(uploaded_file, "content_type", "") or "image/jpeg",
            "image",
            "flagged" if authenticity_detail else "clear",
            authenticity_detail or "No obvious edit detected by the base media checks.",
        )

    expected_video_mime = next(
        (mime for mime, suffix in CHAT_VIDEO_MIME_TYPES.items() if suffix == extension),
        None,
    )
    if not expected_video_mime:
        raise ValidationError("Chat attachments must be JPG, PNG, WebP, MP4, WebM, or MOV files.")
    if expected_video_mime in {"video/mp4", "video/quicktime"} and b"ftyp" not in content[:128]:
        raise ValidationError("The video file signature does not match its extension.")
    if expected_video_mime == "video/webm" and not content.startswith(b"\x1a\x45\xdf\xa3"):
        raise ValidationError("The video file signature does not match its extension.")
    scan_uploaded_file(uploaded_file, content=content, detected_mime_type=expected_video_mime)
    authenticity = analyze_video_authenticity(content, extension=extension)
    return (
        uploaded_file,
        expected_video_mime,
        "video",
        authenticity["status"],
        authenticity["detail"],
    )


def validate_emergency_media_file(uploaded_file):
    return validate_uploaded_media_file(
        uploaded_file,
        profile=EMERGENCY_MEDIA_UPLOAD_PROFILE,
        authenticity=True,
        quality="soft",
        deskew=False,
    )

def validate_location_pair(latitude, longitude, *, required=False):
    if latitude is None or longitude is None:
        if required or latitude is not None or longitude is not None:
            raise ValidationError("Latitude and longitude must be provided together.")
        return
    latitude = float(latitude)
    longitude = float(longitude)
    if not -90 <= latitude <= 90:
        raise ValidationError({"latitude": "Latitude must be between -90 and 90."})
    if not -180 <= longitude <= 180:
        raise ValidationError({"longitude": "Longitude must be between -180 and 180."})
    bounds = MARIKINA_HEIGHTS_BOUNDS
    if not (
        bounds["min_latitude"] <= latitude <= bounds["max_latitude"]
        and bounds["min_longitude"] <= longitude <= bounds["max_longitude"]
    ):
        raise ValidationError("Location must be inside Barangay Marikina Heights.")


class OTPVerificationError(Exception):
    pass


class DuplicateProofError(Exception):
    pass


def create_audit_log(action, actor=None, target_user=None, metadata=None, request_meta=None):
    request_meta = request_meta or {}
    return AuditLog.objects.create(
        actor=actor,
        target_user=target_user,
        action=action,
        metadata=metadata or {},
        ip_address=request_meta.get("ip_address"),
        user_agent=request_meta.get("user_agent", ""),
    )


def hash_destination(destination):
    return hashlib.sha256(destination.lower().encode("utf-8")).hexdigest()


def create_otp_challenge(user, channel, purpose, destination):
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = OTPChallenge.objects.create(
        user=user,
        channel=channel,
        purpose=purpose,
        destination_hash=hash_destination(destination),
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    deliver_otp(channel, destination, code, purpose)
    return challenge, code


OTP_EXPIRY_MINUTES = 5
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_PER_NUMBER_PER_HOUR = 5


class OTPRateLimited(Exception):
    """Raised when a resend is asked for too soon or too often."""

    def __init__(self, message, retry_after=0):
        super().__init__(message)
        self.retry_after = int(retry_after)


def _otp_rate_key(destination):
    return f"otp-window:{hash_destination(destination)}"


def check_otp_rate_limit(destination):
    """Per-destination limits, on top of the IP-scoped DRF throttle.

    The DRF throttle is keyed by IP, so one attacker on a mobile network can
    cycle addresses and keep hammering a single victim's number. This limits
    the number itself.
    """
    now = timezone.now()
    latest = (
        PhoneOTPChallenge.objects.filter(phone_number=destination)
        .order_by("-created_at")
        .first()
    )
    if latest:
        elapsed = (now - latest.created_at).total_seconds()
        if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
            raise OTPRateLimited(
                "Please wait before asking for another code.",
                retry_after=OTP_RESEND_COOLDOWN_SECONDS - elapsed,
            )

    recent = PhoneOTPChallenge.objects.filter(
        phone_number=destination,
        created_at__gte=now - timedelta(hours=1),
    ).count()
    if recent >= OTP_MAX_PER_NUMBER_PER_HOUR:
        raise OTPRateLimited(
            "Too many codes were requested for this number. Try again later.",
            retry_after=OTP_RESEND_COOLDOWN_SECONDS * 5,
        )


def create_phone_otp_challenge(phone_number, *, enforce_rate_limit=True):
    """Issue a registration OTP for a phone number.

    The code is generated and verified here; the gateway only delivers the
    finished message. It is never logged, never returned in an API response,
    and never written to the outbound SMS record.
    """
    if enforce_rate_limit:
        check_otp_rate_limit(phone_number)

    # Any code still outstanding for this number stops working the moment a new
    # one is issued, so a resend cannot leave two valid codes in circulation.
    PhoneOTPChallenge.objects.filter(
        phone_number=phone_number,
        consumed_at__isnull=True,
        verified_at__isnull=True,
    ).update(consumed_at=timezone.now())

    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = PhoneOTPChallenge.objects.create(
        phone_number=phone_number,
        destination_hash=hash_destination(phone_number),
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=OTP_EXPIRY_MINUTES),
    )
    try:
        deliver_registration_otp(phone_number, code)
    except Exception as exc:
        challenge.delete()
        logger.warning("Phone OTP delivery failed: %s", type(exc).__name__)
        raise OTPDeliveryError(
            "SMS verification is not available right now. Please try again in a moment."
        ) from exc
    return challenge, code


def deliver_registration_otp(phone_number, code):
    """Compose the message here and hand the finished text to the gateway."""
    from apps.sms.gateway import SmsConfigurationError, deliver, queue_sms
    from apps.sms.models import SmsPurpose
    from apps.sms.templates import otp_message

    body = otp_message(code)
    message = queue_sms(
        phone_number,
        body,
        purpose=SmsPurpose.OTP,
        idempotency_key=f"otp:{hash_destination(phone_number)}:{timezone.now().timestamp():.0f}",
    )
    if message is None:
        raise OTPDeliveryError("That number cannot receive SMS.")

    # queue_sms hands off on transaction commit. Registration is synchronous, so
    # send now and surface a gateway outage immediately instead of telling the
    # user a code is coming that never arrives.
    try:
        result = deliver(message.pk, phone_number, body)
    except Exception as exc:
        raise OTPDeliveryError("The SMS gateway did not accept the code.") from exc

    if result == "skipped":
        if settings.DEBUG or getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
            return
        raise OTPDeliveryError("The SMS gateway is not available right now.")


def normalize_registration_email(email: str) -> str:
    return (email or "").strip().lower()


def create_email_otp_challenge(email):
    """Send a 6-digit code before the account exists (right after email/password)."""
    email = normalize_registration_email(email)
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = EmailOTPChallenge.objects.create(
        email=email,
        destination_hash=hash_destination(email),
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    try:
        deliver_otp(OTPChallenge.Channel.EMAIL, email, code, OTPChallenge.Purpose.REGISTRATION)
    except ImproperlyConfigured as exc:
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False) or settings.DEBUG:
            logger.warning("Email OTP delivery skipped: %s", type(exc).__name__)
        else:
            challenge.delete()
            raise OTPDeliveryError(
                "Email verification is not available right now. Please try again later."
            ) from exc
    except Exception as exc:
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False) or settings.DEBUG:
            logger.warning("Email OTP delivery failed: %s", type(exc).__name__)
        else:
            challenge.delete()
            raise OTPDeliveryError(
                "We could not send the email code. Check your address and try again in a moment."
            ) from exc
    return challenge, code


def verify_email_otp_challenge(email, code, allow_verified=False):
    email = normalize_registration_email(email)
    with transaction.atomic():
        try:
            challenge = EmailOTPChallenge.objects.select_for_update().filter(email=email).latest("created_at")
        except EmailOTPChallenge.DoesNotExist as exc:
            raise OTPVerificationError("No active email OTP challenge.") from exc

        if challenge.consumed_at:
            raise OTPVerificationError("This OTP has already been used.")
        # Already verified earlier in signup (email step) — accept even if the 10-min
        # window has passed, so finishing the multi-step form still works.
        if challenge.verified_at:
            if allow_verified:
                return challenge
            raise OTPVerificationError("This OTP has already been used.")
        if challenge.is_expired:
            raise OTPVerificationError("This OTP has expired.")
        if challenge.attempts >= challenge.max_attempts:
            raise OTPVerificationError("Too many OTP attempts.")
        invalid_code = not check_password(code, challenge.code_hash)
        if invalid_code:
            challenge.attempts += 1
            challenge.save(update_fields=["attempts"])
        else:
            challenge.verified_at = timezone.now()
            challenge.save(update_fields=["verified_at"])
    if invalid_code:
        raise OTPVerificationError("Invalid OTP code.")
    return challenge


def verify_phone_otp_challenge(phone_number, code, allow_verified=False):
    with transaction.atomic():
        try:
            challenge = PhoneOTPChallenge.objects.select_for_update().filter(
                phone_number=phone_number,
            ).latest("created_at")
        except PhoneOTPChallenge.DoesNotExist as exc:
            raise OTPVerificationError("No active phone OTP challenge.") from exc

        if challenge.consumed_at:
            raise OTPVerificationError("This OTP has already been used.")
        # Already verified earlier in signup (phone step) — accept on final register
        # even if the original OTP window has elapsed.
        if challenge.verified_at:
            if allow_verified:
                return challenge
            raise OTPVerificationError("This OTP has already been used.")
        if challenge.is_expired:
            raise OTPVerificationError("This OTP has expired.")
        if challenge.attempts >= challenge.max_attempts:
            raise OTPVerificationError("Too many OTP attempts.")
        invalid_code = not check_password(code, challenge.code_hash)
        if invalid_code:
            challenge.attempts += 1
            challenge.save(update_fields=["attempts"])
        else:
            challenge.verified_at = timezone.now()
            challenge.save(update_fields=["verified_at"])
    if invalid_code:
        raise OTPVerificationError("Invalid OTP code.")
    return challenge


def duplicate_phash_exists(phash: str) -> bool:
    if not phash:
        return False
    return any(
        is_similar_phash(phash, existing)
        for existing in ResidenceProof.objects.exclude(phash="").values_list("phash", flat=True)
    )


def duplicate_phash_blocks_exists(phash: str) -> bool:
    if not phash:
        return False
    return any(
        has_similar_phash_block(phash, existing_blocks)
        for existing_blocks in ResidenceProof.objects.exclude(phash_blocks=[]).values_list("phash_blocks", flat=True)
    )


def registration_proof_files(validated_data):
    return validated_data.get("proof_files") or [validated_data["proof"]]


def validate_residence_proof_uploads(proof_files):
    """Final register: file contract + duplicates + normalize. No C2PA (ran at ID upload)."""
    validated_files = [
        validate_residence_proof_file(
            proof_file,
            authenticity=False,
            quality="none",
            deskew=False,
            normalize=True,
            strict=False,
        )
        for proof_file in proof_files
    ]
    proof_hashes = [sha256_file(proof_file) for proof_file in validated_files]
    duplicate_in_upload = len(set(proof_hashes)) != len(proof_hashes)
    duplicate_existing = ResidenceProof.objects.filter(sha256_hash__in=proof_hashes).exists()
    if duplicate_in_upload or duplicate_existing:
        raise DuplicateProofError("Duplicate proof upload detected.")

    proof_phashes = []
    proof_phash_blocks = []
    for proof_file in validated_files:
        content = _read_upload(proof_file)
        phash = phash_file(content)
        if phash:
            proof_phashes.append(phash)
        blocks = phash_blocks_file(content)
        if blocks:
            proof_phash_blocks.append(blocks)

    duplicate_phash_in_upload = any(
        is_similar_phash(left, right)
        for index, left in enumerate(proof_phashes)
        for right in proof_phashes[index + 1:]
    )
    duplicate_phash_existing = any(duplicate_phash_exists(phash) for phash in proof_phashes)
    duplicate_block_in_upload = any(
        has_similar_phash_block(phash, blocks)
        for index, phash in enumerate(proof_phashes)
        for block_index, blocks in enumerate(proof_phash_blocks)
        if index != block_index
    )
    duplicate_block_existing = any(duplicate_phash_blocks_exists(phash) for phash in proof_phashes)
    if duplicate_phash_in_upload or duplicate_phash_existing or duplicate_block_in_upload or duplicate_block_existing:
        raise DuplicateProofError("Duplicate proof upload detected.")
    return validated_files


def create_registration_profile(user, validated_data):
    proof_files = registration_proof_files(validated_data)
    document_type = validated_data.get("_ocr_document_type")
    proof_sides = validated_data.get("_proof_sides") or [ResidenceProof.Side.SINGLE] * len(proof_files)
    profile = ResidentProfile.objects.create(
        user=user,
        first_name=validated_data["first_name"],
        middle_name=validated_data.get("middle_name", ""),
        last_name=validated_data["last_name"],
        date_of_birth=validated_data["date_of_birth"],
        address=validated_data["address"],
        barangay=validated_data.get("barangay") or "Marikina Heights",
        gender=validated_data.get("gender", ""),
        avatar=validated_data.get("avatar", ""),
    )
    proofs = []
    for proof_file, side in zip(proof_files, proof_sides):
        raw_content = proof_file.read(); proof_file.seek(0)
        proofs.append(
            ResidenceProof.objects.create(
                user=user,
                document_type=document_type,
                side=side,
                file=proof_file,
                original_filename=proof_file.name,
                mime_type=getattr(proof_file, "content_type", "") or "",
                file_size=proof_file.size,
                sha256_hash=sha256_file(proof_file),
                phash=phash_file(raw_content),
                phash_blocks=phash_blocks_file(raw_content),
            )
        )
    if document_type is not None:
        # Keep case creation in the same transaction as the resident and proof
        # rows.  The case remains awaiting_email until the second OTP is
        # verified, after which the worker queues OCR without blocking signup.
        from .ocr_runtime import create_registration_case

        create_registration_case(
            user,
            proofs,
            configuration=validated_data.get("_ocr_configuration"),
            document_type=document_type,
            sides=proof_sides,
        )
    ConsentRecord.objects.create(
        user=user,
        terms_version=validated_data["terms_version"],
        privacy_version=validated_data["privacy_version"],
        ip_address=(validated_data.get("request_meta") or {}).get("ip_address"),
        user_agent=(validated_data.get("request_meta") or {}).get("user_agent", ""),
    )
    return profile, proofs


def run_system_verification(user):
    """Backward-compatible entry point for callers that used the old sync check.

    Verification is now an asynchronous, configuration-pinned workflow.  The
    function intentionally only queues a case; provider errors become manual
    review and can never reject a resident from the request thread.
    """
    from .ocr_runtime import queue_user_verification

    return queue_user_verification(user, trigger=VerificationCheck.Trigger.SYSTEM)


@transaction.atomic
def register_resident(validated_data, request_meta=None):
    validated_data["request_meta"] = request_meta or {}
    email = normalize_registration_email(validated_data["email"])
    validated_data["email"] = email

    # Email OTP is verified during sign-up (right after email/password), before profile steps.
    email_challenge = verify_email_otp_challenge(
        email,
        validated_data["email_otp_code"],
        allow_verified=True,
    )
    phone_challenge = verify_phone_otp_challenge(
        validated_data["phone_number"],
        validated_data["phone_otp_code"],
        allow_verified=True,
    )
    proof_files = validate_residence_proof_uploads(registration_proof_files(validated_data))
    validated_data["proof_files"] = proof_files
    # Select and validate the published policy before creating the account.
    # This only validates the upload contract; OCR itself is always queued
    # after both OTPs are verified and never runs in the signup request.
    from .ocr_runtime import validate_registration_selection, queue_user_verification

    # Older clients did not send a type.  Keep their one/two-image contract
    # working with the broad government-ID default; new clients always send
    # an explicit catalog code and receive that type's stricter side rules.
    proof_type = validated_data.get("proof_type") or "government_id_with_address"
    configuration, document_type, proof_sides = validate_registration_selection(
        proof_type,
        proof_files,
        validated_data.get("proof_sides"),
    )
    validated_data["proof_type"] = proof_type
    validated_data["_ocr_configuration"] = configuration
    validated_data["_ocr_document_type"] = document_type
    validated_data["_proof_sides"] = proof_sides

    User = get_user_model()
    user = User.objects.create_user(
        email=email,
        phone_number=validated_data["phone_number"],
        password=validated_data["password"],
        email_verified_at=email_challenge.verified_at,
        phone_verified_at=phone_challenge.verified_at,
        status=User.Status.PENDING_VERIFICATION,
    )
    create_registration_profile(user, validated_data)
    email_challenge.consumed_at = timezone.now()
    email_challenge.save(update_fields=["consumed_at"])
    phone_challenge.consumed_at = timezone.now()
    phone_challenge.save(update_fields=["consumed_at"])
    create_audit_log("auth.registered", actor=user, target_user=user, request_meta=request_meta)
    if settings.AUTH_BACKEND == "supabase":
        from .supabase_admin import provision_supabase_user
        provision_supabase_user(user, validated_data["password"])
    queue_user_verification(user, trigger=VerificationCheck.Trigger.REGISTRATION)
    return user


def verify_otp_challenge(challenge, code):
    if challenge.verified_at:
        raise OTPVerificationError("This OTP has already been used.")
    if challenge.is_expired:
        raise OTPVerificationError("This OTP has expired.")
    if challenge.attempts >= challenge.max_attempts:
        raise OTPVerificationError("Too many OTP attempts.")
    if not check_password(code, challenge.code_hash):
        challenge.attempts += 1
        challenge.save(update_fields=["attempts"])
        raise OTPVerificationError("Invalid OTP code.")

    challenge.verified_at = timezone.now()
    challenge.save(update_fields=["verified_at"])
    user = challenge.user
    if challenge.purpose == OTPChallenge.Purpose.REGISTRATION:
        if challenge.channel == OTPChallenge.Channel.EMAIL:
            user.email_verified_at = challenge.verified_at
        if challenge.channel == OTPChallenge.Channel.SMS:
            user.phone_verified_at = challenge.verified_at
        if user.email_verified_at and user.phone_verified_at and user.status == User.Status.PENDING_OTP:
            user.status = User.Status.PENDING_VERIFICATION
        user.save(update_fields=["email_verified_at", "phone_verified_at", "status", "updated_at"])
        if user.status == User.Status.PENDING_VERIFICATION:
            from .ocr_runtime import queue_user_verification

            queue_user_verification(user, trigger=VerificationCheck.Trigger.REGISTRATION)
    return challenge


def create_password_reset_token(user):
    signer = TimestampSigner(salt=PASSWORD_RESET_SALT)
    return signer.sign(str(user.pk))


def read_password_reset_token(token):
    signer = TimestampSigner(salt=PASSWORD_RESET_SALT)
    user_id = signer.unsign(token, max_age=PASSWORD_RESET_MAX_AGE_SECONDS)
    return get_user_model().objects.get(pk=user_id)
