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
        VEHICLE = "vehicle", "Vehicle"
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
    category_ref = models.ForeignKey(
        "ConcernCategory",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="concerns",
    )
    assigned_department = models.ForeignKey(
        "Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="concerns",
    )
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
    report_fingerprint = models.CharField(max_length=64, blank=True, db_index=True)
    report_text_fingerprint = models.CharField(max_length=64, blank=True, db_index=True)
    report_location_bucket = models.CharField(max_length=48, blank=True, db_index=True)
    location_source = models.CharField(max_length=32, blank=True, default="")
    location_accuracy = models.FloatField(null=True, blank=True)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    update_text = models.CharField(max_length=255, blank=True)
    visibility = models.CharField(max_length=16, choices=Visibility.choices, default=Visibility.COMMUNITY)
    official_title = models.CharField(max_length=140, blank=True)
    summary = models.CharField(max_length=300, blank=True)
    community_summary = models.TextField(blank=True)
    community_observed = models.JSONField(default=list, blank=True)
    publication_block_reason = models.CharField(max_length=64, blank=True)
    duplicate_of = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="duplicates"
    )
    recurrence_of = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="recurrences"
    )
    archived_at = models.DateTimeField(null=True, blank=True)
    reopen_count = models.PositiveSmallIntegerField(default=0)
    reopened_at = models.DateTimeField(null=True, blank=True)
    ip_country = models.CharField(max_length=2, blank=True)
    ip_asn = models.CharField(max_length=16, blank=True)
    ip_org = models.CharField(max_length=120, blank=True)
    ip_verdict = models.CharField(max_length=24, blank=True)
    ip_score = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["barangay", "latitude", "longitude"], name="concern_location_lookup"),
            # Managed queue: filter status (+validation_status), sort newest activity.
            models.Index(fields=["status", "updated_at"], name="concern_status_queue"),
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
    class PrivacyState(models.TextChoices):
        """Where this image is in the Gemma → SAM3 → OpenCV privacy pipeline.

        Only NOT_REQUIRED and PROTECTED are safe-to-publish terminal states.
        Everything else means the public copy must not be served, which is what
        `public_visible` enforces — the two are set together so a half-finished
        run can never leak the original.
        """

        NOT_REQUIRED = "not_required", "No privacy scan required"
        QUEUED = "queued", "Queued for privacy processing"
        PROCESSING = "processing", "Privacy processing running"
        PROTECTED = "protected", "Protected copy created"
        SENSITIVE_REVIEW_REQUIRED = "sensitive_review_required", "Sensitive media, review required"
        NO_MATCH_FOUND = "no_match_found", "No matching sensitive region confirmed"
        FAILED_RESTRICTED = "failed_restricted", "Privacy processing failed, media restricted"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/concern-media/%Y/%m/")
    # The protected, public-facing copy. Never a byte-for-byte copy of `file`:
    # every write path re-encodes and strips EXIF, and blur is baked in.
    preview_file = models.FileField(storage=PublicMediaStorage(), upload_to="previews/concern-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    sha256_hash = models.CharField(max_length=64, blank=True, db_index=True)
    phash = models.CharField(max_length=16, blank=True, db_index=True)
    phash_blocks = models.JSONField(default=list, blank=True)
    validation_status = models.CharField(max_length=16, default="accepted")
    validation_detail = models.CharField(max_length=255, blank=True)
    privacy_state = models.CharField(max_length=32, choices=PrivacyState.choices, default=PrivacyState.NOT_REQUIRED)
    privacy_requested_classes = models.JSONField(default=list, blank=True)
    privacy_detected_classes = models.JSONField(default=list, blank=True)
    # Normalised 0..1 boxes actually blurred into the protected copy. Kept so a
    # re-render reproduces the same redactions without calling SAM3 again.
    privacy_regions = models.JSONField(default=list, blank=True)
    privacy_cache_key = models.CharField(max_length=64, blank=True)
    # Developer-only. Never serialized to the official interface.
    privacy_failure = models.JSONField(default=dict, blank=True)
    privacy_processed_at = models.DateTimeField(null=True, blank=True)
    # Fail closed: an image is only publicly displayable once a privacy run has
    # explicitly cleared it.
    public_visible = models.BooleanField(default=False)
    relevance_state = models.CharField(max_length=16, blank=True)
    relevance_reason = models.CharField(max_length=255, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class ConcernMediaRedaction(models.Model):
    """One blurred region on a concern photo, from SAM3 or from an official.

    Officials can add regions the automatic scan missed, so the protected copy
    is always re-rendered from SAM3 regions *plus* official regions. Coordinates
    are normalised 0..1 so they survive the preview resize.
    """

    class Source(models.TextChoices):
        SAM3 = "sam3", "Automatic scan"
        OFFICIAL = "official", "Added by an official"

    media = models.ForeignKey(ConcernMedia, on_delete=models.CASCADE, related_name="redactions")
    x = models.FloatField()
    y = models.FloatField()
    width = models.FloatField()
    height = models.FloatField()
    label = models.CharField(max_length=64, blank=True)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.SAM3)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_media_redactions")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class Department(models.Model):
    """A barangay unit, desk or standing committee that can own a concern.

    `short_name` exists because the full names are long ("Barangay Council for
    the Protection of Children") and tables and map pins need something that
    fits. `emergency_role` is separate from `description` because a unit's
    day-to-day scope and its duty during an emergency are different questions,
    and officials look them up at different moments.
    """

    name = models.CharField(max_length=120, unique=True)
    code = models.SlugField(max_length=80, unique=True)
    short_name = models.CharField(max_length=48, blank=True)
    description = models.CharField(max_length=255, blank=True)
    emergency_role = models.CharField(max_length=255, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Emergency dispatch reads these. Before this existed, dispatch routed on the
    # closed User.responder_unit enum, so a unit created here could never receive
    # an alert. `emergency_types` holds EmergencyAlert.Type values; it is JSON
    # rather than a join table because it is a small closed set read on every
    # dispatch.
    responds_to_emergencies = models.BooleanField(default=False)
    emergency_types = models.JSONField(default=list, blank=True)
    # Escalation target today (city hotline handoff); the SMS fallback in a later
    # phase sends here too.
    contact_number = models.CharField(max_length=16, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # A blank short name would render as an empty table cell, so fall back
        # to the full name rather than showing nothing.
        if not self.short_name:
            self.short_name = self.name[:48]
        super().save(*args, **kwargs)


class Position(models.Model):
    name = models.CharField(max_length=120)
    code = models.SlugField(max_length=80, unique=True)
    # The unit this position belongs to. Null means barangay-wide: the shared
    # RBAC catalog (Barangay Captain, Secretary, ...) stays assignable to any
    # unit and appears in no unit's own position list.
    department = models.ForeignKey(
        Department, null=True, blank=True, on_delete=models.CASCADE, related_name="positions"
    )
    permissions = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["name", "department"], name="concerns_unique_position_per_department"),
        ]

    def __str__(self):
        return self.name


class Designation(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="designations")
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name="designations")
    position = models.ForeignKey(Position, on_delete=models.PROTECT, related_name="designations")
    title = models.CharField(max_length=160, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["department__name", "position__name", "user_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "department", "position"],
                condition=models.Q(is_active=True),
                name="concerns_unique_active_designation",
            ),
        ]


