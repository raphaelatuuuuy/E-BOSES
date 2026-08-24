"""Mini probe: measure candidate selectivity per probe family."""

import os
import secrets
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.db.models import Q

from apps.accounts.models import MediaPhashBand, ResidenceProof
from apps.media_utils import PHASH_BLOCK_BAND_BITS, PHASH_FULL_BAND_BITS, split_phash_bands
from apps.phash_index import SCOPE_RESIDENCE_PROOF, index_phash_bands

N = 2000
MARKER = "bench-phash-mini"

user_id = ResidenceProof.objects.values_list("user_id", flat=True).first()

try:
    hashes = [secrets.token_hex(8) for _ in range(N)]
    target = secrets.token_hex(8)
    proofs = ResidenceProof.objects.bulk_create(
        ResidenceProof(
            user_id=user_id,
            side=ResidenceProof.Side.SINGLE,
            original_filename=f"{MARKER}-{i}",
            mime_type="image/jpeg",
            file_size=1,
            sha256_hash=secrets.token_hex(32),
            phash=h,
        )
        for i, h in enumerate(hashes)
    )
    for i, proof in enumerate(proofs):
        index_phash_bands(SCOPE_RESIDENCE_PROOF, proof.pk, phash=proof.phash, blocks=[])

    print("band rows:", MediaPhashBand.objects.filter(scope=SCOPE_RESIDENCE_PROOF).count())
    from apps.phash_index import phash_candidate_ids

    started = time.perf_counter()
    ids = phash_candidate_ids(SCOPE_RESIDENCE_PROOF, phashes=[target])
    elapsed_ms = (time.perf_counter() - started) * 1000
    import json

    print(
        json.dumps(
            {
                "rows": N,
                "union": len(ids),
                "selectivity_pct": round(100 * len(ids) / N, 1),
                "probe_ms": round(elapsed_ms, 1),
            }
        )
    )
finally:
    deleted, _ = ResidenceProof.objects.filter(original_filename__startswith=MARKER).delete()
    print(f"cleaned up {deleted} rows")
