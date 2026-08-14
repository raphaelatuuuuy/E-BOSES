from django.conf import settings as django_settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from .storage import PrivateMediaStorage, PublicMediaStorage


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

    class ResponderUnit(models.TextChoices):
        TANOD = "tanod", "Barangay Tanod"
        BHW = "bhw", "Barangay Health Worker"
        BDRRMO = "bdrrmo", "BDRRMO"

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
    last_seen_at = models.DateTimeField(null=True, blank=True)
    is_onboarded = models.BooleanField(default=False)
    responder_unit = models.CharField(max_length=24, choices=ResponderUnit.choices, blank=True)
    is_on_duty = models.BooleanField(default=False)
    current_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    current_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    location_updated_at = models.DateTimeField(null=True, blank=True)
    ip_country = models.CharField(max_length=2, blank=True)
    ip_asn = models.CharField(max_length=16, blank=True)
    ip_org = models.CharField(max_length=120, blank=True)
    ip_verdict = models.CharField(max_length=24, blank=True)
    ip_score = models.FloatField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    class Meta:
        indexes = [
            models.Index(
                fields=["role", "status", "is_on_duty", "responder_unit"],
                name="accounts_resp_avail",
            ),
            models.Index(
                fields=["current_latitude", "current_longitude"],
                name="accounts_resp_coords",
            ),
        ]

    def __str__(self):
        return self.email


class ResidentProfile(models.Model):
    class Gender(models.TextChoices):
        MALE = "male", "Male"
        FEMALE = "female", "Female"
        PREFER_NOT_TO_SAY = "prefer_not_to_say", "Prefer not to say"

    user = models.OneToOneField(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="resident_profile")
    first_name = models.CharField(max_length=50)
    middle_name = models.CharField(max_length=50, blank=True)
    last_name = models.CharField(max_length=50)
    date_of_birth = models.DateField()
    address = models.CharField(max_length=200)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    gender = models.CharField(max_length=20, choices=Gender.choices, blank=True)
    avatar = models.CharField(max_length=30, blank=True)
    profile_completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class ResidentSettings(models.Model):
    class SosPlacement(models.TextChoices):
        SIDEBAR = "sidebar", "Sidebar"
        INLINE = "inline", "Inline"
        COMPACT = "compact", "Compact"

    user = models.OneToOneField(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="resident_settings")
    push_alerts = models.BooleanField(default=True)
    report_updates = models.BooleanField(default=True)
    community_sharing = models.BooleanField(default=False)
    location_confirmation = models.BooleanField(default=True)
    sos_placement = models.CharField(max_length=16, choices=SosPlacement.choices, default=SosPlacement.SIDEBAR)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class AccountRequest(models.Model):
    class Type(models.TextChoices):
        DELETION = "deletion", "Deletion"
        DATA_EXPORT = "data_export", "Data Export"
        DEACTIVATION = "deactivation", "Deactivation"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        REVIEWED = "reviewed", "Reviewed"
        COMPLETED = "completed", "Completed"
        REJECTED = "rejected", "Rejected"

    user = models.ForeignKey(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="account_requests")
    type = models.CharField(max_length=24, choices=Type.choices)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUBMITTED)
    note = models.CharField(max_length=255, blank=True)
    staff_note = models.CharField(max_length=255, blank=True)
    reviewed_by = models.ForeignKey(django_settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_account_requests")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class OTPChallenge(models.Model):
    class Channel(models.TextChoices):
        EMAIL = "email", "Email"
        SMS = "sms", "SMS"

    class Purpose(models.TextChoices):
        REGISTRATION = "registration", "Registration"
        PASSWORD_RESET = "password_reset", "Password Reset"

    user = models.ForeignKey(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="otp_challenges")
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
            models.Index(fields=["phone_number", "verified_at", "consumed_at"], name="accounts_ph_phone_n_025c54_idx"),
        ]

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at


class EmailOTPChallenge(models.Model):
    """Pre-registration email OTP (mirrors PhoneOTPChallenge — no user yet)."""

    email = models.EmailField(db_index=True)
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
            models.Index(fields=["email", "verified_at", "consumed_at"], name="accounts_em_email_otp_idx"),
        ]

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at


