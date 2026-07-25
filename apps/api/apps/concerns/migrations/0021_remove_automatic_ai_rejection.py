from django.db import migrations, models


def replace_automatic_rejection(apps, schema_editor):
    Configuration = apps.get_model("concerns", "ConcernClassificationConfiguration")
    Configuration.objects.filter(mismatch_action="reject").update(mismatch_action="manual_review")


class Migration(migrations.Migration):

    dependencies = [("concerns", "0020_concern_media_reviewed_redactions")]

    operations = [
        migrations.RunPython(replace_automatic_rejection, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="concernclassificationconfiguration",
            name="mismatch_action",
            field=models.CharField(
                choices=[
                    ("manual_review", "Flag for official review"),
                    ("request_resubmission", "Request resubmission"),
                ],
                default="manual_review",
                max_length=32,
            ),
        ),
    ]
