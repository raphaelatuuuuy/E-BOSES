"""Live health of every module, for the Configuration hub.

Each probe answers one question and returns quickly. Nothing here raises: a
probe that cannot decide reports "unknown" rather than taking down the page
that exists to tell you what is broken.
"""

import time
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.utils import timezone
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

CACHE_KEY = "service-status:v2"
CACHE_SECONDS = 20
HISTORY_DAYS = 180

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
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    return OPERATIONAL, connection.vendor


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
    return OPERATIONAL, type(layer).__name__


def _worker():
    from config.celery import app

    replies = app.control.ping(timeout=1.0) or []
    if not replies:
        return DOWN, "no worker responded"
    return OPERATIONAL, f"{len(replies)} worker(s)"


def _ocr():
    from apps.accounts.models import OCRServiceStatus

    row = OCRServiceStatus.objects.order_by("-updated_at").first()
    if row is None:
        return UNKNOWN, "never checked"
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
    from apps.concerns.models import ConcernClassificationConfiguration

    config = ConcernClassificationConfiguration.current()
    if not getattr(settings, "OLLAMA_API_KEY", ""):
        return NOT_CONFIGURED, "no OLLAMA_API_KEY"
    return OPERATIONAL, f"{config.nlp_provider}/{config.nlp_model}"


def _privacy_scan():
    if not getattr(settings, "ROBOFLOW_API_KEY", ""):
        return NOT_CONFIGURED, "no ROBOFLOW_API_KEY"
    return OPERATIONAL, getattr(settings, "ROBOFLOW_WORKFLOW_ID", "") or "configured"


def _email():
    provider = getattr(settings, "EMAIL_OTP_PROVIDER", "")
    if provider == "resend":
        if not getattr(settings, "RESEND_API_KEY", ""):
            return NOT_CONFIGURED, "resend selected but no API key"
        return OPERATIONAL, "resend"
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
    return OPERATIONAL, driver


def _push():
    if not getattr(settings, "WEB_PUSH_PRIVATE_KEY", ""):
        return NOT_CONFIGURED, "no VAPID key"
    return OPERATIONAL, "web push"


def _assistant():
    from apps.assistant.client import is_configured

    if not is_configured():
        return NOT_CONFIGURED, "answers from the built-in topics only"
    return OPERATIONAL, getattr(settings, "ASSISTANT_MODEL", "")


def _map_data():
    from apps.emergencies.models import MapGeometry

    count = MapGeometry.objects.filter(is_active=True).count()
    if not count:
        return DEGRADED, "no geometry imported"
    return OPERATIONAL, f"{count} active geometries"


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
    return OPERATIONAL, "Nominatim"


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
    },
    "sms": {
        DEGRADED: "Residents receive nothing.",
        DOWN: "No texts when the internet is down.",
        NOT_CONFIGURED: "No texts when the internet is down.",
    },
    "push": {
        DEGRADED: "Alerts reach phones late.",
        DOWN: "No alerts on officials' phones.",
        NOT_CONFIGURED: "No alerts on officials' phones.",
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


def _record(results):
    """Save today's worst state per module so the timeline has real history."""
    from apps.accounts.models import ServiceHealthDay

    today = timezone.localdate()
    existing = {
        row.module_key: row
        for row in ServiceHealthDay.objects.filter(day=today, module_key__in=results)
    }
    for key, module in results.items():
        severity = SEVERITY.get(module["status"], 1)
        row = existing.get(key)
        if row is None:
            issues = [] if severity == 0 else [{"severity": severity, "text": module["message"]}]
            ServiceHealthDay.objects.get_or_create(
                day=today,
                module_key=key,
                defaults={"severity": severity, "issues": issues},
            )
            continue
        if severity == 0:
            continue
        texts = {item.get("text") for item in row.issues}
        changed = False
        if module["message"] not in texts:
            row.issues = [*row.issues, {"severity": severity, "text": module["message"]}]
            changed = True
        if severity > row.severity:
            row.severity = severity
            changed = True
        if changed:
            row.save(update_fields=["severity", "issues", "updated_at"])


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
        }
    return by_key


def _group_history(keys, by_key):
    today = timezone.localdate()
    days = []
    for offset in range(HISTORY_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        iso = day.isoformat()
        samples = [by_key[key][iso] for key in keys if iso in by_key.get(key, {})]
        if not samples:
            days.append({"date": iso, "status": "no_data", "issues": []})
            continue
        severity = max(sample["severity"] for sample in samples)
        issues = [issue for sample in samples for issue in sample["issues"]]
        days.append(
            {
                "date": iso,
                "status": DAY_STATUS.get(severity, "operational"),
                "issues": issues,
            }
        )
    return days


def collect(use_cache=True):
    if use_cache:
        cached = cache.get(CACHE_KEY)
        if cached:
            return cached

    results = {key: _probe(key, *PROBES[key]) for key in PROBES}
    try:
        _record(results)
    except Exception:
        # History is a nice-to-have; a write failure must not hide live status.
        pass

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

    everything = list(results.values())
    worst_overall = max((SEVERITY.get(m["status"], 1) for m in everything), default=0)
    down = [m["label"] for m in everything if m["status"] == DOWN]
    degraded = [m["label"] for m in everything if m["status"] == DEGRADED]
    unset = [m["label"] for m in everything if m["status"] == NOT_CONFIGURED]

    if down:
        headline = f"{len(down)} {'service is' if len(down) == 1 else 'services are'} not working"
    elif degraded:
        headline = f"{len(degraded)} {'service is' if len(degraded) == 1 else 'services are'} slow"
    elif unset:
        headline = "Everything is working"
    else:
        headline = "Everything is working"

    payload = {
        "headline": headline,
        "worst": worst_overall,
        "checked_at": time.time(),
        "history_days": HISTORY_DAYS,
        "groups": groups,
        "counts": {
            "total": len(everything),
            "operational": sum(1 for m in everything if m["status"] == OPERATIONAL),
            "degraded": len(degraded),
            "down": len(down),
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
    collect(use_cache=False)


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


class ServiceStatusView(APIView):
    permission_classes = [IsAuthenticated, HasCapability]
    required_capability = CONFIGURE_CLASSIFICATION

    def get(self, request):
        fresh = request.query_params.get("refresh") == "1"
        return Response(collect(use_cache=not fresh))
