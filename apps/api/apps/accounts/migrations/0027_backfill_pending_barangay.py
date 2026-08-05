from django.db import migrations


def clear_pending_barangay(apps, schema_editor):
    """
    Old ResidentProfile rows may carry the legacy "Pending" default in their
    `barangay` field (the current default is "Marikina Heights"). Update those
    rows so the responder-side UI never surfaces the placeholder to a dispatch.
    """
    ResidentProfile = apps.get_model("accounts", "ResidentProfile")
    ResidentProfile.objects.filter(barangay__iexact="Pending").update(
        barangay="Marikina Heights",
    )


def noop_reverse(apps, schema_editor):
    """No reverse — cannot restore "Pending" without losing information."""


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0026_seed_dev_accounts"),
    ]

    operations = [
        migrations.RunPython(clear_pending_barangay, noop_reverse),
    ]
