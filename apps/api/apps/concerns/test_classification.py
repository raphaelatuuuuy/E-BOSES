"""Configuration API, the sample tester, the resident precheck, and the parser.

Rewritten for the Gemma-only architecture. What went with YOLO: the supported-
class list, the `car → vehicle` mapping table, the image-only test endpoint, and
every assertion about detector confidence thresholds. What replaced it: one
model that reads the photo directly, and a schema whose fields are the ones the
official interface actually shows.
"""

from dataclasses import replace
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image, ImageDraw
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.duplicate_detector import report_fingerprints
from apps.concerns.ai.gemma_analyzer import GemmaAnalyzer, parse_gemma_result, payload_from_result
from apps.concerns.ai_fixtures import gemma_result
from apps.concerns.models import Concern, ConcernAiAssessment, ConcernClassificationConfiguration, ContentFlag, Department, Designation, LlmDecisionLog, Position
from apps.concerns.test_helpers import ensure_test_profile, grant_position


def png_upload(name="safe.png"):
    output = BytesIO()
    image = Image.new("RGB", (800, 600), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 50, 750, 550), fill=(60, 100, 140))
    draw.ellipse((250, 150, 550, 450), fill=(230, 180, 50))
    image.save(output, "PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


def grant_captain(user):
    return grant_position(user)


class ConcernClassificationApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.official = User.objects.create_user(
            email="classification-official@example.com", phone_number="+639180000001",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )
        grant_captain(self.official)
        self.resident = User.objects.create_user(
            email="classification-resident@example.com", phone_number="+639180000002",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )
        ensure_test_profile(self.resident)

    def test_only_official_can_read_and_update_configuration(self):
        self.client.force_authenticate(self.resident)
        self.assertEqual(self.client.get("/api/concerns/classification/").status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.official)
        response = self.client.patch("/api/concerns/classification/", {
            "text_relevance_threshold": 0.72,
            "categories": [
                {"key": "infrastructure", "enabled": True},
                {"key": "environment", "enabled": True},
                {"key": "public_safety", "enabled": True},
                {"key": "others", "enabled": False},
            ],
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["text_relevance_threshold"], 0.72)
        self.assertEqual(
            {item["key"] for item in response.data["categories"]},
            {"infrastructure", "environment", "public_safety", "vehicle", "others"},
        )
        self.assertFalse(next(item for item in response.data["categories"] if item["key"] == "others")["enabled"])
        self.assertEqual(ConcernClassificationConfiguration.current().relevance_threshold, 0.72)

        reset = self.client.post("/api/concerns/classification/reset/", {}, format="json")
        self.assertEqual(reset.status_code, status.HTTP_200_OK)
        self.assertEqual(reset.data["text_relevance_threshold"], 0.65)

    def test_configuration_no_longer_exposes_detector_settings(self):
        """No model file, no class list, no label→category table.

        Officials were being asked to maintain rows like `car → public safety`
        for an 80-class detector trained on a different problem. There is now no
        detector and no table, and the API must not pretend otherwise.
        """
        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        for gone in ("image_model", "image_provider", "image_confidence_threshold", "label_mappings",
                     "supported_classes", "mapping_targets", "image_available"):
            self.assertNotIn(gone, response.data)

    def test_configuration_rejects_non_base_text_model(self):
        self.client.force_authenticate(self.official)
        response = self.client.patch("/api/concerns/classification/", {
            "text_model": "custom-roberta-checkpoint",
        }, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("text_model", response.data)

    @override_settings(OLLAMA_API_KEY="test-key")
    @patch("apps.concerns.ai.gemma_analyzer.GemmaAnalyzer.analyze")
    def test_sample_text_test_reports_a_matching_concern(self, analyze):
        self.client.force_authenticate(self.official)
        analyze.return_value = gemma_result(category="infrastructure")

        response = self.client.post("/api/concerns/classification/test-text/", {
            "title": "Baradong kanal", "description": "May baradong kanal at lubak sa aming kalsada.",
            "category": "infrastructure",
        }, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["classification"], "related")
        self.assertEqual(response.data["outcome"], "approved")
        self.assertTrue(response.data["category_match"])
        analyze.assert_called_once()

    @override_settings(OLLAMA_API_KEY="")
    def test_missing_ollama_key_sends_text_to_review(self):
        self.client.force_authenticate(self.official)
        response = self.client.post("/api/concerns/classification/test-text/", {
            "title": "test", "description": "asdf asdf asdf asdf asdf", "category": "others",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["classification"], "needs_review")
        self.assertEqual(response.data["outcome"], "flagged")
        self.assertIn("description", response.data["explanation"].lower())

    @override_settings(OLLAMA_API_KEY="test-key")
    @patch("apps.concerns.classification_api.classification_payload")
    def test_submission_test_sends_the_photo_straight_to_gemma(self, classify):
        """No detector sits between the upload and the model any more."""
        self.client.force_authenticate(self.official)
        classify.return_value = payload_from_result(
            gemma_result(
                category="vehicle",
                possible_categories=["public_safety"],
                detected_objects=["vehicle", "residential gate"],
                evidence_relationship="supports_report",
                image_review_succeeded=True,
                privacy_scan_required=True,
                suspected_sensitive_classes=["license plate"],
                recommended_action="accept_with_privacy_review",
            ),
            selected_category="vehicle",
        )

        response = self.client.post(
            "/api/concerns/classification/test-submission/",
            {
                "file": png_upload(),
                "category": "vehicle",
                "title": "Blocked driveway",
                "description": "May sasakyang nakaharang sa driveway sa Rosal Street.",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["primary_category"], "vehicle")
        self.assertEqual(response.data["possible_categories"], ["public_safety"])
        self.assertTrue(response.data["privacy_scan_required"])
        self.assertEqual(response.data["detected_objects"], ["vehicle", "residential gate"])
        self.assertTrue(response.data["image_uploaded"])
        # The tester still hands the normalised photo set straight to the analyzer.
        self.assertEqual(classify.call_args.kwargs["images"][0].mime_type, "image/jpeg")

    @patch("apps.concerns.classification_api.validate_concern_media_file", side_effect=lambda uploaded: uploaded)
    @patch("apps.concerns.classification_api.classification_payload")
    def test_resident_precheck_passes_the_prepared_image_to_the_analyzer(self, classify, _validate):
        self.client.force_authenticate(self.resident)
        classify.return_value = payload_from_result(
            gemma_result(
                category="vehicle",
                evidence_relationship="supports_report",
                image_review_succeeded=True,
            ),
            selected_category="vehicle",
        )

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {
                "media": png_upload(),
                "category": "vehicle",
                "title": "Blocked driveway",
                "description": "May sasakyang nakaharang sa driveway.",
                "latitude": "14.6507",
                "longitude": "121.1029",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["can_submit"])
        # Precheck validates photos locally but never uploads them to the
        # model — the resident is waiting on the response.
        self.assertIsNone(classify.call_args.kwargs["images"])
        self.assertTrue(classify.call_args.kwargs["image_uploaded"])

    def test_resident_precheck_blocks_low_information_text(self):
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {
                "category": "others",
                "title": "test",
                "description": "asdf asdf qwerty 12345",
                "latitude": "14.6507",
                "longitude": "121.1029",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["can_submit"])
        self.assertEqual(response.data["field_errors"]["description"], "Add a clearer description of the issue.")

    @override_settings(OLLAMA_API_KEY="test-key")
    @patch("apps.concerns.ai.classification.GemmaAnalyzer")
    def test_resident_precheck_model_failure_does_not_block(self, analyzer_cls):
        """When Gemma itself fails, the resident is not told to "add a clearer
        description" — nothing was reviewed, so the report goes to an official."""
        analyzer_cls.return_value.analyze.side_effect = RuntimeError("provider down")
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {
                "category": "others",
                "title": "test",
                "description": "May nakaharang na sasakyan sa kalsada malapit sa amin.",
                "latitude": "14.6507",
                "longitude": "121.1029",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["can_submit"])
        self.assertIn("could not run", response.data["message"])

    @patch("apps.concerns.classification_api.validate_concern_media_file", side_effect=lambda uploaded: uploaded)
    @patch("apps.concerns.classification_api.classification_payload")
    def test_resident_precheck_sends_all_photos_and_returns_verdicts(self, classify, _validate):
        classify.return_value = payload_from_result(
            gemma_result(
                category="vehicle",
                evidence_relationship="supports_report",
                image_review_succeeded=True,
                photo_verdicts=[
                    {"index": 0, "relevance": "supports_report", "note": "Shows the blocked driveway."},
                    {"index": 1, "relevance": "contradicts_report", "note": "Shows a parked motorcycle only."},
                ],
            ),
            selected_category="vehicle",
        )
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {
                "media": [png_upload("first.png"), png_upload("second.png")],
                "category": "vehicle",
                "title": "Blocked driveway",
                "description": "May sasakyang nakaharang sa driveway.",
                "latitude": "14.6507",
                "longitude": "121.1029",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["can_submit"])
        self.assertIsNone(classify.call_args.kwargs["images"])
        self.assertTrue(classify.call_args.kwargs["image_uploaded"])
        verdicts = response.data["photo_verdicts"]
        self.assertEqual([item["state"] for item in verdicts], ["relevant", "unrelated"])
        self.assertEqual(verdicts[0]["message"], "")

    @patch("apps.concerns.classification_api.validate_concern_media_file", side_effect=lambda uploaded: uploaded)
    @patch("apps.concerns.classification_api.classification_payload")
    def test_resident_precheck_fills_the_confirm_dialog_fields(self, classify, _validate):
        classify.return_value = payload_from_result(
            gemma_result(
                category="environment",
                evidence_relationship="supports_report",
                image_review_succeeded=True,
                urgent_attention=True,
                recommended_action="escalate_as_emergency",
            ),
            selected_category="vehicle",
        )
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {
                "media": png_upload(),
                "category": "vehicle",
                "title": "Blocked driveway",
                "description": "May sasakyang nakaharang sa driveway.",
                "latitude": "14.6507",
                "longitude": "121.1029",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["category_confirm_required"])
        self.assertTrue(response.data["suggested_category_label"])
        self.assertEqual(response.data["emergency_triage"]["is_emergency"], True)
        self.assertEqual(response.data["emergency_triage"]["escalation_offered"], True)
        self.assertIsNotNone(response.data["resolved_address"])
        self.assertIsNone(response.data["active_duplicate"])
        self.assertIsNone(response.data["resolved_match"])

    @patch("apps.concerns.classification_api.classification_payload")
    def test_resident_precheck_suggests_an_active_duplicate(self, classify):
        classify.return_value = payload_from_result(
            gemma_result(category="vehicle", evidence_relationship="supports_report", image_review_succeeded=True),
            selected_category="vehicle",
        )
        fingerprints = report_fingerprints(
            barangay="Marikina Heights",
            category="vehicle",
            title="Blocked driveway",
            description="May sasakyang nakaharang sa driveway.",
            latitude="14.6507",
            longitude="121.1029",
            precision=ConcernClassificationConfiguration.current().report_duplicate_location_precision,
        )
        existing = Concern.objects.create(
            reporter=self.resident,
            title="Blocked driveway",
            description="May sasakyang nakaharang sa driveway.",
            category="vehicle",
            report_fingerprint=fingerprints["report_fingerprint"],
            report_text_fingerprint=fingerprints["report_text_fingerprint"],
            report_location_bucket=fingerprints["report_location_bucket"],
        )
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {
                "category": "vehicle",
                "title": "Blocked driveway",
                "description": "May sasakyang nakaharang sa driveway.",
                "latitude": "14.6507",
                "longitude": "121.1029",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        duplicate = response.data["active_duplicate"]
        self.assertIsNotNone(duplicate)
        self.assertEqual(duplicate["concern_id"], existing.pk)
        self.assertEqual(duplicate["tracking_id"], existing.tracking_id)
        self.assertEqual(duplicate["reporter_count"], 1)

    def test_create_honors_duplicate_of_and_recurrence_of(self):
        self.client.force_authenticate(self.resident)
        original = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drain",
            description="May nakabara sa drainage sa kalsada.",
            category="infrastructure",
        )
        second = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drain again",
            description="Bumalik ang bara sa drainage.",
            category="infrastructure",
        )
        response = self.client.post(
            "/api/concerns/",
            {
                "title": "Blocked drain round three",
                "description": "Ang drainage sa kalsada ay nabara muli ngayon.",
                "category": "infrastructure",
                "visibility": "community",
                "address": "Bayan-Bayanan St.",
                "latitude": "14.6515000",
                "longitude": "121.1207000",
                "location_source": "manual_pin",
                "duplicate_of": str(original.pk),
                "recurrence_of": str(second.pk),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        created = Concern.objects.get(pk=response.data["id"])
        self.assertEqual(created.duplicate_of_id, original.pk)
        self.assertEqual(created.recurrence_of_id, second.pk)

    def test_stats_do_not_claim_unmeasured_accuracy(self):
        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/stats/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["accuracy"])

    @override_settings(OLLAMA_API_KEY="test-key")
    @patch("ollama.Client")
    def test_sample_generator_returns_a_generated_description(self, client):
        client.return_value.chat.return_value = SimpleNamespace(
            message=SimpleNamespace(content="May malaking butas sa kalsada malapit sa ilaw-dagitab.")
        )
        self.client.force_authenticate(self.official)

        response = self.client.post(
            "/api/concerns/classification/generate-sample/",
            {"category": "infrastructure", "mode": "matching", "language": "filipino"},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["description"], "May malaking butas sa kalsada malapit sa ilaw-dagitab.")
        sent = client.return_value.chat.call_args
        self.assertIn("marikina heights", sent.kwargs["messages"][1]["content"].lower())

    @override_settings(OLLAMA_API_KEY="")
    def test_sample_generator_requires_an_api_key(self):
        self.client.force_authenticate(self.official)
        response = self.client.post(
            "/api/concerns/classification/generate-sample/",
            {"category": "infrastructure", "mode": "matching", "language": "filipino"},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_sample_generator_rejects_unknown_mode_and_language(self):
        self.client.force_authenticate(self.official)
        for payload in (
            {"category": "infrastructure", "mode": "made-up", "language": "filipino"},
            {"category": "infrastructure", "mode": "matching", "language": "klingon"},
        ):
            response = self.client.post("/api/concerns/classification/generate-sample/", payload, format="multipart")
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ClassificationServiceStatusTests(APITestCase):
    """The config screen reports whether each service is working, in words."""

    def setUp(self):
        User = get_user_model()
        self.official = User.objects.create_user(
            email="service-status-official@example.com", phone_number="+639180000201",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )
        grant_captain(self.official)
        self.client.force_authenticate(self.official)

    def tearDown(self):
        ConcernClassificationConfiguration.objects.filter(pk=1).delete()

    @override_settings(OLLAMA_API_KEY="", ROBOFLOW_API_KEY="")
    def test_missing_keys_report_unavailable(self):
        response = self.client.get("/api/concerns/classification/")
        self.assertEqual(response.data["services"]["report_review"]["status"], "unavailable")
        self.assertEqual(response.data["services"]["media_protection"]["status"], "unavailable")

    @override_settings(OLLAMA_API_KEY="test-key", ROBOFLOW_API_KEY="test-key")
    def test_configured_keys_report_available(self):
        response = self.client.get("/api/concerns/classification/")
        self.assertEqual(response.data["services"]["report_review"]["status"], "available")
        self.assertEqual(response.data["services"]["media_protection"]["status"], "available")

    @override_settings(OLLAMA_API_KEY="test-key", ROBOFLOW_API_KEY="test-key")
    def test_recent_photo_review_failures_report_limited(self):
        """Text still works, photos do not — the state the old UI could not say."""
        User = get_user_model()
        resident = User.objects.create_user(
            email="service-status-resident@example.com", phone_number="+639180000202",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(reporter=resident, title="Photo failed", category=Concern.Category.OTHERS)
        ConcernAiAssessment.objects.create(
            concern=concern,
            status=ConcernAiAssessment.Status.COMPLETED,
            image_review_succeeded=False,
        )

        response = self.client.get("/api/concerns/classification/")

        self.assertEqual(response.data["services"]["report_review"]["status"], "limited")


class ConcernAiTextProviderPipelineTests(TestCase):
    """How process_concern_ai records the analyzer's availability and result."""

    def setUp(self):
        self.resident = get_user_model().objects.create_user(
            email="nlp-provider-resident@example.com", phone_number="+639180000102",
            password="pass", role=get_user_model().Role.RESIDENT, status=get_user_model().Status.VERIFIED,
        )

    def tearDown(self):
        ConcernClassificationConfiguration.objects.filter(pk=1).delete()

    def _make_concern(self, **overrides):
        defaults = dict(
            reporter=self.resident,
            title="Baradong kanal",
            description="May baradong kanal at lubak sa aming kalsada.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        defaults.update(overrides)
        return Concern.objects.create(**defaults)

    @override_settings(OLLAMA_API_KEY="")
    def test_missing_ollama_key_uses_safe_intake_fallback(self):
        concern = self._make_concern()

        assessment = process_concern_ai(concern.id)

        review = assessment.raw_result["review"]
        self.assertEqual(review["provider"], "ollama_cloud")
        self.assertIn("fallback_reason", review)
        self.assertEqual(assessment.nlp_validity, "needs_review")
        self.assertEqual(assessment.status, ConcernAiAssessment.Status.NOT_CONFIGURED)
        self.assertEqual(assessment.recommended_action, "accept")
        concern.refresh_from_db()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_analyzer_is_called_with_the_report_and_no_detector_evidence(self):
        concern = self._make_concern()

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.INFRASTRUCTURE,
            )
            assessment = process_concern_ai(concern.id)

        classifier.assert_called_once()
        classifier.return_value.analyze.assert_called_once_with(
            title=concern.title,
            description=concern.description,
            selected_category=concern.category,
            images=[],
            image_uploaded=False,
        )
        review = assessment.raw_result["review"]
        self.assertEqual(review["provider"], "ollama_cloud")
        self.assertNotIn("fallback_reason", review)
        self.assertEqual(assessment.nlp_validity, "related_infrastructure")

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_analyzer_failure_fails_open_without_rejecting_report(self):
        concern = self._make_concern()

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.side_effect = RuntimeError("weights corrupted")
            assessment = process_concern_ai(concern.id)

        review = assessment.raw_result["review"]
        self.assertIn("RuntimeError", review["fallback_reason"])
        self.assertEqual(assessment.nlp_validity, "needs_review")
        self.assertEqual(assessment.status, ConcernAiAssessment.Status.FAILED)
        # A broken model does not discard a real report.
        concern.refresh_from_db()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_suspicious_flag_fires_from_the_result_flag(self):
        concern = self._make_concern()

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = replace(
                gemma_result(relevance="IRRELEVANT", recommended_action="reject_as_irrelevant"),
                is_suspicious=True,
            )
            assessment = process_concern_ai(concern.id)

        self.assertTrue(assessment.flagged)
        self.assertIn("suspicious_text", [reason["reason"] for reason in assessment.flag_reasons])
        concern.refresh_from_db()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.REJECTED)
        self.assertEqual(concern.status, Concern.Status.REJECTED)
        self.assertEqual(concern.rejection_code, "automated_irrelevant")

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_category_mismatch_is_corrected_without_manual_review(self):
        concern = self._make_concern(category=Concern.Category.ENVIRONMENT)

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.INFRASTRUCTURE,
                selected_category_match=False,
                recommended_action="accept",
            )
            assessment = process_concern_ai(concern.id)

        self.assertFalse(assessment.category_match)
        self.assertTrue(assessment.flagged)
        self.assertIn("category_mismatch", [reason["reason"] for reason in assessment.flag_reasons])
        self.assertEqual(assessment.recommended_action, "accept")
        self.assertNotEqual(assessment.recommended_action, "reject_as_irrelevant")
        concern.refresh_from_db()
        self.assertNotEqual(concern.status, Concern.Status.REJECTED)
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)
        self.assertEqual(concern.category, Concern.Category.INFRASTRUCTURE)


class GemmaParserTests(TestCase):
    VALID_JSON = (
        '{"relevance":"VALID","primary_category":"vehicle","possible_categories":["public_safety"],'
        '"selected_category_match":true,"detected_objects":["vehicle","residential gate"],'
        '"text_assessment":"A vehicle is blocking a driveway.",'
        '"photo_assessment":"The photo shows a car in front of a gate.",'
        '"evidence_relationship":"supports_report","missing_information":[],"urgent_attention":false,'
        '"severity":"medium","privacy_scan_required":true,'
        '"privacy_scan_reasons":["A plate may be readable."],'
        '"suspected_sensitive_classes":["license plate"],"ai_result_uncertain":false,'
        '"recommended_action":"accept_with_privacy_review",'
        '"short_explanation":"The description reports a blocked driveway and the photo shows a vehicle in front of a gate, which supports the report."}'
    )

    @override_settings(OLLAMA_API_KEY="test-key")
    @patch("ollama.Client")
    def test_analyzer_reads_an_object_style_ollama_response(self, client):
        client.return_value.chat.return_value = SimpleNamespace(
            message=SimpleNamespace(content=self.VALID_JSON)
        )

        result = GemmaAnalyzer().analyze(
            title="Blocked driveway",
            description="May sasakyang nakaharang sa driveway.",
            selected_category="vehicle",
        )

        self.assertEqual(result.category, "vehicle")
        self.assertEqual(client.return_value.chat.call_args.kwargs["format"], "json")

    def test_parser_accepts_markdown_wrapped_json(self):
        result = parse_gemma_result(
            f"```json\n{self.VALID_JSON}\n```",
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_attached=True,
            image_review_succeeded=True,
        )

        self.assertEqual(result.category, "vehicle")
        self.assertEqual(result.details["evidence_relationship"], "supports_report")
        self.assertEqual(result.details["possible_categories"], ["public_safety"])
        self.assertEqual(result.details["suspected_sensitive_classes"], ["license plate"])

    def test_unreadable_output_uses_safe_fallback_without_claiming_anything(self):
        result = parse_gemma_result(
            "This should be reviewed by an official.",
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_attached=True,
            image_review_succeeded=True,
        )

        self.assertEqual(result.label, "needs_review")
        self.assertTrue(result.details["ai_result_uncertain"])
        self.assertEqual(result.details["recommended_action"], "accept")
        self.assertFalse(result.details["privacy_scan_required"])

    def test_gemma_may_name_any_concrete_object_to_blur(self):
        """SAM3 is open-vocabulary, so the class list is not fixed."""
        content = self.VALID_JSON.replace(
            '"suspected_sensitive_classes":["license plate"]',
            '"suspected_sensitive_classes":["license plate","house number","tattoo"]',
        )

        result = parse_gemma_result(
            content,
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_attached=True,
            image_review_succeeded=True,
        )

        self.assertEqual(
            result.details["suspected_sensitive_classes"],
            ["license plate", "house number", "tattoo"],
        )

    def test_abstract_classes_are_dropped_before_the_scan(self):
        """A segmenter cannot find an "injury", and an empty scan looks clear."""
        content = self.VALID_JSON.replace(
            '"suspected_sensitive_classes":["license plate"]',
            '"suspected_sensitive_classes":["injury","personal information","license plate"]',
        )

        result = parse_gemma_result(
            content,
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_attached=True,
            image_review_succeeded=True,
        )

        self.assertEqual(result.details["suspected_sensitive_classes"], ["license plate"])

    def test_a_privacy_suspicion_about_an_unread_photo_is_discarded(self):
        """A guess about an image nobody looked at must not become a scan."""
        result = parse_gemma_result(
            self.VALID_JSON,
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_attached=True,
            image_review_succeeded=False,
        )

        self.assertFalse(result.details["privacy_scan_required"])
        self.assertEqual(result.details["suspected_sensitive_classes"], [])
        self.assertEqual(result.details["evidence_relationship"], "image_review_failed")
        # And nothing was "observed", because nothing was seen.
        self.assertEqual(result.details["detected_objects"], [])

    def test_no_photo_is_reported_as_unavailable_not_as_a_failure(self):
        result = parse_gemma_result(
            self.VALID_JSON,
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_attached=False,
        )

        self.assertEqual(result.details["evidence_relationship"], "image_unavailable")
        self.assertEqual(result.details["detected_objects"], [])

    def test_an_urgent_report_is_never_recommended_for_plain_acceptance(self):
        content = self.VALID_JSON.replace('"urgent_attention":false', '"urgent_attention":true').replace(
            '"recommended_action":"accept_with_privacy_review"', '"recommended_action":"accept"'
        )

        result = parse_gemma_result(
            content,
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_attached=True,
            image_review_succeeded=True,
        )

        self.assertEqual(result.details["recommended_action"], "escalate_as_emergency")

    def test_payload_marks_a_category_mismatch_as_needs_review(self):
        content = self.VALID_JSON.replace('"selected_category_match":true', '"selected_category_match":false')
        result = parse_gemma_result(
            content,
            model_version="gemma4:cloud",
            selected_category="public_safety",
            image_attached=True,
            image_review_succeeded=True,
        )

        payload = payload_from_result(result, selected_category="public_safety")

        self.assertFalse(payload["category_match"])
        self.assertEqual(payload["outcome"], "needs_review")


from apps.concerns.ai.community_moderation_analyzer import FAIL_OPEN_RESULT


class CommunityModerationSimulationViewTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.official = User.objects.create_user(
            email="community-sim-official@example.com", phone_number="+639180000101",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )
        grant_captain(self.official)
        self.resident = User.objects.create_user(
            email="community-sim-resident@example.com", phone_number="+639180000102",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )

    @patch("apps.concerns.ai.community_moderation_analyzer.analyze_flagged_content")
    def test_official_can_simulate_a_flagged_comment(self, analyze):
        analyze.return_value = {
            "assessment": "clearly_violates",
            "matched_reason": "abusive",
            "recommended_disposition": "take_down",
            "short_explanation": "Hostile language directed at staff.",
        }
        self.client.force_authenticate(self.official)
        response = self.client.post("/api/concerns/classification/test-community/", {
            "content_text": "Kayong mga tanod, wala kayong ginagawa.",
            "reason": ContentFlag.Reason.ABUSIVE,
            "reporter_note": "",
        }, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assessment"], "clearly_violates")
        self.assertEqual(response.data["matched_reason"], "abusive")
        self.assertEqual(response.data["recommended_disposition"], "take_down")
        self.assertEqual(LlmDecisionLog.objects.count(), 1)
        log = LlmDecisionLog.objects.get()
        self.assertEqual(log.run_kind, LlmDecisionLog.RunKind.SIMULATION)
        self.assertEqual(log.domain, LlmDecisionLog.Domain.COMMUNITY)
        self.assertEqual(log.performed_by_id, self.official.pk)
        self.assertEqual(log.recommended_action, "take_down")
        # Never persisted: the simulation must not create a real flag.
        self.assertEqual(ContentFlag.objects.count(), 0)

    def test_resident_cannot_simulate(self):
        self.client.force_authenticate(self.resident)
        response = self.client.post("/api/concerns/classification/test-community/", {
            "content_text": "some text", "reason": ContentFlag.Reason.OTHER,
        }, format="json")
        self.assertEqual(response.status_code, 403)

    def test_blank_content_text_is_rejected(self):
        self.client.force_authenticate(self.official)
        response = self.client.post("/api/concerns/classification/test-community/", {
            "content_text": "   ", "reason": ContentFlag.Reason.OTHER,
        }, format="json")
        self.assertEqual(response.status_code, 400)

    def test_invalid_reason_is_rejected(self):
        self.client.force_authenticate(self.official)
        response = self.client.post("/api/concerns/classification/test-community/", {
            "content_text": "some text", "reason": "not_a_real_reason",
        }, format="json")
        self.assertEqual(response.status_code, 400)

    @patch(
        "apps.concerns.ai.community_moderation_analyzer.analyze_flagged_content",
        return_value=dict(FAIL_OPEN_RESULT),
    )
    def test_analyzer_failure_fails_open_and_still_logs(self, analyze):
        self.client.force_authenticate(self.official)
        response = self.client.post("/api/concerns/classification/test-community/", {
            "content_text": "some text", "reason": ContentFlag.Reason.OTHER,
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["recommended_disposition"], "dismiss")
        self.assertEqual(LlmDecisionLog.objects.count(), 1)
