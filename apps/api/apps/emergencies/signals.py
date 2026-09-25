"""Keep a critical concern and its emergency companion in one lifecycle."""

from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.concerns.models import Concern

from .models import Community, EmergencyAlert, MapGeometry


@receiver(post_save, sender=MapGeometry)
def bump_community_boundary_revision(sender, instance, **kwargs):
    """Redraw the boundary and every cached map has to notice.

    The static map payload and the public config are cached under
    `...:{community.pk}:{boundary_revision}`, so an edit that does not bump the
    revision keeps serving the old outline until the cache expires. Direct
    model saves (admin, shell, tests) and the boundary API both land here.
    """
    if instance.kind != MapGeometry.Kind.BOUNDARY:
        return
    community = getattr(instance, "community", None)
    if community is None:
        return
    Community.objects.filter(pk=community.pk).update(
        boundary_revision=models.F("boundary_revision") + 1,
        updated_at=timezone.now(),
    )


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
