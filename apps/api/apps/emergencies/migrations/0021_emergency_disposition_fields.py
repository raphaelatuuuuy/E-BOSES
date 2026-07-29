from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0020_map_policy_emergency_sms"),
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
                    ("drug_related", "Drug-Related Incident"),
                    ("other", "Other"),
                ],
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="emergencyalert",
            name="status",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("routed", "Routed"),
                    ("acknowledged", "Acknowledged"),
                    ("en_route", "En Route"),
                    ("nearby", "Nearby"),
                    ("arrived", "Arrived"),
                    ("resolved", "Resolved"),
                    ("false_alarm", "False Alarm"),
                    ("invalid", "Invalid"),
                    ("cancelled", "Cancelled"),
                ],
                default="submitted",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="emergencyalert",
            name="resolution_report",
            field=models.TextField(blank=True),
        ),
        migrations.AlterField(
            model_name="emergencystatusevent",
            name="status",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("routed", "Routed"),
                    ("acknowledged", "Acknowledged"),
                    ("en_route", "En Route"),
                    ("nearby", "Nearby"),
                    ("arrived", "Arrived"),
                    ("resolved", "Resolved"),
                    ("false_alarm", "False Alarm"),
                    ("invalid", "Invalid"),
                    ("cancelled", "Cancelled"),
                ],
                max_length=32,
            ),
        ),
    ]
