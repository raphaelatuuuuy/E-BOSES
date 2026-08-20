import uuid

from django.conf import settings
from django.db import models

from apps.accounts.storage import PrivateMediaStorage, PublicMediaStorage


class MapGeometry(models.Model):
    class Kind(models.TextChoices):
        BOUNDARY = "boundary", "Boundary"
        STREET = "street", "Street"

    kind = models.CharField(max_length=16, choices=Kind.choices)
    name = models.CharField(max_length=160, db_index=True)
    osm_type = models.CharField(max_length=1)
    osm_id = models.PositiveBigIntegerField()
    street_type = models.CharField(max_length=40, blank=True)
    geometry = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True)
    locality = models.CharField(max_length=80, blank=True)
    is_home = models.BooleanField(default=False)
    neighbors = models.ManyToManyField("self", blank=True, symmetrical=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["kind", "name", "osm_id"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "osm_type", "osm_id"], name="unique_map_geometry_osm"),
        ]
        indexes = [models.Index(fields=["kind", "is_active", "name"], name="emerg_map_geom_kind_active")]

    def __str__(self):
        return f"{self.name} ({self.osm_type}{self.osm_id})"


DEFAULT_HOTLINES = [
    {"label": "Marikina Rescue", "number": "161"},
    {"label": "Emergency", "number": "911"},
]


class MapAddressPoint(models.Model):
    """A house number imported from OpenStreetMap.

    Street geometry alone answers "which road is this pin on"; these answer
    "which house". Held locally so address lookup never depends on a third-party
    API that can rate-limit us mid-emergency.
    """

    osm_type = models.CharField(max_length=1, default="N")
    osm_id = models.PositiveBigIntegerField()
    house_number = models.CharField(max_length=32, blank=True)
    street = models.CharField(max_length=160, blank=True, db_index=True)
    name = models.CharField(max_length=200, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["osm_type", "osm_id"], name="unique_map_address_osm"),
        ]
        indexes = [
            models.Index(fields=["latitude", "longitude"], name="emerg_addr_coords"),
        ]

    def __str__(self):
        return f"{self.house_number} {self.street}".strip() or f"Address {self.osm_id}"

    @property
    def label(self) -> str:
        parts = [self.house_number, self.street or self.name]
        return " ".join(part for part in parts if part).strip()


