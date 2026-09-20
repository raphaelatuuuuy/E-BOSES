import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("sms", "0005_outboundsmsmessage_delivered_at"),
        ("emergencies", "0053_chat_phone_constraints"),
    ]

    operations = [
        migrations.AddField(
            model_name="outboundsmsmessage",
            name="chat_message",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="outbound_sms_messages",
                to="emergencies.emergencychatmessage",
            ),
        ),
    ]
