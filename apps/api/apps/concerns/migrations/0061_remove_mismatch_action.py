from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("concerns", "0060_public_guest_concerns"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="concernclassificationconfiguration",
            name="mismatch_action",
        ),
    ]
