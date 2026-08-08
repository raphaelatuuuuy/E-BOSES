"""Swap the OCR service status tracking row from PaddleOCR to OCR.space."""

from django.db import migrations


def swap_provider(apps, schema_editor):
    ServiceStatus = apps.get_model("accounts", "OCRServiceStatus")
    paddle_row = ServiceStatus.objects.filter(provider="paddleocr").first()
    if paddle_row is not None:
        ocrspace_row = ServiceStatus.objects.filter(provider="ocrspace").first()
        if ocrspace_row is not None:
            ocrspace_row.status = paddle_row.status
            ocrspace_row.circuit_state = paddle_row.circuit_state
            ocrspace_row.consecutive_failures = paddle_row.consecutive_failures
            ocrspace_row.latency_ms = paddle_row.latency_ms
            ocrspace_row.details = paddle_row.details
            ocrspace_row.last_checked_at = paddle_row.last_checked_at
            ocrspace_row.last_success_at = paddle_row.last_success_at
            ocrspace_row.last_failure_at = paddle_row.last_failure_at
            ocrspace_row.next_retry_at = paddle_row.next_retry_at
            ocrspace_row.save()
            paddle_row.delete()
        else:
            paddle_row.provider = "ocrspace"
            paddle_row.save(update_fields=["provider"])
    else:
        ServiceStatus.objects.get_or_create(provider="ocrspace")


def reverse_provider(apps, schema_editor):
    ServiceStatus = apps.get_model("accounts", "OCRServiceStatus")
    ocrspace_row = ServiceStatus.objects.filter(provider="ocrspace").first()
    if ocrspace_row is not None:
        ocrspace_row.provider = "paddleocr"
        ocrspace_row.save(update_fields=["provider"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0032_ocr_ensure_address_and_dob"),
    ]

    operations = [
        migrations.RunPython(swap_provider, reverse_provider),
    ]
