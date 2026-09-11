from datetime import timedelta
import json
import uuid
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.sms.models import OutboundSmsMessage, SmsPurpose
from apps.sms.tests.test_inbound import TOKEN, TEST_CHANNEL_LAYERS
from apps.emergencies.description import description_for_display
from apps.emergencies.models import EmergencyAlert
from apps.emergencies.serializers import EmergencyStatusEventSerializer
from apps.emergencies.views import escalate_overdue_assignments


@override_settings(
    SMS_INBOUND_WEBHOOK_TOKEN=TOKEN,
    OUTBOUND_SMS_DRIVER="console",
    SMS_PIPELINE_ONLY=True,
    CELERY_TASK_ALWAYS_EAGER=True,
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
    OLLAMA_API_KEY="",
    REVERSE_GEOCODE_ENABLED=False,
)
class UnifiedEmergencyPipelineTests(APITestCase):
    url = "/api/sms/inbound/"

    def setUp(self):
        from apps.sms.tests.test_inbound import SmsInboundTests

        SmsInboundTests.setUp(self)

    def post(self, body, sender="+639451234821", token=TOKEN, **extra):
        return self.client.post(
            self.url,
            {"from": sender, "msg": body, **extra},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN=token,
        )

    def test_sms_intake_dispatch_progress_and_duplicate_without_gateway(self):
        message = (
            "I need immediate help. This is a Fire emergency near Champaca Street, Marikina Heights. "
            "1 person affected, fire is still spreading, someone is injured. Please send assistance.\n"
            "LOC:14.650700,121.113300"
        )
        with patch("apps.sms.gateway.HttpJsonSmsDriver.send", side_effect=AssertionError("Real gateway forbidden")):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.post(message, id="unified-intake")
            self.assertEqual(response.status_code, 201, response.data)
            alert = EmergencyAlert.objects.get(reporter=self.resident)
            self.assertEqual(alert.triage, {"people_affected": "one", "detail": "spreading", "injuries": "yes"})
            self.assertIn("affecting one person, with reported injuries.", description_for_display(alert))
            self.assertNotIn("I need immediate help", description_for_display(alert))
            assignment = alert.assignments.get(responder=self.responder)
            assignment.assigned_at = timezone.now() - timedelta(hours=2)
            assignment.save(update_fields=["assigned_at"])
            self.assertEqual(escalate_overdue_assignments(), [])
            assignment.refresh_from_db()
            self.assertEqual(assignment.status, "assigned")
            events = EmergencyStatusEventSerializer(alert.status_events.all(), many=True).data
            assigned = [event for event in events if event["label"] == "Assigned unit"]
            self.assertTrue(assigned)
            self.assertTrue(assigned[0]["note"].startswith("Assigned to "))
            dispatch = OutboundSmsMessage.objects.filter(alert=alert, purpose=SmsPurpose.DISPATCH).first()
            self.assertIsNotNone(dispatch)
            self.assertIn("assigned to your unit", dispatch.body)
            self.assertNotIn("Reply ACCEPT", dispatch.body)
            with self.captureOnCommitCallbacks(execute=True):
                self.post(f"ENROUTE E-{alert.pk}", sender=self.responder.phone_number, id="unified-travel")
            alert.refresh_from_db()
            self.assertEqual(alert.status, "en_route")
            with self.captureOnCommitCallbacks(execute=True):
                self.post(f"ONSCENE E-{alert.pk}", sender=self.responder.phone_number, id="unified-arrival")
            alert.refresh_from_db()
            self.assertEqual(alert.status, "arrived")
            count = OutboundSmsMessage.objects.count()
            with self.captureOnCommitCallbacks(execute=True):
                self.post(message, id="unified-intake")
            self.assertEqual(EmergencyAlert.objects.filter(reporter=self.resident).count(), 1)
            self.assertEqual(OutboundSmsMessage.objects.count(), count)
            messages = OutboundSmsMessage.objects.filter(alert=alert, purpose=SmsPurpose.EMERGENCY_ACK)
            self.assertTrue(any("on the way" in item.body for item in messages))
            self.assertTrue(any("arrived at your location" in item.body for item in messages))
            for item in messages:
                self.assertNotIn(f"E-{alert.pk}", item.body)
                self.assertNotIn("Reply ", item.body)
                self.assertNotIn("http", item.body)
            self.assertFalse(OutboundSmsMessage.objects.exclude(driver__in=["console", ""]).exists())

    def test_confirmation_is_not_travel(self):
        alert = EmergencyAlert.objects.create(reporter=self.resident, type="fire", status="routed")
        alert.assignments.create(responder=self.responder)
        with self.captureOnCommitCallbacks(execute=True):
            self.post(f"ACCEPT E-{alert.pk}", sender=self.responder.phone_number, id="confirmation")
        alert.refresh_from_db()
        self.assertEqual(alert.status, "routed")
        self.assertFalse(alert.status_events.filter(status="en_route").exists())

    def test_online_emergency_uses_the_same_assignment_and_description_contract(self):
        self.client.force_authenticate(self.resident)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/emergencies/",
                {
                    "client_request_id": str(uuid.uuid4()),
                    "type": "fire",
                    "latitude": "14.6507000",
                    "longitude": "121.1133000",
                    "address": "Champaca Street, Marikina Heights",
                    "reported_area": "Champaca Street, Marikina Heights",
                    "triage": json.dumps({"people_affected": "one", "detail": "spreading", "injuries": "yes"}),
                },
                format="multipart",
            )
        self.assertEqual(response.status_code, 201, response.data)
        alert = EmergencyAlert.objects.get(reporter=self.resident)
        self.assertIn("affecting one person, with reported injuries.", response.data["display_description"])
        assigned = EmergencyStatusEventSerializer(alert.status_events.all(), many=True).data
        self.assertTrue(any(event["label"] == "Assigned unit" and event["note"].startswith("Assigned to ") for event in assigned))
        self.assertTrue(OutboundSmsMessage.objects.filter(alert=alert, purpose=SmsPurpose.DISPATCH).exists())

    def test_accept_and_decline_routes_are_removed(self):
        self.client.force_authenticate(self.responder)
        self.assertEqual(self.client.post("/api/emergencies/1/acknowledge/", {}).status_code, 404)
        self.assertEqual(self.client.post("/api/emergencies/1/unable/", {}).status_code, 404)

    @patch(
        "apps.emergencies.location_services.reverse_geocode",
        return_value={"status": "success", "location": "Mayon Street, Hacienda Heights, Marikina", "raw": {}},
    )
    def test_unit_sms_waits_for_resolved_coordinate_address(self, _reverse):
        message = (
            "I need immediate help. This is a Flood emergency. 1 person affected, "
            "water is waist deep or higher, someone is injured. Please send assistance.\n"
            "LOC:14.650700,121.113300"
        )
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post(message, id="resolved-location-intake")
        self.assertEqual(response.status_code, 201)
        dispatch = OutboundSmsMessage.objects.get(purpose=SmsPurpose.DISPATCH)
        self.assertIn("Location: Mayon Street, Hacienda Heights, Marikina", dispatch.body)
        self.assertIn("waist-deep water or higher", dispatch.body)
