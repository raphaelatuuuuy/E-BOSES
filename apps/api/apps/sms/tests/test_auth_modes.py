"""Which credential is actually required, in each deployment shape."""

import hashlib
import hmac
import json
import time

from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.sms.models import InboundSmsMessage

SIGNING_KEY = "eboses"
TOKEN = "some-shared-token"
TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

ENVELOPE = {
    "event": "sms:received",
    "payload": {"message": "GUIDE", "phoneNumber": "+639451230777", "id": "m1"},
}


@override_settings(
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
)
class WebhookAuthModeTests(APITestCase):
    url = "/api/sms/inbound/"

    def signed(self, key=SIGNING_KEY, timestamp=None):
        timestamp = timestamp or str(int(time.time()))
        raw = json.dumps(ENVELOPE)
        signature = hmac.new(
            key.encode(), f"{raw}{timestamp}".encode(), hashlib.sha256
        ).hexdigest()
        return self.client.post(
            self.url,
            data=raw,
            content_type="application/json",
            HTTP_X_SIGNATURE=signature,
            HTTP_X_TIMESTAMP=timestamp,
        )

    def with_token(self, token=TOKEN):
        return self.client.post(
            self.url, ENVELOPE, format="json", HTTP_X_SMS_WEBHOOK_TOKEN=token
        )

    # -- signature only: the android-sms-gateway production shape ---------

    @override_settings(SMS_WEBHOOK_SIGNING_KEY=SIGNING_KEY, SMS_INBOUND_WEBHOOK_TOKEN="", SMS_EMERGENCY_WEBHOOK_TOKEN="")
    def test_signing_key_alone_is_enough(self):
        self.assertEqual(self.signed().status_code, status.HTTP_200_OK)
        self.assertEqual(InboundSmsMessage.objects.count(), 1)

    @override_settings(SMS_WEBHOOK_SIGNING_KEY=SIGNING_KEY, SMS_INBOUND_WEBHOOK_TOKEN="", SMS_EMERGENCY_WEBHOOK_TOKEN="")
    def test_with_no_token_configured_an_unsigned_call_is_refused(self):
        response = self.client.post(self.url, ENVELOPE, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # -- token only: SMS Forwarder, curl, the test script ----------------

    @override_settings(SMS_WEBHOOK_SIGNING_KEY="", SMS_INBOUND_WEBHOOK_TOKEN=TOKEN)
    def test_token_alone_is_enough(self):
        self.assertEqual(self.with_token().status_code, status.HTTP_200_OK)

    @override_settings(SMS_WEBHOOK_SIGNING_KEY="", SMS_INBOUND_WEBHOOK_TOKEN=TOKEN)
    def test_a_wrong_token_is_refused(self):
        self.assertEqual(self.with_token("nope").status_code, status.HTTP_403_FORBIDDEN)

    # -- both configured: phone signs, local tooling uses the token ------

    @override_settings(SMS_WEBHOOK_SIGNING_KEY=SIGNING_KEY, SMS_INBOUND_WEBHOOK_TOKEN=TOKEN)
    def test_either_credential_works_when_both_are_set(self):
        self.assertEqual(self.signed().status_code, status.HTTP_200_OK)
        self.assertEqual(self.with_token().status_code, status.HTTP_200_OK)

    # -- neither: fail closed --------------------------------------------

    @override_settings(SMS_WEBHOOK_SIGNING_KEY="", SMS_INBOUND_WEBHOOK_TOKEN="", SMS_EMERGENCY_WEBHOOK_TOKEN="")
    def test_with_nothing_configured_everything_is_refused(self):
        self.assertEqual(self.signed().status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.with_token().status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.post(self.url, ENVELOPE, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(InboundSmsMessage.objects.count(), 0)

    @override_settings(SMS_WEBHOOK_SIGNING_KEY=SIGNING_KEY, SMS_INBOUND_WEBHOOK_TOKEN="")
    def test_a_stale_signature_is_refused(self):
        self.assertEqual(self.signed(timestamp="1000000000").status_code, status.HTTP_403_FORBIDDEN)
