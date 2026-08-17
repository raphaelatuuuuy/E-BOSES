"""Disable the development accounts created by the old seed migration.

Migration 0026 is already applied in some deployments, so it must not be
rewritten. This forward repair makes those known-password accounts unusable
outside local development while preserving the migration history.
"""

from django.conf import settings
from django.db import migrations


DEV_EMAILS = (
    "official@eboses.test",
    "responder@eboses.test",
    "resident@eboses.test",
)


def disable_seeded_accounts(apps, schema_editor):
    if getattr(settings, "IS_LOCAL_DEVELOPMENT", False) or getattr(settings, "IS_TEST_RUN", False):
        return

    User = apps.get_model("accounts", "User")
    User.objects.filter(email__in=DEV_EMAILS).update(
        is_active=False,
        is_staff=False,
        is_superuser=False,
        is_on_duty=False,
        password="!",
    )


def preserve_seeded_accounts(apps, schema_editor):
    # Never restore a known password during rollback.
    return


class Migration(migrations.Migration):
    dependencies = [("accounts", "0044_unblock_missing_proof_cases")]

    operations = [
        migrations.RunPython(disable_seeded_accounts, preserve_seeded_accounts),
    ]
