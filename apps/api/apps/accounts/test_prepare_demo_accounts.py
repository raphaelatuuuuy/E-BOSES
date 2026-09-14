from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase


class PrepareDemoAccountsTests(TestCase):
    def create_user(self, email, role, phone_number):
        User = get_user_model()
        return User.objects.create_user(
            email=email,
            phone_number=phone_number,
            password="old-password",
            role=role,
            status=User.Status.PENDING_OTP,
        )

    def test_preview_does_not_change_accounts(self):
        User = get_user_model()
        user = self.create_user("resident@example.com", User.Role.RESIDENT, "+639170000001")
        output = StringIO()

        call_command("prepare_demo_accounts", stdout=output)

        user.refresh_from_db()
        self.assertEqual(user.email, "resident@example.com")
        self.assertTrue(user.check_password("old-password"))
        self.assertIn("Preview only", output.getvalue())

    def test_apply_removes_only_explicit_placeholder_and_normalizes_cast(self):
        User = get_user_model()
        resident = self.create_user("resident@example.com", User.Role.RESIDENT, "+639170000001")
        responder = self.create_user("old-responder@example.com", User.Role.FIRST_RESPONDER, "+639170000002")
        official = self.create_user("old-official@example.com", User.Role.BARANGAY_OFFICIAL, "+639170000003")

        call_command(
            "prepare_demo_accounts",
            "--delete-unused",
            "--apply",
            stdout=StringIO(),
        )

        self.assertFalse(User.objects.filter(email="resident@example.com").exists())
        responder.refresh_from_db()
        official.refresh_from_db()

        self.assertEqual(responder.email, "resp1@demo.test")
        self.assertEqual(responder.responder_unit, User.ResponderUnit.TANOD)
        self.assertTrue(responder.is_on_duty)
        self.assertEqual(official.email, "o1@demo.test")
        self.assertTrue(official.is_staff)
        self.assertTrue(official.is_superuser)
        self.assertTrue(responder.check_password("Boses123!"))
        self.assertTrue(official.check_password("Boses123!"))
