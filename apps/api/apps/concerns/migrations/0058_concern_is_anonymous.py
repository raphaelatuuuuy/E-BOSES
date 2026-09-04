from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0057_concern_reporter_community_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="concern",
            name="is_anonymous",
            field=models.BooleanField(default=False, db_index=True),
        ),
    ]
