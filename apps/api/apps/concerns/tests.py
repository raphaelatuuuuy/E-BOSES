"""Concern AI validation tests."""

from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase

from apps.ai_validation.adapters import ImageSeverityResult, TextClassificationResult
from apps.ai_validation.services import validate_concern
from apps.ai_validation.tasks import enqueue_concern_validation

from apps.concerns.models import Category, Concern
from apps.concerns.services import create_concern


@dataclass
class MockImageDetector:
    def detect_severity(self, image_paths: list[Path]):
        return ImageSeverityResult(0.82, "mock-image-v1", "Flooding appears severe.", {"mocked": True, "images": len(image_paths)})


@dataclass
class MockTextClassifier:
    def classify(self, *, title: str, description: str):
        return TextClassificationResult(0.91, 0.08, "utilities", "mock-text-v1", "Report text is relevant.", {"mocked": True})


class ConcernAIValidationTests(TestCase):
    def test_validate_concern_stores_mocked_ai_outputs_as_advisory_fields(self):
        concern = Concern.objects.create(title="No water supply", description="The whole street has no water service since yesterday.")

        validate_concern(concern.id, image_detector=MockImageDetector(), text_classifier=MockTextClassifier())

        concern.refresh_from_db()
        self.assertEqual(concern.ai_severity_score, 0.82)
        self.assertEqual(concern.ai_category_suggestion, "utilities")
        self.assertEqual(concern.ai_relevance_score, 0.91)
        self.assertEqual(concern.ai_fake_report_score, 0.08)
        self.assertIn("mock-image-v1", concern.ai_model_version)
        self.assertTrue(concern.ai_metadata["advisory_only"])
        self.assertIn("officials make final approval", concern.ai_explanation)
        self.assertEqual(concern.status, Concern.Status.PENDING_REVIEW)

    def test_reviewer_override_fields_take_precedence_without_auto_approval(self):
        ai_category = Category.objects.create(name="utilities")
        reviewer_category = Category.objects.create(name="road")
        concern = Concern.objects.create(title="Broken pavement", description="Large pothole near the crossing.", category=ai_category, ai_severity_score=0.3, reviewer_severity_score=0.7, reviewer_category=reviewer_category)

        self.assertEqual(concern.final_severity_score, 0.7)
        self.assertEqual(concern.final_category, reviewer_category)
        self.assertEqual(concern.status, Concern.Status.PENDING_REVIEW)

    def test_enqueue_concern_validation_uses_isolated_background_worker(self):
        concern = Concern.objects.create(title="Garbage pile", description="Garbage is blocking the drainage canal.")
        with patch("apps.ai_validation.tasks.validate_concern") as validate_mock:
            future = enqueue_concern_validation(concern.id)
            future.result(timeout=2)

        validate_mock.assert_called_once_with(concern.id)


class ConcernServiceTests(TestCase):
    def test_create_concern_enqueues_ai_validation_without_setting_status(self):
        with patch("apps.concerns.services.enqueue_concern_validation") as enqueue_mock:
            concern = create_concern(
                reporter=None,
                validated_data={"title": "Blocked canal", "description": "Drainage is blocked by waste."},
            )

        enqueue_mock.assert_called_once_with(concern.id)
        self.assertEqual(concern.status, Concern.Status.PENDING_REVIEW)
        self.assertIsNone(concern.ai_severity_score)
