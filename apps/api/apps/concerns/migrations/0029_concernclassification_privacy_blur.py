from django.db import migrations, models


def seed_privacy_blur_settings(apps, schema_editor):
    Config = apps.get_model("concerns", "ConcernClassificationConfiguration")
    config = Config.objects.filter(pk=1).first()
    if not config:
        return
    updates = {
        "privacy_blur_enabled": True,
        "privacy_blur_faces": True,
        "privacy_blur_profile_faces": True,
        "privacy_blur_license_plates": False,
        "privacy_blur_strength": 14,
        "privacy_blur_padding": 0.15,
        "privacy_blur_fallback": "blur_full_image",
    }
    changed = []
    for field, value in updates.items():
        if getattr(config, field, None) != value:
            setattr(config, field, value)
            changed.append(field)
    if changed:
        config.save(update_fields=changed)


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0028_seed_concern_categories"),
    ]

    operations = [
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_faces",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_profile_faces",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_license_plates",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_strength",
            field=models.PositiveSmallIntegerField(default=14),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_padding",
            field=models.FloatField(default=0.15),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_fallback",
            field=models.CharField(default="blur_full_image", max_length=24),
        ),
        migrations.RunPython(seed_privacy_blur_settings, migrations.RunPython.noop),
    ]
