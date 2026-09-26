import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import apps.accounts.storage


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0063_remove_concernaiassessment_urgent_attention"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PrecheckJob",
            fields=[
                ("job_id", models.CharField(max_length=32, primary_key=True, serialize=False)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="precheck_jobs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("processing", "Processing"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                        ],
                        default="queued",
                        max_length=16,
                    ),
                ),
                ("dedup_hash", models.CharField(blank=True, db_index=True, max_length=64)),
                ("params", models.JSONField(blank=True, default=dict)),
                ("result", models.JSONField(blank=True, null=True)),
                ("error_code", models.CharField(blank=True, max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ["-created_at"], "indexes": [models.Index(fields=["owner", "status"], name="precheck_job_owner")]},
        ),
        migrations.CreateModel(
            name="PrecheckJobAttachment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "file",
                    models.FileField(
                        storage=apps.accounts.storage.PrivateMediaStorage(),
                        upload_to="raw/precheck-staging/%Y/%m/",
                    ),
                ),
                ("original_filename", models.CharField(blank=True, max_length=255)),
                ("mime_type", models.CharField(blank=True, max_length=120)),
                ("file_size", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "job",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attachments",
                        to="concerns.precheckjob",
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
    ]
