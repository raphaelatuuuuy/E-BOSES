from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0034_default_ollama_text_classifier"),
    ]

    operations = [
        migrations.AlterField(
            model_name="concern",
            name="category",
            field=models.CharField(
                choices=[
                    ("infrastructure", "Infrastructure"),
                    ("environment", "Environment"),
                    ("public_safety", "Public Safety"),
                    ("vehicle", "Vehicle"),
                    ("others", "Others"),
                ],
                default="others",
                max_length=32,
            ),
        ),
    ]
