from django.conf import settings
from django.db import connection
from django.http import JsonResponse


def health_check(request):
    database = "ok"
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        database = "error"

    status = "ok" if database == "ok" else "degraded"
    return JsonResponse({
        "status": status,
        "database": database,
        "redis_configured": bool(getattr(settings, "REDIS_URL", "")),
        "browser_push_configured": bool(
            getattr(settings, "WEB_PUSH_PUBLIC_KEY", "")
            and getattr(settings, "WEB_PUSH_PRIVATE_KEY", "")
        ),
        "ai_configured": bool(
            getattr(settings, "EBOSES_YOLO_MODEL_PATH", "")
            and getattr(settings, "EBOSES_NLP_MODEL_PATH", "")
        ),
    }, status=200 if status == "ok" else 503)
