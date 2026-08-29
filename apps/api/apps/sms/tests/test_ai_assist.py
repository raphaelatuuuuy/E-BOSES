"""SMS AI assist: street matching, gating, and the model rescue pass."""

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.emergencies.models import EmergencyAlert
from apps.emergencies.location_resolution import LocationResolution

from ..ai_assist import SmsAiAssistNotConfigured, run_rescue, should_run
from ..streets import match_street


class StreetMatchingTests(APITestCase):
    def test_exact_street(self):
        self.assertEqual(match_street("Champaca Street"), "Champaca Street")

    def test_street_without_suffix(self):
        self.assertEqual(match_street("champaca"), "Champaca Street")

    def test_abbreviated_suffix(self):
        self.assertEqual(match_street("near champaca st"), "Champaca Street")

    def test_street_inside_a_message(self):
        self.assertEqual(
            match_street("tulong may sunog dito sa Champaca Street Marikina"),
            "Champaca Street",
        )

    def test_accents_normalised(self):
        self.assertEqual(match_street("Mañacop"), "Mañacop Street")

    def test_unknown_place_returns_empty(self):
        self.assertEqual(match_street("tabi ng simbahan"), "")

    def test_typo_does_not_match_without_model(self):
        self.assertEqual(match_street("chapmaca"), "")


