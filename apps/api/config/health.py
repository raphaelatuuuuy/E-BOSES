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

    ocr_status = "unknown"
    try:
        from apps.accounts.models import OCRServiceStatus

        ocr_status = (
            OCRServiceStatus.objects.filter(provider="paddleocr")
            .values_list("status", flat=True)
            .first()
            or ("not_configured" if not getattr(settings, "PADDLEOCR_TOKEN", "") else "unknown")
        )
    except Exception:
        # Health must remain useful during first boot/migrations.  A missing
        # OCR table is reported as unknown rather than taking down the API.
        ocr_status = "unknown"

    status = "ok" if database == "ok" else "degraded"
    if ocr_status in {"degraded", "unavailable"} and status == "ok":
        status = "degraded"
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
        "ocr": ocr_status,
        "ocr_configured": bool(getattr(settings, "PADDLEOCR_TOKEN", "")),
    }, status=200 if status == "ok" else 503)
