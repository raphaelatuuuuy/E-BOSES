import uuid

from django.db import migrations, models


def populate_public_tracking(apps, schema_editor):
    Concern = apps.get_model("concerns", "Concern")
    for concern in Concern.objects.all().iterator():
        year = concern.created_at.year if concern.created_at else 0
        concern.tracking_number = f"RPT-{year}-{concern.pk:06d}"
        if concern.status == "submitted":
            concern.validation_status = "pending"
            concern.validation_summary = "Awaiting automated validation."
        elif concern.status == "rejected":
            concern.validation_status = "rejected"
        else:
            concern.validation_status = "accepted"
        concern.save(
            update_fields=["tracking_number", "validation_status", "validation_summary"]
        )


class Migration(migrations.Migration):
    dependencies = [("concerns", "0009_concernclassification_enabled_categories")]

    operations = [
        migrations.AddField(
            model_name="concern",
            name="public_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AddField(
            model_name="concern",
            name="client_request_id",
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="concern",
            name="tracking_number",
            field=models.CharField(blank=True, max_length=32, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="concern",
            name="validation_status",
            field=models.CharField(
                choices=[("pending", "Pending"), ("accepted", "Accepted"), ("rejected", "Rejected")],
                default="accepted",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="concern",
            name="validation_summary",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="concern",
            name="rejection_code",
            field=models.CharField(blank=True, max_length=48),
        ),
        migrations.AddField(
            model_name="concern",
            name="status_version",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="phash_blocks",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="validation_status",
            field=models.CharField(default="accepted", max_length=16),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="validation_detail",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AlterField(
            model_name="concern",
            name="status",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("under_review", "Under Review"),
                    ("assigned", "Assigned"),
                    ("in_progress", "In Progress"),
                    ("resolved", "Resolved"),
                    ("rejected", "Rejected"),
                    ("appealed", "Appealed"),
                ],
                default="submitted",
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="concernstatusevent",
            name="status",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("under_review", "Under Review"),
                    ("assigned", "Assigned"),
                    ("in_progress", "In Progress"),
                    ("resolved", "Resolved"),
                    ("rejected", "Rejected"),
                    ("appealed", "Appealed"),
                ],
                max_length=32,
            ),
        ),
        migrations.RunPython(populate_public_tracking, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="concern",
            constraint=models.UniqueConstraint(
                condition=models.Q(("client_request_id__isnull", False)),
                fields=("reporter", "client_request_id"),
                name="unique_concern_client_request",
            ),
        ),
    ]
