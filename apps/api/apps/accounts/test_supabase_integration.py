import base64
import hashlib
import hmac
import json
import time
import uuid
from unittest.mock import patch

import jwt
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient, APIRequestFactory

from .supabase_auth import SupabaseJWTAuthentication


HOOK_KEY = b"test-hook-key-that-is-long-enough"
HOOK_SECRET = "v1,whsec_" + base64.b64encode(HOOK_KEY).decode()


@override_settings(SUPABASE_AUTH_HOOK_SECRET=HOOK_SECRET)
class SupabaseSmsHookTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _post(self, payload, *, timestamp=None, signature_key=HOOK_KEY):
        body = json.dumps(payload, separators=(",", ":")).encode()
        hook_id = "msg_test"
        timestamp = str(timestamp or int(time.time()))
        signed = f"{hook_id}.{timestamp}.".encode() + body
        signature = base64.b64encode(hmac.new(signature_key, signed, hashlib.sha256).digest()).decode()
        return self.client.post(
            "/api/auth/hooks/supabase/send-sms/",
            data=body,
            content_type="application/json",
            HTTP_WEBHOOK_ID=hook_id,
            HTTP_WEBHOOK_TIMESTAMP=timestamp,
            HTTP_WEBHOOK_SIGNATURE=f"v1,{signature}",
        )

    @patch("apps.accounts.supabase_hooks.send_ephemeral_sms")
    def test_valid_hook_sends_without_persisting_otp(self, send):
        response = self._post({"user": {"phone": "+639171234567"}, "sms": {"otp": "482731"}})
        self.assertEqual(response.status_code, 200)
        send.assert_called_once()

    def test_rejects_bad_signature(self):
        response = self._post(
            {"user": {"phone": "+639171234567"}, "sms": {"otp": "482731"}},
            signature_key=b"wrong-key",
        )
        self.assertEqual(response.status_code, 401)

    def test_rejects_stale_signature(self):
        response = self._post(
            {"user": {"phone": "+639171234567"}, "sms": {"otp": "482731"}},
            timestamp=int(time.time()) - 301,
        )
        self.assertEqual(response.status_code, 401)


@override_settings(
    SUPABASE_URL="https://project.supabase.co",
    SUPABASE_JWT_AUDIENCE="authenticated",
    SUPABASE_JWT_SECRET="test-jwt-secret-that-is-at-least-32-bytes",
    SUPABASE_AUTO_LINK_USERS=False,
)
class SupabaseAuthenticationTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.subject = uuid.uuid4()
        self.user = get_user_model().objects.create_user(
            email="linked@example.invalid",
            password="unused",
            supabase_user_id=self.subject,
            is_active=True,
        )

    def _token(self, subject=None):
        now = int(time.time())
        return jwt.encode(
            {
                "sub": str(subject or self.subject),
                "aud": "authenticated",
                "iss": "https://project.supabase.co/auth/v1",
                "iat": now,
                "exp": now + 300,
                "email": self.user.email,
            },
            "test-jwt-secret-that-is-at-least-32-bytes",
            algorithm="HS256",
        )

    def test_maps_valid_token_to_django_user(self):
        request = self.factory.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Bearer {self._token()}")
        user, claims = SupabaseJWTAuthentication().authenticate(request)
        self.assertEqual(user, self.user)
        self.assertEqual(claims["sub"], str(self.subject))

    def test_rejects_unlinked_subject(self):
        request = self.factory.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Bearer {self._token(uuid.uuid4())}")
        with self.assertRaises(AuthenticationFailed):
            SupabaseJWTAuthentication().authenticate(request)
