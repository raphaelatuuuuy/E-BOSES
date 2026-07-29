from django.db import migrations, models

import apps.accounts.storage


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0022_emergencycategory_dynamic_types"),
    ]

    operations = [
        migrations.AddField(
            model_name="emergencycategory",
            name="icon_image",
            field=models.FileField(blank=True, storage=apps.accounts.storage.PublicMediaStorage(), upload_to="emergency-category-icons/"),
        ),
    ]
