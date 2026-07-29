from django.db import migrations, models


DEFAULT_CATEGORIES = [
    ("medical", "Medical", "Injury, illness, rescue", "activity", 10),
    ("fire", "Fire", "Building, house, residence", "flame", 20),
    ("crime", "Crime / Violence", "Assault, theft, threat", "shield-alert", 30),
    ("disaster", "Fire / Flood / Disaster", "Flood, quake, storm", "cloud-rain-wind", 40),
    ("child_protection", "Child Protection", "Child abuse, neglect, exploitation", "baby", 50),
    ("domestic_violence", "Domestic Violence", "Violence at home, VAWC cases", "heart-crack", 60),
    ("drug_related", "Drug-Related Incident", "Drug-related incident or concern", "pill", 70),
    ("other", "Other", "Emergency not listed above", "siren", 999),
]


def seed_categories(apps, schema_editor):
    EmergencyCategory = apps.get_model("emergencies", "EmergencyCategory")
    for code, label, subtext, icon_key, sort_order in DEFAULT_CATEGORIES:
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


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0021_emergency_disposition_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="EmergencyCategory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.SlugField(max_length=80, unique=True)),
                ("label", models.CharField(max_length=80)),
                ("subtext", models.CharField(blank=True, max_length=160)),
                ("icon_key", models.CharField(default="siren", max_length=48)),
                ("custom_icon_label", models.CharField(blank=True, max_length=8)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["sort_order", "label"]},
        ),
        migrations.AddIndex(
            model_name="emergencycategory",
            index=models.Index(fields=["is_active", "sort_order"], name="emerg_cat_active_order"),
        ),
        migrations.RemoveConstraint(
            model_name="emergencytyperolemap",
            name="emerg_role_map_type_unit_uniq",
        ),
        migrations.AlterField(
            model_name="emergencyalert",
            name="type",
            field=models.CharField(max_length=80),
        ),
        migrations.AlterField(
            model_name="emergencytyperolemap",
            name="emergency_type",
            field=models.CharField(max_length=80),
        ),
        migrations.RunPython(seed_categories, migrations.RunPython.noop),
    ]
