"""Move emergency routing from the `responder_unit` enum onto Department.

Nullable-first, backfill, verify, then rely on it. The verification step raises
rather than warning: a role map row that fails to resolve to a department is an
emergency type that would silently stop routing to anyone, which is the one
failure mode this migration exists to prevent.

`responder_unit` is left populated. Nothing reads it for routing after this, but
older serializers still expose it and it is the rollback path.
"""

from django.db import migrations, models
import django.db.models.deletion


# Legacy enum value -> Department.code from 0025_department_roster.
UNIT_TO_DEPARTMENT = {
    "tanod": "bpso-tanod",
    "bhw": "bhw",
    "bdrrmo": "bdrrmo",
    "other": "other-responders",
}

OTHER_RESPONDERS = {
    "code": "other-responders",
    "name": "Other Responders",
    "short_name": "Other",
    "description": "Responders that do not belong to a standing barangay unit",
    "emergency_role": "General emergency support",
    "sort_order": 900,
    "responds_to_emergencies": True,
    "emergency_types": ["medical", "fire", "crime", "disaster", "other"],
}


def backfill_departments(apps, schema_editor):
    Department = apps.get_model("concerns", "Department")
    RoleMap = apps.get_model("emergencies", "EmergencyTypeRoleMap")

    rows = list(RoleMap.objects.all())
    if not rows:
        return

    # Only materialise the catch-all unit if something actually needs it, so a
    # barangay with a clean roster does not gain a phantom department.
    if rows and any((row.responder_unit or "").strip() == "other" for row in rows):
        Department.objects.get_or_create(
            code=OTHER_RESPONDERS["code"],
            defaults={k: v for k, v in OTHER_RESPONDERS.items() if k != "code"},
        )

    by_code = {d.code: d for d in Department.objects.all()}
    unresolved = []

    for row in rows:
        unit = (row.responder_unit or "").strip()
        department_code = UNIT_TO_DEPARTMENT.get(unit)
        department = by_code.get(department_code) if department_code else None
        if department is None:
            unresolved.append(f"role map #{row.pk} (type={row.emergency_type}, unit={unit!r})")
            continue
        row.department = department
        row.save(update_fields=["department"])

    if unresolved:
        raise RuntimeError(
            "Cannot migrate emergency routing onto Department; these rows do not "
            "map to a known unit and would stop routing silently:\n  "
            + "\n  ".join(unresolved)
            + "\nAdd the missing Department rows, then re-run the migration."
        )


def unbackfill_departments(apps, schema_editor):
    RoleMap = apps.get_model("emergencies", "EmergencyTypeRoleMap")
    RoleMap.objects.update(department=None)


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0018_emergencyalert_route"),
        ("concerns", "0026_department_emergency_capability"),
    ]

    operations = [
        migrations.AddField(
            model_name="emergencytyperolemap",
            name="department",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="emergency_role_maps",
                to="concerns.department",
            ),
        ),
        migrations.RunPython(backfill_departments, unbackfill_departments),
        migrations.AddConstraint(
            model_name="emergencytyperolemap",
            constraint=models.UniqueConstraint(
                condition=models.Q(department__isnull=False),
                fields=("emergency_type", "department"),
                name="emerg_role_map_type_dept_uniq",
            ),
        ),
        migrations.AddIndex(
            model_name="emergencytyperolemap",
            index=models.Index(fields=["department", "is_active"], name="emerg_role_map_dept"),
        ),
    ]
