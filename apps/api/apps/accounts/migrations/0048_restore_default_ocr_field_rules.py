from django.db import migrations


def restore_rules(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    Rule = apps.get_model("accounts", "OCRRule")
    for configuration in Configuration.objects.filter(status__in=["draft", "published"]):
        for document in configuration.document_types.all():
            for field in document.fields.all():
                label = (field.label or "").strip().lower()
                if label not in {"full name", "address", "birthdate", "expiry date", "date of birth"}:
                    continue
                code = f"{document.code}_{field.code}_required"
                Rule.objects.get_or_create(
                    configuration=configuration,
                    code=code[:80],
                    defaults={
                        "document_type": document,
                        "field": field,
                        "name": f"{field.label} is required",
                        "rule_type": "required",
                        "operator": "exists",
                        "value": {"field": field.code},
                        "on_failure": "manual_review",
                        "enabled": True,
                    },
                )
                if label == "expiry date":
                    Rule.objects.get_or_create(
                        configuration=configuration,
                        code=f"{document.code}_{field.code}_not_expired"[:80],
                        defaults={
                            "document_type": document,
                            "field": field,
                            "name": "Expiry date is valid",
                            "rule_type": "not_expired",
                            "operator": "not_expired",
                            "value": {"field": field.code},
                            "on_failure": "manual_review",
                            "enabled": True,
                        },
                    )


class Migration(migrations.Migration):
    dependencies = [("accounts", "0047_disable_cloud_seeded_accounts")]

    operations = [migrations.RunPython(restore_rules, migrations.RunPython.noop)]
