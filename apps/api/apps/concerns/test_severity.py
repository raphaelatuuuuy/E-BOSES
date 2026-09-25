"""Concern severity, priority, and the equity property they exist to protect.

`apps/concerns/severity.py` replaced `votes * 3 + comments * 2`. These tests pin
the behaviour that made that replacement necessary, so it cannot quietly regress
into popularity ranking again.
"""

from django.contrib.auth import get_user_model
from datetime import timedelta
from types import SimpleNamespace

from django.utils import timezone
from rest_framework.test import APITestCase

from apps.concerns.models import Concern, ConcernAiAssessment
from apps.concerns.severity import priority_score, severity_label, severity_level

User = get_user_model()


class ConcernSeverityTests(APITestCase):
    def setUp(self):
        self.reporter = User.objects.create_user(
            email="severity-reporter@example.com",
            phone_number="+639173330001",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )

    def _concern(
        self,
        *,
        category="others",
        estimate=None,
        relevance=None,
        current_danger=False,
        incident_timing="unclear",
        votes=0,
    ):
        concern = Concern.objects.create(
            reporter=self.reporter,
            title="Test concern",
            category=category,
            status=Concern.Status.UNDER_REVIEW,
        )
        if estimate is not None:
            ConcernAiAssessment.objects.create(
                concern=concern,
                status="completed",
                severity_estimate=estimate,
                nlp_confidence=relevance,
                raw_result={
                    "review": {
                        "current_danger": current_danger,
                        "incident_timing": incident_timing,
                    }
                },
            )
            concern.refresh_from_db()
        concern.vote_count = votes
        return concern

    def test_review_severity_maps_to_bands(self):
        for estimate, expected in (("low", "low"), ("medium", "moderate"), ("high", "high"), ("critical", "critical")):
            concern = self._concern(estimate=estimate)
            self.assertEqual(severity_label(concern), expected, f"severity {estimate}")

    def test_low_severity_without_high_risk_stays_low(self):
        concern = self._concern(estimate="low")
        self.assertEqual(severity_label(concern), "low")

    def test_current_danger_cannot_override_a_non_high_llm_severity(self):
        concern = SimpleNamespace(
            category="infrastructure",
            ai_assessment=SimpleNamespace(
                status="completed",
                severity_estimate="medium",
                nlp_confidence=None,
                raw_result={"review": {"current_danger": False, "incident_timing": "ongoing"}},
            ),
        )

        self.assertEqual(severity_label(concern), "moderate")

    def test_high_risk_remains_high_without_explicit_critical_severity(self):
        concern = self._concern(
            estimate="high",
            current_danger=True,
            incident_timing="ongoing",
        )
        self.assertEqual(severity_label(concern), "high")

    def test_ended_or_non_dangerous_high_risk_stays_high(self):
        ended = self._concern(
            estimate="high",
            current_danger=True,
            incident_timing="ended",
        )
        quiet = self._concern(
            estimate="high",
            current_danger=False,
            incident_timing="ongoing",
        )
        self.assertEqual(severity_label(ended), "high")
        self.assertEqual(severity_label(quiet), "high")

    def test_category_baseline_applies_only_until_the_model_scores(self):
        unassessed = self._concern(category="public_safety")
        self.assertEqual(severity_label(unassessed), "high")

        assessed = self._concern(category="public_safety", estimate="low")
        self.assertEqual(severity_label(assessed), "low")

    def test_missing_assessment_is_reported_as_unassessed(self):
        concern = self._concern(category="infrastructure")
        level, assessed = severity_level(concern)
        self.assertEqual(level, 1)
        self.assertFalse(assessed)

    def test_votes_do_not_affect_severity(self):
        # The whole point: severity is objective. Support may reorder within a
        # band, never change the band itself.
        quiet = self._concern(estimate="high", votes=0)
        popular = self._concern(estimate="high", votes=500)
        self.assertEqual(severity_label(quiet), severity_label(popular))

    def test_support_cannot_outrank_severity(self):
        # A trivial concern with overwhelming support must still sort below a
        # severe one with none — the Schiff (2023) equity correction.
        popular_but_minor = self._concern(estimate="low", votes=10_000)
        popular_but_minor.updated_at = timezone.now() - timedelta(days=30)

        severe_but_quiet = self._concern(category="public_safety", estimate="high", votes=0)

        self.assertGreater(
            priority_score(severe_but_quiet),
            priority_score(popular_but_minor),
        )

    def test_support_orders_within_a_band(self):
        # Civic participation still has to matter, or the system is not a
        # civic engagement platform.
        supported = self._concern(estimate="high", votes=20)
        ignored = self._concern(estimate="high", votes=0)
        self.assertGreater(priority_score(supported), priority_score(ignored))

    def test_waiting_raises_priority_within_a_band(self):
        stale = self._concern(estimate="high")
        stale.updated_at = timezone.now() - timedelta(days=5)
        fresh = self._concern(estimate="high")

        self.assertGreater(priority_score(stale), priority_score(fresh))
