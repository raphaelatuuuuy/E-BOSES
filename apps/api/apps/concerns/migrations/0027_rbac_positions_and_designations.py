"""Activate Position.permissions as the real authorisation source.

`Position.permissions` has existed and gone unread since 0024. Until now every
staff member carried the flat `barangay_official` role, so a Secretary and the
Barangay Captain held identical power.

Two backfills matter here:

* Existing officials are seeded as Barangay Captain. They hold full access today;
  turning enforcement on without this would lock out every account including the
  one that would fix it. Reducing an official's privilege becomes a deliberate
  act in the Roles screen rather than a migration side effect.
* Existing responders gain a Designation in the unit their `responder_unit` enum
  named, because dispatch now finds responders through designations.

Capability codes are written out rather than imported from apps.capabilities:
a migration must keep describing the past even after the vocabulary moves on.
"""

from django.db import migrations


ALL_CAPABILITIES = [
    "manage_units",
    "manage_roles",
    "manage_users",
    "review_verification",
    "handle_privacy",
    "resolve_concerns",
    "manage_categories",
    "configure_classification",
    "configure_dispatch",
    "configure_geography",
    "publish_announcements",
    "dispatch_emergencies",
]

POSITION_SEEDS = [
    ("barangay-captain", "Barangay Captain", ALL_CAPABILITIES),
    (
        "secretary",
        "Barangay Secretary",
        [
            "manage_users",
            "review_verification",
            "handle_privacy",
            "publish_announcements",
            "resolve_concerns",
        ],
    ),
    ("kagawad", "Kagawad", ["resolve_concerns", "publish_announcements"]),
    ("unit-head", "Unit Head", ["dispatch_emergencies", "resolve_concerns"]),
    ("staff", "Staff / Volunteer", ["resolve_concerns"]),
]

RESPONDER_UNIT_TO_DEPARTMENT = {
    "tanod": "bpso-tanod",
    "bhw": "bhw",
    "bdrrmo": "bdrrmo",
    "other": "other-responders",
}

OFFICIAL_HOME_DEPARTMENT = "sangguniang-barangay"


def seed(apps, schema_editor):
    Position = apps.get_model("concerns", "Position")
    Department = apps.get_model("concerns", "Department")
    Designation = apps.get_model("concerns", "Designation")
    User = apps.get_model("accounts", "User")

    positions = {}
    for code, name, permissions in POSITION_SEEDS:
        position, _created = Position.objects.get_or_create(
            code=code,
            defaults={"name": name, "permissions": permissions},
        )
        # An existing position keeps its name but gains the seeded capability
        # set only if it has none, so a hand-edited roster is not overwritten.
        if not position.permissions:
            position.permissions = permissions
            position.save(update_fields=["permissions"])
        positions[code] = position

    departments = {d.code: d for d in Department.objects.all()}

    # --- Officials keep the access they already have -----------------------
    home = departments.get(OFFICIAL_HOME_DEPARTMENT)
    if home is not None:
        captain = positions["barangay-captain"]
        for user in User.objects.filter(role="barangay_official"):
            Designation.objects.get_or_create(
                user=user,
                department=home,
                position=captain,
                defaults={"title": "Barangay Captain", "is_active": True},
            )

    # --- Responders become findable through designations -------------------
    staff = positions["staff"]
    for user in User.objects.filter(role="first_responder").exclude(responder_unit=""):
        department_code = RESPONDER_UNIT_TO_DEPARTMENT.get(user.responder_unit)
        department = departments.get(department_code) if department_code else None
        if department is None:
            # Not fatal: an unmapped responder loses auto-routing, not access,
            # and appears in the Users screen for an official to place.
            continue
        Designation.objects.get_or_create(
            user=user,
            department=department,
            position=staff,
            defaults={"title": "", "is_active": True},
        )


def unseed(apps, schema_editor):
    Designation = apps.get_model("concerns", "Designation")
    Position = apps.get_model("concerns", "Position")
    seeded_codes = [code for code, _name, _perms in POSITION_SEEDS]
    Designation.objects.filter(position__code__in=seeded_codes).delete()
    Position.objects.filter(code__in=seeded_codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0026_department_emergency_capability"),
        ("emergencies", "0019_role_map_department"),
        ("accounts", "0023_identityidentifierclaim_and_duplicate_review_reason"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
