from django.conf import settings
from django.db import migrations


def complete_stale_exports(apps, schema_editor):
    """Close data exports left open before self-service completed them.

    Exports have finished themselves since SELF_SERVICE_DATA_EXPORT landed, but
    rows created before that stayed SUBMITTED forever. No official screen can
    finish one, so they sat on the Configuration card as work that could never
    be cleared.
    """
    if not getattr(settings, "SELF_SERVICE_DATA_EXPORT", True):
        return
    AccountRequest = apps.get_model("accounts", "AccountRequest")
    AccountRequest.objects.filter(type="data_export", status__in=["submitted", "reviewed"]).update(
        status="completed",
        staff_note="Completed automatically: resident self-service export.",
    )


class Migration(migrations.Migration):
    dependencies = [("accounts", "0042_servicehealthday")]

    operations = [migrations.RunPython(complete_stale_exports, migrations.RunPython.noop)]
