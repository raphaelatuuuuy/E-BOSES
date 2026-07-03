import uuid

from django.conf import settings
from django.db import models


class EmergencyAlert(models.Model):
    class AlertType(models.TextChoices):
        MEDICAL = "medical", "Medical"
        FIRE = "fire", "Fire"
        CRIME = "crime", "Crime"
        DISASTER = "disaster", "Disaster"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        SENT = "sent", "Sent"
        DISPATCHED = "dispatched", "Dispatched"
        ACKNOWLEDGED = "acknowledged", "Acknowledged"
        RESPONDING = "responding", "Responding"
        RESOLVED = "resolved", "Resolved"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    resident = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="emergency_alerts")
    barangay = models.CharField(max_length=120)
    alert_type = models.CharField(max_length=30, choices=AlertType.choices)
    description = models.TextField(blank=True)
    photo_url = models.URLField(max_length=500, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    address_text = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=40, choices=Status.choices, default=Status.SENT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["barangay", "status"]), models.Index(fields=["resident", "created_at"])]


class AlertAcknowledgement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="acknowledgements")
    responder = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="alert_acknowledgements")
    status = models.CharField(max_length=30, default="assigned")
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    outcome_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("alert", "responder")


class EmergencyStatusHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alert = models.ForeignKey(EmergencyAlert, on_delete=models.CASCADE, related_name="status_history")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="emergency_status_updates")
    old_status = models.CharField(max_length=40)
    new_status = models.CharField(max_length=40)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
