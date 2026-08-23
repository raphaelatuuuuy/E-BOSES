"""One-off: safely remove all benchmark seed data created by bench_hot_endpoints."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.contrib.auth import get_user_model

from apps.accounts.models import MediaPhashBand, ResidenceProof
from apps.concerns.models import Concern
from apps.emergencies.models import EmergencyAlert

BENCH_EMAILS = [
    "bench-resident@example.com",
    "bench-official@example.com",
    "bench-responder@example.com",
]

counts = {
    "bench_concerns": Concern.objects.filter(title__startswith="Bench").count(),
    "bench_alerts": EmergencyAlert.objects.filter(address__startswith="Bench").count(),
    "bench_users": get_user_model().objects.filter(email__in=BENCH_EMAILS).count(),
    "band_rows_for_bench": 0,
}
print("before:", counts)

deleted_concerns, _ = Concern.objects.filter(title__startswith="Bench").delete()
deleted_alerts, _ = EmergencyAlert.objects.filter(address__startswith="Bench").delete()

# Users last: cascade removes resident profile, designations, any remaining
# ownership edges. Signals strip their band-index rows as each proof dies.
users = get_user_model().objects.filter(email__in=BENCH_EMAILS)
deleted_users, _ = users.delete()

proof_ids = ResidenceProof.objects.values_list("id", flat=True)
orphan_ids = set(
    MediaPhashBand.objects.filter(scope="residence-proof")
    .exclude(object_id__in=proof_ids)
    .values_list("id", flat=True)
)
MediaPhashBand.objects.filter(id__in=orphan_ids).delete()

remaining = {
    "bench_concerns": Concern.objects.filter(title__startswith="Bench").count(),
    "bench_alerts": EmergencyAlert.objects.filter(address__startswith="Bench").count(),
    "bench_users": get_user_model().objects.filter(email__in=BENCH_EMAILS).count(),
}
print(f"deleted: concerns={deleted_concerns} alerts={deleted_alerts} users={deleted_users}")
print(f"orphan band rows removed: {len(orphan_ids)}")
print("after:", remaining)
assert not any(remaining.values()), "benchmark data still present"
print("OK - all benchmark records removed")
