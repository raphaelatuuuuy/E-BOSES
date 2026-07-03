import hashlib
import importlib
import mimetypes
import secrets
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.core.signing import TimestampSigner
from django.db import transaction
from django.utils import timezone
from PIL import Image, UnidentifiedImageError

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

ALLOWED_PROOF_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png"}
ALLOWED_PROOF_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_PROOF_FILE_SIZE = 5 * 1024 * 1024


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
    b"%PDF-": "application/pdf",
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}
_EXTENSION_MIME_TYPES = {
    ".pdf": "application/pdf",
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
    name = getattr(original, "name", "upload") or "upload"
    if extension and Path(name).suffix.lower() != extension:
        name = f"{Path(name).stem}{extension}"
    normalized = InMemoryUploadedFile(
        file=BytesIO(content),
        field_name=getattr(original, "field_name", None),
        name=name,
        content_type=content_type,
        size=len(content),
        charset=getattr(original, "charset", None),
    )
    normalized._validated_upload = True
    normalized._detected_mime_type = content_type
    return normalized


def normalize_uploaded_file(uploaded_file, *, content, detected_mime_type):
    if detected_mime_type == "application/pdf":
        if b"%%EOF" not in content[-2048:]:
            raise ValidationError("PDF uploads must be well-formed documents.")
        return _as_uploaded_file(
            uploaded_file,
            content=content,
            content_type=detected_mime_type,
            extension=".pdf",
        )
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            output = BytesIO()
            if detected_mime_type == "image/jpeg":
                image.convert("RGB").save(output, format="JPEG", quality=90, optimize=True)
                extension = ".jpg"
            else:
                image.save(output, format="PNG", optimize=True)
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
        raise ValidationError(f"{profile.label} files must be PDF, JPG, JPEG, or PNG.")
    content = _read_upload(uploaded_file)
    detected_mime_type = detect_file_signature(content)
    expected_mime_type = _EXTENSION_MIME_TYPES.get(extension)
    claimed_mime_type = (
        getattr(uploaded_file, "content_type", "") or mimetypes.guess_type(uploaded_file.name)[0] or ""
    ).lower()
    if detected_mime_type not in profile.allowed_mime_types:
        raise ValidationError(f"{profile.label} files must be valid PDF, JPG, JPEG, or PNG files.")
    if detected_mime_type != expected_mime_type or (claimed_mime_type and claimed_mime_type != detected_mime_type):
        raise ValidationError("Uploaded file content does not match its extension or MIME type.")
    normalized_file = normalize_uploaded_file(uploaded_file, content=content, detected_mime_type=detected_mime_type)
    scan_uploaded_file(normalized_file, content=_read_upload(normalized_file), detected_mime_type=detected_mime_type)
    return normalized_file


def validate_residence_proof_file(uploaded_file):
    return validate_uploaded_media_file(uploaded_file, profile=RESIDENCE_PROOF_UPLOAD_PROFILE)


def validate_concern_media_file(uploaded_file):
    return validate_uploaded_media_file(uploaded_file, profile=CONCERN_MEDIA_UPLOAD_PROFILE)


def validate_emergency_media_file(uploaded_file):
    return validate_uploaded_media_file(uploaded_file, profile=EMERGENCY_MEDIA_UPLOAD_PROFILE)


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
    print(f"{channel.upper()} OTP for {destination}: {code}", flush=True)
    return challenge, code


def create_phone_otp_challenge(phone_number):
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = PhoneOTPChallenge.objects.create(
        phone_number=phone_number,
        destination_hash=hash_destination(phone_number),
        code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    print(f"SMS OTP for {phone_number}: {code}", flush=True)
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


def registration_proof_files(validated_data):
    return validated_data.get("proof_files") or [validated_data["proof"]]


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
    )
    proofs = []
    for proof_file in proof_files:
        proofs.append(
            ResidenceProof.objects.create(
                user=user,
                file=proof_file,
                original_filename=proof_file.name,
                mime_type=getattr(proof_file, "content_type", "") or "",
                file_size=proof_file.size,
                sha256_hash=sha256_file(proof_file),
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
    proof_files = [
        validate_residence_proof_file(proof_file) for proof_file in registration_proof_files(validated_data)
    ]
    validated_data["proof_files"] = proof_files
    proof_hashes = [sha256_file(proof_file) for proof_file in proof_files]
    duplicate_in_upload = len(set(proof_hashes)) != len(proof_hashes)
    duplicate_existing = ResidenceProof.objects.filter(sha256_hash__in=proof_hashes).exists()
    if duplicate_in_upload or duplicate_existing:
        raise DuplicateProofError("Duplicate proof upload detected.")

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