class ConcernCategory(models.Model):
    name = models.CharField(max_length=120, unique=True)
    code = models.SlugField(max_length=80, unique=True)
    description = models.CharField(max_length=255, blank=True)
    icon_key = models.CharField(max_length=48, default="tag")
    custom_icon_label = models.CharField(max_length=8, blank=True)
    icon_image = models.FileField(storage=PublicMediaStorage(), upload_to="concern-category-icons/", blank=True)
    department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="categories")
    is_active = models.BooleanField(default=True)
    photo_required = models.BooleanField(default=False)
    description_required = models.BooleanField(default=True)
    location_required = models.BooleanField(default=True)
    public_feed_allowed = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ConcernFormField(models.Model):
    class FieldType(models.TextChoices):
        TEXT = "text", "Text"
        TEXTAREA = "textarea", "Textarea"
        SELECT = "select", "Select"
        NUMBER = "number", "Number"
        DATE = "date", "Date"
        BOOLEAN = "boolean", "Boolean"

    category = models.ForeignKey(ConcernCategory, on_delete=models.CASCADE, related_name="form_fields")
    field_key = models.SlugField(max_length=80)
    label = models.CharField(max_length=120)
    field_type = models.CharField(max_length=24, choices=FieldType.choices, default=FieldType.TEXT)
    is_required = models.BooleanField(default=False)
    options = models.JSONField(default=list, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [models.UniqueConstraint(fields=["category", "field_key"], name="concerns_category_field_key_uniq")]


class ConcernFormValue(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="form_values")
    field = models.ForeignKey(ConcernFormField, on_delete=models.CASCADE, related_name="values")
    value = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["concern", "field"], name="concerns_form_value_uniq")]


