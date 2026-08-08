from django.db import migrations


def fix_digital_number_labels(apps, schema_editor):
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    for field in Field.objects.filter(code="digital_number"):
        hints = dict(field.extraction_hints or {})
        changed = False
        labels = [
            "digital national id number" if str(k) == "DigitalNationalIDNumber" else str(k)
            for k in (hints.get("labels") or [])
        ]
        if labels != (hints.get("labels") or []):
            hints["labels"] = labels
            changed = True
        keywords = [
            k for k in (hints.get("expected_keywords") or [])
            if str(k) != "DigitalNationalIDNumber"
        ]
        if keywords != (hints.get("expected_keywords") or []):
            hints["expected_keywords"] = keywords
            changed = True
        if changed:
            field.extraction_hints = hints
            field.save(update_fields=["extraction_hints"])


def reverse(apps, schema_editor):
    # No-op: reverting would reintroduce the camelCase label artifact.
    pass


class Migration(migrations.Migration):
    dependencies = [("accounts", "0034_alter_ocrservicestatus_provider")]
    operations = [migrations.RunPython(fix_digital_number_labels, reverse)]
