from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0011_emergencychatmessage"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ResponderShift",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("responder_unit", models.CharField(blank=True, max_length=24)),
                ("status", models.CharField(choices=[("active", "Active"), ("ended", "Ended")], default="active", max_length=16)),
                ("started_at", models.DateTimeField()),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                ("start_latitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("start_longitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("end_latitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("end_longitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("incidents_assigned", models.PositiveIntegerField(default=0)),
                ("incidents_acknowledged", models.PositiveIntegerField(default=0)),
                ("incidents_resolved", models.PositiveIntegerField(default=0)),
                ("false_alarms", models.PositiveIntegerField(default=0)),
                ("average_response_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "responder",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="responder_shifts", to=settings.AUTH_USER_MODEL),
                ),
            ],
            options={
                "ordering": ["-started_at", "-id"],
            },
        ),
        migrations.AddConstraint(
            model_name="respondershift",
            constraint=models.UniqueConstraint(condition=models.Q(("ended_at__isnull", True)), fields=("responder",), name="unique_active_responder_shift"),
        ),
        migrations.AddIndex(
            model_name="respondershift",
            index=models.Index(fields=["responder", "started_at"], name="shift_responder_started"),
        ),
        migrations.AddIndex(
            model_name="respondershift",
            index=models.Index(fields=["status", "started_at"], name="shift_status_started"),
        ),
    ]
