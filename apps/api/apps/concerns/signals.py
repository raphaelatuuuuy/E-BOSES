from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.phash_index import SCOPE_CONCERN_MEDIA, index_phash_bands, remove_phash_bands

from .models import ConcernMedia


@receiver(post_save, sender=ConcernMedia, dispatch_uid="index-concern-media-phash")
def index_concern_media_bands(sender, instance, **kwargs):
    index_phash_bands(
        SCOPE_CONCERN_MEDIA,
        instance.pk,
        phash=instance.phash,
        blocks=instance.phash_blocks or [],
        source_created_at=instance.uploaded_at,
    )


@receiver(post_delete, sender=ConcernMedia, dispatch_uid="deindex-concern-media-phash")
def deindex_concern_media_bands(sender, instance, **kwargs):
    remove_phash_bands(SCOPE_CONCERN_MEDIA, instance.pk)
