from django.db import migrations

from apps.concerns.models import DEFAULT_SUPPORTED_YOLO_CLASSES


def forwards(apps, schema_editor):
    Config = apps.get_model("concerns", "ConcernClassificationConfiguration")
    Config.objects.filter(supported_classes=[]).update(supported_classes=DEFAULT_SUPPORTED_YOLO_CLASSES)


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0032_concernclassification_supported_classes"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
