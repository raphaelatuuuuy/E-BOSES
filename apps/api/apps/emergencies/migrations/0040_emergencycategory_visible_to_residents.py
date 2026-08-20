from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("emergencies", "0039_mapdispatchpolicy_acceptance_geometry")]

    operations = [
        migrations.AddField(
            model_name="emergencycategory",
            name="visible_to_residents",
            field=models.BooleanField(default=True),
        ),
    ]
