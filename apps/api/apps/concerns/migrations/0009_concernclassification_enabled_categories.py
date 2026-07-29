from django.db import migrations, models


def seed_enabled_categories(apps, schema_editor):
    Config = apps.get_model("concerns", "ConcernClassificationConfiguration")
    Config.objects.filter(enabled_categories=[]).update(
        enabled_categories=["infrastructure", "environment", "public_safety", "vehicle", "others"]
    )


class Migration(migrations.Migration):
    dependencies = [("concerns", "0008_concernclassificationconfiguration")]

    operations = [
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="enabled_categories",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(seed_enabled_categories, migrations.RunPython.noop),
    ]