class RoutingRule(models.Model):
    name = models.CharField(max_length=120)
    category = models.ForeignKey(ConcernCategory, on_delete=models.CASCADE, related_name="routing_rules")
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name="routing_rules")
    priority = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "id"]
        indexes = [models.Index(fields=["category", "is_active", "-priority"], name="concerns_route_lookup")]


class ConcernTimelineEntry(models.Model):
    class EventType(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        STATUS_CHANGE = "status_change", "Status change"
        ASSIGNMENT = "assignment", "Assignment"
        CLARIFICATION = "clarification", "Clarification"
        APPEAL = "appeal", "Appeal"
        RESOLUTION = "resolution", "Resolution"
        CUSTOM = "custom", "Custom"
        CHAT = "chat", "Chat"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="timeline_entries")
    event_type = models.CharField(max_length=32, choices=EventType.choices)
    status = models.CharField(max_length=32, blank=True)
    message = models.TextField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_timeline_entries")
    visible_to_resident = models.BooleanField(default=True)
    is_custom = models.BooleanField(default=False)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["concern", "created_at"], name="concerns_timeline_lookup")]


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
    preview_file = models.FileField(
        storage=PublicMediaStorage(),
        upload_to="previews/concern-resolution-evidence/%Y/%m/",
        blank=True,
    )
    privacy_state = models.CharField(max_length=32, blank=True)
    privacy_detected_classes = models.JSONField(default=list, blank=True)
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
    class Status(models.TextChoices):
        VISIBLE = "visible", "Visible"
        HIDDEN = "hidden", "Hidden"
        REMOVED = "removed", "Removed"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_comments")
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies")
    body = models.TextField()
    # Kept after first edit so readers can preview the original text
    original_body = models.TextField(blank=True, default="")
    is_edited = models.BooleanField(default=False)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.VISIBLE)
    moderation_note = models.CharField(max_length=255, blank=True)
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
    original_image = models.FileField(
        storage=PublicMediaStorage(), upload_to="announcements/original/%Y/%m/", blank=True
    )
    image_alt = models.CharField(max_length=160, blank=True)
    image_privacy_state = models.CharField(max_length=24, blank=True)
    image_privacy_detail = models.CharField(max_length=255, blank=True)
    place_label = models.CharField(max_length=160, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    affected_streets = models.JSONField(default=list, blank=True)
    area_geometry = models.JSONField(null=True, blank=True)
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
    affected_streets = models.JSONField(default=list, blank=True)
    area_geometry = models.JSONField(null=True, blank=True)
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
        TAKEN_DOWN = "taken_down", "Taken Down"

    # Exactly one of concern (a post-level flag, optionally with `comment` set
    # for a concern-comment flag), announcement_comment, or emergency_comment
    # is populated per flag — the target this flag is about.
    concern = models.ForeignKey(Concern, null=True, blank=True, on_delete=models.CASCADE, related_name="flags")
    comment = models.ForeignKey(ConcernComment, null=True, blank=True, on_delete=models.CASCADE, related_name="flags")
    announcement_comment = models.ForeignKey(
        "AnnouncementComment", null=True, blank=True, on_delete=models.CASCADE, related_name="flags"
    )
    emergency_comment = models.ForeignKey(
        "emergencies.EmergencyCommunityComment", null=True, blank=True, on_delete=models.CASCADE, related_name="flags"
    )
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_flags")
    reason = models.CharField(max_length=24, choices=Reason.choices)
    note = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUBMITTED)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_content_flags")
    staff_note = models.CharField(max_length=255, blank=True)
    # True when execute_takedown()/dismissal was decided by the community
    # moderation model with no human reviewer — reviewed_by stays null.
    auto_moderated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def target_kind(self):
        if self.announcement_comment_id:
            return "announcement_comment"
        if self.emergency_comment_id:
            return "emergency_comment"
        if self.comment_id:
            return "concern_comment"
        return "concern"