class MapDispatchPolicy(models.Model):
    class OutOfZoneAction(models.TextChoices):
        BLOCK = "block", "Block submission"
        WARN = "warn", "Warn and allow"
        REVIEW = "review", "Flag for official review"

    barangay = models.CharField(max_length=120, default="Marikina Heights", unique=True)
    acceptance_center_latitude = models.DecimalField(max_digits=10, decimal_places=7, default=14.6507000)
    acceptance_center_longitude = models.DecimalField(max_digits=10, decimal_places=7, default=121.1133000)
    acceptance_radius_meters = models.PositiveIntegerField(default=800)
    # A drawn acceptance zone (GeoJSON Polygon). When set it replaces the
    # circle, so a barangay whose coverage is not round can trace it instead.
    acceptance_geometry = models.JSONField(null=True, blank=True)
    out_of_zone_action = models.CharField(
        max_length=16,
        choices=OutOfZoneAction.choices,
        default=OutOfZoneAction.REVIEW,
    )
    witness_radius_meters = models.PositiveIntegerField(default=250)
    responder_nearby_radius_meters = models.PositiveIntegerField(default=100)
    # SMS fallback for residents with no mobile data. Held here rather than in a
    # build-time env var so a barangay can change the number without rebuilding
    # and redeploying the app. Blank means the SOS screen offers no SMS option,
    # which is the honest default until a barangay has a number to publish.
    emergency_sms_number = models.CharField(max_length=16, blank=True)
    # Outside these hours the SOS button warns and points at the hotlines, but
    # never blocks: an emergency at 2am is still an emergency, and a disabled
    # button would simply lose the report.
    duty_hours_start = models.TimeField(null=True, blank=True)
    duty_hours_end = models.TimeField(null=True, blank=True)
    hotlines = models.JSONField(
        default=list,
        blank=True,
        help_text='[{"label": "Marikina Rescue", "number": "161"}]',
    )
    covered = models.ManyToManyField(
        "MapGeometry",
        blank=True,
        limit_choices_to={"kind": "boundary"},
        related_name="covered_by_policies",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="map_dispatch_policy_updates",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Map dispatch policy"
        verbose_name_plural = "Map dispatch policies"

    @classmethod
    def current(cls):
        obj, _ = cls.objects.get_or_create(pk=1, defaults={"barangay": "Marikina Heights"})
        return obj

    def as_payload(self):
        return {
            "id": self.pk,
            "barangay": self.barangay,
            "acceptance_center_latitude": float(self.acceptance_center_latitude),
            "acceptance_center_longitude": float(self.acceptance_center_longitude),
            "acceptance_radius_meters": int(self.acceptance_radius_meters),
            "acceptance_geometry": self.acceptance_geometry,
            "out_of_zone_action": self.out_of_zone_action,
            "witness_radius_meters": int(self.witness_radius_meters),
            "responder_nearby_radius_meters": int(self.responder_nearby_radius_meters),
            "emergency_sms_number": self.emergency_sms_number,
            "duty_hours_start": self.duty_hours_start.strftime("%H:%M") if self.duty_hours_start else None,
            "duty_hours_end": self.duty_hours_end.strftime("%H:%M") if self.duty_hours_end else None,
            "hotlines": self.hotlines or DEFAULT_HOTLINES,
            "updated_at": self.updated_at,
        }

    def is_within_duty_hours(self, moment=None) -> bool:
        """True when barangay responders are on their normal shift.

        No configured window means always on duty, which is the safe default.
        A window that wraps past midnight (e.g. 20:00-06:00) is handled.
        """
        if not self.duty_hours_start or not self.duty_hours_end:
            return True
        from django.utils import timezone as dj_timezone

        now = (moment or dj_timezone.localtime()).time()
        if self.duty_hours_start <= self.duty_hours_end:
            return self.duty_hours_start <= now <= self.duty_hours_end
        return now >= self.duty_hours_start or now <= self.duty_hours_end

    def __str__(self):
        return f"{self.barangay} dispatch policy"


class MapServicePoi(models.Model):
    """
    Admin-managed map service markers (hall, tanod, clinic, etc.).

    Merge rules with OpenStreetMap (see apps.geo_services.collect_service_pois):
    - Active admin rows always appear on the Services layer.
    - If osm_type + osm_id are set on an active row, that OSM feature is replaced
      by the admin record (custom name/coords).
    - If osm_type + osm_id are set and is_active=False, that OSM feature is hidden.
    """

    class Source(models.TextChoices):
        ADMIN = "admin", "Admin managed"
        CURATED = "curated", "Curated seed"

    class Sector(models.TextChoices):
        PUBLIC = "public", "Public"
        PRIVATE = "private", "Private"

    class PoiType(models.TextChoices):
        BARANGAY_HALL = "barangay_hall", "Barangay Hall"
        HEALTH_CENTER = "health_center", "Health Center"
        HOSPITAL = "hospital", "Hospital"
        POLICE = "police", "Police"
        FIRE = "fire", "Fire Station"
        TANOD = "tanod", "Tanod"
        BDRRMO = "bdrrmo", "BDRRMO"
        EVACUATION = "evacuation", "Evacuation"
        SCHOOL = "school", "School"
        PHARMACY = "pharmacy", "Pharmacy"
        CLINIC = "clinic", "Clinic"
        DENTIST = "dentist", "Dentist"
        VETERINARY = "veterinary", "Veterinary"
        AMBULANCE = "ambulance", "Ambulance"
        SECURITY = "security", "Security"
        COMMUNITY = "community", "Community"
        OTHER = "other", "Other"

    name = models.CharField(max_length=200)
    poi_type = models.CharField(max_length=40, choices=PoiType.choices, default=PoiType.OTHER)
    label = models.CharField(
        max_length=80,
        blank=True,
        help_text="Short map label; defaults from type if blank.",
    )
    sector = models.CharField(max_length=16, choices=Sector.choices, default=Sector.PUBLIC)
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.ADMIN)
    osm_type = models.CharField(
        max_length=1,
        blank=True,
        help_text="OSM element type N/W/R when this row overrides or suppresses an OSM feature.",
    )
    osm_id = models.PositiveBigIntegerField(
        null=True,
        blank=True,
        help_text="OSM id to replace (active) or hide (inactive).",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Show on map. If False and osm_id is set, hide that OSM POI.",
    )
    notes = models.TextField(blank=True)
    priority = models.PositiveSmallIntegerField(
        default=10,
        help_text="Higher priority sorts first when merging duplicates.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "name", "id"]
        verbose_name = "Map service POI"
        verbose_name_plural = "Map service POIs"
        indexes = [
            models.Index(fields=["is_active", "poi_type"], name="emerg_svcpoi_active_type"),
            models.Index(fields=["osm_type", "osm_id"], name="emerg_svcpoi_osm"),
        ]

    def __str__(self):
        return f"{self.name} ({self.poi_type})"

    def resolved_label(self) -> str:
        if self.label.strip():
            return self.label.strip()
        return self.get_poi_type_display()


class EmergencyCategory(models.Model):
    code = models.SlugField(max_length=80, unique=True)
    label = models.CharField(max_length=80)
    subtext = models.CharField(max_length=160, blank=True)
    icon_key = models.CharField(max_length=48, default="siren")
    custom_icon_label = models.CharField(max_length=8, blank=True)
    icon_image = models.FileField(storage=PublicMediaStorage(), upload_to="emergency-category-icons/", blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "label"]
        indexes = [models.Index(fields=["is_active", "sort_order"], name="emerg_cat_active_order")]

    def __str__(self):
        return self.label


class EmergencyAlert(models.Model):
    class Type(models.TextChoices):
        MEDICAL = "medical", "Medical"
        FIRE = "fire", "Fire"
        CRIME = "crime", "Crime"
        DISASTER = "disaster", "Disaster"
        CHILD_PROTECTION = "child_protection", "Child Protection"
        DOMESTIC_VIOLENCE = "domestic_violence", "Domestic Violence"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Emergency Received"
        ROUTING = "routing", "Finding Available Responder"
        ROUTED = "routed", "Responder Assigned"
        AWAITING_ACKNOWLEDGMENT = "awaiting_acknowledgment", "Awaiting Responder"
        ACKNOWLEDGED = "acknowledged", "Responder Confirmed"
        EN_ROUTE = "en_route", "Responder En Route"
        NEARBY = "nearby", "Responder Nearby"
        ARRIVED = "arrived", "Responder at Scene"
        RESIDENT_SAFE = "resident_safe", "Resident Reported Safe"
        BACKUP_REQUESTED = "backup_requested", "Backup Requested"
        BACKUP_ASSIGNED = "backup_assigned", "Backup Assigned"
        IN_PROGRESS = "in_progress", "Response in Progress"
        TRANSFER_REQUIRED = "transfer_required", "Transfer Required"
        ESCALATION_REQUIRED = "escalation_required", "Escalation Required"
        RESOLVED = "resolved", "Resolved"
        FALSE_ALARM = "false_alarm", "False Alarm"
        INVALID = "invalid", "Invalid"
        CANCELLED = "cancelled", "Cancelled"
        CLOSED = "closed", "Closed"

    class LocationConfidence(models.TextChoices):
        CONFIRMED = "confirmed", "Confirmed"
        REPORTED = "reported", "Reported area only"
        UNKNOWN = "unknown", "Unknown"
        OUTSIDE_AREA = "outside_area", "Outside service area"

    class ReverseGeocodingStatus(models.TextChoices):
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"
        PENDING = "pending", "Pending"

    class ReporterVerification(models.TextChoices):
        ACCOUNT = "account", "Signed-in account"
        REGISTERED_NUMBER = "registered", "Registered mobile number"
        UNVERIFIED_NUMBER = "unverified", "Mobile number not verified"
        NEEDS_REVIEW = "needs_review", "Account match requires review"

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    client_request_id = models.UUIDField(null=True, blank=True, db_index=True)
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_alerts")
    type = models.CharField(max_length=32, choices=Type.choices)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.SUBMITTED)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    # Nullable since the SMS fallback: a resident can text "This is a Fire
    # emergency near Champaca Street" from a phone with no GPS fix. That is a
    # real emergency and must be saved and routed. Substituting a barangay
    # centroid instead would put a confident-looking pin on the wrong street,
    # so an alert with no coordinates carries none.
    latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    location_source = models.CharField(max_length=32, default="gps")
    location_accuracy = models.FloatField(null=True, blank=True)
    address = models.CharField(max_length=255, blank=True)
    # The area exactly as the resident described it. Never overwritten by
    # geocoding, so an official can always see what was actually reported.
    reported_area = models.CharField(max_length=255, blank=True)
    # What reverse geocoding made of the coordinates. Shown to officials in
    # preference to raw numbers.
    resolved_location = models.CharField(max_length=255, blank=True)
    reverse_geocoding_status = models.CharField(
        max_length=16,
        choices=ReverseGeocodingStatus.choices,
        default=ReverseGeocodingStatus.SKIPPED,
    )
    location_confidence = models.CharField(
        max_length=16,
        choices=LocationConfidence.choices,
        default=LocationConfidence.CONFIRMED,
    )
    reporter_verification = models.CharField(
        max_length=16,
        choices=ReporterVerification.choices,
        default=ReporterVerification.ACCOUNT,
    )
    reporter_contact_number = models.CharField(
        max_length=24,
        blank=True,
        help_text="Sender number for SMS-originated alerts. Masked everywhere except the audited reveal endpoint.",
    )
    # Answers from the SOS triage questions, or parsed back out of the SMS.
    triage = models.JSONField(default=dict, blank=True)
    category_needs_confirmation = models.BooleanField(default=False)
    unresolved_fields = models.JSONField(default=list, blank=True)
    media_warnings = models.JSONField(default=list, blank=True)
    resolution_report = models.TextField(blank=True)
    resolution_submitted_at = models.DateTimeField(null=True, blank=True)
    status_version = models.PositiveIntegerField(default=0)
    source_concern = models.ForeignKey(
        "concerns.Concern",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="escalated_emergencies",
    )
    reopen_count = models.PositiveIntegerField(default=0)
    reopen_reason = models.CharField(max_length=255, blank=True)
    reopened_at = models.DateTimeField(null=True, blank=True)
    ai_assist = models.JSONField(default=dict, blank=True)
    ip_country = models.CharField(max_length=2, blank=True)
    ip_asn = models.CharField(max_length=16, blank=True)
    ip_org = models.CharField(max_length=120, blank=True)
    ip_verdict = models.CharField(max_length=24, blank=True)
    ip_score = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    routed_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    route = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["reporter", "client_request_id"],
                condition=models.Q(client_request_id__isnull=False),
                name="unique_emergency_client_request",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "barangay", "created_at"], name="emerg_alert_status_brgy"),
            models.Index(fields=["latitude", "longitude"], name="emerg_alert_coords"),
        ]


