"""Scopes positions to a unit.

`Position` was a flat catalog every unit shared. Officials now manage each
unit's positions from the Units screen and the Users screen only offers the
chosen unit's positions, so a position must know its unit.

`department` is nullable: the shared RBAC positions seeded in 0027 (Barangay
Captain, Secretary, Kagawad, Unit Head, Staff / Volunteer) stay barangay-wide
with `department=NULL`. They no longer appear in any unit's own position list,
but the RBAC grants and the legacy responder sync still read them.

Name uniqueness becomes per-department so two units can each have a "Tanod"
or "Committee Chairperson".
"""

from django.db import migrations, models

import django.db.models.deletion

# Seeded defaults per unit, in the language a barangay roster uses. Heads can
# dispatch and resolve; members resolve. Officials can rename, deactivate and
# add positions freely afterwards.
HEAD = ["dispatch_emergencies", "resolve_concerns"]
MEMBER = ["resolve_concerns"]

UNIT_POSITIONS = {
    "captain": [
        ("Punong Barangay", HEAD),
        ("Barangay Aide", MEMBER),
    ],
    "secretary": [
        ("Records Officer", MEMBER),
        ("Administrative Aide", MEMBER),
    ],
    "treasurer": [
        ("Barangay Treasurer", MEMBER),
        ("Finance Clerk", MEMBER),
    ],
    "sangguniang-barangay": [
        ("Sector Kagawad", MEMBER),
        ("Committee Chairperson", MEMBER),
    ],
    "lupon-tagapamayapa": [
        ("Lupon Chairperson", MEMBER),
        ("Lupon Member", MEMBER),
    ],
    "bpso-tanod": [
        ("Tanod Chief", HEAD),
        ("Tanod Team Leader", MEMBER),
        ("Tanod", MEMBER),
        ("Traffic Enforcer", MEMBER),
    ],
    "bhw": [
        ("BHW Coordinator", HEAD),
        ("BHW Leader", MEMBER),
        ("BHW Volunteer", MEMBER),
    ],
    "bns": [
        ("BNS Coordinator", HEAD),
        ("BNS Volunteer", MEMBER),
    ],
    "bdrrmo": [
        ("BDRRMO Head", HEAD),
        ("Rescue Team Leader", MEMBER),
        ("First Aider", MEMBER),
    ],
    "badac": [
        ("BADAC Chairperson", MEMBER),
        ("BADAC Secretary", MEMBER),
        ("BADAC Member", MEMBER),
    ],
    "bcpc": [
        ("BCPC Chairperson", MEMBER),
        ("BCPC Secretary", MEMBER),
        ("BCPC Member", MEMBER),
    ],
    "vawc-desk": [
        ("VAWC Desk Officer", MEMBER),
        ("VAWC Advocate", MEMBER),
    ],
    "senior-citizens-desk": [
        ("Senior Citizens Desk Officer", MEMBER),
        ("Senior Citizens Coordinator", MEMBER),
    ],
    "pwd-desk": [
        ("PWD Desk Officer", MEMBER),
        ("PWD Coordinator", MEMBER),
    ],
    "sk": [
        ("SK Chairperson", HEAD),
        ("SK Kagawad", MEMBER),
        ("SK Secretary", MEMBER),
        ("SK Treasurer", MEMBER),
    ],
    "environment-sanitation": [
        ("Committee Chairperson", MEMBER),
        ("Committee Member", MEMBER),
        ("Sanitation Inspector", MEMBER),
    ],
    "infrastructure-public-works": [
        ("Committee Chairperson", MEMBER),
        ("Committee Member", MEMBER),
        ("Works Inspector", MEMBER),
    ],
    "peace-and-order": [
        ("Committee Chairperson", MEMBER),
        ("Committee Member", MEMBER),
    ],
    "education-committee": [
        ("Committee Chairperson", MEMBER),
        ("Committee Member", MEMBER),
    ],
    "social-services": [
        ("Committee Chairperson", MEMBER),
        ("Committee Member", MEMBER),
        ("Social Welfare Aide", MEMBER),
    ],
}


def slugify(value):
    return value.lower().replace(" ", "-").replace("/", "").strip("-")


def seed(apps, schema_editor):
    Position = apps.get_model("concerns", "Position")
    Department = apps.get_model("concerns", "Department")
    departments = {d.code: d for d in Department.objects.all()}
    for code, positions in UNIT_POSITIONS.items():
        department = departments.get(code)
        if department is None:
            continue
        for name, permissions in positions:
            Position.objects.get_or_create(
                code=f"{code}-{slugify(name)}",
                defaults={
                    "name": name,
                    "department": department,
                    "permissions": permissions,
                    "is_active": True,
                },
            )


def unseed(apps, schema_editor):
    Position = apps.get_model("concerns", "Position")
    codes = [
        f"{dept}-{slugify(name)}"
        for dept, positions in UNIT_POSITIONS.items()
        for name, _permissions in positions
    ]
    Position.objects.filter(code__in=codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0043_concerncategory_public_feed_allowed"),
    ]

    operations = [
        migrations.AddField(
            model_name="position",
            name="department",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="positions",
                to="concerns.department",
            ),
        ),
        migrations.AlterField(
            model_name="position",
            name="name",
            field=models.CharField(max_length=120),
        ),
        migrations.AddConstraint(
            model_name="position",
            constraint=models.UniqueConstraint(
                fields=("name", "department"),
                name="concerns_unique_position_per_department",
            ),
        ),
        migrations.RunPython(seed, unseed),
    ]