class ConcernAiAssessment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        NOT_CONFIGURED = "not_configured", "Not Configured"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    concern = models.OneToOneField(Concern, on_delete=models.CASCADE, related_name="ai_assessment")
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.NOT_CONFIGURED)
    # Plain-language object names Gemma reports seeing in the photo. Free text,
    # not a fixed class vocabulary — there is no detector taxonomy any more.
    detected_objects = models.JSONField(default=list, blank=True)
    severity_estimate = models.CharField(max_length=32, blank=True)
    nlp_validity = models.CharField(max_length=32, blank=True)
    nlp_confidence = models.FloatField(null=True, blank=True)
    category_match = models.BooleanField(null=True, blank=True)
    # Photo/privacy state, stored as columns rather than dug out of raw_result:
    # the official UI and the privacy task both branch on these, and a JSON path
    # lookup is not something either should depend on.
    #
    # `image_review_succeeded` is None when no image was submitted at all, which
    # is what keeps "no photo" and "photo we could not read" distinguishable.
    image_review_succeeded = models.BooleanField(null=True, blank=True)
    evidence_relationship = models.CharField(max_length=32, blank=True)
    privacy_scan_required = models.BooleanField(default=False)
    privacy_scan_reasons = models.JSONField(default=list, blank=True)
    suspected_sensitive_classes = models.JSONField(default=list, blank=True)
    urgent_attention = models.BooleanField(default=False)
    missing_information = models.JSONField(default=list, blank=True)
    recommended_action = models.CharField(max_length=32, blank=True)
    recommendation = models.CharField(max_length=120, blank=True)
    explanation = models.TextField(blank=True)
    model_version = models.CharField(max_length=80, blank=True)
    raw_result = models.JSONField(default=dict, blank=True)
    flagged = models.BooleanField(default=False)
    flag_reasons = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class LlmDecisionLog(models.Model):
    """Append-only record of every LLM decision — real or simulated.

    Unlike ConcernAiAssessment (overwritten on reprocess, one row per concern),
    a row here is never updated after creation. This is the audit trail;
    ConcernAiAssessment remains the current-state cache the queue UI reads.
    """

    class RunKind(models.TextChoices):
        PRODUCTION = "production", "Production"
        SIMULATION = "simulation", "Simulation"

    class Domain(models.TextChoices):
        CONCERN = "concern", "Concern"
        EMERGENCY = "emergency", "Emergency"
        COMMUNITY = "community", "Community content"

    run_kind = models.CharField(max_length=16, choices=RunKind.choices)
    domain = models.CharField(max_length=16, choices=Domain.choices)
    concern = models.ForeignKey(
        Concern, null=True, blank=True, on_delete=models.SET_NULL, related_name="llm_decision_logs"
    )
    content_flag = models.ForeignKey(
        "ContentFlag", null=True, blank=True, on_delete=models.SET_NULL, related_name="llm_decision_logs"
    )
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="llm_decision_logs"
    )
    model_version = models.CharField(max_length=80, blank=True)
    input_snapshot = models.JSONField(default=dict, blank=True)
    output_snapshot = models.JSONField(default=dict, blank=True)
    resident_message = models.TextField(blank=True)
    recommended_action = models.CharField(max_length=32, blank=True)
    assigned_department = models.ForeignKey(
        "Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="llm_decision_logs"
    )
    routing_reason = models.CharField(max_length=255, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["domain", "run_kind", "created_at"], name="llm_log_domain_kind_created"),
        ]