class EmergencyMedia(models.Model):
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/emergency-media/%Y/%m/")
    preview_file = models.FileField(
        storage=PublicMediaStorage(),
        upload_to="previews/emergency-media/%Y/%m/",
        blank=True,
    )
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    sha256_hash = models.CharField(max_length=64, blank=True, db_index=True)
    phash = models.CharField(max_length=16, blank=True, db_index=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class EmergencyTypeRoleMap(models.Model):
    """Routes an emergency type to the unit that answers it.

    `department` is the source of truth. `responder_unit` is the legacy closed
    enum it replaced: it is still written so older serializers and the
    `accounts_resp_avail` index keep working, but nothing reads it for routing.
    It is dropped once the transition release ships.
    """

    emergency_type = models.CharField(max_length=80)
    department = models.ForeignKey(
        "concerns.Department",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="emergency_role_maps",
    )
    # Used for backup requests and acknowledgement timeouts, never for initial
    # dispatch — sending every supporting unit to every call would strip the
    # barangay of responders for the next emergency.
    supporting_department = models.ForeignKey(
        "concerns.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="emergency_support_maps",
    )
    escalation_department = models.ForeignKey(
        "concerns.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="emergency_escalation_maps",
    )
    service_area = models.CharField(max_length=120, blank=True)
    acknowledgment_timeout_seconds = models.PositiveIntegerField(
        default=300,
        help_text="Seconds before an unacknowledged assignment is reassigned or escalated.",
    )
    auto_backup_on_timeout = models.BooleanField(default=True)
    responder_unit = models.CharField(max_length=24)
    priority = models.PositiveSmallIntegerField(default=0)
    requires_shift = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["emergency_type", "department"],
                condition=models.Q(department__isnull=False),
                name="emerg_role_map_type_dept_uniq",
            ),
        ]
        indexes = [
            models.Index(fields=["emergency_type", "is_active", "-priority"], name="emerg_role_map_lookup"),
            models.Index(fields=["department", "is_active"], name="emerg_role_map_dept"),
        ]


