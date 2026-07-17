from django.db import migrations, models

import apps.accounts.storage


class Migration(migrations.Migration):
    dependencies = [
        ("emergencies", "0007_emergency_delivery_state"),
    ]

    operations = [
        migrations.AddField(
            model_name="emergencymedia",
            name="preview_file",
            field=models.FileField(
                blank=True,
                storage=apps.accounts.storage.PublicMediaStorage(),
                upload_to="previews/emergency-media/%Y/%m/",
            ),
        ),
    ]