class ConcernClassificationConfiguration(models.Model):
    """Published settings used by the concern AI adapters.

    Kept as one row so a future model can replace the current one without
    changing the official-facing API.

    The object-detection settings this row used to hold (`image_provider`,
    `image_model`, `image_confidence_threshold`, `label_mappings`,
    `supported_classes`) are gone with YOLO. Gemma reads the photo directly and
    names what it sees, so there is no class vocabulary to filter and no
    label→category table for officials to maintain.
    """

    class MismatchAction(models.TextChoices):
        AUTO_CORRECT = "auto_correct", "Use detected category"
        REJECT = "reject", "Reject automatically"
        RESUBMIT = "request_resubmission", "Request resubmission"

    class ReportDuplicateAction(models.TextChoices):
        WARN = "warn", "Warn resident"
        BLOCK = "block", "Block submission"

    class SpamAction(models.TextChoices):
        AUTO_REJECT = "auto_reject", "Reject automatically"
        HOLD = "hold", "Hold for review"

    class AbusiveAction(models.TextChoices):
        HOLD = "hold", "Hold for review"
        AUTO_REJECT = "auto_reject", "Reject automatically"

    class ThreatAction(models.TextChoices):
        ACCEPT_FLAG_NOTIFY = "accept_flag_notify", "Accept, flag & notify"
        HOLD = "hold", "Hold for review"

    class SensitiveContentAction(models.TextChoices):
        RESTRICT_HOLD = "restrict_hold", "Restrict & hold for review"
        AUTO_BLUR_ACCEPT = "auto_blur_accept", "Auto-blur & accept"

    class StreetImageryAction(models.TextChoices):
        WARN = "warn", "Warn reviewer only"
        RESUBMIT = "request_resubmission", "Request resubmission"
        REJECT = "reject", "Reject automatically"

    nlp_provider = models.CharField(max_length=32, default="ollama_cloud")
    nlp_model = models.CharField(max_length=120, default="gemma4:31b")
    relevance_threshold = models.FloatField(default=0.65)
    duplicate_threshold = models.FloatField(default=0.85)
    report_duplicate_detection_enabled = models.BooleanField(default=True)
    report_duplicate_action = models.CharField(max_length=24, choices=ReportDuplicateAction.choices, default=ReportDuplicateAction.WARN)
    report_duplicate_lookback_days = models.PositiveIntegerField(default=180)
    report_duplicate_distance_meters = models.PositiveIntegerField(default=100)
    report_duplicate_similarity_threshold = models.FloatField(default=0.88)
    report_duplicate_location_precision = models.PositiveSmallIntegerField(default=4)
    minimum_description_length = models.PositiveSmallIntegerField(default=20)
    mismatch_action = models.CharField(max_length=32, choices=MismatchAction.choices, default=MismatchAction.AUTO_CORRECT)
    duplicate_detection_enabled = models.BooleanField(default=True)
    resolved_match_detection_enabled = models.BooleanField(default=True)
    resolved_match_lookback_days = models.PositiveIntegerField(default=90)
    flag_suspicious = models.BooleanField(default=True)
    flag_irrelevant = models.BooleanField(default=True)
    content_safety_spam_action = models.CharField(max_length=24, choices=SpamAction.choices, default=SpamAction.AUTO_REJECT)
    content_safety_abusive_action = models.CharField(max_length=24, choices=AbusiveAction.choices, default=AbusiveAction.HOLD)
    content_safety_threat_action = models.CharField(max_length=24, choices=ThreatAction.choices, default=ThreatAction.ACCEPT_FLAG_NOTIFY)
    content_safety_sensitive_action = models.CharField(max_length=24, choices=SensitiveContentAction.choices, default=SensitiveContentAction.RESTRICT_HOLD)
    require_ongoing_emergency_confirmation = models.BooleanField(default=True)
    street_imagery_enabled = models.BooleanField(default=False)
    street_imagery_categories = models.JSONField(default=list, blank=True)
    street_imagery_radius_meters = models.PositiveIntegerField(default=50)
    street_imagery_action = models.CharField(max_length=24, choices=StreetImageryAction.choices, default=StreetImageryAction.RESUBMIT)
    photo_duplicate_llm_enabled = models.BooleanField(default=True)
    photo_duplicate_candidate_limit = models.PositiveSmallIntegerField(default=3)
    enabled_categories = models.JSONField(default=list, blank=True)
    suspicious_terms = models.JSONField(default=list, blank=True)
    category_keywords = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="classification_config_updates")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


    CLASSIFICATION_CONFIG_CACHE_KEY = "concerns:classification-config:v1"

    @classmethod
    def _config_defaults(cls):
        return {
            "enabled_categories": list(Concern.Category.values),
            "suspicious_terms": ["asdf", "qwerty", "test", "testing", "12345"],
            "category_keywords": {
                "infrastructure": ["pothole", "lubak", "kalsada", "streetlight", "ilaw", "kanal", "drainage"],
                "environment": ["basura", "garbage", "trash", "baha", "tubig", "pollution", "punong natumba"],
                "public_safety": ["aksidente", "accident", "sunog", "away", "crime", "danger", "delikado", "stray dog"],
                "vehicle": ["car", "truck", "motorcycle", "bus", "bicycle", "van", "jeep"],
                "others": [],
            },
            "nlp_provider": "ollama_cloud",
            "nlp_model": "gemma4:31b",
        }

    @classmethod
    def current(cls):
        """The singleton configuration, cached briefly.

        Serializers call this several times per concern row; uncached it was
        ~30 DB queries per feed request (27 seconds over a WAN database at
        ~100 ms/query). Officials' edits still apply within a minute because
        save()/delete() invalidate the key.
        """
        from django.core.cache import cache

        cached = cache.get(cls.CLASSIFICATION_CONFIG_CACHE_KEY)
        if isinstance(cached, cls):
            return cached
        obj, _ = cls.objects.get_or_create(pk=1, defaults=cls._config_defaults())
        cache.set(cls.CLASSIFICATION_CONFIG_CACHE_KEY, obj, 60)
        return obj

    @classmethod
    def current_fresh(cls):
        """Uncached twin of current() for read/modify/write flows.

        Mutating a cached instance breaks when the row was recreated elsewhere
        (save(update_fields) hits zero rows); officials' config endpoints are
        low-traffic, so they take the extra query.
        """
        obj, _ = cls.objects.get_or_create(pk=1, defaults=cls._config_defaults())
        return obj

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self._bust_cache()

    def delete(self, *args, **kwargs):
        result = super().delete(*args, **kwargs)
        self._bust_cache()
        return result

    @staticmethod
    def _bust_cache():
        from django.core.cache import cache

        cache.delete(ConcernClassificationConfiguration.CLASSIFICATION_CONFIG_CACHE_KEY)

