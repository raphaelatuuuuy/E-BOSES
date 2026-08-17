import uuid
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .supabase_admin import SupabaseProvisioningError, provision_supabase_user


@override_settings(
    SUPABASE_URL="https://project.supabase.co",
    SUPABASE_SECRET_KEY="sb_secret_test",
    SUPABASE_PUBLISHABLE_KEY="sb_publishable_test",
)
class SupabaseProvisioningTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="new@example.invalid", phone_number="+639171234567", password="StrongPass123!"
        )

    @patch("apps.accounts.supabase_admin.httpx.post")
    def test_new_user_is_mapped(self, post):
        subject = uuid.uuid4()
        response = Mock(status_code=201)
        response.json.return_value = {"id": str(subject)}
        post.return_value = response
        self.assertEqual(provision_supabase_user(self.user, "StrongPass123!"), subject)
        self.user.refresh_from_db()
        self.assertEqual(self.user.supabase_user_id, subject)

    @patch("apps.accounts.supabase_admin.httpx.post")
    def test_existing_user_must_accept_same_password(self, post):
        conflict = Mock(status_code=422)
        conflict.json.return_value = {}
        sign_in = Mock(status_code=400)
        sign_in.json.return_value = {}
        post.side_effect = [conflict, sign_in]
        with self.assertRaises(SupabaseProvisioningError):
            provision_supabase_user(self.user, "StrongPass123!")
        self.user.refresh_from_db()
        self.assertIsNone(self.user.supabase_user_id)
