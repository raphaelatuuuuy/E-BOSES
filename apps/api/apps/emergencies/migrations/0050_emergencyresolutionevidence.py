from django.conf import settings
from django.db import migrations, models
import apps.accounts.storage


class Migration(migrations.Migration):
    dependencies = [
        ("emergencies", "0049_community_psgc_code"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EmergencyResolutionEvidence",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(upload_to="raw/emergency-resolution-evidence/%Y/%m/", storage=apps.accounts.storage.PrivateMediaStorage())),
                ("preview_file", models.FileField(blank=True, upload_to="previews/emergency-resolution-evidence/%Y/%m/", storage=apps.accounts.storage.PublicMediaStorage())),
                ("original_filename", models.CharField(max_length=255)),
                ("mime_type", models.CharField(blank=True, max_length=120)),
                ("file_size", models.PositiveIntegerField(default=0)),
                ("note", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("alert", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="resolution_evidence", to="emergencies.emergencyalert")),
                ("uploaded_by", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="emergency_resolution_evidence", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["created_at", "id"]},
        ),
    ]