class ConcernAssignment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="assignments")
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_concerns")
    department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_assignments")
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
    preview_file = models.FileField(
        storage=PublicMediaStorage(), upload_to="previews/concern-chat/%Y/%m/", blank=True
    )
    privacy_state = models.CharField(max_length=24, blank=True)
    privacy_detail = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class ChatMessageRead(models.Model):
    message = models.ForeignKey(ConcernChatMessage, on_delete=models.CASCADE, related_name="reads")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_chat_reads")
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "user"], name="concerns_chat_read_uniq")]
        indexes = [models.Index(fields=["user", "read_at"], name="concerns_chat_read_user")]


class ChatTypingIndicator(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="typing_indicators")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_typing_indicators")
    is_typing = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["concern", "user"], name="concerns_typing_uniq")]


class DepartmentChatThread(models.Model):
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name="chat_threads")
    title = models.CharField(max_length=160)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_department_chat_threads")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]


class DepartmentChatMessage(models.Model):
    thread = models.ForeignKey(DepartmentChatThread, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="department_chat_messages")
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["thread", "created_at"], name="dept_chat_thread_created")]


class AnnouncementComment(models.Model):
    class Status(models.TextChoices):
        VISIBLE = "visible", "Visible"
        HIDDEN = "hidden", "Hidden"
        REMOVED = "removed", "Removed"

    announcement = models.ForeignKey(
        Announcement, on_delete=models.CASCADE, related_name="comments"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="announcement_comments",
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies"
    )
    body = models.TextField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.VISIBLE)
    is_official_reply = models.BooleanField(default=False)
    moderation_note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(
                fields=["announcement", "status", "created_at"],
                name="ann_comment_status_idx",
            ),
        ]

    def __str__(self):
        return f"Comment {self.pk} on announcement {self.announcement_id}"


