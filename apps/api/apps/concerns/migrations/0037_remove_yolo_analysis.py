"""Drop YOLO object detection from the concern pipeline.

Gemma now reads the photo directly, so there is no detector class vocabulary to
filter (`supported_classes`), no label→category table for officials to maintain
(`label_mappings`), no detector to configure (`image_provider`, `image_model`,
`image_confidence_threshold`) and no per-image damage score (`yolo_confidence`).

`image_objects` is renamed rather than dropped: the column keeps carrying "what
was seen in the photo", but the contents change from COCO class rows to the
plain-language object names Gemma reports.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0036_concern_report_fingerprint_and_more"),
    ]

    operations = [
        migrations.RenameField(
            model_name="concernaiassessment",
            old_name="image_objects",
            new_name="detected_objects",
        ),
        migrations.RemoveField(
            model_name="concernaiassessment",
            name="yolo_confidence",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="image_provider",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="image_model",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="image_confidence_threshold",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="label_mappings",
        ),
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="supported_classes",
        ),
        migrations.AlterField(
            model_name="concernaiassessment",
            name="detected_objects",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
