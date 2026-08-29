from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("sms", "0004_outboundsmsmessage_provider_message_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="outboundsmsmessage",
            name="delivered_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="outboundsmsmessage",
            name="status",
            field=models.CharField(
                choices=[
                    ("queued", "Queued"),
                    ("sending", "Sending"),
                    ("sent", "Sent"),
                    ("delivered", "Delivered"),
                    ("failed", "Failed"),
                    ("skipped", "Skipped (gateway disabled)"),
                ],
                default="queued",
                max_length=16,
            ),
        ),
    ]
