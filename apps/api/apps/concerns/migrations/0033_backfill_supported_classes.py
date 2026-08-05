from django.db import migrations


# Inlined deliberately. This used to import DEFAULT_SUPPORTED_YOLO_CLASSES from
# apps.concerns.models, which is a live import of current application code from
# a historical migration. The constant was deleted with YOLO in 0037, so the
# literal has to live here for `migrate` to still run from zero.
SUPPORTED_YOLO_CLASSES = [
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
    "bench",
    "parking meter",
    "traffic light",
    "knife",
    "dog",
    "cat",
    "handbag",
    "backpack",
    "suitcase",
]


def forwards(apps, schema_editor):
    Config = apps.get_model("concerns", "ConcernClassificationConfiguration")
    Config.objects.filter(supported_classes=[]).update(supported_classes=SUPPORTED_YOLO_CLASSES)


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0032_concernclassification_supported_classes"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