class ConcernMergeSuggestion(models.Model):
    """A proposal that `concern` is the same report as `primary`.

    Kept separate from ConcernMergeEvent so a suggestion an official never
    looked at is distinguishable from one they acted on.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        EXPIRED = "expired", "Expired"

    concern = models.ForeignKey(
        Concern, on_delete=models.CASCADE, related_name="merge_suggestions"
    )
    primary = models.ForeignKey(
        Concern, on_delete=models.CASCADE, related_name="merge_suggestions_as_primary"
    )
    confidence = models.FloatField(default=0.0)
    method = models.CharField(max_length=32, blank=True)
    distance_meters = models.PositiveIntegerField(null=True, blank=True)
    rationale = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="concern_merge_decisions",
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-confidence", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["concern", "primary"], name="unique_concern_merge_suggestion"
            ),
            models.CheckConstraint(
                condition=~models.Q(concern=models.F("primary")),
                name="merge_suggestion_not_self",
            ),
        ]

    def __str__(self):
        return f"Suggest merging {self.concern_id} into {self.primary_id}"


class ConcernMergeEvent(models.Model):
    class Action(models.TextChoices):
        MERGED = "merged", "Merged"
        UNMERGED = "unmerged", "Unmerged"
        PRIMARY_CHANGED = "primary_changed", "Primary changed"
        SUGGESTION_REJECTED = "suggestion_rejected", "Suggestion rejected"

    concern = models.ForeignKey(
        Concern, on_delete=models.CASCADE, related_name="merge_events"
    )
    primary = models.ForeignKey(
        Concern,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="merge_events_as_primary",
    )
    action = models.CharField(max_length=24, choices=Action.choices)
    confidence = models.FloatField(null=True, blank=True)
    method = models.CharField(max_length=32, blank=True)
    reason = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="concern_merge_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.action} on concern {self.concern_id}"


class SystemBanner(models.Model):
    """A scrolling notice, or the maintenance lock, set by an official."""

    class Kind(models.TextChoices):
        TICKER = "ticker", "Scrolling notice"
        MAINTENANCE = "maintenance", "Maintenance mode"

    class Tone(models.TextChoices):
        INFO = "info", "Information"
        WARNING = "warning", "Warning"
        CRITICAL = "critical", "Critical"

    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.TICKER)
    tone = models.CharField(max_length=16, choices=Tone.choices, default=Tone.INFO)
    message = models.CharField(max_length=280)
    detail = models.TextField(blank=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="system_banners",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["kind", "is_active"], name="system_banner_live")]

    def __str__(self):
        return f"{self.kind}: {self.message[:40]}"

    def is_live(self, now=None):
        from django.utils import timezone as dj_timezone

        if not self.is_active:
            return False
        moment = now or dj_timezone.now()
        if self.starts_at and moment < self.starts_at:
            return False
        if self.ends_at and moment > self.ends_at:
            return False
        return True

    @classmethod
    def live(cls, kind, now=None):
        for banner in cls.objects.filter(kind=kind, is_active=True):
            if banner.is_live(now):
                return banner
        return None
