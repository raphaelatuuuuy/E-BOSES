from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.phash_index import SCOPE_RESIDENCE_PROOF, index_phash_bands, remove_phash_bands

from .models import ResidenceProof


@receiver(post_save, sender=ResidenceProof, dispatch_uid="index-residence-proof-phash")
def index_residence_proof_bands(sender, instance, **kwargs):
    index_phash_bands(
        SCOPE_RESIDENCE_PROOF,
        instance.pk,
        phash=instance.phash,
        blocks=instance.phash_blocks or [],
        source_created_at=instance.uploaded_at,
    )


@receiver(post_delete, sender=ResidenceProof, dispatch_uid="deindex-residence-proof-phash")
def deindex_residence_proof_bands(sender, instance, **kwargs):
    remove_phash_bands(SCOPE_RESIDENCE_PROOF, instance.pk)
