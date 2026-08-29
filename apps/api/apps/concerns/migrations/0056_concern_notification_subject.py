from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0055_concernaiassessment_severity_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="concern",
            name="notification_subject",
            field=models.CharField(blank=True, editable=False, max_length=80),
        ),
    ]
