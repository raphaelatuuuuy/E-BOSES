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
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.models import ResidentProfile
from apps.concerns.ai.gemma_analyzer import payload_from_result
from apps.concerns.ai_fixtures import gemma_result
from apps.concerns.models import LlmDecisionLog
from apps.concerns.test_helpers import grant_position

from .models import EmergencyAlert
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
        grant_position(self.official)

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
        ResidentProfile.objects.create(
            user=responder,
            first_name="Bea",
            last_name="Health",
            date_of_birth="1990-01-01",
            address="Health Center",
            barangay="Marikina Heights",
        )
        return responder

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_question_step_reports_whether_confirmation_is_required(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            urgent_attention=True,
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
        self.assertIn("urgent_attention", response.data["review"])
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
    def test_confirmed_ongoing_true_routes_to_an_on_duty_responder(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            urgent_attention=True,
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
        log = LlmDecisionLog.objects.get()
        self.assertTrue(log.routing_reason)
        self.assertIsNotNone(log.assigned_department_id)

        # Never persisted: the simulation must not create a real alert.
        self.assertEqual(EmergencyAlert.objects.count(), 0)

    @patch("apps.concerns.ai.classification.classification_payload")
    def test_confirmed_ongoing_true_with_no_one_on_duty(self, classify):
        classify.return_value = simulation_payload(
            matched_emergency_type="medical",
            urgent_attention=True,
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
