from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0008_concern_comment_mentions"),
    ]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
