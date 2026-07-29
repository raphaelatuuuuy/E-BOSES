"""Make ConcernCategory the real category list.

`ConcernCategory` has existed since 0024 and was never populated, so every
surface fell back to the four hardcoded `Concern.Category` enum values. The
Categories screen showed an empty table while the resident report form and the
Overview breakdown showed "Infrastructure / Environment / Public Safety /
Others" — categories that existed nowhere in the database and therefore could
not be renamed, routed, or added to.

This seeds the four legacy values as real rows, routes each to the committee
that already handles it, and backfills `category_ref` on existing concerns so
history keeps working. After this the enum is only a compatibility column.
"""

from django.db import migrations


# code, name, description, department code that answers it
CATEGORY_SEEDS = [
    (
        "infrastructure",
        "Infrastructure",
        "Roads, drainage, street lights and public structures",
        "infrastructure-public-works",
    ),
    (
        "environment",
        "Environment",
        "Rubbish, flooding, sanitation and pollution",
        "environment-sanitation",
    ),
    (
        "public_safety",
        "Public Safety",
        "Hazards, disturbances and anything unsafe",
        "peace-and-order",
    ),
    (
        "vehicle",
        "Vehicle",
        "Cars, trucks, buses, motorcycles, bicycles and other vehicles",
        "car",
    ),
    (
        "others",
        "Others",
        "Anything that does not fit the categories above",
        "social-services",
    ),
]


def seed(apps, schema_editor):
    ConcernCategory = apps.get_model("concerns", "ConcernCategory")
    Department = apps.get_model("concerns", "Department")
    Concern = apps.get_model("concerns", "Concern")

    departments = {d.code: d for d in Department.objects.all()}

    for order, (code, name, description, department_code) in enumerate(CATEGORY_SEEDS):
        category, created = ConcernCategory.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "description": description,
                "department": departments.get(department_code),
                "is_active": True,
            },
        )
        # An existing row keeps whatever an official already set; only fill a
        # missing routing target so the category is not left answering to nobody.
        if not created and category.department_id is None:
            category.department = departments.get(department_code)
            category.save(update_fields=["department"])

        # Existing concerns carry only the enum string. Pointing them at the new
        # row keeps their category displayable once the UI reads `category_ref`.
        Concern.objects.filter(category=code, category_ref__isnull=True).update(
            category_ref=category
        )


def unseed(apps, schema_editor):
    ConcernCategory = apps.get_model("concerns", "ConcernCategory")
    Concern = apps.get_model("concerns", "Concern")
    codes = [code for code, _n, _d, _dept in CATEGORY_SEEDS]
    Concern.objects.filter(category_ref__code__in=codes).update(category_ref=None)
    ConcernCategory.objects.filter(code__in=codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0027_rbac_positions_and_designations"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
