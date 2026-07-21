"""Domain services for alert creation, responder assignment, and status changes."""

from django.utils import timezone


def mark_witness_notifications_read(resident, *, alert_id=None):
    """Synchronize notification reads without exposing emergency models to another app."""
    from .models import WitnessNotification

    queryset = WitnessNotification.objects.filter(resident=resident, read_at__isnull=True)
    if alert_id is not None:
        queryset = queryset.filter(alert_id=alert_id)
    return queryset.update(read_at=timezone.now())