class EmergencyAssignmentLog(models.Model):
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="assignment_logs")
    assignment = models.ForeignKey("EmergencyResponderAssignment", null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    responder = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="emergency_assignment_logs")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="emergency_assignment_actions")
    action = models.CharField(max_length=40)
    old_status = models.CharField(max_length=32, blank=True)
    new_status = models.CharField(max_length=32, blank=True)
    note = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["alert", "created_at"], name="emerg_assign_log_lookup")]


class EmergencyResponderAssignment(models.Model):
    class Status(models.TextChoices):
        ASSIGNED = "assigned", "Assigned"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        EN_ROUTE = "en_route", "En Route"
        ARRIVED = "arrived", "Arrived"
        ASSISTING = "assisting", "Assisting"
        RESOLVED = "resolved", "Resolved"
        DECLINED = "declined", "Declined"
        ESCALATED = "escalated", "Escalated"
        CANCELLED = "cancelled", "Cancelled"

    class Source(models.TextChoices):
        AUTO = "auto", "Auto route"
        MANUAL = "manual", "Manual assignment"
        ESCALATION = "escalation", "Escalation"
        CLAIM = "claim", "Responder claim"

    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="assignments")
    responder = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_assignments")
    role_map = models.ForeignKey("EmergencyTypeRoleMap", null=True, blank=True, on_delete=models.SET_NULL, related_name="assignments")
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.ASSIGNED)
    travel_profile = models.CharField(max_length=8, blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)
    status_note = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["alert", "responder"], name="unique_responder_per_emergency_alert"),
        ]
        ordering = ["assigned_at", "id"]


