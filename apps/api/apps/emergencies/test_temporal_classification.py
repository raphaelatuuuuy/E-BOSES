import json

from django.test import TestCase

from apps.concerns.ai.gemma_analyzer import parse_gemma_result
from apps.sms.parsing import parse_emergency_sms

from .models import EmergencyCategory
from .temporal import infer_incident_timing


class TemporalClassificationTests(TestCase):
    def setUp(self):
        EmergencyCategory.objects.get_or_create(
            community=None,
            code="fire",
            defaults={"label": "Fire", "is_active": True},
        )
        EmergencyCategory.objects.get_or_create(
            community=None,
            code="disaster",
            defaults={"label": "Disaster", "is_active": True},
        )

    def _result(self, text, **changes):
        payload = {
            "relevance": "VALID",
            "primary_category": "public_safety",
            "severity": "high",
            "recommended_action": "escalate_as_emergency",
            "matched_emergency_type": "fire",
            "emergency_routing_reason": "The text mentions a fire.",
            "incident_timing": "ongoing",
            "incident_timing_reason": "The fire is active.",
            "current_danger": True,
        }
        payload.update(changes)
        return parse_gemma_result(
            json.dumps(payload),
            model_version="test",
            selected_category="public_safety",
            report_text=text,
        )

    def test_ended_fire_cannot_start_emergency_dispatch(self):
        result = self._result("There was a fire yesterday. It was extinguished and is over.")

        self.assertEqual(result.details["incident_timing"], "ended")
        self.assertFalse(result.details["current_danger"])
        self.assertEqual(result.details["matched_emergency_type"], "")
        self.assertEqual(result.details["recommended_action"], "accept")

    def test_past_start_with_current_danger_stays_an_emergency(self):
        result = self._result("The fire started yesterday. Smoke is coming out now and a person is still trapped.")

        self.assertEqual(result.details["incident_timing"], "ongoing")
        self.assertEqual(result.details["matched_emergency_type"], "fire")
        self.assertEqual(result.details["recommended_action"], "escalate_as_emergency")

    def test_unclear_timing_requires_confirmation(self):
        result = self._result(
            "There is a fire report at the warehouse.",
            incident_timing="unclear",
            incident_timing_reason="The timing is unclear.",
        )

        self.assertEqual(result.details["incident_timing"], "unclear")
        self.assertTrue(result.details["ongoing_emergency_confirmation_required"])

    def test_drill_and_future_example_do_not_dispatch(self):
        result = self._result("Fire drill bukas. This is only a test message.")

        self.assertIn(result.details["incident_timing"], {"planned", "hypothetical"})
        self.assertFalse(result.details["current_danger"])
        self.assertEqual(result.details["matched_emergency_type"], "")

    def test_civic_hazard_does_not_become_generic_disaster(self):
        result = self._result(
            "Ongoing disaster around Narra Street. May nakalaylay na wire galing sa poste, "
            "paki-alis agad to baka may madisgrasya pa.",
            matched_emergency_type="disaster",
            emergency_routing_reason="The report sounds dangerous.",
        )

        self.assertEqual(result.details["matched_emergency_type"], "")
        self.assertFalse(result.details["current_danger"])
        self.assertEqual(result.details["recommended_action"], "accept")

    def test_filipino_current_and_ended_phrases(self):
        self.assertEqual(infer_incident_timing("May sunog ngayon, nasusunog pa ang bahay.")[0], "ongoing")
        self.assertEqual(infer_incident_timing("Nasunog kahapon pero naapula na.")[0], "ended")

    def test_sms_uses_the_same_time_guard(self):
        ended = parse_emergency_sms("HELP FIRE. The fire happened yesterday and was extinguished.", sender_is_known=True)
        active = parse_emergency_sms("HELP FIRE. The fire started yesterday but a person is still trapped.", sender_is_known=True)

        self.assertFalse(ended.is_emergency)
        self.assertEqual(ended.incident_timing, "ended")
        self.assertTrue(active.is_emergency)
        self.assertEqual(active.incident_timing, "ongoing")
