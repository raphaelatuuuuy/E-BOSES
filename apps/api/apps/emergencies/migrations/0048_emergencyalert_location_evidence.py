from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0047_backup_active_unit_constraint")]
    operations = [
        migrations.AddField(model_name="emergencyalert", name="canonical_street", field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name="emergencyalert", name="location_age_seconds", field=models.PositiveIntegerField(blank=True, null=True)),
        migrations.AddField(model_name="emergencyalert", name="location_evidence", field=models.JSONField(blank=True, default=dict)),
        migrations.AddField(model_name="emergencyalert", name="location_freshness", field=models.CharField(default="not_available", max_length=20)),
    ]