class EmergencyLocationPing(models.Model):
    assignment = models.ForeignKey(EmergencyResponderAssignment, on_delete=models.CASCADE, related_name="location_pings")
    responder = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_location_pings")
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    accuracy = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["assignment", "created_at"], name="emerg_ping_assignment_time"),
            models.Index(fields=["responder", "created_at"], name="emerg_ping_responder_time"),
            models.Index(fields=["created_at"], name="emerg_ping_created_at"),
        ]


class ResponderShift(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ENDED = "ended", "Ended"

    responder = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="responder_shifts",
    )
    responder_unit = models.CharField(max_length=24, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    start_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    start_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    end_latitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    end_longitude = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    incidents_assigned = models.PositiveIntegerField(default=0)
    incidents_acknowledged = models.PositiveIntegerField(default=0)
    incidents_resolved = models.PositiveIntegerField(default=0)
    false_alarms = models.PositiveIntegerField(default=0)
    average_response_seconds = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["responder"],
                condition=models.Q(ended_at__isnull=True),
                name="unique_active_responder_shift",
            ),
        ]
        indexes = [
            models.Index(fields=["responder", "started_at"], name="shift_responder_started"),
            models.Index(fields=["status", "started_at"], name="shift_status_started"),
            models.Index(fields=["responder", "ended_at"], name="shift_responder_active"),
        ]

    def __str__(self):
        return f"Shift #{self.pk} · {self.responder_id} · {self.status}"


