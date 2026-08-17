from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("emergencies", "0034_emergencyalert_ai_assist_emergencyalert_ip_asn_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="emergencyalert",
            name="type",
            field=models.CharField(
                choices=[
                    ("medical", "Medical"),
                    ("fire", "Fire"),
                    ("crime", "Crime"),
                    ("disaster", "Disaster"),
                    ("child_protection", "Child Protection"),
                    ("domestic_violence", "Domestic Violence"),
                ],
                max_length=32,
            ),
        ),
    ]