@override_settings(
    SMS_AI_ASSIST_ENABLED=True,
    OLLAMA_API_KEY="test-key",
    SMS_AI_MIN_CONFIDENCE=0.6,
)
class SmsAiAssistTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="ai-assist@example.com",
            phone_number="+639451234822",
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
        self.alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="other",
            note="tulong may sunog malapit sa chapmaca",
            location_source="none",
            category_needs_confirmation=True,
            unresolved_fields=["category", "location"],
            reporter_verification=EmergencyAlert.ReporterVerification.UNVERIFIED_NUMBER,
        )

    def _mock_response(self, category, category_conf, street, street_conf):
        return {
            "message": {
                "content": json.dumps(
                    {
                        "category": category,
                        "category_confidence": category_conf,
                        "street": street,
                        "street_confidence": street_conf,
                        "area": None,
                        "area_confidence": 0.0,
                    }
                )
            }
        }

    @patch("ollama.Client")
    def test_rescue_corrects_category_and_typo_street(self, mock_client):
        mock_client.return_value.chat.return_value = self._mock_response(
            "fire", 0.92, "champaca", 0.9
        )
        payload = run_rescue(self.alert)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.type, "fire")
        self.assertEqual(self.alert.reported_area, "")
        self.assertEqual(self.alert.canonical_street, "Champaca Street")
        self.assertFalse(self.alert.category_needs_confirmation)
        self.assertEqual(self.alert.unresolved_fields, [])
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["applied"]["category"], "fire")
        self.assertEqual(payload["applied"]["street"], "Champaca Street")

    @patch("ollama.Client")
    def test_rescue_below_confidence_changes_nothing(self, mock_client):
        mock_client.return_value.chat.return_value = self._mock_response(
            "fire", 0.4, "chapmaca", 0.5
        )
        run_rescue(self.alert)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.type, "other")
        self.assertEqual(self.alert.reported_area, "")
        self.assertTrue(self.alert.category_needs_confirmation)
        self.assertIn("category", self.alert.unresolved_fields)
        self.assertEqual(self.alert.ai_assist["status"], "ok")

    @patch("ollama.Client")
    def test_rescue_rejects_invented_street(self, mock_client):
        mock_client.return_value.chat.return_value = self._mock_response(
            "fire", 0.9, "Candyland", 0.99
        )
        run_rescue(self.alert)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.reported_area, "")
        self.assertIn("location", self.alert.unresolved_fields)

    @patch("ollama.Client")
    def test_rescue_rejects_unknown_category(self, mock_client):
        mock_client.return_value.chat.return_value = self._mock_response(
            "ufo", 0.99, None, 0.0
        )
        run_rescue(self.alert)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.type, "other")
        self.assertIn("category", self.alert.unresolved_fields)

    @patch("ollama.Client")
    def test_model_failure_is_recorded_not_raised(self, mock_client):
        mock_client.return_value.chat.side_effect = TimeoutError("slow model")
        payload = run_rescue(self.alert)
        self.alert.refresh_from_db()
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["error"], "TimeoutError")
        self.assertEqual(self.alert.type, "other")

    @patch("ollama.Client")
    def test_model_timeout_propagates_when_celery_requests_a_retry(self, mock_client):
        mock_client.return_value.chat.side_effect = TimeoutError("slow model")
        with self.assertRaises(TimeoutError):
            run_rescue(self.alert, propagate_timeout=True)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.ai_assist["status"], "failed")

    @patch("ollama.Client")
    def test_assist_never_changes_category_after_assignment(self, mock_client):
        self.alert.assignments.create(responder=self.resident)
        mock_client.return_value.chat.return_value = self._mock_response(
            "fire", 0.99, None, 0.0
        )

        run_rescue(self.alert)

        self.alert.refresh_from_db()
        self.assertEqual(self.alert.type, "other")
        self.assertIsNone(self.alert.ai_assist["applied"]["category"])
        self.assertEqual(self.alert.ai_assist["suggested"]["category"], "fire")

    def test_disabled_assist_raises_not_configured(self):
        with override_settings(SMS_AI_ASSIST_ENABLED=False):
            self.assertRaises(SmsAiAssistNotConfigured, run_rescue, self.alert)

    def test_should_run_only_for_sms_with_unresolved_fields(self):
        self.assertTrue(should_run(self.alert))
        self.alert.unresolved_fields = []
        self.alert.category_needs_confirmation = False
        self.alert.reported_area = "Champaca Street"
        self.assertFalse(should_run(self.alert))
        self.alert.location_source = "gps"
        self.assertFalse(should_run(self.alert))

    @patch("ollama.Client")
    def test_rescue_keeps_unverified_area_as_advisory(self, mock_client):
        mock_client.return_value.chat.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "category": None,
                        "category_confidence": 0.0,
                        "street": None,
                        "street_confidence": 0.0,
                        "area": "sa likod ng simbahan",
                        "area_confidence": 0.8,
                    }
                )
            }
        }
        run_rescue(self.alert)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.reported_area, "")
        self.assertEqual(self.alert.resolved_location, "")
        self.assertIn("location", self.alert.unresolved_fields)
        self.assertIsNone(self.alert.ai_assist["applied"]["area"])
        self.assertEqual(self.alert.ai_assist["suggested"]["area"], "sa likod ng simbahan")

    @patch("apps.sms.ai_assist._geocode_ai_location")
    @patch("ollama.Client")
    def test_rescue_applies_only_boundary_verified_map_place(self, mock_client, geocode):
        community = self.alert.community
        if community is None:
            from apps.emergencies.models import Community

            community = Community.objects.filter(status=Community.Status.ACTIVE).first()
        self.assertIsNotNone(community)
        mock_client.return_value.chat.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "category": None,
                        "category_confidence": 0.0,
                        "street": "Unlisted Rescue Road",
                        "street_confidence": 0.9,
                        "area": None,
                        "area_confidence": 0.0,
                    }
                )
            }
        }
        geocode.return_value = LocationResolution(
            source="sms_geocoded",
            state="reported",
            community=community,
            area_label="Unlisted Rescue Road, Marikina",
            latitude=14.6507,
            longitude=121.1133,
            canonical_street="Unlisted Rescue Road",
            provider="nominatim",
        )

        run_rescue(self.alert)

        self.alert.refresh_from_db()
        geocode.assert_called_once_with("Unlisted Rescue Road")
        self.assertEqual(self.alert.location_source, "sms_geocoded")
        self.assertEqual(self.alert.location_confidence, EmergencyAlert.LocationConfidence.REPORTED)
        self.assertEqual(float(self.alert.latitude), 14.6507)
        self.assertEqual(float(self.alert.longitude), 121.1133)
        self.assertNotIn("location", self.alert.unresolved_fields)
