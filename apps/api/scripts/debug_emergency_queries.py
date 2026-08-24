"""Print the per-row SQL issued by GET /emergencies/mine/ to spot leftover N+1s."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.contrib.auth import get_user_model
from django.db import connection, reset_queries
from django.test.utils import CaptureQueriesContext

from rest_framework.test import APIClient

User = get_user_model()
resident = User.objects.get(email="bench-resident@example.com")

client = APIClient()
client.force_authenticate(resident)

with CaptureQueriesContext(connection) as ctx:
    response = client.get("/api/emergencies/mine/", HTTP_HOST="127.0.0.1")

print("status:", response.status_code, "queries:", len(ctx.captured_queries))
seen = {}
for entry in ctx.captured_queries:
    sql = " ".join(entry["sql"].split())
    key = sql[:110]
    seen[key] = seen.get(key, 0) + 1
for sql, count in sorted(seen.items(), key=lambda kv: -kv[1]):
    print(f"x{count:3d}  {sql}")
