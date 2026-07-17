from django.db import migrations, models


DEFAULT_ACTION = "manual_review"


def seed_failure_action(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    for configuration in Configuration.objects.all().iterator():
        settings = dict(configuration.settings or {})
        if settings.get("failure_action") not in {"manual_review", "reject", "request_resubmission"}:
            settings["failure_action"] = DEFAULT_ACTION
            configuration.settings = settings
            configuration.save(update_fields=["settings", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0017_upgrade_barangay_id_fields")]

    operations = [
        migrations.AlterField(
            model_name="residenceverificationcase",
            name="review_reason",
            field=models.CharField(
                blank=True,
                choices=[
                    ("ocr_unavailable", "OCR unavailable"),
                    ("low_confidence", "Low OCR confidence"),
                    ("missing_required_field", "Missing required field"),
                    ("document_type_mismatch", "Document type mismatch"),
                    ("rule_mismatch", "Validation rule mismatch"),
                    ("resubmission_required", "Request a new submission"),
                    ("official_requested", "Official requested review"),
                    ("legacy_pending", "Legacy pending verification"),
                ],
                max_length=40,
            ),
        ),
        migrations.RunPython(seed_failure_action, migrations.RunPython.noop),
    ]
