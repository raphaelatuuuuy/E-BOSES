from django.db import migrations
import random


def backfill_gender_avatar(apps, schema_editor):
    ResidentProfile = apps.get_model("accounts", "ResidentProfile")
    from datetime import date

    profiles = list(ResidentProfile.objects.filter(gender=""))
    if not profiles:
        return

    choices = ["male", "female"]
    for p in profiles:
        p.gender = random.choice(choices)
        if p.date_of_birth:
            age = date.today().year - p.date_of_birth.year
            bucket = "senior" if age >= 55 else "middleaged" if age >= 30 else "young"
        else:
            bucket = "young"
        icon = "man" if p.gender == "male" else "woman"
        p.avatar = f"{bucket}-{icon}"

    ResidentProfile.objects.bulk_update(profiles, ["gender", "avatar"])


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0008_residentprofile_avatar_residentprofile_gender"),
    ]
    operations = [
        migrations.RunPython(backfill_gender_avatar, migrations.RunPython.noop),
    ]
