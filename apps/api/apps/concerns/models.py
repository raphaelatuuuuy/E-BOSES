import uuid

from django.conf import settings
from django.db import models

from apps.accounts.storage import PrivateMediaStorage, PublicMediaStorage


class Concern(models.Model):
    class Visibility(models.TextChoices):
        PRIVATE = "private", "Private"
        COMMUNITY = "community", "Community"

    class Category(models.TextChoices):
        INFRASTRUCTURE = "infrastructure", "Infrastructure"
        ENVIRONMENT = "environment", "Environment"
        PUBLIC_SAFETY = "public_safety", "Public Safety"
        OTHERS = "others", "Others"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        ASSIGNED = "assigned", "Assigned"
        IN_PROGRESS = "in_progress", "In Progress"
        RESOLVED = "resolved", "Resolved"
        REJECTED = "rejected", "Rejected"
        APPEALED = "appealed", "Appealed"

    class ValidationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    client_request_id = models.UUIDField(null=True, blank=True, db_index=True)
    tracking_number = models.CharField(max_length=32, null=True, blank=True, unique=True)
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concerns")
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.OTHERS)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.SUBMITTED)
    validation_status = models.CharField(
        max_length=16,
        choices=ValidationStatus.choices,
        default=ValidationStatus.PENDING,
    )
    validation_summary = models.CharField(max_length=255, blank=True)
    rejection_code = models.CharField(max_length=48, blank=True)
    status_version = models.PositiveIntegerField(default=0)
    address = models.CharField(max_length=255, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    location_source = models.CharField(max_length=32, blank=True, default="")
    location_accuracy = models.FloatField(null=True, blank=True)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    update_text = models.CharField(max_length=255, blank=True)
    visibility = models.CharField(max_length=16, choices=Visibility.choices, default=Visibility.COMMUNITY)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["barangay", "latitude", "longitude"], name="concern_location_lookup"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["reporter", "client_request_id"],
                condition=models.Q(client_request_id__isnull=False),
                name="unique_concern_client_request",
            ),
        ]

    @property
    def tracking_id(self):
        if self.tracking_number:
            return self.tracking_number
        year = self.created_at.year if self.created_at else 0
        return f"RPT-{year}-{self.pk:06d}"


class ConcernMedia(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/concern-media/%Y/%m/")
    preview_file = models.FileField(storage=PublicMediaStorage(), upload_to="previews/concern-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    sha256_hash = models.CharField(max_length=64, blank=True, db_index=True)
    phash = models.CharField(max_length=16, blank=True, db_index=True)
    phash_blocks = models.JSONField(default=list, blank=True)
    validation_status = models.CharField(max_length=16, default="accepted")
    validation_detail = models.CharField(max_length=255, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class ConcernResolutionEvidence(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="resolution_evidence")
    file = models.FileField(
        storage=PrivateMediaStorage(),
        upload_to="raw/concern-resolution-evidence/%Y/%m/",
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="concern_resolution_evidence",
    )
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class ConcernStatusEvent(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="status_events")
    status = models.CharField(max_length=32, choices=Concern.Status.choices)
    note = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_status_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class ConcernVote(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_votes")
    value = models.SmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["concern", "user"], name="unique_concern_vote_per_user"),
        ]


class ConcernComment(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_comments")
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies")
    body = models.TextField()
    # Kept after first edit so readers can preview the original text
    original_body = models.TextField(blank=True, default="")
    is_edited = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]


class Announcement(models.Model):
    class Audience(models.TextChoices):
        ALL = "all", "All"
        RESIDENTS = "residents", "Residents"
        RESPONDERS = "responders", "Responders"
        OFFICIALS = "officials", "Officials"

    class Urgency(models.TextChoices):
        NORMAL = "normal", "Normal"
        IMPORTANT = "important", "Important"
        URGENT = "urgent", "Urgent"

    title = models.CharField(max_length=160)
    body = models.TextField()
    tag = models.CharField(max_length=40, default="Barangay")
    audience = models.CharField(max_length=24, choices=Audience.choices, default=Audience.ALL)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    urgency = models.CharField(max_length=16, choices=Urgency.choices, default=Urgency.NORMAL)
    is_pinned = models.BooleanField(default=False)
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    notification_sent_at = models.DateTimeField(null=True, blank=True)
    image = models.FileField(storage=PublicMediaStorage(), upload_to="announcements/%Y/%m/", blank=True)
    image_alt = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_pinned", "-published_at", "-created_at"]


class BarangayEvent(models.Model):
    title = models.CharField(max_length=160)
    detail = models.CharField(max_length=255, blank=True)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["starts_at", "id"]

class ContentFlag(models.Model):
    class Reason(models.TextChoices):
        IRRELEVANT = "irrelevant", "Irrelevant"
        FALSE_INFO = "false_info", "False Information"
        SENSITIVE = "sensitive", "Sensitive Content"
        ABUSIVE = "abusive", "Abusive Content"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        REVIEWED = "reviewed", "Reviewed"
        DISMISSED = "dismissed", "Dismissed"
        ACTION_TAKEN = "action_taken", "Action Taken"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="flags")
    comment = models.ForeignKey(ConcernComment, null=True, blank=True, on_delete=models.CASCADE, related_name="flags")
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_flags")
    reason = models.CharField(max_length=24, choices=Reason.choices)
    note = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUBMITTED)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_content_flags")
    staff_note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

