from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0019_announcement_media_notification_sent"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="concernmedia",
            name="public_preview_state",
            field=models.CharField(
                choices=[
                    ("private", "Private only"),
                    ("pending_redaction", "Pending redaction review"),
                    ("public", "Approved public preview"),
                    ("withheld", "Withheld from public display"),
                ],
                default="private",
                max_length=24,
            ),
        ),
        migrations.CreateModel(
            name="ConcernMediaRedaction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("x", models.FloatField()),
                ("y", models.FloatField()),
                ("width", models.FloatField()),
                ("height", models.FloatField()),
                ("reason", models.CharField(blank=True, max_length=120)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="concern_media_redactions", to=settings.AUTH_USER_MODEL)),
                ("media", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="redactions", to="concerns.concernmedia")),
            ],
            options={"ordering": ["id"]},
        ),
    ]
