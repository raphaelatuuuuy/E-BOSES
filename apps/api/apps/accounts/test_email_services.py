from unittest.mock import Mock, patch

import httpx
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .email_services import MESSAGES, send_account_email


@override_settings(
    ACCOUNT_EMAIL_PROVIDER="resend",
    RESEND_API_KEY="re_test_key",
    RESEND_API_URL="https://api.resend.test/emails",
    RESEND_FROM_EMAIL="no-reply@example.invalid",
    RESEND_FROM_NAME="E-Boses",
    RESEND_REPLY_TO="support@example.invalid",
)
class AccountEmailTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="resident@example.invalid", password="unused"
        )

    @patch("apps.accounts.email_services.httpx.post")
    def test_all_account_templates_are_deliverable(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        post.return_value = response
        for event in MESSAGES:
            with self.subTest(event=event):
                self.assertTrue(send_account_email(self.user, event))
        self.assertEqual(post.call_count, len(MESSAGES))

    @patch("apps.accounts.email_services.httpx.post")
    def test_provider_failure_does_not_break_account_action(self, post):
        post.side_effect = httpx.ConnectError("offline")
        self.assertFalse(send_account_email(self.user, "welcome"))

    @override_settings(ACCOUNT_EMAIL_PROVIDER="disabled")
    @patch("apps.accounts.email_services.httpx.post")
    def test_disabled_provider_never_contacts_resend(self, post):
        self.assertFalse(send_account_email(self.user, "welcome"))
        post.assert_not_called()