class ConcernAiAssessment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        NOT_CONFIGURED = "not_configured", "Not Configured"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    class OfficialDecision(models.TextChoices):
        RELATED = "related", "Related"
        IRRELEVANT = "irrelevant", "Irrelevant"
        SUSPICIOUS = "suspicious", "Suspicious"
        NEEDS_REVIEW = "needs_review", "Needs review"

    concern = models.OneToOneField(Concern, on_delete=models.CASCADE, related_name="ai_assessment")
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.NOT_CONFIGURED)
    image_objects = models.JSONField(default=list, blank=True)
    yolo_confidence = models.FloatField(null=True, blank=True)
    severity_estimate = models.CharField(max_length=32, blank=True)
    nlp_validity = models.CharField(max_length=32, blank=True)
    nlp_confidence = models.FloatField(null=True, blank=True)
    category_match = models.BooleanField(null=True, blank=True)
    recommendation = models.CharField(max_length=120, blank=True)
    explanation = models.TextField(blank=True)
    model_version = models.CharField(max_length=80, blank=True)
    raw_result = models.JSONField(default=dict, blank=True)
    official_decision = models.CharField(max_length=24, choices=OfficialDecision.choices, blank=True)
    official_reason = models.TextField(blank=True)
    official_reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="ai_assessment_reviews")
    official_reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ConcernClassificationConfiguration(models.Model):
    """Published settings used by the concern AI adapters.

    Kept as one row so a future trained Tagalog RoBERTa or hosted detector can
    replace the baseline adapters without changing the official-facing API.
    """

    class MismatchAction(models.TextChoices):
        REVIEW = "manual_review", "Flag for official review"
        REJECT = "reject", "Reject automatically"
        RESUBMIT = "request_resubmission", "Request resubmission"

    image_provider = models.CharField(max_length=32, default="ultralytics")
    image_model = models.CharField(max_length=80, default="yolov8m.pt")
    nlp_provider = models.CharField(max_length=32, default="keyword_baseline")
    nlp_model = models.CharField(max_length=120, default="multilingual-keyword-v1")
    image_confidence_threshold = models.FloatField(default=0.70)
    relevance_threshold = models.FloatField(default=0.65)
    duplicate_threshold = models.FloatField(default=0.85)
    minimum_description_length = models.PositiveSmallIntegerField(default=20)
    mismatch_action = models.CharField(max_length=32, choices=MismatchAction.choices, default=MismatchAction.REVIEW)
    duplicate_detection_enabled = models.BooleanField(default=True)
    flag_suspicious = models.BooleanField(default=True)
    flag_irrelevant = models.BooleanField(default=True)
    notify_reviewer = models.BooleanField(default=True)
    enabled_categories = models.JSONField(default=list, blank=True)
    suspicious_terms = models.JSONField(default=list, blank=True)
    category_keywords = models.JSONField(default=dict, blank=True)
    label_mappings = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="classification_config_updates")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def current(cls):
        defaults = {
            "enabled_categories": list(Concern.Category.values),
            "suspicious_terms": ["asdf", "qwerty", "test", "testing", "12345"],
            "category_keywords": {
                "infrastructure": ["pothole", "lubak", "kalsada", "streetlight", "ilaw", "kanal", "drainage"],
                "environment": ["basura", "garbage", "trash", "baha", "flood", "tubig", "pollution", "punong natumba"],
                "public_safety": ["aksidente", "accident", "sunog", "fire", "away", "crime", "danger", "delikado", "stray dog"],
                "others": [],
            },
            "label_mappings": {
                "pothole": "infrastructure", "traffic light": "infrastructure", "bench": "infrastructure",
                "garbage": "environment", "trash": "environment", "floodwater": "environment",
                "fire": "public_safety", "knife": "public_safety", "dog": "public_safety",
            },
        }
        obj, _ = cls.objects.get_or_create(pk=1, defaults=defaults)
        return obj

class ConcernAssignment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="assignments")
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_concerns")
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_assignments_made")
    office = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

class ConcernClarification(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ANSWERED = "answered", "Answered"
        CLOSED = "closed", "Closed"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="clarifications")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_clarifications_requested")
    request_text = models.CharField(max_length=500)
    response_text = models.TextField(blank=True)
    responded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_clarifications_answered")
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

class ConcernAppeal(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        DENIED = "denied", "Denied"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="appeals")
    appellant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_appeals")
    reason = models.TextField()
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUBMITTED)
    decision_note = models.CharField(max_length=255, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_concern_appeals")
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

class ConcernOfficialRemark(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="official_remarks")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_official_remarks")
    body = models.TextField()
    visible_to_resident = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ConcernChatMessage(models.Model):
    """Private thread between the reporting resident and barangay officials on one report."""

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="chat_messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="concern_chat_messages",
    )
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["concern", "created_at"], name="concern_chat_concern_created"),
        ]

    def __str__(self):
        return f"Chat #{self.pk} on concern {self.concern_id}"


class ConcernChatAttachment(models.Model):
    """Private image/video attachment belonging to one concern chat message."""

    class Kind(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"

    class AuthenticityStatus(models.TextChoices):
        CLEAR = "clear", "No obvious edit detected"
        FLAGGED = "flagged", "Potentially edited media"
        REVIEW_REQUIRED = "review_required", "Review required"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="chat_attachments")
    message = models.OneToOneField(
        ConcernChatMessage,
        on_delete=models.CASCADE,
        related_name="attachment",
    )
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/concern-chat/%Y/%m/")
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120)
    kind = models.CharField(max_length=12, choices=Kind.choices)
    file_size = models.PositiveIntegerField(default=0)
    authenticity_status = models.CharField(max_length=24, choices=AuthenticityStatus.choices, default=AuthenticityStatus.REVIEW_REQUIRED)
    authenticity_detail = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
