from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("emergencies", "0038_mark_home_barangay"),
    ]

    operations = [
        migrations.AddField(
            model_name="mapdispatchpolicy",
            name="acceptance_geometry",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
