from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0029_concernclassification_privacy_blur"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_enabled",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_faces",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_profile_faces",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_license_plates",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_strength",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_padding",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="privacy_blur_fallback",
        ),
    ]
