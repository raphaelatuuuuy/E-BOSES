"""Banded candidate lookup for perceptual-hash duplicate checks.

Writers keep apps.accounts.MediaPhashBand rows in sync via post_save/post_delete
signals (apps.accounts.signals, apps.concerns.signals). Readers probe the index
with positional band equality — a few indexed lookups — and only run the exact
Hamming comparison over the returned candidates, instead of scanning every
stored hash. Positional matching keeps candidate sets tiny; the pigeonhole
guarantee over disjoint bands means no true similar pair is ever missed.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.media_utils import (
    PHASH_BLOCK_BAND_BITS,
    PHASH_FULL_BAND_BITS,
    split_phash_bands,
)

SCOPE_RESIDENCE_PROOF = "residence-proof"
SCOPE_CONCERN_MEDIA = "concern-media"

BLOCK_BAND_STRIDE = len(PHASH_BLOCK_BAND_BITS)


def _band_model():
    from apps.accounts.models import MediaPhashBand

    return MediaPhashBand


def index_phash_bands(scope: str, object_id: int, *, phash: str, blocks, source_created_at=None) -> None:
    """Replace the band rows for one media object. Safe to call repeatedly."""
    MediaPhashBand = _band_model()
    created_at = source_created_at or timezone.now()
    rows = [
        MediaPhashBand(
            scope=scope,
            object_id=object_id,
            kind=MediaPhashBand.KIND_FULL,
            band_index=index,
            band_value=value,
            source_created_at=created_at,
        )
        for index, value in enumerate(split_phash_bands(phash or "", PHASH_FULL_BAND_BITS))
    ]
    seen_block_values = set()
    for block_position, block in enumerate(blocks or []):
        for index, value in enumerate(split_phash_bands(block, PHASH_BLOCK_BAND_BITS)):
            key = (block_position * BLOCK_BAND_STRIDE + index, value)
            if key in seen_block_values:
                continue
            seen_block_values.add(key)
            rows.append(
                MediaPhashBand(
                    scope=scope,
                    object_id=object_id,
                    kind=MediaPhashBand.KIND_BLOCK,
                    band_index=key[0],
                    band_value=value,
                    source_created_at=created_at,
                )
            )
    with transaction.atomic():
        MediaPhashBand.objects.filter(scope=scope, object_id=object_id).delete()
        if rows:
            MediaPhashBand.objects.bulk_create(rows, ignore_conflicts=True)


def remove_phash_bands(scope: str, object_id: int) -> None:
    _band_model().objects.filter(scope=scope, object_id=object_id).delete()


def _window_cutoff():
    days = getattr(settings, "MEDIA_DEDUP_WINDOW_DAYS", 0) or 0
    if days <= 0:
        return None
    return timezone.now() - timedelta(days=days)


def phash_candidate_ids(scope: str, *, phashes=None, blocks=None):
    """Object ids whose stored hashes could be similar to any query hash.

    Probe families mirror every comparison the exact check can make, all
    positional:
    - new full hash vs stored full hashes   (threshold 10, 11 bands)
    - new full hash vs stored crop blocks   (threshold 4, 5 bands)
    - new crop blocks vs stored full hashes (threshold 4, 5 bands)
    """
    condition = Q()

    def add(kind, index_values):
        nonlocal condition
        for index, value in index_values:
            condition |= Q(kind=kind, band_index=index, band_value=value)

    for phash in phashes or []:
        bands = split_phash_bands(phash, PHASH_FULL_BAND_BITS)
        add("full", enumerate(bands))
        # Stored side is any crop-block position k: its row lives at k*5+i.
        block_bands = split_phash_bands(phash, PHASH_BLOCK_BAND_BITS)
        for i, value in enumerate(block_bands):
            positions = [k * BLOCK_BAND_STRIDE + i for k in range(14)]
            condition |= Q(kind="block", band_index__in=positions, band_value=value)
    for block in blocks or []:
        bands = split_phash_bands(block, PHASH_BLOCK_BAND_BITS)
        add("full", enumerate(bands))
    if not condition.children:
        return set()

    queryset = (
        _band_model().objects.filter(Q(scope=scope) & condition).values_list("object_id", flat=True)
    )
    cutoff = _window_cutoff()
    if cutoff is not None:
        queryset = queryset.filter(source_created_at__gte=cutoff)
    return set(queryset.distinct().iterator(chunk_size=1000))
