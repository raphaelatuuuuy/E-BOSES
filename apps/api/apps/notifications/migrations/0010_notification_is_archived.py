from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0009_notification_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="is_archived",
            field=models.BooleanField(default=False),
        ),
    ]
