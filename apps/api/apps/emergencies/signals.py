"""Keep a critical concern and its emergency companion in one lifecycle."""

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.concerns.models import Concern

from .models import EmergencyAlert


@receiver(post_save, sender=EmergencyAlert)
def resolve_linked_critical_concern(sender, instance, **kwargs):
    """Resolving the response also resolves the report that created it."""
    if (
        instance.status != EmergencyAlert.Status.RESOLVED
        or not instance.source_concern_id
    ):
        return
    Concern.objects.filter(pk=instance.source_concern_id).exclude(
        status=Concern.Status.RESOLVED
    ).update(status=Concern.Status.RESOLVED, updated_at=timezone.now())
