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
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["kind", "name", "osm_id"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "osm_type", "osm_id"], name="unique_map_geometry_osm"),
        ]
        indexes = [models.Index(fields=["kind", "is_active", "name"], name="emerg_map_geom_kind_active")]

    def __str__(self):
        return f"{self.name} ({self.osm_type}{self.osm_id})"


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


class EmergencyAlert(models.Model):
    class Type(models.TextChoices):
        MEDICAL = "medical", "Medical"
        FIRE = "fire", "Fire"
        CRIME = "crime", "Crime"
        DISASTER = "disaster", "Disaster"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        ROUTED = "routed", "Routed"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        EN_ROUTE = "en_route", "En Route"
        NEARBY = "nearby", "Nearby"
        ARRIVED = "arrived", "Arrived"
        RESOLVED = "resolved", "Resolved"
        CANCELLED = "cancelled", "Cancelled"

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    client_request_id = models.UUIDField(null=True, blank=True, db_index=True)
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_alerts")
    type = models.CharField(max_length=32, choices=Type.choices)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.SUBMITTED)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    location_source = models.CharField(max_length=32, default="gps")
    location_accuracy = models.FloatField(null=True, blank=True)
    address = models.CharField(max_length=255, blank=True)
    media_warnings = models.JSONField(default=list, blank=True)
    status_version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    routed_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["reporter", "client_request_id"],
                condition=models.Q(client_request_id__isnull=False),
                name="unique_emergency_client_request",
            ),
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


class EmergencyResponderAssignment(models.Model):
    class Status(models.TextChoices):
        ASSIGNED = "assigned", "Assigned"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        EN_ROUTE = "en_route", "En Route"
        ARRIVED = "arrived", "Arrived"
        RESOLVED = "resolved", "Resolved"
        ESCALATED = "escalated", "Escalated"
        CANCELLED = "cancelled", "Cancelled"

    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="assignments")
    responder = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_assignments")
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.ASSIGNED)
    assigned_at = models.DateTimeField(auto_now_add=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    arrived_at = models.DateTimeField(null=True, blank=True)

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


class EmergencyStatusEvent(models.Model):
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="status_events")
    status = models.CharField(max_length=32, choices=EmergencyAlert.Status.choices)
    note = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="emergency_status_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class WitnessNotification(models.Model):
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="witness_notifications")
    resident = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_witness_notifications")
    distance_meters = models.PositiveIntegerField(default=0)
    sent_at = models.DateTimeField(auto_now_add=True)
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
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["alert", "created_at"], name="emerg_chat_alert_created"),
        ]

    def __str__(self):
        return f"Chat #{self.pk} on alert {self.alert_id}"
