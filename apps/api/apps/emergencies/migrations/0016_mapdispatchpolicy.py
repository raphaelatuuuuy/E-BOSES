import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def seed_policy(apps, schema_editor):
    MapDispatchPolicy = apps.get_model("emergencies", "MapDispatchPolicy")
    MapDispatchPolicy.objects.get_or_create(
        pk=1,
        defaults={
            "barangay": "Marikina Heights",
            "acceptance_center_latitude": "14.6507000",
            "acceptance_center_longitude": "121.1133000",
            "acceptance_radius_meters": 800,
            "out_of_zone_action": "review",
            "witness_radius_meters": 250,
            "responder_nearby_radius_meters": 100,
        },
    )


class Migration(migrations.Migration):
    dependencies = [
        ("emergencies", "0015_witnessnotification_delivery_state"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="MapDispatchPolicy",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("barangay", models.CharField(default="Marikina Heights", max_length=120, unique=True)),
                ("acceptance_center_latitude", models.DecimalField(decimal_places=7, default=14.6507, max_digits=10)),
                ("acceptance_center_longitude", models.DecimalField(decimal_places=7, default=121.1133, max_digits=10)),
                ("acceptance_radius_meters", models.PositiveIntegerField(default=800)),
                ("out_of_zone_action", models.CharField(choices=[("block", "Block submission"), ("warn", "Warn and allow"), ("review", "Flag for official review")], default="review", max_length=16)),
                ("witness_radius_meters", models.PositiveIntegerField(default=250)),
                ("responder_nearby_radius_meters", models.PositiveIntegerField(default=100)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("updated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="map_dispatch_policy_updates", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "Map dispatch policy",
                "verbose_name_plural": "Map dispatch policies",
            },
        ),
        migrations.RunPython(seed_policy, migrations.RunPython.noop),
    ]
