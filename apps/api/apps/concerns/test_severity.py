"""Concern severity, priority, and the equity property they exist to protect.

`apps/concerns/severity.py` replaced `votes * 3 + comments * 2`. These tests pin
the behaviour that made that replacement necessary, so it cannot quietly regress
into popularity ranking again.
"""

from django.contrib.auth import get_user_model
from datetime import timedelta

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

    def _concern(self, *, category="others", estimate=None, urgent=False, relevance=None, votes=0):
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
                urgent_attention=urgent,
                nlp_confidence=relevance,
            )
            concern.refresh_from_db()
        concern.vote_count = votes
        return concern

    def test_review_severity_maps_to_bands(self):
        for estimate, expected in (("low", "low"), ("medium", "moderate"), ("high", "high")):
            concern = self._concern(estimate=estimate)
            self.assertEqual(severity_label(concern), expected, f"severity {estimate}")

    def test_urgent_attention_reaches_the_critical_band(self):
        # `critical` is reserved for possible immediate danger, so the top band
        # cannot be reached just by the model picking the highest of three
        # ordinary severity levels.
        concern = self._concern(estimate="low", urgent=True)
        self.assertEqual(severity_label(concern), "critical")

    def test_category_baseline_floors_severity(self):
        concern = self._concern(category="public_safety", estimate="low")
        self.assertEqual(severity_label(concern), "high")

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

        severe_but_quiet = self._concern(category="public_safety", estimate="high", urgent=True, votes=0)

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
