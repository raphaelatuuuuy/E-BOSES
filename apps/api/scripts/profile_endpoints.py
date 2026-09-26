"""Endpoint profiler: HTTP time, SQL count/time, rows, bytes per endpoint.

Baseline tool for the smoothness program. Local dev DB only, read-only
except one transient precheck job (revoked immediately) and the project's
own bench seed data. No paid providers touched: media/check runs with
forensics_only=1 (skips Gemma), street-view measured cold+warm once.

Run:  python scripts/profile_endpoints.py --setup   (once, bench seed)
      python scripts/profile_endpoints.py --run --out artifacts/loadtests/profile_before.json
"""
import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.db import connection  # noqa: E402
from django.test.utils import CaptureQueriesContext  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

from scripts.bench_hot_endpoints import (  # noqa: E402
    EMAIL_OFFICIAL,
    EMAIL_RESIDENT,
    PASSWORD,
    setup as bench_setup,
)

ARTIFACT = Path(__file__).resolve().parents[2] / "artifacts" / "loadtests"


def _tiny_jpeg():
    from io import BytesIO

    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image

    img = Image.new("RGB", (640, 480), (120, 130, 140))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return SimpleUploadedFile("probe.jpg", buf.getvalue(), content_type="image/jpeg")


def _client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def _sql_ms(ctx):
    total = 0.0
    for q in ctx.captured_queries:
        try:
            total += float(q.get("time", 0) or 0) * 1000.0
        except (TypeError, ValueError):
            continue
    return round(total, 1)


def _slowest(ctx, n=3):
    rows = []
    for q in ctx.captured_queries:
        try:
            ms = float(q.get("time", 0) or 0) * 1000.0
        except (TypeError, ValueError):
            continue
        rows.append((round(ms, 1), q.get("sql", "")[:160]))
    rows.sort(reverse=True)
    return rows[:n]


def _measure(client, method, path, label, results, reps=7, **kwargs):
    samples, queries, sql_mss, body, status = [], 0, 0.0, b"", 0
    for _ in range(reps):
        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            if method == "GET":
                response = client.get(path, HTTP_HOST="127.0.0.1", **kwargs)
            else:
                response = client.post(path, HTTP_HOST="127.0.0.1", **kwargs)
            elapsed = (time.perf_counter() - start) * 1000
        samples.append(elapsed)
        queries, sql_mss, body, status = (
            len(ctx.captured_queries),
            _sql_ms(ctx),
            response.content,
            response.status_code,
        )
    samples.sort()
    try:
        payload = json.loads(body)
    except Exception:  # noqa: BLE001
        payload = None
    if isinstance(payload, dict):
        records = payload.get("count", len(payload.get("results", [])) or None)
    elif isinstance(payload, list):
        records = len(payload)
    else:
        records = None
    results.append(
        {
            "endpoint": label,
            "status": status,
            "min_ms": round(samples[0], 1),
            "median_ms": round(statistics.median(samples), 1),
            "max_ms": round(samples[-1], 1),
            "queries": queries,
            "sql_ms": sql_mss,
            "records": records,
            "payload_kb": round(len(body) / 1024, 1),
        }
    )
    print(f"{label}: status={status} median={statistics.median(samples):.0f}ms q={queries} sql={sql_mss}ms bytes={len(body)}", flush=True)


def run(out):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    resident = User.objects.get(email=EMAIL_RESIDENT)
    official = User.objects.get(email=EMAIL_OFFICIAL)
    rc, oc = _client(resident), _client(official)
    ids = ",".join(str(pk) for pk in list(User.objects.values_list("pk", flat=True)[:100]))

    results = []
    _measure(rc, "GET", "/api/notifications/presence/?ids=2", "presence 1 id", results)
    _measure(rc, "GET", f"/api/notifications/presence/?ids={ids}", f"presence {len(ids.split(','))} ids", results)
    _measure(rc, "GET", "/api/announcements/?page_size=5", "announcements size=5", results)
    _measure(rc, "GET", "/api/announcements/?page_size=50", "announcements size=50", results)
    _measure(rc, "GET", "/api/concerns/feed/?scope=all&limit=5", "feed limit=5", results)
    _measure(rc, "GET", "/api/concerns/feed/?scope=all&limit=20", "feed limit=20", results)
    _measure(rc, "GET", "/api/concerns/feed/?scope=all&limit=50", "feed limit=50", results)
    _measure(rc, "GET", "/api/concerns/feed/?scope=all", "feed default", results)
    _measure(rc, "GET", "/api/concerns/mine/?page_size=5", "concerns/mine size=5", results)
    _measure(rc, "GET", "/api/concerns/mine/?page_size=50", "concerns/mine size=50", results)
    _measure(rc, "GET", "/api/emergencies/mine/?page_size=5", "emergencies/mine size=5", results)
    _measure(rc, "GET", "/api/emergencies/mine/?page_size=50", "emergencies/mine size=50", results)
    _measure(rc, "GET", "/api/dashboard/resident/summary/?period=week", "dashboard resident", results)
    _measure(oc, "GET", "/api/dashboard/official/summary/", "dashboard official", results)
    _measure(rc, "GET", "/api/locations/map-context/", "map-context", results)
    _measure(rc, "POST", "/api/notifications/realtime-ticket/", "realtime-ticket", results)
    _measure(
        rc,
        "POST",
        "/api/concerns/classification/precheck/",
        "precheck (202 only)",
        results,
        data={"title": "Profiler probe", "description": "Synthetic baseline probe.", "category": "infrastructure", "address": "Bench Street 1, Marikina Heights", "latitude": "14.65005", "longitude": "121.11950", "media": _tiny_jpeg()},
    )
    lat, lng = "14.65005", "121.11950"
    from django.core.cache import cache as _cache

    _cache.delete(f"public:street-view-image:v5:{float(lat):.4f}:{float(lng):.4f}")
    _cache.delete(f"public:street-view-coverage:v2:{float(lat):.4f}:{float(lng):.4f}")
    _measure(rc, "GET", f"/api/public/street-view/image/?latitude={lat}&longitude={lng}", "street-view cold", results, reps=1)
    _measure(rc, "GET", f"/api/public/street-view/image/?latitude={lat}&longitude={lng}", "street-view warm", results)
    _measure(rc, "GET", f"/api/public/street-view/coverage/?latitude={lat}&longitude={lng}", "coverage cold", results, reps=1)
    _measure(rc, "GET", f"/api/public/street-view/coverage/?latitude={lat}&longitude={lng}", "coverage warm", results)

    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, indent=2))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--out", default="artifacts/loadtests/profile_before.json")
    args = parser.parse_args()
    if args.setup:
        bench_setup()
    if args.run:
        run(args.out)
