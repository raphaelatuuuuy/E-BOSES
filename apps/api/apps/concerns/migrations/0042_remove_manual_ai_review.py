from django.db import migrations, models


def replace_review_settings(apps, schema_editor):
    Configuration = apps.get_model("concerns", "ConcernClassificationConfiguration")
    Configuration.objects.filter(mismatch_action="manual_review").update(mismatch_action="auto_correct")
    Configuration.objects.filter(report_duplicate_action="official_review").update(report_duplicate_action="warn")


class Migration(migrations.Migration):
    dependencies = [("concerns", "0041_systembanner")]

    operations = [
        migrations.RunPython(replace_review_settings, migrations.RunPython.noop),
        migrations.RemoveField(model_name="concernaiassessment", name="official_decision"),
        migrations.RemoveField(model_name="concernaiassessment", name="official_reason"),
        migrations.RemoveField(model_name="concernaiassessment", name="official_reviewed_at"),
        migrations.RemoveField(model_name="concernaiassessment", name="official_reviewer"),
        migrations.RemoveField(model_name="concernclassificationconfiguration", name="notify_reviewer"),
        migrations.AlterField(
            model_name="concernclassificationconfiguration",
            name="mismatch_action",
            field=models.CharField(
                choices=[
                    ("auto_correct", "Use detected category"),
                    ("reject", "Reject automatically"),
                    ("request_resubmission", "Request resubmission"),
                ],
                default="auto_correct",
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="concernclassificationconfiguration",
            name="report_duplicate_action",
            field=models.CharField(
                choices=[("warn", "Warn resident"), ("block", "Block submission")],
                default="warn",
                max_length=24,
            ),
        ),
    ]
