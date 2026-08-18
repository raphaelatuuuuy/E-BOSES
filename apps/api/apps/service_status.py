"""Live health of every module, for the Configuration hub.

Each probe answers one question and returns quickly. Nothing here raises: a
probe that cannot decide reports "unknown" rather than taking down the page
that exists to tell you what is broken.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import tempfile
import time
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from asgiref.sync import async_to_sync
from celery import shared_task
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import AllowAny

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.capabilities import CONFIGURE_CLASSIFICATION, HasCapability

OPERATIONAL = "operational"
DEGRADED = "degraded"
DOWN = "down"
NOT_CONFIGURED = "not_configured"
UNKNOWN = "unknown"

CACHE_KEY = "service-status:v3"
CACHE_SECONDS = 60
HISTORY_DAYS = 180
SAMPLE_MINUTES = 5
STATE_STALE_MINUTES = 15
WORKER_HEARTBEAT_KEY = "service-status:worker-heartbeat"

GROUPS = (
    ("Core", ("database", "cache", "realtime", "worker")),
    ("Submissions", ("ocr", "classifier", "privacy_scan")),
    ("Communication", ("email", "sms", "push", "assistant")),
    ("Location", ("map_data", "geocoding", "weather")),
)


def _probe(name, label, description, fn):
    started = time.monotonic()
    try:
        status, detail = fn()
    except Exception as exc:
        status, detail = DOWN, f"{type(exc).__name__}"
    return {
        "key": name,
        "label": label,
        "description": description,
        "status": status,
        "message": _message(name, label, status),
        "latency_ms": round((time.monotonic() - started) * 1000),
        # Kept for logs and support, never rendered: it is the raw probe text.
        "detail": detail,
    }


def _database():
    from apps.accounts.models import ServiceHealthDay

    probe_key = f"probe-{uuid.uuid4().hex[:20]}"
    with transaction.atomic():
        row = ServiceHealthDay.objects.create(day=timezone.localdate(), module_key=probe_key)
        if not ServiceHealthDay.objects.filter(pk=row.pk).exists():
            return DOWN, "write could not be read"
        transaction.set_rollback(True)
    return OPERATIONAL, "write and read succeeded"


def _cache():
    cache.set("service-status:ping", "1", 10)
    if cache.get("service-status:ping") != "1":
        return DEGRADED, "write succeeded but read did not"
    return OPERATIONAL, "reachable"


def _realtime():
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return NOT_CONFIGURED, "no channel layer"

    async def round_trip():
        token = uuid.uuid4().hex
        channel = await layer.new_channel("health.")
        await layer.send(channel, {"type": "health.check", "token": token})
        message = await asyncio.wait_for(layer.receive(channel), timeout=2.0)
        return message.get("token") == token

    if not async_to_sync(round_trip)():
        return DOWN, "message round trip failed"
    return OPERATIONAL, "message round trip succeeded"


def _worker():
    from config.celery import app
    from celery import current_task

    if getattr(getattr(current_task, "request", None), "id", None):
        return OPERATIONAL, "health task is running in a worker"

    replies = app.control.ping(timeout=2.5) or []
    heartbeat = cache.get(WORKER_HEARTBEAT_KEY)
    fresh_heartbeat = bool(heartbeat and time.time() - float(heartbeat) <= 150)
    if replies:
        return OPERATIONAL, f"{len(replies)} worker(s) answered"
    if fresh_heartbeat:
        return OPERATIONAL, "queued heartbeat completed recently"
    return DOWN, "no worker response or recent queued heartbeat"


def _ocr():
    from apps.accounts.models import OCRServiceStatus

    row = OCRServiceStatus.objects.order_by("-updated_at").first()
    if row is None:
        return UNKNOWN, "never checked"
    if row.updated_at < timezone.now() - timedelta(minutes=15):
        return UNKNOWN, "last canary is stale"
    mapping = {
        "healthy": OPERATIONAL,
        "degraded": DEGRADED,
        "unavailable": DOWN,
        "not_configured": NOT_CONFIGURED,
    }
    detail = row.error_message or row.provider
    if row.circuit_state != "closed":
        detail = f"{detail} (circuit {row.circuit_state})"
    return mapping.get(row.status, UNKNOWN), detail


def _classifier():
    if not getattr(settings, "OLLAMA_API_KEY", ""):
        return NOT_CONFIGURED, "no OLLAMA_API_KEY"
    try:
        from ollama import Client

        client = Client(
            host=getattr(settings, "OLLAMA_HOST", "https://ollama.com"),
            headers={"Authorization": f"Bearer {settings.OLLAMA_API_KEY}"},
            timeout=min(30, getattr(settings, "OLLAMA_TIMEOUT_SECONDS", 120)),
        )
        response = client.chat(
            getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b"),
            messages=[{"role": "user", "content": "Reply with only: operational"}],
            options={"temperature": 0},
            stream=False,
        )
        content = getattr(getattr(response, "message", None), "content", "")
        if not str(content or "").strip():
            return DOWN, "model returned no content"
    except Exception as exc:
        return DOWN, exc.__class__.__name__
    return OPERATIONAL, getattr(settings, "OLLAMA_TEXT_MODEL", "configured")


def _privacy_scan():
    if not getattr(settings, "ROBOFLOW_API_KEY", ""):
        return NOT_CONFIGURED, "no ROBOFLOW_API_KEY"
    from PIL import Image, ImageDraw
    from apps.concerns.ai.privacy.sam3_client import run_segmentation

    path = ""
    try:
        image = Image.new("RGB", (160, 120), "white")
        draw = ImageDraw.Draw(image)
        draw.ellipse((45, 15, 115, 85), outline="black", width=4)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
            path = handle.name
            image.save(handle, format="PNG")
        result = run_segmentation(path, ["face"])
        if not isinstance(result, dict):
            return DOWN, "workflow returned an invalid payload"
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
    return OPERATIONAL, getattr(settings, "ROBOFLOW_WORKFLOW_ID", "configured")


def _email():
    provider = getattr(settings, "EMAIL_OTP_PROVIDER", "")
    if provider == "resend":
        if not getattr(settings, "RESEND_API_KEY", ""):
            return NOT_CONFIGURED, "resend selected but no API key"
        import httpx

        endpoint = getattr(settings, "RESEND_API_URL", "https://api.resend.com/emails")
        try:
            response = httpx.get(
                endpoint,
                params={"limit": 1},
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                timeout=10,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return DOWN, exc.__class__.__name__
        except ValueError:
            return DOWN, "invalid API response"
        delivered = cache.get("service-status:email-delivered")
        failed = cache.get("service-status:email-failed")
        if failed and (not delivered or float(failed) > float(delivered)):
            return DEGRADED, "the latest delivery event failed"
        if delivered and time.time() - float(delivered) <= 86400:
            return OPERATIONAL, "API reachable and a recent email was delivered"
        rows = payload.get("data", []) if isinstance(payload, dict) else []
        latest = rows[0] if rows and isinstance(rows[0], dict) else {}
        latest_at = parse_datetime(str(latest.get("created_at") or ""))
        recent = bool(latest_at and latest_at >= timezone.now() - timedelta(days=7))
        latest_event = str(latest.get("last_event") or "").lower()
        if recent and latest_event == "delivered":
            return OPERATIONAL, "API reachable and the latest email was delivered"
        if recent and latest_event in {"bounced", "failed", "complained"}:
            return DEGRADED, "the latest email was not delivered"
        return UNKNOWN, "API reachable but no recent delivery was confirmed"
    if provider in {"development", "disabled"}:
        return NOT_CONFIGURED, provider
    return OPERATIONAL, provider or "unset"


def _sms():
    driver = getattr(settings, "OUTBOUND_SMS_DRIVER", "disabled")
    if driver in {"disabled", ""}:
        return NOT_CONFIGURED, "no gateway configured"
    if driver == "console":
        return DEGRADED, "console driver - nothing is sent"
    if not getattr(settings, "OUTBOUND_SMS_URL", ""):
        return NOT_CONFIGURED, "no gateway URL"
    if driver != "android_sms_gateway":
        return UNKNOWN, "driver has no operational health endpoint"

    import httpx

    base = str(settings.OUTBOUND_SMS_URL).rstrip("/")
    for suffix in ("/3rdparty/v1/message", "/3rdparty/v1/messages", "/message"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    auth = None
    username = getattr(settings, "OUTBOUND_SMS_USERNAME", "")
    if username:
        auth = (username, getattr(settings, "OUTBOUND_SMS_PASSWORD", ""))
    is_cloud = "sms-gate.app" in base
    endpoint = f"{base}/3rdparty/v1/webhooks" if is_cloud else f"{base}/health/ready"
    try:
        response = httpx.get(endpoint, auth=auth, timeout=10)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        return DOWN, exc.__class__.__name__
    if is_cloud:
        hooks = payload if isinstance(payload, list) else []
        receives_sms = any(hook.get("event") == "sms:received" for hook in hooks if isinstance(hook, dict))
        has_webhook_auth = bool(
            getattr(settings, "SMS_WEBHOOK_SIGNING_KEY", "")
            or getattr(settings, "SMS_INBOUND_WEBHOOK_TOKEN", "")
        )
        if not receives_sms or not has_webhook_auth:
            return NOT_CONFIGURED, "inbound gateway webhook is not configured"
        last_ping = cache.get("sms-gateway:last-device-ping")
        if not last_ping or time.time() - float(last_ping) > 1800:
            return UNKNOWN, "cloud API is reachable but no recent device ping was received"
        return OPERATIONAL, "cloud API and device are ready"
    gateway_status = str(payload.get("status", "")).lower()
    if gateway_status == "fail":
        return DOWN, "gateway readiness failed"
    if gateway_status == "warn":
        return DEGRADED, "gateway reports a warning"
    return OPERATIONAL, "gateway and device are ready"


def _push():
    from apps.notifications.services import web_push_config_health

    if not getattr(settings, "WEB_PUSH_PRIVATE_KEY", ""):
        return NOT_CONFIGURED, "no VAPID key"
    health = web_push_config_health()
    if not health.get("configured") or health.get("key_pair_valid") is not True:
        return DOWN, "VAPID key pair is invalid"
    from apps.notifications.models import BrowserPushSubscription

    if not BrowserPushSubscription.objects.filter(is_active=True).exists():
        return UNKNOWN, "no subscribed browser can be tested"
    delivered = cache.get("service-status:push-delivered")
    if delivered and time.time() - float(delivered) <= 86400:
        return OPERATIONAL, "a recent browser push test was accepted"
    from apps.emergencies.models import WitnessNotification

    recent = timezone.now() - timedelta(hours=24)
    if WitnessNotification.objects.filter(push_delivered_at__gte=recent).exists():
        return OPERATIONAL, "a recent push was accepted by the push service"
    if WitnessNotification.objects.filter(push_attempted_at__gte=recent, push_failure_count__gt=0).exists():
        return DEGRADED, "a recent push delivery failed"
    return UNKNOWN, "keys are valid but no recent delivery was observed"


def _assistant():
    from apps.assistant.client import complete, is_configured

    if not is_configured():
        return NOT_CONFIGURED, "answers from the built-in topics only"
    complete([{"role": "user", "content": "Reply with only: operational"}])
    return OPERATIONAL, getattr(settings, "ASSISTANT_MODEL", "")


def _map_data():
    from apps.geo_services import get_active_boundary_geometry, point_in_geojson
    from apps.emergencies.models import MapGeometry, MapDispatchPolicy

    count = MapGeometry.objects.filter(is_active=True).count()
    if not count:
        return DEGRADED, "no geometry imported"
    geometry = get_active_boundary_geometry()
    if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        return DOWN, "active boundary geometry is invalid"
    policy = MapDispatchPolicy.current()
    inside = point_in_geojson(
        float(policy.acceptance_center_longitude),
        float(policy.acceptance_center_latitude),
        geometry,
    )
    if inside is not True:
        return DEGRADED, "barangay center is outside the active boundary"
    return OPERATIONAL, f"{count} valid active geometries"


CLIENT_WEATHER_KEY = "client-health:weather"
CLIENT_WEATHER_WINDOW = 900
# One browser having no internet is not an outage. Several browsers failing at
# once is, so a verdict of "down" waits for corroboration.
CLIENT_WEATHER_QUORUM = 3


def record_weather_report(ok):
    """Tally what browsers actually saw when they called the forecast service."""
    tally = cache.get(CLIENT_WEATHER_KEY) or {"ok": 0, "fail": 0}
    tally["ok" if ok else "fail"] = tally.get("ok" if ok else "fail", 0) + 1
    cache.set(CLIENT_WEATHER_KEY, tally, CLIENT_WEATHER_WINDOW)


WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_REACHABLE_KEY = "service-status:weather-reachable"
WEATHER_REACHABLE_TTL = 300


def _weather_reachable():
    """Ask the forecast service ourselves, so the row means something at 3am.

    Cached, because the status page polls every minute and this is the only
    probe that leaves the building.
    """
    cached = cache.get(WEATHER_REACHABLE_KEY)
    if cached is not None:
        return cached

    import requests

    try:
        response = requests.get(
            WEATHER_URL,
            params={"latitude": 14.65, "longitude": 121.11, "current": "temperature_2m"},
            timeout=5,
        )
        reachable = response.ok
    except Exception:
        reachable = False

    cache.set(WEATHER_REACHABLE_KEY, reachable, WEATHER_REACHABLE_TTL)
    return reachable


def _weather():
    """Two signals, because neither alone is honest.

    The browser fetches the forecast, so the server reaching Open-Meteo proves
    nothing about what officials see — their network could be the broken one.
    But waiting for a browser means an empty row until somebody opens a map.

    So: browser reports win when they show trouble, and our own check fills the
    silence the rest of the time.
    """
    tally = cache.get(CLIENT_WEATHER_KEY) or {}
    ok = tally.get("ok", 0)
    fail = tally.get("fail", 0)
    total = ok + fail

    if fail:
        if fail >= CLIENT_WEATHER_QUORUM and fail * 2 >= total:
            return DOWN, f"{fail} of {total} browser loads failed"
        return DEGRADED, f"{fail} of {total} browser loads failed"

    if not _weather_reachable():
        # Nobody has complained, but we cannot reach it either.
        return DEGRADED, "not reachable from the server"

    if total:
        return OPERATIONAL, f"{total} browser loads, all fine"
    return OPERATIONAL, "reachable"


def _geocoding():
    if not getattr(settings, "REVERSE_GEOCODE_ENABLED", False):
        return NOT_CONFIGURED, "reverse geocoding disabled"
    from apps.geo_services import REVERSE_STATUS_SUCCESS, reverse_geocode

    result = reverse_geocode(14.6507, 121.1029)
    if result.get("status") != REVERSE_STATUS_SUCCESS or not result.get("location"):
        return DOWN, "known coordinate did not resolve"
    return OPERATIONAL, result["location"]


PROBES = {
    "database": ("Saved records", "Where every report and account is kept", _database),
    "cache": ("Quick memory", "Short-term memory that keeps pages fast", _cache),
    "realtime": ("Live updates", "Makes the map and alerts refresh on their own", _realtime),
    "worker": ("Background jobs", "Work that runs after you close the page", _worker),
    "ocr": ("ID reading", "Reads a resident ID and checks the details", _ocr),
    "classifier": ("Report checking", "Screens report text before it reaches your queue", _classifier),
    "privacy_scan": ("Photo blurring", "Hides faces and plate numbers in photos", _privacy_scan),
    "email": ("Email", "Sends sign-up codes and password resets", _email),
    "sms": ("Text messages", "Reaches residents when the internet is down", _sms),
    "push": ("Phone alerts", "Rings officials on their phone", _push),
    "assistant": ("Help assistant", "Answers resident questions in the chat", _assistant),
    "map_data": ("Map areas", "The barangay boundaries used to place an emergency", _map_data),
    "geocoding": ("Street names", "Turns a map pin into a readable address", _geocoding),
    "weather": ("Weather", "Shows the forecast on the alerts map", _weather),
}

SEVERITY = {OPERATIONAL: 0, NOT_CONFIGURED: 1, UNKNOWN: 1, DEGRADED: 2, DOWN: 3}

# One short phrase, naming the consequence. No provider names, no HTTP codes,
# no key names. A healthy service says nothing at all.
MESSAGES = {
    "database": {
        DEGRADED: "Pages load late.",
        DOWN: "Nothing can be saved or opened.",
    },
    "cache": {
        DEGRADED: "Some numbers may be old.",
        DOWN: "Every page will be slow.",
        NOT_CONFIGURED: "Every page will be slow.",
    },
    "realtime": {
        DEGRADED: "The map refreshes late.",
        DOWN: "The map will not refresh on its own.",
        NOT_CONFIGURED: "The map will not refresh on its own.",
    },
    "worker": {
        DEGRADED: "ID checks and alerts run late.",
        DOWN: "ID checks and alerts are stuck.",
        NOT_CONFIGURED: "ID checks and alerts will not run.",
    },
    "ocr": {
        DEGRADED: "Sign-ups take longer.",
        DOWN: "New sign-ups cannot be verified.",
        NOT_CONFIGURED: "Every sign-up needs manual review.",
        UNKNOWN: "Not checked yet.",
    },
    "classifier": {
        DEGRADED: "Reports reach your queue late.",
        DOWN: "Reports arrive unchecked.",
        NOT_CONFIGURED: "Reports arrive unchecked.",
    },
    "privacy_scan": {
        DEGRADED: "Photos may show before blurring.",
        DOWN: "Faces and plate numbers stay visible.",
        NOT_CONFIGURED: "Faces and plate numbers stay visible.",
    },
    "email": {
        DEGRADED: "Codes arrive late.",
        DOWN: "No codes or password resets are sent.",
        NOT_CONFIGURED: "No codes or password resets are sent.",
        UNKNOWN: "Waiting for a recent delivered email.",
    },
    "sms": {
        DEGRADED: "Residents receive nothing.",
        DOWN: "No texts when the internet is down.",
        NOT_CONFIGURED: "The gateway phone is not linked to E-Boses.",
        UNKNOWN: "Waiting for the gateway phone to check in.",
    },
    "push": {
        DEGRADED: "Alerts reach phones late.",
        DOWN: "No alerts on officials' phones.",
        NOT_CONFIGURED: "No alerts on officials' phones.",
        UNKNOWN: "Waiting for a recent phone alert.",
    },
    "assistant": {
        DEGRADED: "Answers come slowly.",
        DOWN: "Built-in answers only.",
        NOT_CONFIGURED: "Built-in answers only.",
    },
    "map_data": {
        DEGRADED: "Emergencies match no zone.",
        DOWN: "Emergencies match no zone.",
        NOT_CONFIGURED: "Emergencies match no zone.",
    },
    "geocoding": {
        DEGRADED: "Pins may show numbers only.",
        DOWN: "Pins show numbers, not a street.",
        NOT_CONFIGURED: "Pins show numbers, not a street.",
    },
    "weather": {
        DEGRADED: "The forecast may not load on the map.",
        DOWN: "The forecast is missing from the alerts map.",
        NOT_CONFIGURED: "The forecast is turned off.",
        UNKNOWN: "Not checked yet.",
    },
}


def _message(key, label, status):
    # A working service needs no sentence; silence is the clearest "fine".
    if status == OPERATIONAL:
        return ""
    known = MESSAGES.get(key, {}).get(status)
    if known:
        return known
    fallback = {
        DEGRADED: "Running slowly.",
        DOWN: "Not responding.",
        NOT_CONFIGURED: "Turned off.",
        UNKNOWN: "Not checked yet.",
    }
    return fallback.get(status, "State unclear.")


STATUS_COUNTER = {
    OPERATIONAL: "operational_checks",
    DEGRADED: "degraded_checks",
    DOWN: "down_checks",
    NOT_CONFIGURED: "not_configured_checks",
    UNKNOWN: "unknown_checks",
}


def _sample_bucket(checked_at):
    minute = checked_at.minute - checked_at.minute % SAMPLE_MINUTES
    return checked_at.replace(minute=minute, second=0, microsecond=0)


def _record(results, checked_at):
    """Record one sample per service per five-minute bucket."""
    from apps.accounts.models import ServiceHealthDay

    today = timezone.localdate(checked_at)
    bucket = _sample_bucket(checked_at)
    with transaction.atomic():
        for key, module in results.items():
            row, _ = ServiceHealthDay.objects.select_for_update().get_or_create(
                day=today,
                module_key=key,
            )
            if row.last_sample_bucket == bucket:
                continue
            status_value = module["status"]
            counter = STATUS_COUNTER.get(status_value, "unknown_checks")
            setattr(row, counter, getattr(row, counter) + 1)
            row.checks_total += 1
            latency = max(0, int(module.get("latency_ms") or 0))
            row.latency_total_ms += latency
            row.latency_max_ms = max(row.latency_max_ms, latency)
            severity = SEVERITY.get(status_value, 1)
            row.severity = max(row.severity, severity)
            if severity and module.get("message"):
                texts = {item.get("text") for item in row.issues}
                if module["message"] not in texts:
                    row.issues = [*row.issues, {"severity": severity, "text": module["message"]}]
            row.last_sample_bucket = bucket
            row.save()


def _update_states(results, checked_at):
    from apps.accounts.models import ServiceHealthState, ServiceIncident

    for key, module in results.items():
        raw_status = module["status"]
        state = ServiceHealthState.objects.filter(module_key=key).first()
        failures = state.consecutive_failures if state else 0
        successes = state.consecutive_successes if state else 0
        previous = state.status if state else UNKNOWN

        if raw_status == DOWN:
            failures += 1
            successes = 0
            effective = DOWN if failures >= 2 else DEGRADED
        elif raw_status == OPERATIONAL:
            successes += 1
            failures = 0
            effective = OPERATIONAL
        else:
            failures = 0
            successes = 0
            effective = raw_status

        module["raw_status"] = raw_status
        module["status"] = effective
        if effective != raw_status:
            module["message"] = _message(key, module["label"], effective) or module["message"]

        state, _ = ServiceHealthState.objects.update_or_create(
            module_key=key,
            defaults={
                "status": effective,
                "detail": str(module.get("detail") or "")[:255],
                "message": str(module.get("message") or "")[:255],
                "latency_ms": max(0, int(module.get("latency_ms") or 0)),
                "consecutive_failures": failures,
                "consecutive_successes": successes,
                "checked_at": checked_at,
            },
        )
        open_incident = ServiceIncident.objects.filter(module_key=key, resolved_at__isnull=True).first()
        if effective == DOWN and open_incident is None:
            ServiceIncident.objects.create(
                module_key=key,
                status=effective,
                message=state.message,
                started_at=checked_at,
            )
        elif effective == OPERATIONAL and open_incident is not None:
            open_incident.resolved_at = checked_at
            open_incident.save(update_fields=["resolved_at", "updated_at"])


def _stored_results():
    from apps.accounts.models import ServiceHealthState

    states = {row.module_key: row for row in ServiceHealthState.objects.filter(module_key__in=PROBES)}
    if not states:
        return None
    cutoff = timezone.now() - timedelta(minutes=STATE_STALE_MINUTES)
    results = {}
    for key, (label, description, _fn) in PROBES.items():
        state = states.get(key)
        if state is None or state.checked_at < cutoff:
            results[key] = {
                "key": key,
                "label": label,
                "description": description,
                "status": UNKNOWN,
                "message": "The last operational check is stale.",
                "latency_ms": 0,
                "detail": "stale or missing sample",
                "checked_at": state.checked_at if state else None,
            }
            continue
        results[key] = {
            "key": key,
            "label": label,
            "description": description,
            "status": state.status,
            "message": state.message,
            "latency_ms": state.latency_ms,
            "detail": state.detail,
            "checked_at": state.checked_at,
        }
    return results


DAY_STATUS = {0: "operational", 1: "not_configured", 2: "degraded", 3: "down"}


def _history():
    """90+ days of real samples per module key. Days never sampled are absent."""
    from apps.accounts.models import ServiceHealthDay

    today = timezone.localdate()
    since = today - timedelta(days=HISTORY_DAYS - 1)
    rows = ServiceHealthDay.objects.filter(day__gte=since).order_by("day")

    by_key = {}
    for row in rows:
        by_key.setdefault(row.module_key, {})[row.day.isoformat()] = {
            "severity": row.severity,
            "issues": row.issues,
            "checks_total": row.checks_total,
            "operational_checks": row.operational_checks,
            "degraded_checks": row.degraded_checks,
            "down_checks": row.down_checks,
            "not_configured_checks": row.not_configured_checks,
            "unknown_checks": row.unknown_checks,
            "latency_total_ms": row.latency_total_ms,
            "latency_max_ms": row.latency_max_ms,
        }
    return by_key


def _day_payload(day, samples):
    checks_total = sum(sample.get("checks_total", 0) for sample in samples)
    operational_checks = sum(sample.get("operational_checks", 0) for sample in samples)
    degraded_checks = sum(sample.get("degraded_checks", 0) for sample in samples)
    down_checks = sum(sample.get("down_checks", 0) for sample in samples)
    not_configured_checks = sum(sample.get("not_configured_checks", 0) for sample in samples)
    unknown_checks = sum(sample.get("unknown_checks", 0) for sample in samples)
    measured = operational_checks + degraded_checks + down_checks
    up = operational_checks + degraded_checks
    if checks_total == 0:
        status_value = "no_data"
    elif measured == 0:
        status_value = "not_configured" if not_configured_checks else "no_data"
    elif down_checks:
        status_value = "down" if down_checks * 2 >= measured else "degraded"
    elif degraded_checks:
        status_value = "degraded"
    else:
        status_value = "operational"
    return {
        "date": day.isoformat(),
        "status": status_value,
        "issues": [issue for sample in samples for issue in sample.get("issues", [])],
        "checks_total": checks_total,
        "measured_checks": measured,
        "up_checks": up,
        "degraded_checks": degraded_checks,
        "down_checks": down_checks,
        "unknown_checks": unknown_checks,
        "availability_percent": round(up / measured * 100, 2) if measured else None,
    }


def _group_history(keys, by_key):
    today = timezone.localdate()
    days = []
    for offset in range(HISTORY_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        iso = day.isoformat()
        samples = [by_key[key][iso] for key in keys if iso in by_key.get(key, {})]
        if not samples:
            days.append(_day_payload(day, []))
            continue
        days.append(_day_payload(day, samples))
    return days


def _availability(days):
    measured = sum(day["measured_checks"] for day in days)
    up = sum(day["up_checks"] for day in days)
    degraded = sum(day["degraded_checks"] for day in days)
    down = sum(day["down_checks"] for day in days)
    return {
        "percent": round(up / measured * 100, 2) if measured else None,
        "measured_checks": measured,
        "up_checks": up,
        "degraded_checks": degraded,
        "down_checks": down,
        "sample_minutes": SAMPLE_MINUTES,
    }


def collect(use_cache=True, run_checks=False, record=False):
    if use_cache:
        cached = cache.get(CACHE_KEY)
        if cached:
            return cached

    results = None if run_checks else _stored_results()
    checked_at = timezone.now()
    if results is None:
        results = {key: _probe(key, *PROBES[key]) for key in PROBES}
        if record:
            _record(results, checked_at)
        _update_states(results, checked_at)

    try:
        by_key = _history()
    except Exception:
        by_key = {}

    groups = []
    for title, keys in GROUPS:
        modules = []
        for key in keys:
            if key not in results:
                continue
            module = results[key]
            # Uptime is worked out from these days by whoever displays them, so
            # the number always matches the range on screen.
            module["history"] = _group_history((key,), by_key)
            module["availability"] = _availability(module["history"])
            modules.append(module)
        worst = max((SEVERITY.get(m["status"], 1) for m in modules), default=0)
        groups.append(
            {
                "title": title,
                "modules": modules,
                "worst": worst,
                "history": _group_history(keys, by_key),
            }
        )
        groups[-1]["availability"] = _availability(groups[-1]["history"])

    everything = list(results.values())
    worst_overall = max((SEVERITY.get(m["status"], 1) for m in everything), default=0)
    down = [m["label"] for m in everything if m["status"] == DOWN]
    degraded = [m["label"] for m in everything if m["status"] == DEGRADED]
    unset = [m["label"] for m in everything if m["status"] == NOT_CONFIGURED]
    unknown = [m["label"] for m in everything if m["status"] == UNKNOWN]

    if down or degraded:
        headline = "Some services need attention"
    elif unknown:
        headline = "Some services could not be verified"
    elif unset:
        headline = "Some services need setup"
    else:
        headline = "All services are operational"

    payload = {
        "headline": headline,
        "worst": worst_overall,
        "checked_at": max(
            (m.get("checked_at") or checked_at for m in everything),
            default=checked_at,
        ).timestamp(),
        "history_days": HISTORY_DAYS,
        "groups": groups,
        "counts": {
            "total": len(everything),
            "operational": sum(1 for m in everything if m["status"] == OPERATIONAL),
            "degraded": len(degraded),
            "down": len(down),
            "unknown": len(unknown),
            "not_configured": sum(1 for m in everything if m["status"] == NOT_CONFIGURED),
        },
    }
    cache.set(CACHE_KEY, payload, CACHE_SECONDS)
    return payload


@shared_task(name="apps.service_status.record_service_health_task", ignore_result=True)
def record_service_health_task():
    """Probe on a schedule so history exists without anyone opening the page.

    The request path still records too, and deliberately so: this task cannot
    report that the worker is down, because a dead worker never runs it. The
    two together cover each other — the worker records the rest of the system,
    the page records the worker.
    """
    collect(use_cache=False, run_checks=True, record=True)


@shared_task(name="apps.service_status.record_worker_heartbeat_task", ignore_result=True)
def record_worker_heartbeat_task():
    cache.set(WORKER_HEARTBEAT_KEY, time.time(), 300)


class WeatherHealthReportView(APIView):
    """Where the maps say whether the forecast loaded for them.

    Open to anonymous callers because the sign-up preview shows weather before
    anyone has an account. That makes it spoofable, so a single report can never
    declare an outage: `_weather` needs several failures before it says down,
    and the throttle caps how fast one caller can pile them up.
    """

    permission_classes = [AllowAny]
    throttle_scope = "weather_health"

    def post(self, request):
        ok = request.data.get("ok")
        if not isinstance(ok, bool):
            return Response({"detail": "ok must be true or false."}, status=400)
        record_weather_report(ok)
        return Response(status=204)


def _resend_webhook_key():
    secret = str(getattr(settings, "RESEND_WEBHOOK_SECRET", "") or "").strip()
    if secret.startswith("whsec_"):
        secret = secret[6:]
    if not secret:
        return None
    try:
        return base64.b64decode(secret, validate=True)
    except (TypeError, ValueError):
        return secret.encode()


def _valid_resend_webhook(request):
    event_id = request.headers.get("svix-id", "")
    timestamp = request.headers.get("svix-timestamp", "")
    signature = request.headers.get("svix-signature", "")
    key = _resend_webhook_key()
    try:
        sent_at = int(timestamp)
    except ValueError:
        return False
    if not key or not event_id or abs(int(time.time()) - sent_at) > 300:
        return False
    signed = f"{event_id}.{timestamp}.".encode() + request.body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    candidates = [item.removeprefix("v1,") for item in signature.split()]
    return any(hmac.compare_digest(expected, item) for item in candidates)


class ResendHealthWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def post(self, request):
        if not _valid_resend_webhook(request):
            return Response({"detail": "Invalid webhook signature."}, status=401)
        try:
            event = json.loads(request.body).get("type", "")
        except (TypeError, ValueError, json.JSONDecodeError):
            return Response({"detail": "Invalid webhook payload."}, status=400)
        if event == "email.delivered":
            cache.set("service-status:email-delivered", time.time(), 172800)
        elif event in {"email.failed", "email.bounced", "email.delivery_delayed"}:
            cache.set("service-status:email-failed", time.time(), 172800)
        return Response(status=204)


class ServiceStatusView(APIView):
    permission_classes = [IsAuthenticated, HasCapability]
    required_capability = CONFIGURE_CLASSIFICATION

    def get(self, request):
        fresh = request.query_params.get("refresh") == "1"
        return Response(collect(use_cache=not fresh, run_checks=fresh, record=fresh))
