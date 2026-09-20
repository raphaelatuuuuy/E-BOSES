from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("sms", "0006_chat_message_link")]

    operations = [
        migrations.AlterField(
            model_name="inboundsmsmessage",
            name="outcome",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("emergency_created", "Emergency created"),
                    ("command_handled", "Command handled"),
                    ("unrecognised", "Unrecognised"),
                    ("duplicate", "Duplicate"),
                    ("chat_appended", "Chat appended"),
                    ("dropped_otp", "Dropped (OTP-shaped)"),
                    ("rejected", "Rejected"),
                    ("error", "Error"),
                ],
                default="pending",
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="outboundsmsmessage",
            name="purpose",
            field=models.CharField(
                choices=[
                    ("emergency", "Emergency"),
                    ("emergency_ack", "Emergency acknowledgement"),
                    ("dispatch", "Responder dispatch"),
                    ("command_reply", "Command reply"),
                    ("otp", "Registration OTP"),
                    ("official_alert", "Official alert"),
                    ("chat_update", "Chat update"),
                    ("system", "System"),
                ],
                default="system",
                max_length=32,
            ),
        ),
    ]
