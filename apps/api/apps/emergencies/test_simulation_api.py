"""EmergencySimulationView: the emergency-domain admin test workspace.

No URL is wired for this view yet (route wiring is centralized and owned by a
separate task), so these tests drive the view directly through
APIRequestFactory instead of going through `self.client` + a path.

Mirrors apps.concerns.test_classification's mocking convention — Gemma is
never actually called; `classification_payload` is patched at its source
module so both the question-step and confirmed branches are covered without
network access.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from apps.concerns.ai.gemma_analyzer import payload_from_result
from apps.concerns.ai_fixtures import gemma_result
from apps.concerns.models import LlmDecisionLog
from apps.concerns.test_helpers import ensure_test_profile, grant_position
from apps.concerns.units import sync_responder_designation

from .models import EmergencyAlert, EmergencyResponderAssignment
from .simulation_api import EmergencySimulationView


def simulation_payload(**overrides):
    return payload_from_result(
        gemma_result(**overrides),
        selected_category="",
    )


@override_settings(OSM_ROUTE_URL="")
class EmergencySimulationViewTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        User = get_user_model()
        self.official = User.objects.create_user(
            email="sim-official@example.com",
            phone_number="+639620000001",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        designation = grant_position(self.official, department_code="bhw")
        self.community = designation.department.community

    def _post(self, data):
        request = self.factory.post("/api/emergencies/simulate/", data, format="multipart")
        force_authenticate(request, user=self.official)
        return EmergencySimulationView.as_view()(request)

    def _make_bhw_responder(self, *, on_duty=True):
        User = get_user_model()
        responder = User.objects.create_user(
            email="sim-bhw-responder@example.com",
            phone_number="+639620000002",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.BHW,
            status=User.Status.VERIFIED,
            is_on_duty=on_duty,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ensure_test_profile(
            responder,
            community=self.community,
            first_name="Bea",
            last_name="Health",
            address="Health Center",
        )
        sync_responder_designation(responder)
        return responder

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_question_step_reports_whether_confirmation_is_required(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            current_danger=True,
            emergency_routing_reason="Someone collapsed and needs medical help.",
        )

        response = self._post({
            "title": "Collapsed neighbor",
            "description": "My neighbor just collapsed and is not responding.",
            "latitude": 14.6515,
            "longitude": 121.1207,
        })

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["requires_confirmation"])
        self.assertEqual(response.data["matched_emergency_type"], "medical")
        self.assertEqual(
            response.data["emergency_routing_reason"],
            "Someone collapsed and needs medical help.",
        )
        self.assertIn("review", response.data)
        self.assertIn("current_danger", response.data["review"])
        self.assertEqual(LlmDecisionLog.objects.count(), 1)
        log = LlmDecisionLog.objects.get()
        self.assertEqual(log.run_kind, LlmDecisionLog.RunKind.SIMULATION)
        self.assertEqual(log.domain, LlmDecisionLog.Domain.EMERGENCY)
        self.assertEqual(log.performed_by_id, self.official.pk)
        self.assertIsNone(log.input_snapshot["confirmed_ongoing"])

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_confirmed_ongoing_false_routes_to_concern_path(self, classify):
        classify.return_value = simulation_payload(category="infrastructure")

        response = self._post({
            "title": "Pothole",
            "description": "There is a large pothole on the main road.",
            "latitude": 14.6515,
            "longitude": 121.1207,
            "confirmed_ongoing": False,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["requires_confirmation"], False)
        self.assertEqual(response.data["path"], "concern")
        self.assertIn("review", response.data)
        self.assertNotIn("routing", response.data)
        log = LlmDecisionLog.objects.get()
        self.assertEqual(log.routing_reason, "")

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_ended_incident_goes_directly_to_concern_path(self, classify):
        classify.return_value = simulation_payload(
            category="public_safety",
            incident_timing="ended",
            incident_timing_reason="The report says the fire ended.",
            current_danger=False,
            matched_emergency_type="",
        )

        response = self._post({
            "title": "Fire damage",
            "description": "The fire happened yesterday and was extinguished.",
            "latitude": 14.6515,
            "longitude": 121.1207,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["path"], "concern")
        self.assertEqual(response.data["review"]["incident_timing"], "ended")
        self.assertEqual(EmergencyAlert.objects.count(), 0)

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_clearly_ongoing_incident_routes_without_an_extra_question(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            recommended_action="escalate_as_emergency",
            incident_timing="ongoing",
            current_danger=True,
        )
        self._make_bhw_responder(on_duty=True)

        response = self._post({
            "title": "Collapsed neighbor",
            "description": "My neighbor is unconscious and not breathing now.",
            "latitude": 14.6515,
            "longitude": 121.1207,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["path"], "emergency")
        self.assertFalse(response.data["requires_confirmation"])
        self.assertEqual(EmergencyAlert.objects.count(), 0)

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_confirmed_ongoing_true_routes_to_an_on_duty_responder(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            current_danger=True,
        )
        responder = self._make_bhw_responder(on_duty=True)

        response = self._post({
            "title": "Collapsed neighbor",
            "description": "My neighbor just collapsed and is not responding.",
            "latitude": 14.6515,
            "longitude": 121.1207,
            "confirmed_ongoing": True,
        })

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["requires_confirmation"])
        self.assertEqual(response.data["path"], "emergency")
        self.assertEqual(response.data["matched_emergency_type"], "medical")
        routing = response.data["routing"]
        self.assertIsNotNone(routing["department"])
        self.assertTrue(routing["routing_reason"])
        self.assertTrue(routing["responder_preview"]["found"])
        self.assertEqual(routing["responder_preview"]["responder"]["id"], responder.pk)
        self.assertIn("geometry", routing["route"])
        self.assertIn("profile", routing["route"])
        self.assertIn("status", routing["route"])
        log = LlmDecisionLog.objects.get()
        self.assertTrue(log.routing_reason)
        self.assertIsNotNone(log.assigned_department_id)

        # Never persisted: the simulation must not create a real alert.
        self.assertEqual(EmergencyAlert.objects.count(), 0)
        self.assertEqual(EmergencyResponderAssignment.objects.count(), 0)

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_confirmed_ongoing_true_with_no_one_on_duty(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            current_danger=True,
        )
        self._make_bhw_responder(on_duty=False)

        response = self._post({
            "title": "Collapsed neighbor",
            "description": "My neighbor just collapsed and is not responding.",
            "latitude": 14.6515,
            "longitude": 121.1207,
            "confirmed_ongoing": True,
        })

        self.assertEqual(response.status_code, 200)
        routing = response.data["routing"]
        self.assertEqual(
            routing["responder_preview"],
            {"found": False, "reason": "no_on_duty_responder_for_unit"},
        )

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_simulation_and_real_web_creation_choose_the_same_route(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            current_danger=True,
        )
        responder = self._make_bhw_responder(on_duty=True)
        simulated = self._post({
            "title": "Collapsed neighbor",
            "description": "My neighbor collapsed and is not responding.",
            "latitude": 14.6515,
            "longitude": 121.1207,
            "confirmed_ongoing": True,
        })

        User = get_user_model()
        resident = User.objects.create_user(
            email="route-parity-resident@example.com",
            phone_number="+639620000003",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(
            resident,
            community=self.community,
            first_name="Mika",
            last_name="Reyes",
            address="Sample address",
        )
        client = APIClient()
        client.force_authenticate(resident)
        created = client.post(
            "/api/emergencies/",
            {
                "type": "medical",
                "note": "My neighbor collapsed and is not responding.",
                "latitude": 14.6515,
                "longitude": 121.1207,
                "location_source": "manual_pin",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        alert = EmergencyAlert.objects.get(reporter=resident)
        assignment = alert.assignments.get()
        routing = simulated.data["routing"]
        self.assertEqual(alert.community_id, simulated.data["location"]["community"]["id"])
        self.assertEqual(assignment.responder_id, responder.pk)
        self.assertEqual(assignment.responder_id, routing["responder_preview"]["responder"]["id"])
        self.assertEqual(assignment.responding_community_id, routing["responding_community"]["id"])
        self.assertEqual("cross_community" if assignment.is_cross_community else "local", routing["scope"])
