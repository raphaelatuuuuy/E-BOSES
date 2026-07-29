"""Give Department the fields emergency dispatch needs to route to it.

Before this, dispatch routed on the closed `User.responder_unit` enum, so a unit
created through the admin could never receive an alert. Seeding
`responds_to_emergencies` and `emergency_types` from the roster's existing
`emergency_role` prose keeps current behaviour intact while moving the source of
truth onto Department.
"""

from django.db import migrations, models


# Derived from the emergency_role text seeded in 0025_department_roster. Units
# absent from this map are civil/administrative and do not answer SOS alerts.
EMERGENCY_UNITS = {
    "bpso-tanod": ["crime", "disaster", "other"],
    "bhw": ["medical"],
    "bdrrmo": ["disaster", "fire", "medical"],
    "bcpc": ["crime"],
    "vawc-desk": ["crime"],
    "bns": ["medical"],
}


def seed_emergency_capability(apps, schema_editor):
    Department = apps.get_model("concerns", "Department")
    for code, types in EMERGENCY_UNITS.items():
        Department.objects.filter(code=code).update(
            responds_to_emergencies=True,
            emergency_types=types,
        )


def unseed_emergency_capability(apps, schema_editor):
    Department = apps.get_model("concerns", "Department")
    Department.objects.update(responds_to_emergencies=False, emergency_types=[])


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0025_department_roster"),
    ]

    operations = [
        migrations.AddField(
            model_name="department",
            name="responds_to_emergencies",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="department",
            name="emergency_types",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="department",
            name="contact_number",
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.RunPython(seed_emergency_capability, unseed_emergency_capability),
    ]
