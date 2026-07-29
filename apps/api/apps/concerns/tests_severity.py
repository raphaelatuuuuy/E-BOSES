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

    def _concern(self, *, category="others", damage=None, relevance=None, votes=0):
        concern = Concern.objects.create(
            reporter=self.reporter,
            title="Test concern",
            category=category,
            status=Concern.Status.UNDER_REVIEW,
        )
        if damage is not None:
            ConcernAiAssessment.objects.create(
                concern=concern,
                status="completed",
                yolo_confidence=damage,
                nlp_confidence=relevance,
            )
            concern.refresh_from_db()
        concern.vote_count = votes
        return concern

    def test_damage_score_maps_to_quartile_bands(self):
        for damage, expected in ((0.1, "low"), (0.3, "moderate"), (0.6, "high"), (0.9, "critical")):
            concern = self._concern(damage=damage)
            self.assertEqual(severity_label(concern), expected, f"damage {damage}")

    def test_category_baseline_floors_severity(self):
        concern = self._concern(category="public_safety", damage=0.0)
        self.assertEqual(severity_label(concern), "high")

    def test_missing_assessment_is_reported_as_unassessed(self):
        concern = self._concern(category="infrastructure")
        level, assessed = severity_level(concern)
        self.assertEqual(level, 1)
        self.assertFalse(assessed)

    def test_votes_do_not_affect_severity(self):
        # The whole point: severity is objective. Support may reorder within a
        # band, never change the band itself.
        quiet = self._concern(damage=0.6, votes=0)
        popular = self._concern(damage=0.6, votes=500)
        self.assertEqual(severity_label(quiet), severity_label(popular))

    def test_support_cannot_outrank_severity(self):
        # A trivial concern with overwhelming support must still sort below a
        # severe one with none — the Schiff (2023) equity correction.
        popular_but_minor = self._concern(damage=0.1, votes=10_000)
        popular_but_minor.updated_at = timezone.now() - timedelta(days=30)

        severe_but_quiet = self._concern(category="public_safety", damage=0.9, votes=0)

        self.assertGreater(
            priority_score(severe_but_quiet),
            priority_score(popular_but_minor),
        )

    def test_support_orders_within_a_band(self):
        # Civic participation still has to matter, or the system is not a
        # civic engagement platform.
        supported = self._concern(damage=0.6, votes=20)
        ignored = self._concern(damage=0.6, votes=0)
        self.assertGreater(priority_score(supported), priority_score(ignored))

    def test_waiting_raises_priority_within_a_band(self):
        stale = self._concern(damage=0.6)
        stale.updated_at = timezone.now() - timedelta(days=5)
        fresh = self._concern(damage=0.6)

        self.assertGreater(priority_score(stale), priority_score(fresh))
