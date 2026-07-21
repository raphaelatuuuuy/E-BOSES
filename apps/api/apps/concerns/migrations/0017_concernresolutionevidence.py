import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import apps.accounts.storage


class Migration(migrations.Migration):
    dependencies = [
        ("concerns", "0016_merge_0015_location_lookup_and_official_review"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ConcernResolutionEvidence",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "file",
                    models.FileField(
                        storage=apps.accounts.storage.PrivateMediaStorage(),
                        upload_to="raw/concern-resolution-evidence/%Y/%m/",
                    ),
                ),
                ("original_filename", models.CharField(max_length=255)),
                ("mime_type", models.CharField(blank=True, max_length=120)),
                ("file_size", models.PositiveIntegerField(default=0)),
                ("note", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "concern",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="resolution_evidence",
                        to="concerns.concern",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="concern_resolution_evidence",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["created_at", "id"]},
        ),
    ]
