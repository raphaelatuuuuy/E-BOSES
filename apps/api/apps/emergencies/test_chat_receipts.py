"""Emergency chat delivery receipts: watermarks, states, and who may send them.

Three facts the UI has to be able to prove:

* a message was *delivered* - a device holds it (the resident's or a responder's);
* a message was *read* - the thread was on screen;
* neither claim can regress, and a thread never claims "read" while one
  participant has not got there yet.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.test_helpers import active_test_community
from apps.concerns.units import sync_responder_designation
from apps.sms.models import OutboundSmsMessage

from .models import (
    EmergencyAlert,
    EmergencyChatMessage,
    EmergencyChatReadState,
    EmergencyResponderAssignment,
    ResponderShift,
)

TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
LIVE_NUMBER = "+639478000010"


@override_settings(
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
    REVERSE_GEOCODE_ENABLED=False,
)
class ChatReceiptTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.community = active_test_community()
        self.resident = self._user(
            "rc-live-resident@example.com", LIVE_NUMBER, "Andres", "Bonifacio"
        )
        self.responder = self._user(
            "chat-receipt-responder@example.com",
            "+639478000012",
            "Jose",
            "Garcia",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.BDRRMO,
            is_on_duty=True,
        )
        ResponderShift.objects.create(
            responder=self.responder,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=5),
        )
        sync_responder_designation(self.responder)
        self.alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="fire",
            note="Smoke on the second floor.",
            latitude="14.6507000",
            longitude="121.1133000",
            address="Champaca Street",
            reported_area="Champaca Street",
            barangay="Marikina Heights",
            community=self.community,
            status=EmergencyAlert.Status.ROUTED,
            reporter_contact_number=LIVE_NUMBER,
        )
        EmergencyResponderAssignment.objects.create(
            alert=self.alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            source=EmergencyResponderAssignment.Source.AUTO,
        )

    def _user(self, email, phone, first, last, **extra):
        User = get_user_model()
        user = User.objects.create_user(
            email=email,
            phone_number=phone,
            password="pass",
            status=User.Status.VERIFIED,
            **extra,
        )
        ResidentProfile.objects.create(
            user=user,
            first_name=first,
            last_name=last,
            date_of_birth="1990-01-01",
            address="Somewhere",
            barangay="Marikina Heights",
            community=self.community,
        )
        return user

    def message(self, sender, body="We are on our way."):
        return EmergencyChatMessage.objects.create(
            alert=self.alert, sender=sender, body=body
        )

    def receipt_url(self, alert_id=None):
        return f"/api/emergencies/{alert_id or self.alert.pk}/chat/receipt/"

    def chat_url(self):
        return f"/api/emergencies/{self.alert.pk}/chat/"

    def watermarks(self, user) -> EmergencyChatReadState:
        return EmergencyChatReadState.objects.get(alert=self.alert, user=user)

    # -- the endpoint ------------------------------------------------------

    def test_delivered_then_read_watermarks_only_move_forward(self):
        first = self.message(self.responder)
        second = self.message(self.responder, "Two minutes out.")
        self.client.force_authenticate(self.resident)

        delivered = self.client.post(
            self.receipt_url(), {"through": first.pk, "state": "delivered"}, format="json"
        )
        self.assertEqual(delivered.status_code, status.HTTP_200_OK)
        self.assertEqual(delivered.data["delivered_through"], first.pk)
        self.assertEqual(delivered.data["read_through"], 0)

        read = self.client.post(
            self.receipt_url(), {"through": second.pk, "state": "read"}, format="json"
        )
        self.assertEqual(read.data["read_through"], second.pk)
        # Reading a message implies the device had everything up to it.
        self.assertEqual(read.data["delivered_through"], second.pk)

        # An out-of-order receipt cannot un-tick anything.
        stale = self.client.post(
            self.receipt_url(), {"through": first.pk, "state": "delivered"}, format="json"
        )
        self.assertEqual(stale.data["read_through"], second.pk)
        self.assertEqual(stale.data["delivered_through"], second.pk)

    def test_non_participant_cannot_post_a_receipt(self):
        User = get_user_model()
        outsider = self._user(
            "chat-outsider@example.com", "+639478000013", "Out", "Sider"
        )
        self.client.force_authenticate(outsider)
        message = self.message(self.responder)

        response = self.client.post(
            self.receipt_url(), {"through": message.pk, "state": "read"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(EmergencyChatReadState.objects.exists())

    def test_invalid_receipts_are_rejected(self):
        self.client.force_authenticate(self.resident)
        message = self.message(self.responder)

        self.assertEqual(
            self.client.post(
                self.receipt_url(), {"through": "abc", "state": "read"}, format="json"
            ).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self.client.post(
                self.receipt_url(),
                {"through": message.pk + 1000, "state": "read"},
                format="json",
            ).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self.client.post(
                self.receipt_url(), {"through": message.pk, "state": "seen"}, format="json"
            ).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertFalse(EmergencyChatReadState.objects.exists())

    def test_listing_the_thread_marks_its_messages_delivered(self):
        self.message(self.responder)
        last = self.message(self.responder, "Arriving now.")
        self.client.force_authenticate(self.resident)

        self.assertEqual(
            self.client.get(self.chat_url()).status_code, status.HTTP_200_OK
        )
        self.assertEqual(self.watermarks(self.resident).delivered_through_id, last.pk)
        # Delivery is not a reading claim.
        self.assertEqual(self.watermarks(self.resident).read_through_id, 0)

    # -- the states the UI renders -----------------------------------------

    def get_thread(self):
        self.client.force_authenticate(self.responder)
        response = self.client.get(self.chat_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return {row["id"]: row for row in response.data}

    def test_delivery_state_progresses_sent_delivered_read(self):
        first = self.message(self.responder)
        second = self.message(self.responder, "Two minutes out.")

        states = self.get_thread()
        self.assertEqual(states[first.pk]["delivery_state"], "sent")
        self.assertEqual(states[second.pk]["delivery_state"], "sent")

        row = EmergencyChatReadState.objects.create(
            alert=self.alert, user=self.resident, delivered_through_id=first.pk
        )
        states = self.get_thread()
        self.assertEqual(states[first.pk]["delivery_state"], "delivered")
        self.assertEqual(states[second.pk]["delivery_state"], "sent")

        row.read_through_id = second.pk
        row.save(update_fields=["read_through_id"])
        states = self.get_thread()
        self.assertEqual(states[first.pk]["delivery_state"], "read")
        self.assertEqual(states[second.pk]["delivery_state"], "read")
        self.assertEqual(states[first.pk]["read_count"], 1)
        self.assertEqual(states[first.pk]["recipient_count"], 1)

    def test_a_failed_sms_leg_marks_a_message_failed_until_someone_receives_it(self):
        message = self.message(self.responder, "Meeting point is the gate.")
        outbound = OutboundSmsMessage(
            purpose="chat_update", status="failed", body=message.body
        )
        outbound.alert = self.alert
        outbound.chat_message = message
        outbound.set_destination(LIVE_NUMBER)
        outbound.idempotency_key = "test-chat-sms-failed"
        outbound.save()

        states = self.get_thread()
        self.assertEqual(states[message.pk]["delivery_state"], "failed")

        EmergencyChatReadState.objects.create(
            alert=self.alert, user=self.resident, delivered_through_id=message.pk
        )
        states = self.get_thread()
        self.assertEqual(states[message.pk]["delivery_state"], "delivered")
