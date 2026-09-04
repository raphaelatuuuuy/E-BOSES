from django.db import migrations, models
import django.db.models.deletion


def archive_seeded_concepcion_policy(apps, schema_editor):
    """Remove the old bootstrap copy without touching official policies."""
    Community = apps.get_model("emergencies", "Community")
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    community = Community.objects.filter(code="concepcion-dos").first()
    if community is None:
        return
    Configuration.objects.filter(
        community=community,
        scope="residence_proof",
        status="published",
        version=1,
        created_by__isnull=True,
        published_by__isnull=True,
        notes="System default proof-of-residency OCR policy.",
    ).update(status="archived")


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0061_auditlog_community"),
    ]

    operations = [
        migrations.AlterField(
            model_name="communityresolution",
            name="configuration",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name="signup_resolutions",
                to="accounts.ocrconfigurationversion",
            ),
        ),
        migrations.RunPython(archive_seeded_concepcion_policy, migrations.RunPython.noop),
    ]
