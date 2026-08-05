"""android-sms-gateway (capcom6) support: payload envelope, HMAC, Basic auth."""

import hashlib
import hmac
import json

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.emergencies.models import EmergencyAlert
from apps.sms.gateway import AndroidSmsGatewayDriver
from apps.sms.models import InboundSmsMessage

SIGNING_KEY = "eboses"
TOKEN = "test-inbound-token"
RESIDENT = "+639451230777"
TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


def webhook_body(message, phone=RESIDENT, event="sms:received", message_id="msg-1"):
    """The envelope android-sms-gateway actually posts."""
    return {
        "deviceId": "000000001501a86e0000019fc0f11fad",
        "event": event,
        "id": "webhook-delivery-1",
        "webhookId": "hook-1",
        "payload": {
            "id": message_id,
            "message": message,
            "phoneNumber": phone,
            "simNumber": 1,
            "receivedAt": "2026-08-02T13:31:00.000+08:00",
        },
    }


@override_settings(
    OUTBOUND_SMS_DRIVER="android_sms_gateway",
    OUTBOUND_SMS_URL="http://10.118.12.5:8080/message",
    OUTBOUND_SMS_USERNAME="sms",
    OUTBOUND_SMS_PASSWORD="oJkay91V",
)
class AndroidGatewayDriverTests(SimpleTestCase):
    def test_send_payload_uses_a_phone_numbers_array(self):
        payload = AndroidSmsGatewayDriver().build_payload("+639171234821", "hello")
        self.assertEqual(payload, {"message": "hello", "phoneNumbers": ["+639171234821"]})

    def test_basic_auth_header_is_built_from_the_app_credentials(self):
        headers = AndroidSmsGatewayDriver()._headers()
        # base64("sms:oJkay91V")
        self.assertEqual(headers["Authorization"], "Basic c21zOm9Ka2F5OTFW")

    @override_settings(OUTBOUND_SMS_AUTH_HEADER="Authorization", OUTBOUND_SMS_SECRET="Bearer custom")
    def test_an_explicit_auth_header_wins_over_basic(self):
        headers = AndroidSmsGatewayDriver()._headers()
        self.assertEqual(headers["Authorization"], "Bearer custom")


@override_settings(
    SMS_INBOUND_WEBHOOK_TOKEN=TOKEN,
    SMS_WEBHOOK_SIGNING_KEY=SIGNING_KEY,
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
)
class AndroidGatewayWebhookTests(APITestCase):
    url = "/api/sms/inbound/"

    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="asg-resident@example.com",
            phone_number=RESIDENT,
            password="pass",
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Maria",
            last_name="Dela Cruz",
            date_of_birth="1995-01-01",
            address="Blk 5",
            barangay="Marikina Heights",
        )

    def post_signed(self, payload, *, key=SIGNING_KEY, timestamp="1767330660"):
        raw = json.dumps(payload)
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

    def post_token(self, payload):
        return self.client.post(self.url, payload, format="json", HTTP_X_SMS_WEBHOOK_TOKEN=TOKEN)

    # -- payload shape ---------------------------------------------------

    def test_the_nested_payload_envelope_is_unwrapped(self):
        response = self.post_token(webhook_body("GUIDE"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        inbound = InboundSmsMessage.objects.get()
        self.assertEqual(inbound.body, "GUIDE")
        self.assertEqual(inbound.sender_number, RESIDENT)
        self.assertEqual(inbound.matched_user, self.resident)

    def test_an_emergency_arrives_through_the_envelope(self):
        response = self.post_token(webhook_body(
            "I need immediate help. This is a Fire emergency near Champaca Street, "
            "Marikina Heights. Please send assistance.\nLOC:14.6507,121.1133"
        ))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.type, "fire")
        self.assertEqual(alert.reported_area, "Champaca Street, Marikina Heights")

    def test_the_message_id_comes_from_the_payload_not_the_delivery(self):
        self.post_token(webhook_body("GUIDE", message_id="real-msg-99"))
        self.assertEqual(InboundSmsMessage.objects.get().gateway_message_id, "real-msg-99")

    def test_receivedat_is_parsed_as_the_gateway_timestamp(self):
        self.post_token(webhook_body("GUIDE"))
        self.assertIsNotNone(InboundSmsMessage.objects.get().gateway_received_at)

    # -- event filtering -------------------------------------------------

    def test_our_own_outgoing_messages_are_ignored(self):
        # Without this, every reply E-Boses sends would come straight back in.
        for event in ("sms:sent", "sms:delivered", "sms:failed", "system:ping"):
            with self.subTest(event=event):
                response = self.post_token(webhook_body("E-BOSES: help is on the way.", event=event))
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertTrue(response.data["ignored"])
        self.assertEqual(InboundSmsMessage.objects.count(), 0)
        self.assertEqual(EmergencyAlert.objects.count(), 0)

    # -- signature auth --------------------------------------------------

    def test_a_valid_hmac_signature_is_accepted_without_any_token(self):
        response = self.post_signed(webhook_body("GUIDE"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(InboundSmsMessage.objects.get().body, "GUIDE")

    def test_a_signature_made_with_the_wrong_key_is_refused(self):
        response = self.post_signed(webhook_body("GUIDE"), key="not-the-key")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(InboundSmsMessage.objects.count(), 0)

    def test_a_tampered_body_fails_verification(self):
        raw = json.dumps(webhook_body("GUIDE"))
        timestamp = "1767330660"
        signature = hmac.new(
            SIGNING_KEY.encode(), f"{raw}{timestamp}".encode(), hashlib.sha256
        ).hexdigest()
        tampered = raw.replace("GUIDE", "HELP FIRE")
        response = self.client.post(
            self.url,
            data=tampered,
            content_type="application/json",
            HTTP_X_SIGNATURE=signature,
            HTTP_X_TIMESTAMP=timestamp,
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(EmergencyAlert.objects.count(), 0)

    @override_settings(SMS_WEBHOOK_SIGNING_KEY="")
    def test_without_a_configured_key_a_signature_alone_is_not_enough(self):
        response = self.post_signed(webhook_body("GUIDE"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_token_path_still_works_alongside_signatures(self):
        self.assertEqual(self.post_token(webhook_body("GUIDE")).status_code, status.HTTP_200_OK)
