"""Per-category acknowledgment timeouts, support units and escalation units."""

from django.db import migrations

# category -> (timeout seconds, supporting unit, escalation unit)
ROUTING_POLICY = {
    "fire": (45, "bpso-tanod", "bdrrmo"),
    "medical": (45, "bns", "bdrrmo"),
    "flood": (90, "bpso-tanod", "bdrrmo"),
    "crime": (60, "bdrrmo", "bpso-tanod"),
    "domestic_violence": (45, "bcpc", "bpso-tanod"),
    "child_protection": (45, "vawc-desk", "bpso-tanod"),
    "dangerous_animal": (180, "bpso-tanod", "bpso-tanod"),
    "disaster": (45, "bpso-tanod", "bdrrmo"),
    "drug_related": (120, "bpso-tanod", "bpso-tanod"),
    "other": (180, "bpso-tanod", "bpso-tanod"),
}


def seed(apps, schema_editor):
    EmergencyTypeRoleMap = apps.get_model("emergencies", "EmergencyTypeRoleMap")
    Department = apps.get_model("concerns", "Department")
    departments = {d.code: d for d in Department.objects.all()}

    for role_map in EmergencyTypeRoleMap.objects.all():
        policy = ROUTING_POLICY.get(role_map.emergency_type)
        if not policy:
            continue
        timeout, supporting_code, escalation_code = policy
        role_map.acknowledgment_timeout_seconds = timeout
        role_map.supporting_department = departments.get(supporting_code)
        role_map.escalation_department = departments.get(escalation_code)
        role_map.service_area = "Marikina Heights"
        role_map.auto_backup_on_timeout = True
        role_map.save(
            update_fields=[
                "acknowledgment_timeout_seconds",
                "supporting_department",
                "escalation_department",
                "service_area",
                "auto_backup_on_timeout",
            ]
        )


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0028_emergencytyperolemap_acknowledgment_timeout_seconds_and_more"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
