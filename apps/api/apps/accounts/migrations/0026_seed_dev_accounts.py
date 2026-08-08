import sys
from datetime import date

from django.contrib.auth.hashers import make_password
from django.db import migrations


# DEV-ONLY test credentials. Never reuse these in staging or production.
DEFAULT_PASSWORD = "Boses123!"


SEED_ACCOUNTS = [
    {
        "email": "official@eboses.test",
        "password": DEFAULT_PASSWORD,
        "phone_number": "+639170000001",
        "role": "barangay_official",
        "status": "verified",
        "is_staff": True,
        "is_superuser": True,
        "is_onboarded": True,
        "profile": {
            "first_name": "Maria",
            "middle_name": "Luna",
            "last_name": "Santos",
            "date_of_birth": date(1980, 3, 15),
            "address": "Blk 12 Lot 5, Phase 1, Marikina Heights",
            "barangay": "Marikina Heights",
            "gender": "female",
        },
    },
    {
        "email": "responder@eboses.test",
        "password": DEFAULT_PASSWORD,
        "phone_number": "+639170000002",
        "role": "first_responder",
        "status": "verified",
        "is_onboarded": True,
        "responder_unit": "tanod",
        "is_on_duty": True,
        "profile": {
            "first_name": "Juan",
            "middle_name": "Reyes",
            "last_name": "Cruz",
            "date_of_birth": date(1995, 7, 20),
            "address": "18 Sumulong St, Marikina Heights",
            "barangay": "Marikina Heights",
            "gender": "male",
        },
    },
    {
        "email": "resident@eboses.test",
        "password": DEFAULT_PASSWORD,
        "phone_number": "+639170000003",
        "role": "resident",
        "status": "verified",
        "is_onboarded": True,
        "profile": {
            "first_name": "Angela",
            "middle_name": "Tan",
            "last_name": "Dela Cruz",
            "date_of_birth": date(1998, 11, 2),
            "address": "45 Gil Fernando Ave, Marikina Heights",
            "barangay": "Marikina Heights",
            "gender": "female",
        },
    },
]


def seed_dev_accounts(apps, schema_editor):
    # DEV-ONLY creds: a test run would inherit this on-duty responder and the
    # seeded officials, silently changing every dashboard/role count the suite
    # asserts. Skip when the suite builds its database.
    if "test" in sys.argv:
        return
    User = apps.get_model("accounts", "User")
    ResidentProfile = apps.get_model("accounts", "ResidentProfile")
    ResidentSettings = apps.get_model("accounts", "ResidentSettings")

    for account in SEED_ACCOUNTS:
        profile_data = account["profile"]
        user_fields = {key: value for key, value in account.items() if key in ("phone_number", "role", "status", "is_staff", "is_superuser", "is_onboarded", "responder_unit", "is_on_duty")}
        user_fields["password"] = make_password(account["password"])
        user, _ = User.objects.get_or_create(
            email=account["email"],
            defaults=user_fields,
        )
        ResidentProfile.objects.get_or_create(user=user, defaults=profile_data)
        ResidentSettings.objects.get_or_create(user=user)


def unseed_dev_accounts(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(
        email__in=[account["email"] for account in SEED_ACCOUNTS]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0025_clear_other_responder_unit"),
    ]

    operations = [
        migrations.RunPython(seed_dev_accounts, unseed_dev_accounts),
    ]