class OCRConfigurationVersion(models.Model):
    """Immutable-after-publish OCR policy snapshot for residence verification."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    scope = models.CharField(max_length=64, default="residence_proof")
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    revision = models.PositiveIntegerField(default=1)
    based_on = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="derived_versions",
    )
    settings = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_ocr_configurations",
    )
    published_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="published_ocr_configurations",
    )
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["scope", "version"], name="accounts_ocr_cfg_scope_version_uniq"),
            models.UniqueConstraint(
                fields=["scope"],
                condition=models.Q(status="draft"),
                name="accounts_ocr_cfg_one_draft_per_scope",
            ),
            models.UniqueConstraint(
                fields=["scope"],
                condition=models.Q(status="published"),
                name="accounts_ocr_cfg_one_published_per_scope",
            ),
            models.CheckConstraint(condition=models.Q(version__gte=1), name="accounts_ocr_cfg_version_gte_1"),
            models.CheckConstraint(condition=models.Q(revision__gte=1), name="accounts_ocr_cfg_revision_gte_1"),
        ]
        indexes = [models.Index(fields=["scope", "status"], name="acct_ocr_cfg_scope_status")]

    def __str__(self):
        return f"{self.scope} v{self.version} ({self.status})"


class OCRDocumentType(models.Model):
    class Category(models.TextChoices):
        IDENTITY = "identity", "Identity document"
        CERTIFICATE = "certificate", "Certificate"
        UTILITY = "utility", "Utility bill"
        AGREEMENT = "agreement", "Agreement"
        FINANCIAL = "financial", "Financial statement"
        PROPERTY = "property", "Property record"
        OTHER = "other", "Other"

    configuration = models.ForeignKey(
        OCRConfigurationVersion,
        on_delete=models.CASCADE,
        related_name="document_types",
    )
    code = models.SlugField(max_length=64)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=24, choices=Category.choices, default=Category.OTHER)
    enabled = models.BooleanField(default=True)
    requires_front = models.BooleanField(default=False)
    requires_back = models.BooleanField(default=False)
    allowed_sides = models.JSONField(default=list, blank=True)
    accepted_mime_types = models.JSONField(default=list, blank=True)
    max_files = models.PositiveSmallIntegerField(default=1)
    keywords = models.JSONField(default=list, blank=True)
    provider_names = models.JSONField(default=list, blank=True)
    aliases = models.JSONField(default=list, blank=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    # Template Builder metadata (OCR Template Builder UI)
    template_name = models.CharField(max_length=160, blank=True)
    template_version = models.CharField(max_length=32, default="v1.0")
    expected_title = models.CharField(max_length=160, blank=True)
    min_ocr_confidence = models.DecimalField(
        max_digits=4,
        decimal_places=3,
        default=0.900,
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    accept_rotated = models.BooleanField(default=True)
    accept_scanned_pdf = models.BooleanField(default=True)
    sample_file = models.FileField(
        storage=PrivateMediaStorage(),
        upload_to="raw/ocr-samples/%Y/%m/",
        blank=True,
    )
    sample_original_filename = models.CharField(max_length=255, blank=True)
    template_settings = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["configuration", "code"],
                name="accounts_ocr_doc_config_code_uniq",
            ),
            models.CheckConstraint(condition=models.Q(max_files__gte=1), name="accounts_ocr_doc_max_files_gte_1"),
            models.CheckConstraint(
                condition=models.Q(min_ocr_confidence__gte=0, min_ocr_confidence__lte=1),
                name="accounts_ocr_doc_min_conf_range",
            ),
        ]
        indexes = [
            models.Index(fields=["configuration", "enabled", "display_order"], name="acct_ocr_doc_cfg_enabled"),
        ]

    def __str__(self):
        return f"{self.name} ({self.configuration})"

    @property
    def display_template_name(self) -> str:
        return (self.template_name or self.name or self.code).strip()


class OCRFieldDefinition(models.Model):
    class DataType(models.TextChoices):
        TEXT = "text", "Text"
        NAME = "name", "Person name"
        ADDRESS = "address", "Address"
        DATE = "date", "Date"
        IDENTIFIER = "identifier", "Identifier"
        NUMBER = "number", "Number"

    class Normalization(models.TextChoices):
        NONE = "none", "None"
        UPPERCASE = "uppercase", "Uppercase"
        NAME = "name", "Person name"
        ADDRESS = "address", "Address"
        DATE = "date", "Date"
        DIGITS = "digits", "Digits only"
        ALPHANUMERIC = "alphanumeric", "Alphanumeric"

    class Format(models.TextChoices):
        NONE = "none", "No fixed format"
        TEXT = "text", "Text"
        DATE_MDY = "date_mdy", "Date (MM/DD/YYYY)"
        DATE_YMD = "date_ymd", "Date (YYYY-MM-DD)"
        ALPHANUMERIC = "alphanumeric", "Alphanumeric"
        NUMERIC = "numeric", "Numeric"

    document_type = models.ForeignKey(OCRDocumentType, on_delete=models.CASCADE, related_name="fields")
    code = models.SlugField(max_length=64)
    label = models.CharField(max_length=120)
    data_type = models.CharField(max_length=24, choices=DataType.choices, default=DataType.TEXT)
    required = models.BooleanField(default=False)
    enabled = models.BooleanField(default=True)
    sides = models.JSONField(default=list, blank=True)
    aliases = models.JSONField(default=list, blank=True)
    extraction_hints = models.JSONField(default=dict, blank=True)
    normalization = models.CharField(
        max_length=24,
        choices=Normalization.choices,
        default=Normalization.NONE,
    )
    format = models.CharField(max_length=24, choices=Format.choices, default=Format.NONE)
    min_confidence = models.DecimalField(
        max_digits=4,
        decimal_places=3,
        default=0.800,
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    display_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "label"]
        constraints = [
            models.UniqueConstraint(
                fields=["document_type", "code"],
                name="accounts_ocr_field_doc_code_uniq",
            ),
            models.CheckConstraint(
                condition=models.Q(min_confidence__gte=0, min_confidence__lte=1),
                name="accounts_ocr_field_conf_range",
            ),
        ]
        indexes = [models.Index(fields=["document_type", "enabled", "display_order"], name="acct_ocr_field_doc_enabled")]

    def __str__(self):
        return f"{self.document_type.name}: {self.label}"


class OCRRule(models.Model):
    class RuleType(models.TextChoices):
        REQUIRED = "required", "Required field"
        PROFILE_MATCH = "profile_match", "Resident profile match"
        SIMILARITY = "similarity", "Similarity threshold"
        RECENCY = "recency", "Document recency"
        ALLOWED_VALUE = "allowed_value", "Allowed value"
        CONTAINS_KEYWORD = "contains_keyword", "Contains keyword"
        FORMAT = "format", "Format"
        NOT_EXPIRED = "not_expired", "Not expired"
        IMAGE_QUALITY = "image_quality", "Image quality"

    class Operator(models.TextChoices):
        EXISTS = "exists", "Exists"
        MATCHES_PROFILE = "matches_profile", "Matches resident profile"
        GTE = "gte", "Greater than or equal"
        LTE = "lte", "Less than or equal"
        EQUALS = "equals", "Equals"
        ONE_OF = "one_of", "One of"
        CONTAINS_ANY = "contains_any", "Contains any"
        WITHIN_DAYS = "within_days", "Within days"
        NOT_EXPIRED = "not_expired", "Not expired"

    class FailureDisposition(models.TextChoices):
        MANUAL_REVIEW = "manual_review", "Send to manual review"
        WARNING = "warning", "Record warning"

    configuration = models.ForeignKey(OCRConfigurationVersion, on_delete=models.CASCADE, related_name="rules")
    document_type = models.ForeignKey(
        OCRDocumentType,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="rules",
    )
    field = models.ForeignKey(
        OCRFieldDefinition,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="rules",
    )
    code = models.SlugField(max_length=80)
    name = models.CharField(max_length=160)
    rule_type = models.CharField(max_length=32, choices=RuleType.choices)
    operator = models.CharField(max_length=32, choices=Operator.choices)
    value = models.JSONField(default=dict, blank=True)
    threshold = models.DecimalField(
        max_digits=6,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    on_failure = models.CharField(
        max_length=24,
        choices=FailureDisposition.choices,
        default=FailureDisposition.MANUAL_REVIEW,
    )
    enabled = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["configuration", "code"],
                name="accounts_ocr_rule_config_code_uniq",
            ),
            models.CheckConstraint(
                condition=models.Q(threshold__isnull=True) | models.Q(threshold__gte=0, threshold__lte=1),
                name="accounts_ocr_rule_threshold_range",
            ),
        ]
        indexes = [
            models.Index(fields=["configuration", "document_type", "enabled"], name="accounts_ocr_rule_cfg_doc_idx"),
        ]

    def __str__(self):
        return self.name


class OCRSample(models.Model):
    document_type = models.ForeignKey(OCRDocumentType, on_delete=models.CASCADE, related_name="samples")
    name = models.CharField(max_length=160)
    file = models.FileField(
        storage=PrivateMediaStorage(),
        upload_to="raw/ocr-samples/%Y/%m/",
        blank=True,
    )
    original_filename = models.CharField(max_length=255, blank=True)
    mime_type = models.CharField(max_length=120, blank=True)
    sha256_hash = models.CharField(max_length=64, blank=True, db_index=True)
    is_synthetic = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_ocr_samples",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["document_type", "name"]

    def __str__(self):
        return self.name


class OCRServiceStatus(models.Model):
    class Status(models.TextChoices):
        NOT_CONFIGURED = "not_configured", "Not configured"
        HEALTHY = "healthy", "Healthy"
        DEGRADED = "degraded", "Degraded"
        UNAVAILABLE = "unavailable", "Unavailable"

    class CircuitState(models.TextChoices):
        CLOSED = "closed", "Closed"
        OPEN = "open", "Open"
        HALF_OPEN = "half_open", "Half-open"

    provider = models.SlugField(max_length=64, unique=True, default="ocrspace")
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.NOT_CONFIGURED)
    circuit_state = models.CharField(max_length=16, choices=CircuitState.choices, default=CircuitState.CLOSED)
    consecutive_failures = models.PositiveSmallIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    error_code = models.CharField(max_length=80, blank=True)
    error_message = models.CharField(max_length=255, blank=True)
    details = models.JSONField(default=dict, blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "OCR service statuses"

    def __str__(self):
        return f"{self.provider}: {self.status}"


class ServiceHealthDay(models.Model):
    """One row per module per day, written by the service-status probes.

    The status timeline reads only from here, so a day with no row is reported
    as "no data" instead of being invented.
    """

    day = models.DateField()
    module_key = models.SlugField(max_length=40)
    severity = models.PositiveSmallIntegerField(default=0)
    issues = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("day", "module_key")
        indexes = [models.Index(fields=["module_key", "day"])]

    def __str__(self):
        return f"{self.module_key} {self.day}: {self.severity}"


class ResidenceVerificationCase(models.Model):
    class Status(models.TextChoices):
        AWAITING_EMAIL = "awaiting_email", "Awaiting email verification"
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        MANUAL_REVIEW = "manual_review", "Manual review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    class ReviewReason(models.TextChoices):
        OCR_UNAVAILABLE = "ocr_unavailable", "OCR unavailable"
        LOW_CONFIDENCE = "low_confidence", "Low OCR confidence"
        MISSING_REQUIRED_FIELD = "missing_required_field", "Missing required field"
        DOCUMENT_TYPE_MISMATCH = "document_type_mismatch", "Document type mismatch"
        RULE_MISMATCH = "rule_mismatch", "Validation rule mismatch"
        DUPLICATE_IDENTITY = "duplicate_identity", "Possible duplicate identity"
        RESUBMISSION_REQUIRED = "resubmission_required", "Request a new submission"
        OFFICIAL_REQUESTED = "official_requested", "Official requested review"
        LEGACY_PENDING = "legacy_pending", "Legacy pending verification"

    class DecisionSource(models.TextChoices):
        NONE = "none", "No decision"
        SYSTEM = "system", "System"
        OFFICIAL = "official", "Barangay official"

    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="residence_verification_cases",
    )
    configuration = models.ForeignKey(
        OCRConfigurationVersion,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="cases",
    )
    document_type = models.ForeignKey(
        OCRDocumentType,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="cases",
    )
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.AWAITING_EMAIL)
    review_reason = models.CharField(max_length=40, choices=ReviewReason.choices, blank=True)
    priority = models.PositiveSmallIntegerField(default=0)
    retry_eligible = models.BooleanField(default=True)
    decision_source = models.CharField(max_length=16, choices=DecisionSource.choices, default=DecisionSource.NONE)
    decision_reason = models.TextField(blank=True)
    decided_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="decided_residence_verification_cases",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    queued_at = models.DateTimeField(null=True, blank=True)
    processing_started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(status__in=["awaiting_email", "queued", "processing", "manual_review"]),
                name="accounts_one_active_res_case",
            ),
            models.CheckConstraint(condition=models.Q(revision__gte=1), name="accounts_res_case_revision_gte_1"),
        ]
        indexes = [
            models.Index(fields=["status", "-priority", "created_at"], name="accounts_res_case_queue_idx"),
            models.Index(fields=["retry_eligible", "status", "updated_at"], name="accounts_res_case_retry_idx"),
        ]

    def __str__(self):
        return f"{self.user.email}: {self.status}"


class ResidenceProof(models.Model):
    class Side(models.TextChoices):
        SINGLE = "single", "Single page"
        FRONT = "front", "Front"
        BACK = "back", "Back"
        OTHER = "other", "Other"

    user = models.ForeignKey(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="residence_proofs")
    case = models.ForeignKey(
        ResidenceVerificationCase,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="proofs",
    )
    document_type = models.ForeignKey(
        OCRDocumentType,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="proofs",
    )
    side = models.CharField(max_length=16, choices=Side.choices, default=Side.SINGLE)
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/residence-proofs/%Y/%m/")
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField()
    sha256_hash = models.CharField(max_length=64, db_index=True)
    phash = models.CharField(max_length=16, blank=True, db_index=True)
    phash_blocks = models.JSONField(default=list, blank=True)
    access_level = models.CharField(max_length=32, default="restricted")
    blurred_preview_file = models.FileField(storage=PublicMediaStorage(), upload_to="previews/residence-proofs/%Y/%m/", blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["sha256_hash"])]


class ConsentRecord(models.Model):
    user = models.ForeignKey(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="consents")
    terms_version = models.CharField(max_length=32)
    privacy_version = models.CharField(max_length=32)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    consented_at = models.DateTimeField(auto_now_add=True)


class VerificationCheck(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        PASSED = "passed", "Passed"
        MANUAL_REVIEW = "manual_review", "Manual review"
        FAILED = "failed", "Failed"
        ERROR = "error", "Service error"
        CANCELLED = "cancelled", "Cancelled"

    class Trigger(models.TextChoices):
        REGISTRATION = "registration", "Registration"
        RETRY = "retry", "Retry"
        RECOVERY = "recovery", "Service recovery"
        OFFICIAL = "official", "Official request"
        SYSTEM = "system", "System"

    user = models.ForeignKey(django_settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="verification_checks")
    proof = models.ForeignKey(ResidenceProof, on_delete=models.CASCADE, related_name="verification_checks")
    case = models.ForeignKey(
        ResidenceVerificationCase,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="checks",
    )
    configuration = models.ForeignKey(
        OCRConfigurationVersion,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="checks",
    )
    document_type = models.ForeignKey(
        OCRDocumentType,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="checks",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    attempt_number = models.PositiveSmallIntegerField(default=1)
    trigger = models.CharField(max_length=24, choices=Trigger.choices, default=Trigger.REGISTRATION)
    failure_reason_code = models.CharField(max_length=80, blank=True)
    provider_job_id = models.CharField(max_length=160, blank=True, db_index=True)
    ocr_confidence = models.DecimalField(
        max_digits=4,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    extracted_fields = models.JSONField(default=dict, blank=True)
    rule_results = models.JSONField(default=list, blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    retryable = models.BooleanField(default=True)
    available_at = models.DateTimeField(default=timezone.now)
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

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["case", "proof", "attempt_number"],
                condition=models.Q(case__isnull=False),
                name="accounts_ocr_attempt_case_proof_no_uniq",
            ),
            models.CheckConstraint(
                condition=models.Q(ocr_confidence__isnull=True) | models.Q(ocr_confidence__gte=0, ocr_confidence__lte=1),
                name="accounts_ocr_attempt_conf_range",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "available_at"], name="accounts_ocr_attempt_queue_idx"),
            models.Index(fields=["case", "-created_at"], name="accounts_ocr_attempt_case_idx"),
        ]


class IdentityIdentifierClaim(models.Model):
    """Non-reversible claim used to prevent reuse of an OCR identity number."""

    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="identity_identifier_claims",
    )
    source_case = models.ForeignKey(
        ResidenceVerificationCase,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="identity_identifier_claims",
    )
    document_type_code = models.SlugField(max_length=64)
    field_code = models.SlugField(max_length=64)
    value_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["document_type_code", "field_code", "value_hash"],
                name="accounts_identity_identifier_claim_uniq",
            )
        ]
        indexes = [
            models.Index(
                fields=["document_type_code", "field_code", "value_hash"],
                name="acct_identity_claim_lookup",
            )
        ]


class OCRTestRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        PASSED = "passed", "Passed"
        WARNING = "warning", "Warning"
        FAILED = "failed", "Failed"
        ERROR = "error", "Service error"
        CANCELLED = "cancelled", "Cancelled"

    configuration = models.ForeignKey(OCRConfigurationVersion, on_delete=models.PROTECT, related_name="test_runs")
    document_type = models.ForeignKey(OCRDocumentType, on_delete=models.PROTECT, related_name="test_runs")
    sample = models.ForeignKey(
        OCRSample,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="test_runs",
    )
    requested_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="requested_ocr_test_runs",
    )
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/ocr-tests/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    sha256_hash = models.CharField(max_length=64, blank=True, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    provider_job_id = models.CharField(max_length=160, blank=True, db_index=True)
    ocr_confidence = models.DecimalField(
        max_digits=4,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    extracted_fields = models.JSONField(default=dict, blank=True)
    rule_results = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    error_code = models.CharField(max_length=80, blank=True)
    error_message = models.CharField(max_length=255, blank=True)
    queued_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ocr_confidence__isnull=True) | models.Q(ocr_confidence__gte=0, ocr_confidence__lte=1),
                name="accounts_ocr_test_conf_range",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "created_at"], name="accounts_ocr_test_status_idx"),
            models.Index(fields=["requested_by", "-created_at"], name="acct_ocr_test_requester"),
        ]

    def __str__(self):
        return f"OCR test {self.pk or 'new'}: {self.status}"


class AuditLog(models.Model):
    actor = models.ForeignKey(django_settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_actions")
    target_user = models.ForeignKey(django_settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_events")
    action = models.CharField(max_length=120)
    metadata = models.JSONField(default=dict, blank=True, db_column="metadata_json")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["created_at"], name="audit_log_created_at"),
            models.Index(fields=["actor", "created_at"], name="audit_log_actor_created"),
        ]

    def __str__(self):
        return f"audit {self.action} by {self.actor_id or 'system'} at {self.created_at:%Y-%m-%d %H:%M}"


class VerificationOverride(models.Model):
    """An official overruling the automatic verification result.

    Kept separate from VerificationCheck so the machine's own conclusion is
    never rewritten — the override sits alongside it and wins.
    """

    class Decision(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="verification_overrides",
    )
    verification_check = models.ForeignKey(
        "VerificationCheck",
        on_delete=models.CASCADE,
        related_name="overrides",
    )
    overridden_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="verification_overrides_made",
    )
    decision = models.CharField(max_length=16, choices=Decision.choices)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.decision} override on check {self.verification_check_id}"
