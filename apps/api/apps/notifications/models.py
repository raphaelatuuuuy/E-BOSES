from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Type(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        ASSIGNED = "assigned", "Assigned"
        RESOLVED = "resolved", "Resolved"
        REJECTED = "rejected", "Rejected"
        ANNOUNCEMENT = "announcement", "Announcement"
        EMERGENCY_SUBMITTED = "emergency_submitted", "Emergency Submitted"
        EMERGENCY_ROUTED = "emergency_routed", "Emergency Routed"
        EMERGENCY_ACKNOWLEDGED = "emergency_acknowledged", "Emergency Acknowledged"
        EMERGENCY_EN_ROUTE = "emergency_en_route", "Emergency En Route"
        EMERGENCY_ARRIVED = "emergency_arrived", "Emergency Arrived"
        EMERGENCY_RESOLVED = "emergency_resolved", "Emergency Resolved"
        EMERGENCY_CANCELLED = "emergency_cancelled", "Emergency Cancelled"
        WITNESS_ALERT = "witness_alert", "Witness Alert"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    concern = models.ForeignKey(
        "concerns.Concern",
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    emergency = models.ForeignKey(
        "emergencies.EmergencyAlert",
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    type = models.CharField(max_length=32, choices=Type.choices)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.type}] {self.title} — {self.recipient}"

class BrowserPushSubscription(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="browser_push_subscriptions",
    )
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    user_agent = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "is_active"]),
        ]

    def __str__(self):
        return f"Browser push for {self.user_id}"
