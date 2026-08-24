from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0059_bind_community_resolution_email_challenge")]
    operations = [
        migrations.AddField(
            model_name="residentsettings",
            name="location_sharing_enabled",
            field=models.BooleanField(default=False),
        ),
    ]
