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
