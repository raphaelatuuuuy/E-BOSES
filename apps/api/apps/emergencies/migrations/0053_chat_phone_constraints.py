from django.db import migrations, models


def normalize_phone(value):
    digits = "".join(char for char in (value or "") if char.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("639"):
        local = digits[2:]
    elif digits.startswith("09"):
        local = digits[1:]
    elif digits.startswith("9"):
        local = digits
    else:
        return (value or "").strip()
    if len(local) != 10 or not local.startswith("9"):
        return (value or "").strip()
    return f"+63{local}"


def normalize_alert_phones(apps, schema_editor):
    EmergencyAlert = apps.get_model("emergencies", "EmergencyAlert")
    for alert in EmergencyAlert.objects.exclude(reporter_contact_number="").iterator():
        normalized = normalize_phone(alert.reporter_contact_number)
        if normalized != alert.reporter_contact_number:
            EmergencyAlert.objects.filter(pk=alert.pk).update(reporter_contact_number=normalized)
    duplicates = list(
        EmergencyAlert.objects.filter(
            reporter_contact_number__gt="",
            status__in={
                "submitted",
                "routing",
                "routed",
                "awaiting_acknowledgment",
                "acknowledged",
                "en_route",
                "nearby",
                "arrived",
                "resident_safe",
                "backup_requested",
                "backup_assigned",
                "in_progress",
                "transfer_required",
                "escalation_required",
            },
        )
        .values("reporter_contact_number")
        .annotate(total=models.Count("id"))
        .filter(total__gt=1)
    )
    if duplicates:
        raise RuntimeError(f"Resolve duplicate active alert phone numbers before migration: {duplicates}")


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0052_emergencycategory_quick_questions")]

    operations = [
        migrations.AddField(
            model_name="emergencychatmessage",
            name="client_message_id",
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
        migrations.RunPython(normalize_alert_phones, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="emergencyalert",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    reporter_contact_number__gt="",
                    status__in=[
                        "submitted",
                        "routing",
                        "routed",
                        "awaiting_acknowledgment",
                        "acknowledged",
                        "en_route",
                        "nearby",
                        "arrived",
                        "resident_safe",
                        "backup_requested",
                        "backup_assigned",
                        "in_progress",
                        "transfer_required",
                        "escalation_required",
                    ],
                ),
                fields=("reporter_contact_number",),
                name="unique_active_alert_phone",
            ),
        ),
        migrations.AddConstraint(
            model_name="emergencychatmessage",
            constraint=models.UniqueConstraint(
                condition=models.Q(client_message_id__isnull=False),
                fields=("alert", "sender", "client_message_id"),
                name="unique_emergency_chat_client_message",
            ),
        ),
        migrations.AddIndex(
            model_name="emergencychatmessage",
            index=models.Index(
                fields=["alert", "sender", "client_message_id"],
                name="emerg_chat_client_id",
            ),
        ),
    ]
