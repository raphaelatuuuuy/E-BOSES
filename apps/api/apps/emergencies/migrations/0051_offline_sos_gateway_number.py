from django.db import migrations, models


SOS_NUMBER = "09640746068"


def align_sos_number(apps, schema_editor):
    MapDispatchPolicy = apps.get_model("emergencies", "MapDispatchPolicy")
    MapDispatchPolicy.objects.filter(community__status="active").update(
        emergency_sms_number=SOS_NUMBER
    )


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0050_emergencyresolutionevidence")]

    operations = [
        migrations.AlterField(
            model_name="mapdispatchpolicy",
            name="emergency_sms_number",
            field=models.CharField(blank=True, default=SOS_NUMBER, max_length=16),
        ),
        migrations.RunPython(align_sos_number, migrations.RunPython.noop),
    ]
