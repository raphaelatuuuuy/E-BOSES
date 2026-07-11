import hashlib
import importlib
import logging
import mimetypes
import secrets
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO
from pathlib import Path

import imagehash
from PIL import Image, ImageOps, ImageStat, UnidentifiedImageError

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

from .media_forensics import check_image_quality, check_media_authenticity
from .ocr import ocr_bytes, validate_barangay_id_ocr
from .models import (
    AuditLog,
    ConsentRecord,
    OTPChallenge,
    PhoneOTPChallenge,
    ResidenceProof,
    ResidentProfile,
    User,
    VerificationCheck,
)

PASSWORD_RESET_SALT = "accounts.password-reset"
PASSWORD_RESET_MAX_AGE_SECONDS = 15 * 60

ALLOWED_PROOF_MIME_TYPES = {"image/jpeg", "image/png"}
ALLOWED_PROOF_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_PROOF_FILE_SIZE = 2 * 1024 * 1024
MAX_IMAGE_WIDTH = 4000
MAX_IMAGE_HEIGHT = 4000
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
        if not settings.DEBUG:
            raise ImproperlyConfigured("Development OTP provider is only allowed when DEBUG=True.")
        print(f"Development OTP for {destination} ({purpose}): {code}", flush=True)
        logger.info("Development OTP for %s (%s): %s", destination, purpose, code)


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


class HTTPSMSOTPProvider(BaseOTPProvider):
    def deliver(self, destination, code, purpose):
        url = getattr(settings, "SMS_OTP_WEBHOOK_URL", "")
        if not url:
            raise ImproperlyConfigured("SMS_OTP_WEBHOOK_URL is required for http_sms OTP delivery.")
        response = httpx.post(
            url,
            json={"to": destination, "code": code, "purpose": purpose},
            headers={"Authorization": f"Bearer {getattr(settings, 'SMS_OTP_WEBHOOK_TOKEN', '')}"},
            timeout=10,
        )
        response.raise_for_status()


class DisabledOTPProvider(BaseOTPProvider):
    def deliver(self, destination, code, purpose):
        raise ImproperlyConfigured("No OTP provider is configured for this channel.")


def get_otp_provider(channel):
    provider_name = (
        settings.EMAIL_OTP_PROVIDER
        if channel == OTPChallenge.Channel.EMAIL
        else settings.SMS_OTP_PROVIDER
    )
    providers = {
        "development": DevelopmentOTPProvider,
        "django_email": DjangoEmailOTPProvider,
        "http_sms": HTTPSMSOTPProvider,
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
CONCERN_MEDIA_UPLOAD_PROFILE = RESIDENCE_PROOF_UPLOAD_PROFILE
EMERGENCY_MEDIA_UPLOAD_PROFILE = RESIDENCE_PROOF_UPLOAD_PROFILE
_SIGNATURE_MIME_TYPES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}
_EXTENSION_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
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


def normalize_uploaded_file(uploaded_file, *, content, detected_mime_type):
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            if width > MAX_IMAGE_WIDTH or height > MAX_IMAGE_HEIGHT:
                raise ValidationError(f"Images must be {MAX_IMAGE_WIDTH}×{MAX_IMAGE_HEIGHT} pixels or smaller.")
            output = BytesIO()
            if detected_mime_type == "image/jpeg":
                image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
                extension = ".jpg"
            else:
                clean = image.convert("RGBA") if image.mode in ("RGBA", "LA") else image.convert("RGB")
                clean.save(output, format="PNG", optimize=True)
                extension = ".png"
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError("Image uploads must be valid JPG or PNG files.") from exc
    return _as_uploaded_file(
        uploaded_file,
        content=output.getvalue(),
        content_type=detected_mime_type,
        extension=extension,
    )


def validate_uploaded_media_file(uploaded_file, *, profile=RESIDENCE_PROOF_UPLOAD_PROFILE):
    if uploaded_file.size > profile.max_size:
        raise ValidationError(f"{profile.label} files must be {profile.max_size // (1024 * 1024)}MB or smaller.")
    extension = _extension(uploaded_file)
    if extension not in profile.allowed_extensions:
        raise ValidationError(f"{profile.label} files must be JPG, JPEG, or PNG.")
    content = _read_upload(uploaded_file)
    detected_mime_type = detect_file_signature(content)
    expected_mime_type = _EXTENSION_MIME_TYPES.get(extension)
    claimed_mime_type = (
        getattr(uploaded_file, "content_type", "") or mimetypes.guess_type(uploaded_file.name)[0] or ""
    ).lower()
    if detected_mime_type not in profile.allowed_mime_types:
        raise ValidationError(f"{profile.label} files must be valid JPG, JPEG, or PNG files.")
    if detected_mime_type != expected_mime_type or (claimed_mime_type and claimed_mime_type != detected_mime_type):
        raise ValidationError("Uploaded file content does not match its extension or MIME type.")
    # Forensics: block AI-generated, edited, and unreadable media
    check_media_authenticity(content)
    check_image_quality(content)
    normalized_file = normalize_uploaded_file(uploaded_file, content=content, detected_mime_type=detected_mime_type)
    scan_uploaded_file(normalized_file, content=_read_upload(normalized_file), detected_mime_type=detected_mime_type)
    return normalized_file


