from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("notifications", "0010_notification_is_archived")]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="event_key",
            field=models.CharField(blank=True, max_length=180, null=True),
        ),
        migrations.AddConstraint(
            model_name="notification",
            constraint=models.UniqueConstraint(
                condition=models.Q(("event_key__isnull", False)),
                fields=("recipient", "event_key"),
                name="notifications_recipient_event_key_unique",
            ),
        ),
    ]
