from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0031_concerncategory_custom_icon_label_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="supported_classes",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
