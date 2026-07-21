from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0014_emergencyalert_emerg_alert_status_brgy_and_more")]

    operations = [
        migrations.AddField(
            model_name="witnessnotification",
            name="in_app_delivered_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="witnessnotification",
            name="push_status",
            field=models.CharField(
                choices=[
                    ("not_configured", "Not configured"),
                    ("not_subscribed", "Not subscribed"),
                    ("disabled", "Disabled by resident"),
                    ("delivered", "Delivered"),
                    ("partial", "Partially delivered"),
                    ("failed", "Failed"),
                ],
                default="not_configured",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="witnessnotification",
            name="push_attempted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="witnessnotification",
            name="push_delivered_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="witnessnotification",
            name="push_failure_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunSQL(
            sql="UPDATE emergencies_witnessnotification SET in_app_delivered_at = sent_at WHERE in_app_delivered_at IS NULL",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
