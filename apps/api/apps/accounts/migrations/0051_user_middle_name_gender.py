from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0050_clear_legacy_service_health")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="middle_name",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="user",
            name="gender",
            field=models.CharField(
                blank=True,
                choices=[
                    ("male", "Male"),
                    ("female", "Female"),
                    ("prefer_not_to_say", "Prefer not to say"),
                ],
                max_length=20,
            ),
        ),
    ]