def validate_residence_proof_file(uploaded_file):
    return validate_uploaded_media_file(uploaded_file, profile=RESIDENCE_PROOF_UPLOAD_PROFILE)


def validate_concern_media_file(uploaded_file):
    return validate_uploaded_media_file(uploaded_file, profile=CONCERN_MEDIA_UPLOAD_PROFILE)


def validate_emergency_media_file(uploaded_file):
    return validate_uploaded_media_file(uploaded_file, profile=EMERGENCY_MEDIA_UPLOAD_PROFILE)

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


def create_phone_otp_challenge(phone_number):
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = PhoneOTPChallenge.objects.create(
        phone_number=phone_number,
        destination_hash=hash_destination(phone_number),
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    deliver_otp(OTPChallenge.Channel.SMS, phone_number, code, OTPChallenge.Purpose.REGISTRATION)
    return challenge, code


def verify_phone_otp_challenge(phone_number, code, allow_verified=False):
    try:
        challenge = PhoneOTPChallenge.objects.filter(
            phone_number=phone_number,
        ).latest("created_at")
    except PhoneOTPChallenge.DoesNotExist as exc:
        raise OTPVerificationError("No active phone OTP challenge.") from exc

    if challenge.consumed_at:
        raise OTPVerificationError("This OTP has already been used.")
    if challenge.is_expired:
        raise OTPVerificationError("This OTP has expired.")
    if challenge.attempts >= challenge.max_attempts:
        raise OTPVerificationError("Too many OTP attempts.")
    if not check_password(code, challenge.code_hash):
        if challenge.verified_at:
            raise OTPVerificationError("This OTP has already been used.")
        challenge.attempts += 1
        challenge.save(update_fields=["attempts"])
        raise OTPVerificationError("Invalid OTP code.")
    if challenge.verified_at:
        if allow_verified:
            return challenge
        raise OTPVerificationError("This OTP has already been used.")

    challenge.verified_at = timezone.now()
    challenge.save(update_fields=["verified_at"])
    return challenge


def sha256_file(uploaded_file):
    digest = hashlib.sha256()
    current_position = uploaded_file.tell() if hasattr(uploaded_file, "tell") else None
    for chunk in uploaded_file.chunks():
        digest.update(chunk)
    if hasattr(uploaded_file, "seek"):
        uploaded_file.seek(current_position or 0)
    return digest.hexdigest()


def phash_file(content: bytes) -> str:
    """Compute perceptual hash (pHash) for image dedup via visual similarity."""
    try:
        with Image.open(BytesIO(content)) as image:
            return str(imagehash.phash(image))
    except (UnidentifiedImageError, OSError, ValueError):
        return ""


PHASH_DUPLICATE_THRESHOLD = 10
PHASH_BLOCK_DUPLICATE_THRESHOLD = 4
PHASH_BLOCK_MIN_SIZE = 96
PHASH_BLOCK_MIN_STDDEV = 8


def is_similar_phash(left: str, right: str, *, threshold=PHASH_DUPLICATE_THRESHOLD) -> bool:
    if not left or not right:
        return False
    try:
        return imagehash.hex_to_hash(left) - imagehash.hex_to_hash(right) <= threshold
    except ValueError:
        return False


def _phash_regions(width: int, height: int):
    yield (0, 0, width, height)

    for ratio in (0.8, 0.6):
        crop_width = int(width * ratio)
        crop_height = int(height * ratio)
        left = (width - crop_width) // 2
        top = (height - crop_height) // 2
        yield (left, top, left + crop_width, top + crop_height)

    for grid in (2, 3):
        tile_width = width // grid
        tile_height = height // grid
        for row in range(grid):
            for col in range(grid):
                left = col * tile_width
                top = row * tile_height
                right = width if col == grid - 1 else left + tile_width
                bottom = height if row == grid - 1 else top + tile_height
                yield (left, top, right, bottom)


def phash_blocks_file(content: bytes) -> list[str]:
    try:
        with Image.open(BytesIO(content)) as image:
            image = image.convert("RGB")
            hashes = []
            for box in _phash_regions(*image.size):
                crop = image.crop(box)
                width, height = crop.size
                if width < PHASH_BLOCK_MIN_SIZE or height < PHASH_BLOCK_MIN_SIZE:
                    continue
                if ImageStat.Stat(crop.convert("L")).stddev[0] < PHASH_BLOCK_MIN_STDDEV:
                    continue
                hashes.append(str(imagehash.phash(crop)))
            return list(dict.fromkeys(hashes))
    except (UnidentifiedImageError, OSError, ValueError):
        return []


def has_similar_phash_block(phash: str, blocks: list[str]) -> bool:
    if not phash or not blocks:
        return False
    return any(
        is_similar_phash(phash, block, threshold=PHASH_BLOCK_DUPLICATE_THRESHOLD)
        for block in blocks
    )


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
    validated_files = [
        validate_residence_proof_file(proof_file) for proof_file in proof_files
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
    profile = ResidentProfile.objects.create(
        user=user,
        first_name=validated_data["first_name"],
        middle_name=validated_data.get("middle_name", ""),
        last_name=validated_data["last_name"],
        date_of_birth=validated_data["date_of_birth"],
        address=validated_data["address"],
        barangay=validated_data.get("barangay") or "Pending",
        gender=validated_data.get("gender", ""),
        avatar=validated_data.get("avatar", ""),
    )
    proofs = []
    for proof_file in proof_files:
        raw_content = proof_file.read(); proof_file.seek(0)
        proofs.append(
            ResidenceProof.objects.create(
                user=user,
                file=proof_file,
                original_filename=proof_file.name,
                mime_type=getattr(proof_file, "content_type", "") or "",
                file_size=proof_file.size,
                sha256_hash=sha256_file(proof_file),
                phash=phash_file(raw_content),
                phash_blocks=phash_blocks_file(raw_content),
            )
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
    proof = user.residence_proofs.latest("uploaded_at")
    duplicate_exists = ResidenceProof.objects.filter(sha256_hash=proof.sha256_hash).exclude(user=user).exists()
    check = VerificationCheck.objects.create(
        user=user,
        proof=proof,
        duplicate_match_found=duplicate_exists,
        metadata={"adapter": "sha256_duplicate_checker_v1"},
    )
    now = timezone.now()
    if duplicate_exists:
        check.status = VerificationCheck.Status.FAILED
        check.failure_reason = "Duplicate proof upload detected."
        user.status = User.Status.REJECTED
        user.save(update_fields=["status", "updated_at"])
    else:
        check.status = VerificationCheck.Status.PASSED
        user.status = User.Status.VERIFIED
        user.save(update_fields=["status", "updated_at"])
    check.completed_at = now
    check.save(update_fields=["status", "failure_reason", "completed_at"])
    return check


@transaction.atomic
def register_resident(validated_data, request_meta=None):
    validated_data["request_meta"] = request_meta or {}
    phone_challenge = verify_phone_otp_challenge(
        validated_data["phone_number"],
        validated_data["phone_otp_code"],
        allow_verified=True,
    )
    proof_files = validate_residence_proof_uploads(registration_proof_files(validated_data))
    validated_data["proof_files"] = proof_files

    # OCR validation for barangay ID
    if validated_data.get("proof_type") == "barangay_id":
        for proof_file in proof_files:
            raw_content = _read_upload(proof_file)
            ocr_results = ocr_bytes(raw_content)
            user_data = {
                "first_name": validated_data["first_name"],
                "last_name": validated_data["last_name"],
                "address": validated_data["address"],
                "date_of_birth": str(validated_data["date_of_birth"]),
            }
            passed, reason, failed_field, details = validate_barangay_id_ocr(ocr_results, user_data)
            logger.info("OCR validation for %s: passed=%s, reason=%s, field=%s, details=%s",
                         validated_data.get("email", "?"), passed, reason, failed_field, details)
            if not passed:
                err = {failed_field: [reason]} if failed_field else {"proofOfResidency": [reason]}
                raise ValidationError(err)

    user = get_user_model().objects.create_user(
        email=validated_data["email"],
        phone_number=validated_data["phone_number"],
        password=validated_data["password"],
        phone_verified_at=phone_challenge.verified_at,
    )
    create_registration_profile(user, validated_data)
    create_otp_challenge(user, OTPChallenge.Channel.EMAIL, OTPChallenge.Purpose.REGISTRATION, user.email)
    phone_challenge.consumed_at = timezone.now()
    phone_challenge.save(update_fields=["consumed_at"])
    create_audit_log("auth.registered", actor=user, target_user=user, request_meta=request_meta)
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
            run_system_verification(user)
    return challenge


def create_password_reset_token(user):
    signer = TimestampSigner(salt=PASSWORD_RESET_SALT)
    return signer.sign(str(user.pk))


def read_password_reset_token(token):
    signer = TimestampSigner(salt=PASSWORD_RESET_SALT)
    user_id = signer.unsign(token, max_age=PASSWORD_RESET_MAX_AGE_SECONDS)
    return get_user_model().objects.get(pk=user_id)
