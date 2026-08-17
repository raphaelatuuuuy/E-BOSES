from django.db import migrations


REMOVED_CODES = (
    "child_protection",
    "dangerous_animal",
    "domestic_violence",
    "drug_related",
    "other",
)


def deactivate_removed_categories(apps, schema_editor):
    EmergencyCategory = apps.get_model("emergencies", "EmergencyCategory")
    EmergencyTypeRoleMap = apps.get_model("emergencies", "EmergencyTypeRoleMap")
    EmergencyCategory.objects.filter(code__in=REMOVED_CODES).update(is_active=False)
    EmergencyTypeRoleMap.objects.filter(emergency_type__in=REMOVED_CODES).update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0035_alter_emergencyalert_type")]

    operations = [migrations.RunPython(deactivate_removed_categories, migrations.RunPython.noop)]
