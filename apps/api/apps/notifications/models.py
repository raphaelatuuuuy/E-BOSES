import uuid

from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Type(models.TextChoices):
        RESIDENT_UPDATE = "resident_update", "Resident Update"
        RESPONDER_ALERT = "responder_alert", "Responder Alert"
        BARANGAY_STAFF = "barangay_staff", "Barangay Staff"
        WITNESS_ALERT = "witness_alert", "Witness Alert"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=40, choices=Type.choices)
    title = models.CharField(max_length=120)
    body = models.TextField()
    data = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "read_at"]), models.Index(fields=["type", "created_at"])]


class WitnessNotification(models.Model):
    class DeliveryStatus(models.TextChoices):
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"
        PENDING = "pending", "Pending"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alert = models.ForeignKey("emergencies.EmergencyAlert", on_delete=models.CASCADE, related_name="witness_notifications")
    resident = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="witness_notifications")
    sent_at = models.DateTimeField(auto_now_add=True)
    delivery_status = models.CharField(max_length=20, choices=DeliveryStatus.choices, default=DeliveryStatus.DELIVERED)

    class Meta:
        unique_together = ("alert", "resident")


class DeviceToken(models.Model):
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="device_tokens")
    token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=30, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)
