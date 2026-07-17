from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0008_emergencymedia_preview_file")]

    operations = [
        migrations.AlterField(
            model_name="emergencyresponderassignment",
            name="status",
            field=models.CharField(
                choices=[
                    ("assigned", "Assigned"),
                    ("acknowledged", "Acknowledged"),
                    ("en_route", "En Route"),
                    ("arrived", "Arrived"),
                    ("resolved", "Resolved"),
                    ("escalated", "Escalated"),
                    ("cancelled", "Cancelled"),
                ],
                default="assigned",
                max_length=32,
            ),
        ),
    ]
