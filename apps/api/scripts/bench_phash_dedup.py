"""One-off: prove banded dedup finds the same duplicate as a full scan, faster."""

import os
import secrets
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from apps.accounts.models import ResidenceProof
from apps.accounts.services import is_similar_phash
from apps.phash_index import SCOPE_RESIDENCE_PROOF, index_phash_bands, phash_candidate_ids
from django.contrib.auth import get_user_model

N = 20000
MARKER = "bench-phash"

User = get_user_model()
user = User.objects.filter(email="bench-resident@example.com").first()

try:
    hashes = [secrets.token_hex(8) for _ in range(N)]
    target = secrets.token_hex(8)
    proofs = ResidenceProof.objects.bulk_create(
        ResidenceProof(
            user=user,
            side=ResidenceProof.Side.SINGLE,
            original_filename=f"{MARKER}-{i}",
            mime_type="image/jpeg",
            file_size=1,
            sha256_hash=secrets.token_hex(32),
            phash=h,
        )
        for i, h in enumerate(hashes)
    )
    # One row is a TRUE duplicate of target (identical hash).
    twin = ResidenceProof.objects.create(
        user=user,
        side=ResidenceProof.Side.SINGLE,
        original_filename=f"{MARKER}-twin",
        mime_type="image/jpeg",
        file_size=1,
        sha256_hash=secrets.token_hex(32),
        phash=target,
    )
    # .create() fires the signal -> twin is indexed; bulk rows are not, so
    # index everything to give the banded path its worst case (full index).
    started = time.perf_counter()
    for i, proof in enumerate(proofs):
        index_phash_bands(SCOPE_RESIDENCE_PROOF, proof.pk, phash=proof.phash, blocks=[])
    print(f"indexed {len(proofs)} rows in {time.perf_counter() - started:.2f}s")

    start = time.perf_counter()
    found_old = any(is_similar_phash(target, h) for h in ResidenceProof.objects.exclude(phash="").values_list("phash", flat=True))
    old_ms = (time.perf_counter() - start) * 1000

    start = time.perf_counter()
    candidates = phash_candidate_ids(SCOPE_RESIDENCE_PROOF, phashes=[target])
    found_new = any(
        is_similar_phash(target, h)
        for h in ResidenceProof.objects.filter(pk__in=candidates).values_list("phash", flat=True)
    )
    new_ms = (time.perf_counter() - start) * 1000

    print(f"rows={N + 1}")
    print(f"full scan : found={found_old} in {old_ms:.1f} ms")
    print(f"banded    : found={found_new} in {new_ms:.1f} ms (candidates={len(candidates)})")
    assert found_old and found_new, "MISSED THE DUPLICATE"
    print("OK")
finally:
    deleted, _ = (
        ResidenceProof.objects.filter(original_filename__startswith=MARKER).delete()
    )
    print(f"cleaned up {deleted} bench rows")
