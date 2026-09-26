"""One-off benchmark: query counts + timings for the hot list endpoints.

Run:  python scripts/bench_hot_endpoints.py --setup --inprocess
      python scripts/bench_hot_endpoints.py --http
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

import django

django.setup()

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.accounts.models import ResidentProfile
from apps.concerns.models import Concern
from apps.emergencies.models import EmergencyAlert

EMAIL_RESIDENT = "bench-resident@example.com"
EMAIL_OFFICIAL = "bench-official@example.com"
EMAIL_RESPONDER = "bench-responder@example.com"
PASSWORD = "Str0ng!Bench123"
BARANGAY = "Marikina Heights"

CATEGORIES = [c for c in Concern.Category.values]
STATUSES = [Concern.Status.SUBMITTED, Concern.Status.IN_PROGRESS, Concern.Status.RESOLVED]
TYPES = [t for t in EmergencyAlert.Type.values]


def setup():
    User = get_user_model()
    resident, _ = User.objects.get_or_create(
        email=EMAIL_RESIDENT,
        defaults={
            "phone_number": "+639390000001",
            "role": User.Role.RESIDENT,
            "status": User.Status.VERIFIED,
        },
    )
    resident.set_password(PASSWORD)
    resident.save(update_fields=["password"])
    ResidentProfile.objects.get_or_create(
        user=resident,
        defaults={
            "first_name": "Bench",
            "last_name": "Resident",
            "date_of_birth": "1990-01-01",
            "address": "Bench Street",
            "barangay": BARANGAY,
            "community_id": 1,
        },
    )

    official, _ = User.objects.get_or_create(
        email=EMAIL_OFFICIAL,
        defaults={
            "phone_number": "+639390000002",
            "role": User.Role.BARANGAY_OFFICIAL,
            "status": User.Status.VERIFIED,
        },
    )
    official.set_password(PASSWORD)
    official.save(update_fields=["password"])
    ResidentProfile.objects.get_or_create(
        user=official,
        defaults={
            "first_name": "Bench",
            "last_name": "Official",
            "date_of_birth": "1980-01-01",
            "address": "Bench Street",
            "barangay": BARANGAY,
        },
    )
    from apps.concerns.models import Department, Designation, Position

    if not Designation.objects.filter(
        user=official,
        department__code="sangguniang-barangay",
        position__code="barangay-captain",
    ).exists():
        Designation.objects.create(
            user=official,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )

    responder, _ = User.objects.get_or_create(
        email=EMAIL_RESPONDER,
        defaults={
            "phone_number": "+639390000003",
            "role": User.Role.FIRST_RESPONDER,
            "status": User.Status.VERIFIED,
            "responder_unit": User.ResponderUnit.BHW,
            "is_on_duty": True,
        },
    )
    responder.set_password(PASSWORD)
    responder.save(update_fields=["password"])
    ResidentProfile.objects.get_or_create(
        user=responder,
        defaults={
            "first_name": "Bench",
            "last_name": "Responder",
            "date_of_birth": "1985-01-01",
            "address": "Bench Street",
            "barangay": BARANGAY,
        },
    )

    if not Concern.objects.filter(title__startswith="Bench").exists():
        Concern.objects.bulk_create(
            Concern(
                reporter=resident,
                title=f"Bench concern {i:04d}",
                description="Benchmark filler report for load measurement.",
                category=CATEGORIES[i % len(CATEGORIES)],
                status=STATUSES[i % len(STATUSES)],
                validation_status=Concern.ValidationStatus.ACCEPTED,
                visibility=Concern.Visibility.COMMUNITY,
                address=f"Bench Street {i}",
            )
            for i in range(250)
        )
    if not EmergencyAlert.objects.filter(address__startswith="Bench").exists():
        EmergencyAlert.objects.bulk_create(
            EmergencyAlert(
                reporter=resident,
                type=TYPES[i % len(TYPES)],
                latitude="14.6510000",
                longitude="121.1150000",
                address=f"Bench alert {i:04d}",
                status=(
                    EmergencyAlert.Status.SUBMITTED
                    if i % 3 == 0
                    else (EmergencyAlert.Status.RESOLVED if i % 3 == 1 else EmergencyAlert.Status.CANCELLED)
                ),
            )
            for i in range(120)
        )
    print("setup done: 250 concerns, 120 alerts, 3 users")


def _client(user):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user)
    return client


HOST_HEADER = {"HTTP_HOST": "127.0.0.1"}


def _measure(client, path, label, results):
    with CaptureQueriesContext(connection) as ctx:
        start = time.perf_counter()
        response = client.get(path, **HOST_HEADER)
        elapsed = (time.perf_counter() - start) * 1000
    body = response.content
    results.append(
        {
            "endpoint": label,
            "status": response.status_code,
            "queries": len(ctx.captured_queries),
            "ms_in_view": round(elapsed, 1),
            "payload_kb": round(len(body) / 1024, 1),
        }
    )


def inprocess():
    User = get_user_model()
    resident = User.objects.get(email=EMAIL_RESIDENT)
    official = User.objects.get(email=EMAIL_OFFICIAL)

    results = []
    resident_client = _client(resident)
    official_client = _client(official)

    _measure(resident_client, "/api/concerns/mine/", "GET /concerns/mine/", results)
    _measure(official_client, "/api/concerns/manage/", "GET /concerns/manage/", results)
    _measure(official_client, "/api/emergencies/queue/", "GET /emergencies/queue/", results)
    _measure(resident_client, "/api/emergencies/mine/", "GET /emergencies/mine/", results)
    _measure(resident_client, "/api/announcements/", "GET /announcements/", results)
    _measure(resident_client, "/api/responders/active/", "GET /responders/active/", results)

    alerts = list(EmergencyAlert.objects.order_by("-created_at", "-id")[:50])
    with CaptureQueriesContext(connection) as ctx:
        for alert in alerts:
            (
                EmergencyAlert.objects.select_related(
                    "reporter", "reporter__resident_profile"
                )
                .prefetch_related(
                    "media",
                    "status_events__actor",
                    "status_events__actor__resident_profile",
                    "appeals__appellant",
                    "appeals__appellant__resident_profile",
                    "appeals__reviewed_by",
                    "appeals__reviewed_by__resident_profile",
                    "escalations__escalated_to",
                    "escalations__escalated_to__resident_profile",
                    "escalations__triggered_by",
                    "escalations__triggered_by__resident_profile",
                    "assignments__responder",
                    "assignments__responder__resident_profile",
                    "assignments__location_pings",
                )
                .get(pk=alert.pk)
            )
    results.append(
        {
            "endpoint": "OLD serialize_alert x50 (emulated)",
            "status": 200,
            "queries": len(ctx.captured_queries),
            "ms_in_view": None,
            "payload_kb": None,
        }
    )

    print(json.dumps(results, indent=2))


def http_bench():
    import requests

    base = os.environ.get("BENCH_BASE_URL", "http://127.0.0.1:8010/api")
    session = requests.Session()

    def timed(method, path, token=None, label=None, **kwargs):
        headers = kwargs.pop("headers", {})
        if token:
            headers["Authorization"] = f"Bearer {token}"
        samples = []
        body = None
        for _ in range(12):
            start = time.perf_counter()
            response = session.request(method, f"{base}{path}", headers=headers, timeout=30, **kwargs)
            elapsed = (time.perf_counter() - start) * 1000
            samples.append(elapsed)
            body = response.content
        samples.sort()
        return {
            "endpoint": label or f"{method} {path}",
            "status": response.status_code,
            "min_ms": round(samples[0], 1),
            "median_ms": round(statistics.median(samples), 1),
            "p95_ms": round(samples[int(len(samples) * 0.95) - 1], 1),
            "payload_kb": round(len(body or b"") / 1024, 1),
        }

    login = session.post(
        f"{base}/auth/login/",
        json={"identifier": EMAIL_RESIDENT, "password": PASSWORD},
        timeout=15,
    )
    resident_token = login.json().get("access") or login.json().get("access_token")
    login_o = session.post(
        f"{base}/auth/login/",
        json={"identifier": EMAIL_OFFICIAL, "password": PASSWORD},
        timeout=15,
    )
    official_token = login_o.json().get("access") or login_o.json().get("access_token")
    if not resident_token or not official_token:
        print("login failed:", login.status_code, login.text[:200])
        sys.exit(1)

    results = [
        timed("POST", "/auth/login/", label="POST /auth/login/",
              json={"identifier": EMAIL_RESIDENT, "password": PASSWORD}),
        timed("GET", "/concerns/mine/", resident_token),
        timed("GET", "/emergencies/mine/", resident_token),
        timed("GET", "/announcements/", resident_token),
        timed("GET", "/responders/active/", resident_token),
        timed("GET", "/concerns/manage/", official_token),
        timed("GET", "/emergencies/queue/", official_token),
    ]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup", action="store_true")
    parser.add_argument("--inprocess", action="store_true")
    parser.add_argument("--http", action="store_true")
    args = parser.parse_args()
    if args.setup:
        setup()
    if args.inprocess:
        inprocess()
    if args.http:
        http_bench()
