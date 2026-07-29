from django.db import migrations


def clear_other_responder_unit(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(responder_unit="other").update(responder_unit="")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0024_remove_other_choices"),
    ]

    operations = [
        migrations.RunPython(clear_other_responder_unit, migrations.RunPython.noop),
    ]
