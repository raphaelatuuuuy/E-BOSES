from django.db import migrations


def publish_guest_concerns(apps, schema_editor):
    Concern = apps.get_model("concerns", "Concern")
    Concern.objects.filter(is_anonymous=True, visibility="private").update(
        visibility="community"
    )


class Migration(migrations.Migration):
    dependencies = [
        ("concerns", "0059_publiccommentattachment"),
    ]

    operations = [
        migrations.RunPython(publish_guest_concerns, migrations.RunPython.noop),
    ]
