from django.db import migrations


HOME_NAME = "Marikina Heights"
HOME_LOCALITY = "Marikina"


def mark_home(apps, schema_editor):
    MapGeometry = apps.get_model("emergencies", "MapGeometry")
    MapGeometry.objects.filter(kind="boundary", name=HOME_NAME).update(
        is_home=True, locality=HOME_LOCALITY
    )


def unmark_home(apps, schema_editor):
    MapGeometry = apps.get_model("emergencies", "MapGeometry")
    MapGeometry.objects.filter(kind="boundary", name=HOME_NAME).update(
        is_home=False, locality=""
    )


class Migration(migrations.Migration):
    dependencies = [
        ("emergencies", "0037_mapdispatchpolicy_covered_mapgeometry_is_home_and_more"),
    ]

    operations = [
        migrations.RunPython(mark_home, unmark_home),
    ]
