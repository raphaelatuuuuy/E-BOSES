from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.notifications.services import notify_status_change

from .models import ConcernStatusEvent


@receiver(post_save, sender=ConcernStatusEvent)
def on_concern_status_event(sender, instance, created, **kwargs):
    """Auto-create a notification when a ConcernStatusEvent is created."""
    if created:
        notify_status_change(instance.concern)