class EmergencyStatusEvent(models.Model):
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="status_events")
    status = models.CharField(max_length=32, choices=EmergencyAlert.Status.choices)
    # What happened, independent of the alert's status at the time. Without
    # this every entry rendered as the current status, so a timeline of five
    # different events all read "Emergency received".
    event_key = models.CharField(max_length=40, blank=True)
    label = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="emergency_status_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class WitnessNotification(models.Model):
    class PushStatus(models.TextChoices):
        NOT_CONFIGURED = "not_configured", "Not configured"
        NOT_SUBSCRIBED = "not_subscribed", "Not subscribed"
        DISABLED = "disabled", "Disabled by resident"
        DELIVERED = "delivered", "Delivered"
        PARTIAL = "partial", "Partially delivered"
        FAILED = "failed", "Failed"

    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="witness_notifications")
    resident = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_witness_notifications")
    distance_meters = models.PositiveIntegerField(default=0)
    sent_at = models.DateTimeField(auto_now_add=True)
    in_app_delivered_at = models.DateTimeField(null=True, blank=True)
    push_status = models.CharField(max_length=24, choices=PushStatus.choices, default=PushStatus.NOT_CONFIGURED)
    push_attempted_at = models.DateTimeField(null=True, blank=True)
    push_delivered_at = models.DateTimeField(null=True, blank=True)
    push_failure_count = models.PositiveIntegerField(default=0)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["alert", "resident"], name="unique_witness_notification_per_alert"),
        ]

class EmergencyAppeal(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        DENIED = "denied", "Denied"

    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="appeals")
    appellant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_appeals")
    reason = models.TextField()
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUBMITTED)
    decision_note = models.CharField(max_length=255, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_emergency_appeals")
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

class EmergencyEscalation(models.Model):
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="escalations")
    previous_assignment = models.ForeignKey(EmergencyResponderAssignment, null=True, blank=True, on_delete=models.SET_NULL, related_name="escalations")
    escalated_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="emergency_escalations_received")
    triggered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="emergency_escalations_triggered")
    reason = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class EmergencyChatMessage(models.Model):
    """Live chat between the resident and assigned responders for one SOS alert."""

    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="chat_messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="emergency_chat_messages",
    )
    body = models.TextField(max_length=2000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["alert", "created_at"], name="emerg_chat_alert_created"),
        ]

    def __str__(self):
        return f"Chat #{self.pk} on alert {self.alert_id}"


class EmergencyChatAttachment(models.Model):
    class MediaType(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"

    class AnalysisStatus(models.TextChoices):
        COMPLETE = "complete", "Complete"
        PENDING = "pending", "Pending"
        UNAVAILABLE = "unavailable", "Unavailable"

    message = models.OneToOneField(EmergencyChatMessage, on_delete=models.CASCADE, related_name="attachment")
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/emergency-chat/%Y/%m/")
    preview_file = models.FileField(storage=PublicMediaStorage(), upload_to="previews/emergency-chat/%Y/%m/", blank=True)
    media_type = models.CharField(max_length=12, choices=MediaType.choices)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120)
    file_size = models.PositiveIntegerField()
    sha256_hash = models.CharField(max_length=64, db_index=True)
    phash = models.CharField(max_length=16, blank=True, db_index=True)
    analysis_status = models.CharField(max_length=16, choices=AnalysisStatus.choices)
    analysis = models.JSONField(default=dict)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class EmergencyCommunityComment(models.Model):
    class Status(models.TextChoices):
        VISIBLE = "visible", "Visible"
        HIDDEN = "hidden", "Hidden"
        REMOVED = "removed", "Removed"

    alert = models.ForeignKey(
        EmergencyAlert, on_delete=models.CASCADE, related_name="community_comments"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="emergency_community_comments",
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies"
    )
    body = models.TextField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.VISIBLE)
    is_official_update = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="verified_emergency_comments",
    )
    moderation_note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["alert", "status", "created_at"], name="emerg_comment_alert_status"),
        ]

    def __str__(self):
        return f"Comment {self.pk} on alert {self.alert_id}"
