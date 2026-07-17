from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("concerns", "0010_concern_public_lifecycle")]

    operations = [
        migrations.AlterField(
            model_name="concern",
            name="validation_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("accepted", "Accepted"),
                    ("rejected", "Rejected"),
                ],
                default="pending",
                max_length=16,
            ),
        ),
    ]
