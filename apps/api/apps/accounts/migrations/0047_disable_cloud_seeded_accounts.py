from django.conf import settings
from django.db import migrations


DEV_EMAILS = (
    "official@eboses.test",
    "responder@eboses.test",
    "resident@eboses.test",
)


def disable_cloud_seeded_accounts(apps, schema_editor):
    if getattr(settings, "DATABASE_TARGET", "local") != "supabase":
        return
    User = apps.get_model("accounts", "User")
    User.objects.filter(email__in=DEV_EMAILS).update(
        is_active=False,
        is_staff=False,
        is_superuser=False,
        is_on_duty=False,
        password="!",
    )


class Migration(migrations.Migration):
    dependencies = [("accounts", "0046_user_supabase_user_id")]

    operations = [
        migrations.RunPython(disable_cloud_seeded_accounts, migrations.RunPython.noop),
    ]
