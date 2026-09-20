from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.test_helpers import active_test_community
from apps.concerns.units import sync_responder_designation
from apps.emergencies.models import (
    EmergencyAlert,
    EmergencyChatMessage,
    ResponderShift,
)
from apps.sms.models import InboundSmsMessage, OutboundSmsMessage


TOKEN = "test-inbound-token"
TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
WIZARD_MESSAGE = (
    "I need immediate help. This is a Fire emergency near Champaca Street, "
    "Marikina Heights. 1 person affected, fire is still spreading, someone is injured. "
    "Please send assistance.\nLOC:14.6507000,121.1133000"
)


@override_settings(
    SMS_INBOUND_WEBHOOK_TOKEN=TOKEN,
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
    REVERSE_GEOCODE_ENABLED=False,
)
class SmsInboundTests(APITestCase):
    url = "/api/sms/inbound/"

    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="sms-resident@example.com",
            phone_number="+639451234821",
            password="pass",
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Maria",
            last_name="Dela Cruz",
            date_of_birth="1995-01-01",
            address="Blk 5 Lot 2",
            barangay="Marikina Heights",
        )
        self.responder = User.objects.create_user(
            email="sms-responder@example.com",
            phone_number="+639450000002",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=User.Status.VERIFIED,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=self.responder,
            first_name="Juan",
            last_name="Responder",
            date_of_birth="1990-01-01",
            address="Base",
            barangay="Marikina Heights",
        )
        community = active_test_community()
        ResidentProfile.objects.filter(user__in=[self.resident, self.responder]).update(
            community=community,
            barangay=community.name,
        )
        sync_responder_designation(self.responder)
        ResponderShift.objects.create(
            responder=self.responder,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=10),
        )

    def post(self, body, sender="+639451234821", token=TOKEN, **extra):
        return self.client.post(
            self.url,
            {"from": sender, "msg": body, **extra},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=token,
        )

    def test_bad_token_is_rejected(self):
        response = self.post(WIZARD_MESSAGE, token="wrong")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(InboundSmsMessage.objects.exists())

    def test_offline_wizard_creates_and_routes_one_emergency(self):
        response = self.post(WIZARD_MESSAGE, id="wizard-1")
        self.assertEqual(response.status_code, 201)
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(
            alert.triage,
            {"people_affected": "one", "detail": "spreading", "injuries": "yes"},
        )
        self.assertTrue(alert.assignments.filter(responder=self.responder).exists())
        self.assertTrue(alert.status_events.filter(event_key="responder_assigned").exists())

    def test_gateway_retry_is_idempotent(self):
        self.post(WIZARD_MESSAGE, id="same-message")
        outbound_count = OutboundSmsMessage.objects.count()
        response = self.post(WIZARD_MESSAGE, id="same-message")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(EmergencyAlert.objects.count(), 1)
        self.assertEqual(OutboundSmsMessage.objects.count(), outbound_count)

    def test_second_active_emergency_sends_only_the_ongoing_warning(self):
        self.post(WIZARD_MESSAGE, id="first-message")
        outbound_count = OutboundSmsMessage.objects.count()
        chat_count = EmergencyChatMessage.objects.count()
        second_body = WIZARD_MESSAGE.replace("Fire", "Flood")
        response = self.post(second_body, id="second-message")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(EmergencyAlert.objects.count(), 1)
        # Exactly one extra message: the duplicate warning.
        new_messages = list(OutboundSmsMessage.objects.order_by("id")[outbound_count:])
        self.assertEqual(len(new_messages), 1)
        self.assertEqual(new_messages[0].body, "You already have an ongoing SOS emergency.")
        # The repeated SOS is never shown in the active chat.
        self.assertEqual(EmergencyChatMessage.objects.count(), chat_count)
        self.assertFalse(EmergencyChatMessage.objects.filter(body=second_body).exists())

    def test_retired_commands_and_unknown_text_send_no_reply(self):
        for index, body in enumerate(("STATUS", "SAFE", "CANCEL", "GUIDE", "ACCEPT", "DECLINE", "HELPP FIER")):
            self.post(body, id=f"retired-{index}")
        self.assertFalse(OutboundSmsMessage.objects.exists())

    def test_unregistered_sender_still_creates_an_emergency(self):
        response = self.post(WIZARD_MESSAGE, sender="+639998887777", id="unregistered")
        self.assertEqual(response.status_code, 201)
        alert = EmergencyAlert.objects.get()
        self.assertEqual(alert.reporter_contact_number, "+639998887777")
        self.assertTrue(alert.assignments.exists())
