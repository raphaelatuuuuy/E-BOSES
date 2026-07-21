from django.db import migrations, models
import django.db.models.deletion

import apps.accounts.storage


class Migration(migrations.Migration):
    dependencies = [
        ("concerns", "0013_concernchatmessage"),
    ]

    operations = [
        migrations.CreateModel(
            name="ConcernChatAttachment",
            fields=[
                (
                    "id",
                    models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"),
                ),
                (
                    "file",
                    models.FileField(
                        storage=apps.accounts.storage.PrivateMediaStorage(),
                        upload_to="raw/concern-chat/%Y/%m/",
                    ),
                ),
                ("original_filename", models.CharField(max_length=255)),
                ("mime_type", models.CharField(max_length=120)),
                (
                    "kind",
                    models.CharField(
                        choices=[("image", "Image"), ("video", "Video")],
                        max_length=12,
                    ),
                ),
                ("file_size", models.PositiveIntegerField(default=0)),
                (
                    "authenticity_status",
                    models.CharField(
                        choices=[
                            ("clear", "No obvious edit detected"),
                            ("flagged", "Potentially edited media"),
                            ("review_required", "Review required"),
                        ],
                        default="review_required",
                        max_length=24,
                    ),
                ),
                ("authenticity_detail", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "concern",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_attachments",
                        to="concerns.concern",
                    ),
                ),
                (
                    "message",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attachment",
                        to="concerns.concernchatmessage",
                    ),
                ),
            ],
            options={"ordering": ["created_at", "id"]},
        ),
    ]
