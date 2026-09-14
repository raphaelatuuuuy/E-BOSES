import json
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.sms import templates
from apps.sms.models import InboundSmsMessage, OutboundSmsMessage, SmsPurpose
from apps.sms.normalize import match_sender
from apps.sms.payload import InboundPayload
from apps.sms.parsing import parse_emergency_sms
from apps.sms.router import Reply, _send, handle_inbound

from .models import Community, EmergencyAlert, MapDispatchPolicy
from .serializers import EmergencyCategorySerializer
from .sms_intake import create_alert_from_sms


SOS_NUMBER = "09640746068"
SOS_E164 = "+639640746068"


class EmergencyCategoryQuestionTests(TestCase):
    def setUp(self):
        self.community = Community.objects.filter(status=Community.Status.ACTIVE).order_by("pk").first()
        self.assertIsNotNone(self.community)

    def test_questions_are_saved_and_returned_as_category_configuration(self):
        questions = [
            {
                "key": "people_affected",
                "question": "How many people?",
                "choices": [
                    {"value": "one", "label": "One"},
                    {"value": "many", "label": "Many"},
                ],
            }
        ]
        serializer = EmergencyCategorySerializer(
            data={"code": "configured_test", "label": "Configured test", "quick_questions": questions}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        category = serializer.save(community=self.community)

        self.assertEqual(EmergencyCategorySerializer(category).data["quick_questions"], questions)
        form_serializer = EmergencyCategorySerializer(
            data={"code": "configured_form_test", "label": "Configured form test", "quick_questions": json.dumps(questions)}
        )
        self.assertTrue(form_serializer.is_valid(), form_serializer.errors)

    def test_question_keys_and_choice_values_must_be_unique(self):
        serializer = EmergencyCategorySerializer(
            data={
                "code": "invalid_test",
                "label": "Invalid test",
                "quick_questions": [
                    {
                        "key": "same",
                        "question": "First",
                        "choices": [{"value": "yes", "label": "Yes"}],
                    },
                    {
                        "key": "same",
                        "question": "Second",
                        "choices": [{"value": "yes", "label": "Yes"}],
                    },
                ],
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("quick_questions", serializer.errors)


class OfflineSosContractTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.community = Community.objects.filter(status=Community.Status.ACTIVE).order_by("pk").first()
        self.assertIsNotNone(self.community)
        policy = MapDispatchPolicy.current(self.community)
        policy.emergency_sms_number = SOS_NUMBER
        policy.save(update_fields=["emergency_sms_number", "updated_at"])

    def test_public_config_contains_only_the_sos_number_and_safe_geography(self):
        response = self.client.get("/api/public/offline-sos-config/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["smsNumber"], SOS_NUMBER)
        self.assertEqual(response.data["version"], 3)
        self.assertIn("boundaryGeometry", response.data["community"])
        self.assertIn("streets", response.data["community"])
        categories = response.data["community"]["categories"]
        self.assertTrue(categories)
        fire = next(category for category in categories if category["code"] == "fire")
        self.assertEqual(fire["quick_questions"][0]["key"], "people_affected")
        self.assertTrue(fire["quick_questions"][0]["choices"])
        self.assertTrue(response.data["communities"])
        for street in response.data["community"]["streets"]:
            self.assertIn("paths", street)
        self.assertNotIn("users", response.data)
        self.assertNotIn("responders", response.data)

    @patch("apps.emergencies.views.auto_route_alert")
    @patch("apps.emergencies.views.create_witness_notifications")
    def test_outside_coordinate_is_audited_invalid_and_never_routed(self, witnesses, route):
        parsed = parse_emergency_sms(
            "I need immediate help. This is a Fire emergency.\n"
            "LOC:1.000000,1.000000"
        )
        result = create_alert_from_sms(
            parsed,
            sender_number=SOS_NUMBER,
            match=match_sender(SOS_NUMBER),
        )
        self.assertEqual(result.alert.status, EmergencyAlert.Status.INVALID)
        self.assertEqual(result.alert.location_confidence, EmergencyAlert.LocationConfidence.OUTSIDE_AREA)
        route.assert_not_called()
        witnesses.assert_not_called()

    @override_settings(SMS_GATEWAY_NUMBER=SOS_NUMBER)
    @patch("apps.sms.router.queue_sms")
    def test_self_addressed_emergency_ack_is_queued_to_the_only_test_number(self, queue_sms):
        inbound = SimpleNamespace(pk=1, dedupe_key="only-test-number", matched_user=None)
        _send(inbound, SOS_E164, Reply("received", purpose=SmsPurpose.EMERGENCY_ACK))
        self.assertEqual(queue_sms.call_count, 1)
        self.assertEqual(queue_sms.call_args[0][0], SOS_E164)

    @override_settings(SMS_GATEWAY_NUMBER=SOS_NUMBER)
    def test_self_addressed_outbound_echo_is_discarded_without_reply(self):
        outbound = OutboundSmsMessage(
            body="E-BOSES EMERGENCY\n\nYour FIRE emergency was received.",
            purpose=SmsPurpose.EMERGENCY_ACK,
            idempotency_key="only-number-echo",
        )
        outbound.set_destination(SOS_NUMBER)
        outbound.save()
        payload = InboundPayload(
            body=outbound.body,
            sender=SOS_NUMBER,
            gateway_timestamp=None,
            gateway_message_id="only-number-echo-inbound",
            raw={},
            event="sms:received",
        )

        with patch("apps.sms.router.queue_sms") as queue_sms:
            inbound = handle_inbound(payload)

        self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.REJECTED)
        queue_sms.assert_not_called()

    def test_pending_response_is_short_and_has_no_commands(self):
        alert = SimpleNamespace(pk=315, type="fire", reporter=None)
        body = templates.pending_response(alert)
        self.assertIn("still arranging a response unit", body)
        self.assertNotIn("Reply ", body)

    @override_settings(SMS_GATEWAY_NUMBER=SOS_NUMBER)
    def test_only_explicit_resident_intake_check_can_pass_echo_guard(self):
        cases = [
            (SmsPurpose.EMERGENCY, "resident-intake-check:allowed", SOS_NUMBER, "sent", True),
            (SmsPurpose.EMERGENCY_ACK, "resident-intake-check:ack", SOS_NUMBER, "sent", False),
            (SmsPurpose.EMERGENCY, "ordinary-emergency", SOS_NUMBER, "sent", False),
            (SmsPurpose.EMERGENCY, "resident-intake-check:wrong-number", "09171234821", "sent", False),
            (SmsPurpose.EMERGENCY, "resident-intake-check:unsent", SOS_NUMBER, "queued", False),
        ]
        for index, (purpose, key, destination, status, allowed) in enumerate(cases):
            with self.subTest(key=key):
                outbound = OutboundSmsMessage(body=f"I need immediate help. This is a Fire emergency near Marikina Heights. {index}", purpose=purpose, idempotency_key=key, status=status)
                outbound.set_destination(destination)
                outbound.save()
                payload = InboundPayload(body=outbound.body, sender=SOS_NUMBER, gateway_timestamp=None, gateway_message_id=key, raw={}, event="sms:received")
                with patch("apps.sms.router._dispatch", return_value=None) as dispatch, patch("apps.sms.router.queue_sms") as queue_sms:
                    inbound = handle_inbound(payload)
                    handle_inbound(payload)
                self.assertEqual(dispatch.call_count, 1 if allowed else 0)
                if not allowed:
                    self.assertEqual(inbound.outcome, InboundSmsMessage.Outcome.REJECTED)
                queue_sms.assert_not_called()

    def test_unit_alert_contains_callback_but_never_home_address(self):
        alert = SimpleNamespace(
            pk=315,
            type="fire",
            resolved_location="Dao Street, Marikina Heights",
            reported_area="Champaca Street",
            address="",
            latitude=14.650123,
            longitude=121.112345,
            created_at=None,
            triage={},
        )
        body = templates.responder_dispatch(
            alert,
            unit_name="BDRRMC",
            reporter_name="Test Resident",
            contact=SOS_NUMBER,
        )
        self.assertIn(f"Contact: {SOS_NUMBER}", body)
        self.assertIn("Resident: Test Resident", body)
        self.assertIn("Dao Street", body)
        self.assertNotIn("home address", body.lower())
        self.assertNotIn("BACKUP", body)
        self.assertNotIn("Reply ", body)
