from django.db import migrations, models
from django.utils import timezone

import apps.accounts.storage


def mark_existing_active_announcements_sent(apps, schema_editor):
    Announcement = apps.get_model("concerns", "Announcement")
    now = timezone.now()
    for announcement in Announcement.objects.filter(is_published=True, notification_sent_at__isnull=True):
        if announcement.starts_at and announcement.starts_at > now:
            continue
        if announcement.expires_at and announcement.expires_at <= now:
            continue
        announcement.notification_sent_at = announcement.published_at or announcement.created_at or now
        announcement.save(update_fields=["notification_sent_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0018_announcement_publish_workflow"),
    ]

    operations = [
        migrations.AddField(
            model_name="announcement",
            name="image",
            field=models.FileField(blank=True, storage=apps.accounts.storage.PublicMediaStorage(), upload_to="announcements/%Y/%m/"),
        ),
        migrations.AddField(
            model_name="announcement",
            name="image_alt",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="announcement",
            name="notification_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(mark_existing_active_announcements_sent, migrations.RunPython.noop),
    ]
