from django.db import migrations


def clear_legacy_health(apps, schema_editor):
    ServiceHealthDay = apps.get_model("accounts", "ServiceHealthDay")
    ServiceHealthDay.objects.all().update(
        severity=0,
        issues=[],
        checks_total=0,
        operational_checks=0,
        degraded_checks=0,
        down_checks=0,
        not_configured_checks=0,
        unknown_checks=0,
        latency_total_ms=0,
        latency_max_ms=0,
        last_sample_bucket=None,
    )
    apps.get_model("accounts", "ServiceHealthState").objects.all().delete()
    apps.get_model("accounts", "ServiceIncident").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0049_operational_service_health")]

    operations = [migrations.RunPython(clear_legacy_health, migrations.RunPython.noop)]
