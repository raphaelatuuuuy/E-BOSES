"""The reporter contact must resolve to the resident's live number.

Officials and responders who look up the reporter, and the chat SMS fallback,
must use the number on the resident's account. The alert's
``reporter_contact_number`` is a creation-time snapshot and was shown -- and
texted -- even after the resident changed handsets.
"""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.sms.models import InboundSmsMessage, OutboundSmsMessage
from apps.sms.payload import InboundPayload
from apps.sms.router import handle_inbound
from apps.concerns.test_helpers import active_test_community, grant_position
from apps.concerns.units import sync_responder_designation

from .contacts import resolve_reporter_number
from .models import (
    EmergencyAlert,
    EmergencyChatMessage,
    EmergencyResponderAssignment,
    ResponderShift,
)
TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

# One digit too many: the kind of value that used to be stored raw and then
# silently refused by the SMS gateway.
STALE_NUMBER = "+6391700000001"
LIVE_NUMBER = "+639478000010"
OTHER_VALID_NUMBER = "+639478000011"


@override_settings(
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
)
class ReporterContactTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.community = active_test_community()
        self.resident = self._user("rc-live-resident@example.com", LIVE_NUMBER, "Andres", "Bonifacio")
        self.responder = self._user(
            "rc-live-responder@example.com",
            "+639478000003",
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
        self.official = self._user(
            "rc-live-official@example.com",
            "+639478000004",
            "Rico",
            "Official",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
        )
        grant_position(self.official, department_code="bdrrmo")
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
            reporter_contact_number=STALE_NUMBER,
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
            email=email, phone_number=phone, password="pass", status=User.Status.VERIFIED, **extra
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

    def url(self):
        return f"/api/emergencies/{self.alert.pk}/reporter-contact/"

    # -- the resolver ------------------------------------------------------

    def test_live_account_number_wins_over_the_alert_snapshot(self):
        self.assertEqual(resolve_reporter_number(self.alert), LIVE_NUMBER)

    def test_snapshot_is_used_when_the_account_has_no_usable_number(self):
        self.resident.phone_number = ""
        self.resident.save(update_fields=["phone_number"])
        self.alert.reporter_contact_number = OTHER_VALID_NUMBER
        self.alert.save(update_fields=["reporter_contact_number"])

        self.assertEqual(resolve_reporter_number(self.alert), OTHER_VALID_NUMBER)

    def test_an_unusable_value_is_reported_as_missing_not_returned(self):
        self.resident.phone_number = ""
        self.resident.save(update_fields=["phone_number"])

        self.assertEqual(resolve_reporter_number(self.alert), "")

    # -- the reveal endpoint the dashboard displays ------------------------

    def test_official_reveals_the_live_number_not_the_snapshot(self):
        self.client.force_authenticate(self.official)
        response = self.client.get(self.url())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["phone_number"], LIVE_NUMBER)

    def test_assigned_responder_reveals_the_live_number(self):
        self.client.force_authenticate(self.responder)
        response = self.client.get(self.url())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["phone_number"], LIVE_NUMBER)

    def test_an_unusable_number_is_reported_as_unavailable(self):
        self.resident.phone_number = ""
        self.resident.save(update_fields=["phone_number"])
        self.client.force_authenticate(self.official)

        response = self.client.get(self.url())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertNotIn("0000001", str(response.data))

    def test_masked_display_uses_the_live_number(self):
        self.client.force_authenticate(self.responder)

        response = self.client.get(f"/api/emergencies/{self.alert.pk}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["reporter_phone"], "+63 9•• ••• 0010")

    # -- the chat SMS fallback --------------------------------------------

    def test_chat_sms_destination_uses_the_live_number(self):
        message = EmergencyChatMessage.objects.create(
            alert=self.alert, sender=self.responder, body="We are on our way."
        )

        with patch("apps.emergencies.chat_services.is_user_online", return_value=False), patch(
            "apps.emergencies.chat_services.create_emergency_notification"
        ), patch("apps.emergencies.chat_services.broadcast_emergency_chat_message"), patch(
            "apps.emergencies.chat_services.queue_sms"
        ) as queue_sms:
            from .chat_services import deliver_chat_message

            deliver_chat_message(message.pk)

        self.assertEqual(queue_sms.call_count, 1)
        self.assertEqual(queue_sms.call_args.args[0], LIVE_NUMBER)

    @override_settings(SMS_CHAT_MIRROR_MODE="gateway_only")
    def test_gateway_only_texts_an_offline_responder_through_the_gateway(self):
        message = EmergencyChatMessage.objects.create(
            alert=self.alert, sender=self.resident, body="The obstruction is still present."
        )

        with patch("apps.emergencies.chat_services.is_user_online", return_value=False), patch(
            "apps.emergencies.chat_services.create_emergency_notification"
        ), patch("apps.emergencies.chat_services.broadcast_emergency_chat_message"), patch(
            "apps.emergencies.chat_services.queue_sms"
        ) as queue_sms:
            from .chat_services import deliver_chat_message

            deliver_chat_message(message.pk)

        self.assertEqual(queue_sms.call_count, 1)
        self.assertEqual(queue_sms.call_args.args[0], "+639478000003")
        self.assertEqual(queue_sms.call_args.kwargs["recipient"], self.responder)
        self.assertIn(f":{self.responder.pk}", queue_sms.call_args.kwargs["idempotency_key"])

    def test_gateway_chat_envelope_appends_a_resident_message_without_the_envelope(self):
        payload = InboundPayload(
            body=f"E-BOSES CHAT E-{self.alert.pk}: Thank you. The obstruction is still present.",
            sender=LIVE_NUMBER,
            gateway_timestamp=None,
            gateway_message_id="gateway-chat-resident-1",
            raw={},
            event="sms:received",
        )

        inbound = handle_inbound(payload)

        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.CHAT_APPENDED)
        self.assertEqual(inbound.chat_message.sender_id, self.resident.pk)
        self.assertEqual(inbound.chat_message.body, "Thank you. The obstruction is still present.")

    def test_gateway_chat_envelope_routes_a_responder_to_the_referenced_alert(self):
        payload = InboundPayload(
            body=f"E-BOSES CHAT E-{self.alert.pk}: We are two minutes out.",
            sender="+639478000003",
            gateway_timestamp=None,
            gateway_message_id="gateway-chat-responder-1",
            raw={},
            event="sms:received",
        )

        inbound = handle_inbound(payload)

        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.CHAT_APPENDED)
        self.assertEqual(inbound.chat_message.sender_id, self.responder.pk)
        self.assertEqual(inbound.chat_message.body, "We are two minutes out.")

    def test_plain_responder_sms_uses_the_only_active_assignment(self):
        payload = InboundPayload(
            body="We are two minutes out.",
            sender="+639478000003",
            gateway_timestamp=None,
            gateway_message_id="gateway-chat-responder-plain-1",
            raw={},
            event="sms:received",
        )

        inbound = handle_inbound(payload)

        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.CHAT_APPENDED)
        self.assertEqual(inbound.chat_message.alert_id, self.alert.pk)
        self.assertEqual(inbound.chat_message.sender_id, self.responder.pk)

    def test_gateway_chat_envelope_cannot_write_another_alert(self):
        payload = InboundPayload(
            body="E-BOSES CHAT E-999999: Do not append this.",
            sender=LIVE_NUMBER,
            gateway_timestamp=None,
            gateway_message_id="gateway-chat-invalid-1",
            raw={},
            event="sms:received",
        )

        inbound = handle_inbound(payload)

        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.REJECTED)
        self.assertEqual(self.alert.chat_messages.count(), 0)

    def test_responder_answer_is_texted_when_resident_replied_by_sms(self):
        self.alert.reporter = self.resident
        self.alert.save(update_fields=["reporter"])
        resident_line = EmergencyChatMessage.objects.create(
            alert=self.alert, sender=self.resident, body="Thank you. The obstruction is still present."
        )
        InboundSmsMessage.objects.create(
            sender_number=LIVE_NUMBER,
            body=resident_line.body,
            dedupe_key="test-dedupe-mirror-1",
            alert=self.alert,
            chat_message=resident_line,
            outcome=InboundSmsMessage.Outcome.CHAT_APPENDED,
        )
        answer = EmergencyChatMessage.objects.create(
            alert=self.alert, sender=self.responder, body="Stay at the corner, we are two minutes out."
        )

        with patch("apps.emergencies.chat_services.is_user_online", return_value=True), patch(
            "apps.emergencies.chat_services.create_emergency_notification"
        ), patch("apps.emergencies.chat_services.broadcast_emergency_chat_message"), patch(
            "apps.emergencies.chat_services.queue_sms"
        ) as queue_sms:
            from .chat_services import deliver_chat_message

            deliver_chat_message(answer.pk)

        self.assertEqual(queue_sms.call_count, 1)
        self.assertEqual(queue_sms.call_args.args[0], LIVE_NUMBER)
        self.assertNotIn("SOS-", queue_sms.call_args.args[1])
        self.assertIn("Reply to this number to answer.", queue_sms.call_args.args[1])

    @override_settings(SMS_CHAT_MIRROR_MODE="offline_only")
    def test_online_silent_resident_is_not_texted_in_offline_only_mode(self):
        answer = EmergencyChatMessage.objects.create(
            alert=self.alert, sender=self.responder, body="We are on our way."
        )

        with patch("apps.emergencies.chat_services.is_user_online", return_value=True), patch(
            "apps.emergencies.chat_services.create_emergency_notification"
        ), patch("apps.emergencies.chat_services.broadcast_emergency_chat_message"), patch(
            "apps.emergencies.chat_services.queue_sms"
        ) as queue_sms:
            from .chat_services import deliver_chat_message

            deliver_chat_message(answer.pk)

        queue_sms.assert_not_called()
