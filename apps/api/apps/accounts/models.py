from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone

from .storage import PrivateMediaStorage


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Email is required.")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        extra_fields.setdefault("role", User.Role.RESIDENT)
        extra_fields.setdefault("status", User.Status.PENDING_OTP)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.BARANGAY_OFFICIAL)
        extra_fields.setdefault("status", User.Status.VERIFIED)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    class Role(models.TextChoices):
        RESIDENT = "resident", "Resident"
        BARANGAY_OFFICIAL = "barangay_official", "Barangay Official"
        FIRST_RESPONDER = "first_responder", "First Responder"

    class Status(models.TextChoices):
        PENDING_OTP = "pending_otp", "Pending OTP"
        PENDING_PROFILE = "pending_profile", "Pending Profile"
        PENDING_VERIFICATION = "pending_verification", "Pending Verification"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Rejected"
        SUSPENDED = "suspended", "Suspended"

    username = None
    email = models.EmailField(unique=True)
    phone_number = models.CharField(max_length=16, unique=True, blank=True)
    role = models.CharField(max_length=32, choices=Role.choices, default=Role.RESIDENT)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.PENDING_OTP)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email


class ResidentProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="resident_profile")
    first_name = models.CharField(max_length=50)
    middle_name = models.CharField(max_length=50, blank=True)
    last_name = models.CharField(max_length=50)
    date_of_birth = models.DateField()
    address = models.CharField(max_length=200)
    barangay = models.CharField(max_length=120, default="Pending")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class OTPChallenge(models.Model):
    class Channel(models.TextChoices):
        EMAIL = "email", "Email"
        SMS = "sms", "SMS"

    class Purpose(models.TextChoices):
        REGISTRATION = "registration", "Registration"
        PASSWORD_RESET = "password_reset", "Password Reset"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="otp_challenges")
    channel = models.CharField(max_length=16, choices=Channel.choices)
    purpose = models.CharField(max_length=32, choices=Purpose.choices)
    destination_hash = models.CharField(max_length=128)
    code_hash = models.CharField(max_length=256)
    attempts = models.PositiveSmallIntegerField(default=0, db_column="attempt_count")
    max_attempts = models.PositiveSmallIntegerField(default=5)
    last_sent_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "channel", "purpose", "verified_at"]),
        ]

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at


class PhoneOTPChallenge(models.Model):
    phone_number = models.CharField(max_length=16, db_index=True)
    destination_hash = models.CharField(max_length=128)
    code_hash = models.CharField(max_length=256)
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=5)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["phone_number", "verified_at", "consumed_at"]),
        ]

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at


class ResidenceProof(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="residence_proofs")
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="residence-proofs/%Y/%m/")
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField()
    sha256_hash = models.CharField(max_length=64, db_index=True)
    access_level = models.CharField(max_length=32, default="restricted")
    blurred_preview_file = models.FileField(storage=PrivateMediaStorage(), upload_to="residence-proofs/previews/%Y/%m/", blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["sha256_hash"])]


class ConsentRecord(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="consents")
    terms_version = models.CharField(max_length=32)
    privacy_version = models.CharField(max_length=32)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    consented_at = models.DateTimeField(auto_now_add=True)


class VerificationCheck(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PASSED = "passed", "Passed"
        FAILED = "failed", "Failed"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="verification_checks")
    proof = models.ForeignKey(ResidenceProof, on_delete=models.CASCADE, related_name="verification_checks")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    duplicate_match_found = models.BooleanField(default=False)
    failure_reason = models.TextField(blank=True)
    ocr_name = models.CharField(max_length=120, blank=True)
    ocr_address = models.CharField(max_length=255, blank=True)
    name_match_score = models.FloatField(null=True, blank=True)
    address_match_score = models.FloatField(null=True, blank=True)
    authenticity_score = models.FloatField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True, db_column="raw_result_json")
    started_at = models.DateTimeField(auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_actions")
    target_user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_events")
    action = models.CharField(max_length=120)
    metadata = models.JSONField(default=dict, blank=True, db_column="metadata_json")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
