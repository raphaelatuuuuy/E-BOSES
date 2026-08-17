from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("concerns", "0042_remove_manual_ai_review")]

    operations = [
        migrations.AddField(
            model_name="concerncategory",
            name="public_feed_allowed",
            field=models.BooleanField(default=True),
        ),
    ]
