import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.signing import TimestampSigner
from django.db import transaction
from django.utils import timezone

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


def verify_phone_otp_challenge(phone_number, code):
    try:
        challenge = PhoneOTPChallenge.objects.filter(
            phone_number=phone_number,
        ).latest("created_at")
    except PhoneOTPChallenge.DoesNotExist as exc:
        raise OTPVerificationError("No active phone OTP challenge.") from exc

    if challenge.is_expired:
        raise OTPVerificationError("This OTP has expired.")
    if not check_password(code, challenge.code_hash):
        if challenge.verified_at:
            raise OTPVerificationError("Invalid OTP code.")
        if challenge.attempts >= challenge.max_attempts:
            raise OTPVerificationError("Too many OTP attempts.")
        challenge.attempts += 1
        challenge.save(update_fields=["attempts"])
        raise OTPVerificationError("Invalid OTP code.")
    if challenge.verified_at:
        return challenge
    if challenge.attempts >= challenge.max_attempts:
        raise OTPVerificationError("Too many OTP attempts.")

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
    )
    proof_hashes = [sha256_file(proof_file) for proof_file in registration_proof_files(validated_data)]
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
    create_audit_log("auth.registered", actor=user, target_user=user, request_meta=request_meta)
    return user


def verify_otp_challenge(challenge, code):
    if challenge.verified_at:
        return challenge
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
