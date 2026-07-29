from django.db import migrations


def strip_other_from_emergency_types(apps, schema_editor):
    Department = apps.get_model("concerns", "Department")
    for department in Department.objects.all():
        types = department.emergency_types or []
        if "other" in types:
            department.emergency_types = [t for t in types if t != "other"]
            department.save(update_fields=["emergency_types"])


def delete_other_emergency_category(apps, schema_editor):
    EmergencyCategory = apps.get_model("emergencies", "EmergencyCategory")
    EmergencyCategory.objects.filter(code="other").delete()


def delete_other_emergency_alerts(apps, schema_editor):
    EmergencyAlert = apps.get_model("emergencies", "EmergencyAlert")
    EmergencyAlert.objects.filter(type="other").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0024_remove_other_choices"),
    ]

    operations = [
        migrations.RunPython(strip_other_from_emergency_types, migrations.RunPython.noop),
        migrations.RunPython(delete_other_emergency_category, migrations.RunPython.noop),
        migrations.RunPython(delete_other_emergency_alerts, migrations.RunPython.noop),
    ]
