"""Seed the nine categories the SMS gateway accepts, and route each one.

Three things happen here:

1. **Labels are corrected.** "Crime / Violence" becomes "Crime or Public
   Safety" and "Fire / Flood / Disaster" becomes "Disaster". The codes are left
   alone - live alerts reference them, and renaming a code would orphan every
   historical incident.

2. **Flood, Dangerous Animal and Other Emergency are added.** Flood used to be
   folded into `disaster`, which meant a resident texting FLOOD and a resident
   texting EARTHQUAKE produced identical records. `other` was deliberately
   removed in 0025; it comes back because an SMS whose category cannot be read
   has to land somewhere, and dropping it is not an option.

3. **Every category gets a routing row**, so `emergency_category_is_covered`
   passes and dispatch never has to fall back to the hard-coded map in views.
"""

from django.db import migrations

# code, label, subtext, icon key, sort order
CATEGORIES = [
    ("fire", "Fire", "Fire, smoke, burning", "flame", 10),
    ("medical", "Medical Emergency", "Injury, collapse, hard breathing", "activity", 20),
    ("flood", "Flood", "Rising water, flooding", "waves", 30),
    ("crime", "Crime or Public Safety", "Theft, fight, public safety", "shield-alert", 40),
    ("domestic_violence", "Domestic Violence", "Violence at home, VAWC cases", "heart-crack", 50),
    ("child_protection", "Child Protection", "Child abuse, neglect, exploitation", "baby", 60),
    ("dangerous_animal", "Dangerous Animal", "Loose or dangerous animal", "paw-print", 70),
    ("disaster", "Disaster", "Earthquake, landslide, storm", "cloud-rain-wind", 80),
    ("drug_related", "Drug-Related Incident", "Drug-related incident or concern", "pill", 90),
    ("other", "Other Emergency", "Emergency not listed above", "siren", 999),
]

# category code -> (primary department code, priority)
ROUTING = {
    "fire": ("bdrrmo", 100),
    "medical": ("bhw", 100),
    "flood": ("bdrrmo", 100),
    "crime": ("bpso-tanod", 100),
    "domestic_violence": ("vawc-desk", 100),
    "child_protection": ("bcpc", 100),
    "dangerous_animal": ("bpso-tanod", 90),
    "disaster": ("bdrrmo", 100),
    "drug_related": ("badac", 100),
    "other": ("bpso-tanod", 50),
}

# NOTE: only primary units are seeded.
#
# `find_auto_responders_by_unit` assigns one responder from *every* department
# that has a routing row for the emergency type. Seeding supporting units here
# would therefore dispatch a Tanod, a BHW, a BNS and a BDRRMO responder to the
# same medical call at once - four units for one patient, and four units then
# unavailable for the next emergency.
#
# Supporting and escalation units get their own columns on EmergencyTypeRoleMap
# in the backup/escalation work, where they are used for backup requests and
# acknowledgement timeouts rather than for initial dispatch.

LEGACY_UNIT_BY_DEPARTMENT = {
    "bpso-tanod": "tanod",
    "bhw": "bhw",
    "bdrrmo": "bdrrmo",
}


def seed(apps, schema_editor):
    EmergencyCategory = apps.get_model("emergencies", "EmergencyCategory")
    EmergencyTypeRoleMap = apps.get_model("emergencies", "EmergencyTypeRoleMap")
    Department = apps.get_model("concerns", "Department")

    for code, label, subtext, icon_key, sort_order in CATEGORIES:
        EmergencyCategory.objects.update_or_create(
            code=code,
            defaults={
                "label": label,
                "subtext": subtext,
                "icon_key": icon_key,
                "sort_order": sort_order,
                "is_active": True,
            },
        )

    departments = {d.code: d for d in Department.objects.all()}

    def add_route(category_code, department_code, priority):
        department = departments.get(department_code)
        if not department:
            # A barangay that renamed or removed a unit still migrates cleanly;
            # dispatch falls through to Department.emergency_types.
            return
        EmergencyTypeRoleMap.objects.update_or_create(
            emergency_type=category_code,
            department=department,
            defaults={
                "responder_unit": LEGACY_UNIT_BY_DEPARTMENT.get(department_code, ""),
                "priority": priority,
                "requires_shift": True,
                "is_active": True,
            },
        )

    for category_code, (department_code, priority) in ROUTING.items():
        add_route(category_code, department_code, priority)

    # Keep Department.emergency_types in step so the second-tier fallback in
    # `preferred_departments_for` agrees with the explicit routing rows.
    declared: dict[str, set] = {}
    for category_code, (department_code, _priority) in ROUTING.items():
        declared.setdefault(department_code, set()).add(category_code)

    for department_code, types in declared.items():
        department = departments.get(department_code)
        if not department:
            continue
        merged = sorted(set(department.emergency_types or []) | types)
        department.emergency_types = merged
        department.responds_to_emergencies = True
        department.save(update_fields=["emergency_types", "responds_to_emergencies"])


def unseed(apps, schema_editor):
    """Remove only what this migration introduced.

    Categories that predate it keep their rows; reverting must not delete a
    barangay's live routing configuration.
    """
    EmergencyCategory = apps.get_model("emergencies", "EmergencyCategory")
    EmergencyTypeRoleMap = apps.get_model("emergencies", "EmergencyTypeRoleMap")
    added = ["flood", "dangerous_animal", "other"]
    EmergencyTypeRoleMap.objects.filter(emergency_type__in=added).delete()
    EmergencyCategory.objects.filter(code__in=added).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0026_emergencyalert_category_needs_confirmation_and_more"),
        ("concerns", "0026_department_emergency_capability"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
