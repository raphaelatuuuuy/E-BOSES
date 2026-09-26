import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers as drf_serializers

DEEP_CACHE_KEY = "health:deep"
DEEP_CACHE_SECONDS = 30
DEEP_PROBE_TIMEOUT_SECONDS = 2.5


@extend_schema(
    summary="System health",
    description=(
        "Liveness of the API core. Add `?deep=1` to also probe outbound "
        "dependencies (cache, Redis, email, AI, SMS gateway) with a 2.5s "
        "timeout per probe; deep results are cached for 30 seconds."
    ),
    auth=[],
    request=None,
    responses={
        200: inline_serializer(
            name="HealthReport",
            fields={
                "status": drf_serializers.CharField(help_text="ok | degraded"),
                "database": drf_serializers.CharField(),
                "dependencies": drf_serializers.DictField(
                    required=False,
                    help_text="Deep mode only: cache, redis, email, ai, sms_gateway -> ok | error | unknown | not_configured",
                ),
            },
        ),
        503: OpenApiResponse(description="Degraded: at least one probe failed."),
    },
    tags=["system"],
)
@extend_schema(summary="Liveness probe", auth=[], request=None, tags=["system"])
def health_live(request):
    """Render liveness endpoint: Django is alive. No external calls.

    Render restarts the service on non-2xx, so this must never touch the
    database, Redis or providers — a transient blip must not look like a
    dead process (a restart during a blip just adds a cold-start herd).
    """
    return JsonResponse({"status": "ok"})


@extend_schema(summary="Readiness probe", auth=[], request=None, tags=["system"])
def health_ready(request):
    """Minimal readiness: one DB probe with a single retry.

    Reports state in the body instead of flapping 503s: a lone failed probe
    is retried once before calling the service unready.
    """
    database = "ok"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        try:
            from django.db import close_old_connections

            close_old_connections()
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception:
            database = "error"
    payload = {"status": "ok" if database == "ok" else "degraded", "database": database}
    return JsonResponse(payload, status=200 if database == "ok" else 503)


def health_check(request):
    database = "ok"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        database = "error"

    ocr_status = "unknown"
    try:
        from apps.accounts.models import OCRServiceStatus

        ocr_status = (
            OCRServiceStatus.objects.filter(provider="ocrspace")
            .values_list("status", flat=True)
            .first()
            or ("not_configured" if not getattr(settings, "OCRSPACE_API_KEY", "") else "unknown")
        )
    except Exception:
        # Health must remain useful during first boot/migrations.  A missing
        # OCR table is reported as unknown rather than taking down the API.
        ocr_status = "unknown"

    payload = {
        "status": None,
        "database": database,
        "redis_configured": bool(getattr(settings, "REDIS_URL", "")),
        "browser_push_configured": bool(
            getattr(settings, "WEB_PUSH_PUBLIC_KEY", "")
            and getattr(settings, "WEB_PUSH_PRIVATE_KEY", "")
        ),
        "ai_configured": bool(
            getattr(settings, "OLLAMA_API_KEY", "")
            and getattr(settings, "ROBOFLOW_API_KEY", "")
        ),
        "ocr": ocr_status,
        "ocr_configured": bool(getattr(settings, "OCRSPACE_API_KEY", "")),
    }

    if request.GET.get("deep"):
        # ?deep=1 also probes the outbound dependencies officials depend on.
        # Results are cached briefly so monitoring polls cannot turn into a
        # self-inflicted denial of service against the providers.
        payload["dependencies"] = cache.get(DEEP_CACHE_KEY) or _probe_dependencies()
        cache.set(DEEP_CACHE_KEY, payload["dependencies"], DEEP_CACHE_SECONDS)

    dependencies = payload.get("dependencies") or {}
    status = "ok" if database == "ok" else "degraded"
    if ocr_status in {"degraded", "unavailable"} and status == "ok":
        status = "degraded"
    if any(value == "error" for value in dependencies.values()) and status == "ok":
        status = "degraded"
    payload["status"] = status
    return JsonResponse(payload, status=200 if status == "ok" else 503)


def _probe_url_ok(url: str) -> str:
    if not url:
        return "not_configured"
    try:
        response = httpx.get(url, timeout=DEEP_PROBE_TIMEOUT_SECONDS, follow_redirects=False)
    except Exception:
        return "error"
    # Anything below 500 means the service is up and answering, even when the
    # path is unauthorised (401/403) or unknown (404).
    return "ok" if response.status_code < 500 else "error"


def _probe_dependencies() -> dict:
    results = {}

    # Cache round-trip: the same Redis that backs presence, dedup and routes.
    try:
        cache.set("health:probe", "1", 10)
        results["cache"] = "ok" if cache.get("health:probe") == "1" else "error"
    except Exception:
        results["cache"] = "error"

    # Channels broker: same Redis, but verify the connection actually works.
    try:
        import redis as redis_client

        client = redis_client.Redis.from_url(settings.REDIS_URL, socket_timeout=2)
        results["redis"] = "ok" if client.ping() else "error"
    except Exception:
        results["redis"] = "error"

    results["email"] = _probe_url_ok("https://api.resend.com") if getattr(settings, "RESEND_API_KEY", "") else "not_configured"
    results["ai"] = _probe_url_ok(getattr(settings, "OLLAMA_HOST", "")) if getattr(settings, "OLLAMA_API_KEY", "") else "not_configured"

    if getattr(settings, "OUTBOUND_SMS_DRIVER", "console") == "console":
        results["sms_gateway"] = "not_configured"
    else:
        # This is deliberately read-only. For SMSGate it authenticates against
        # GET /webhooks and verifies inbound registration/device evidence;
        # merely receiving a 401/404 from the host is not a healthy gateway.
        from apps.service_status import DOWN, NOT_CONFIGURED, OPERATIONAL, _sms

        sms_status, _detail = _sms()
        results["sms_gateway"] = {
            OPERATIONAL: "ok",
            NOT_CONFIGURED: "not_configured",
            DOWN: "error",
        }.get(sms_status, "unknown")
    return results
