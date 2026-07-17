import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0006_seed_marikina_map_geometry")]

    operations = [
        migrations.AddField(
            model_name="emergencyalert",
            name="public_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AddField(
            model_name="emergencyalert",
            name="client_request_id",
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="emergencyalert",
            name="location_source",
            field=models.CharField(default="gps", max_length=32),
        ),
        migrations.AddField(
            model_name="emergencyalert",
            name="location_accuracy",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="emergencyalert",
            name="media_warnings",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="emergencyalert",
            name="routed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="emergencyalert",
            name="status_version",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddConstraint(
            model_name="emergencyalert",
            constraint=models.UniqueConstraint(
                condition=models.Q(("client_request_id__isnull", False)),
                fields=("reporter", "client_request_id"),
                name="unique_emergency_client_request",
            ),
        ),
    ]
