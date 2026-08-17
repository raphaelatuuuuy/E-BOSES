from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase


class SupabaseUserSyncCommandTests(TestCase):
    def setUp(self):
        get_user_model().objects.create_user(email="resident@example.invalid", password="unused")

    @patch("apps.accounts.management.commands.sync_supabase_auth_users.httpx.post")
    def test_default_is_dry_run(self, post):
        output = StringIO()
        call_command("sync_supabase_auth_users", stdout=output)
        self.assertIn("Dry run only", output.getvalue())
        post.assert_not_called()

    def test_apply_requires_explicit_email_confirmation(self):
        with self.assertRaises(CommandError):
            call_command("sync_supabase_auth_users", "--apply")
