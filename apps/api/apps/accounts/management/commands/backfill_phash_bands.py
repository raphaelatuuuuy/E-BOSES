"""Backfill the perceptual-hash band index for existing media rows.

Run once after deploying the MediaPhashBand model:

    python manage.py backfill_phash_bands

Idempotent: each media row's band rows are replaced, not duplicated.
"""

from django.core.management.base import BaseCommand

from apps.concerns.models import ConcernMedia
from apps.phash_index import (
    SCOPE_CONCERN_MEDIA,
    SCOPE_RESIDENCE_PROOF,
    index_phash_bands,
)
from apps.accounts.models import ResidenceProof


class Command(BaseCommand):
    help = "Index existing ResidenceProof and ConcernMedia hashes into MediaPhashBand."

    def handle(self, *args, **options):
        indexed = 0
        proofs = (
            ResidenceProof.objects.exclude(phash="")
            .exclude(phash_blocks=[])
            .only("id", "phash", "phash_blocks", "uploaded_at")
            .iterator(chunk_size=500)
        )
        for proof in proofs:
            index_phash_bands(
                SCOPE_RESIDENCE_PROOF,
                proof.pk,
                phash=proof.phash,
                blocks=proof.phash_blocks or [],
                source_created_at=proof.uploaded_at,
            )
            indexed += 1
        self.stdout.write(f"residence proofs indexed: {indexed}")

        media_indexed = 0
        medias = (
            ConcernMedia.objects.exclude(phash="")
            .exclude(phash_blocks=[])
            .only("id", "phash", "phash_blocks", "uploaded_at")
            .iterator(chunk_size=500)
        )
        for media in medias:
            index_phash_bands(
                SCOPE_CONCERN_MEDIA,
                media.pk,
                phash=media.phash,
                blocks=media.phash_blocks or [],
                source_created_at=media.uploaded_at,
            )
            media_indexed += 1
        self.stdout.write(f"concern media indexed: {media_indexed}")
        self.stdout.write(self.style.SUCCESS(f"backfill complete ({indexed + media_indexed} rows)"))
