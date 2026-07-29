from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from unittest.mock import patch
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.text_classifier import TextClassificationResult, TextClassifierNotConfigured
from apps.concerns.models import Concern, ConcernAiAssessment, ConcernClassificationConfiguration
from apps.concerns.ai.image_detector import ImageDetectionResult


class ConcernClassificationApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.official = User.objects.create_user(
            email="classification-official@example.com", phone_number="+639180000001",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )
        self.resident = User.objects.create_user(
            email="classification-resident@example.com", phone_number="+639180000002",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )

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
        self.assertEqual(response.data["image_model"], "yolov8m.pt")
        self.assertEqual(response.data["text_relevance_threshold"], 0.72)
        self.assertEqual({item["key"] for item in response.data["categories"]}, {"infrastructure", "environment", "public_safety", "vehicle", "others"})
        self.assertFalse(next(item for item in response.data["categories"] if item["key"] == "others")["enabled"])
        self.assertEqual(len(response.data["supported_classes"]), 15)
        self.assertIn("traffic light", response.data["supported_classes"])
        self.assertIn("car", response.data["supported_classes"])
        self.assertIn("person", response.data["supported_classes"])
        self.assertNotIn("floodwater", response.data["supported_classes"])
        self.assertTrue(any(item["key"] == "emergency:fire" for item in response.data["mapping_targets"]))
        self.assertEqual(ConcernClassificationConfiguration.current().relevance_threshold, 0.72)

        reset = self.client.post("/api/concerns/classification/reset/", {}, format="json")
        self.assertEqual(reset.status_code, status.HTTP_200_OK)
        self.assertEqual(reset.data["text_relevance_threshold"], 0.65)

    def test_configuration_rejects_non_base_text_model(self):
        self.client.force_authenticate(self.official)
        response = self.client.patch("/api/concerns/classification/", {
            "text_model": "custom-roberta-checkpoint",
        }, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("text_model", response.data)

    def test_tagalog_baseline_detects_matching_concern(self):
        self.client.force_authenticate(self.official)
        response = self.client.post("/api/concerns/classification/test-text/", {
            "title": "Baradong kanal", "description": "May baradong kanal at lubak sa aming kalsada.",
            "category": "infrastructure",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["classification"], "related")
        self.assertEqual(response.data["outcome"], "approved")
        self.assertTrue(response.data["category_match"])
        self.assertFalse(response.data["calibrated"])

    def test_suspicious_text_is_sent_to_manual_review(self):
        self.client.force_authenticate(self.official)
        response = self.client.post("/api/concerns/classification/test-text/", {
            "title": "test", "description": "asdf asdf asdf asdf asdf", "category": "others",
        }, format="json")
        self.assertEqual(response.data["classification"], "suspicious")
        self.assertEqual(response.data["outcome"], "flagged")

    @override_settings(EBOSES_YOLO_MODEL_PATH="")
    def test_missing_yolo_weights_fails_safe_to_review(self):
        self.client.force_authenticate(self.official)
        from django.core.files.uploadedfile import SimpleUploadedFile
        from io import BytesIO
        from PIL import Image, ImageDraw
        output = BytesIO()
        image = Image.new("RGB", (800, 600), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((50, 50, 750, 550), fill=(60, 100, 140))
        draw.ellipse((250, 150, 550, 450), fill=(230, 180, 50))
        draw.text((80, 80), "SYNTHETIC ROAD TEST", fill="black")
        image.save(output, "PNG")
        upload = SimpleUploadedFile("safe-test.png", output.getvalue(), content_type="image/png")
        response = self.client.post("/api/concerns/classification/test-image/", {"file": upload, "category": "infrastructure"}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["outcome"], "needs_review")
        self.assertFalse(response.data["available"])

    @override_settings(EBOSES_YOLO_MODEL_PATH="configured.pt")
    @patch("apps.concerns.classification_api.os.path.exists", return_value=True)
    @patch("apps.concerns.classification_api.YoloImageDetector")
    def test_image_result_includes_annotated_inference_preview(self, detector, _exists):
        self.client.force_authenticate(self.official)
        detector.return_value.detect.return_value = ImageDetectionResult(
            objects=[{"label": "traffic light", "confidence": 0.93, "bbox": [10, 20, 100, 160], "source": "safe.png"}],
            confidence=0.93,
            model_version="yolov8m.pt",
            annotated_image="data:image/jpeg;base64,c2FmZQ==",
        )
        from django.core.files.uploadedfile import SimpleUploadedFile
        from io import BytesIO
        from PIL import Image, ImageDraw
        output = BytesIO()
        image = Image.new("RGB", (800, 600), "white")
        ImageDraw.Draw(image).rectangle((50, 50, 750, 550), fill=(60, 100, 140))
        image.save(output, "PNG")
        upload = SimpleUploadedFile("safe.png", output.getvalue(), content_type="image/png")
        response = self.client.post(
            "/api/concerns/classification/test-image/",
            {"file": upload, "category": "infrastructure"},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["annotated_image"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(response.data["objects"][0]["bbox"], [10, 20, 100, 160])

    def test_stats_do_not_claim_unmeasured_accuracy(self):
        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/stats/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["accuracy"])


class ConcernClassificationNlpProviderConfigTests(APITestCase):
    """Task 0.7: nlp_provider config validation and truthful availability reporting."""

    def setUp(self):
        User = get_user_model()
        self.official = User.objects.create_user(
            email="nlp-provider-official@example.com", phone_number="+639180000101",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )

    def tearDown(self):
        ConcernClassificationConfiguration.objects.filter(pk=1).delete()

    def test_rejects_unknown_nlp_provider(self):
        self.client.force_authenticate(self.official)
        response = self.client.patch("/api/concerns/classification/", {
            "nlp_provider": "some_unsupported_provider",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("nlp_provider", response.data)
        self.assertEqual(ConcernClassificationConfiguration.current().nlp_provider, "keyword_baseline")

    @override_settings(EBOSES_NLP_MODEL_PATH="")
    def test_accepts_and_preserves_roberta_tagalog_provider(self):
        self.client.force_authenticate(self.official)
        response = self.client.patch("/api/concerns/classification/", {
            "nlp_provider": "roberta_tagalog",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["nlp_provider"], "roberta_tagalog")
        self.assertEqual(ConcernClassificationConfiguration.current().nlp_provider, "roberta_tagalog")
        # No EBOSES_NLP_MODEL_PATH configured -> reported truthfully as unavailable.
        self.assertFalse(response.data["text_available"])

    @override_settings(EBOSES_NLP_MODEL_PATH="")
    def test_keyword_baseline_text_is_always_available(self):
        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/")
        self.assertEqual(response.data["nlp_provider"], "keyword_baseline")
        self.assertTrue(response.data["text_available"])

    @patch("apps.concerns.classification_api.os.path.exists", return_value=True)
    @override_settings(EBOSES_NLP_MODEL_PATH="configured-nlp-path")
    def test_roberta_tagalog_is_available_when_model_path_exists(self, _exists):
        self.client.force_authenticate(self.official)
        self.client.patch("/api/concerns/classification/", {"nlp_provider": "roberta_tagalog"}, format="json")
        response = self.client.get("/api/concerns/classification/")
        self.assertEqual(response.data["nlp_provider"], "roberta_tagalog")
        self.assertTrue(response.data["text_available"])


class ConcernAiTextProviderPipelineTests(TestCase):
    """Task 0.7: config-driven classifier selection inside process_concern_ai."""

    def setUp(self):
        User = get_user_model()
        self.resident = get_user_model().objects.create_user(
            email="nlp-provider-resident@example.com", phone_number="+639180000102",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
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

    def _set_provider(self, provider: str):
        config = ConcernClassificationConfiguration.current()
        config.nlp_provider = provider
        config.save(update_fields=["nlp_provider"])
        return config

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="")
    def test_default_config_keeps_keyword_baseline_unchanged(self):
        concern = self._make_concern()
        with patch("apps.concerns.ai.text_classifier.RobertaTagalogClassifier") as classifier:
            assessment = process_concern_ai(concern.id)

        classifier.assert_not_called()
        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "keyword_baseline")
        self.assertNotIn("fallback_reason", text_payload)
        self.assertEqual(assessment.nlp_validity, "related_infrastructure")
        self.assertEqual(text_payload["model_version"], "multilingual-keyword-v1")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="configured-nlp-path")
    def test_roberta_provider_is_used_and_recorded_when_configured(self):
        self._set_provider("roberta_tagalog")
        concern = self._make_concern()
        fake_result = TextClassificationResult(
            label="related_infrastructure",
            confidence=0.88,
            category=Concern.Category.INFRASTRUCTURE,
            severity="medium",
            model_version="roberta-tagalog-fake",
        )

        with patch("apps.concerns.ai.text_classifier.RobertaTagalogClassifier") as classifier:
            classifier.return_value.classify.return_value = fake_result
            assessment = process_concern_ai(concern.id)

        classifier.assert_called_once_with("configured-nlp-path")
        classifier.return_value.classify.assert_called_once_with(
            title=concern.title, description=concern.description,
        )
        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "roberta_tagalog")
        self.assertNotIn("fallback_reason", text_payload)
        self.assertEqual(text_payload["model_version"], "roberta-tagalog-fake")
        self.assertEqual(assessment.nlp_validity, "related_infrastructure")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="")
    def test_roberta_provider_falls_back_to_keyword_when_model_path_missing(self):
        self._set_provider("roberta_tagalog")
        concern = self._make_concern()

        with patch("apps.concerns.ai.text_classifier.RobertaTagalogClassifier") as classifier:
            assessment = process_concern_ai(concern.id)

        classifier.assert_not_called()
        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "keyword_baseline")
        self.assertIn("fallback_reason", text_payload)
        self.assertEqual(assessment.nlp_validity, "related_infrastructure")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="configured-nlp-path")
    def test_roberta_provider_falls_back_when_inference_raises(self):
        self._set_provider("roberta_tagalog")
        concern = self._make_concern()

        with patch("apps.concerns.ai.text_classifier.RobertaTagalogClassifier") as classifier:
            classifier.return_value.classify.side_effect = RuntimeError("weights corrupted")
            assessment = process_concern_ai(concern.id)

        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "keyword_baseline")
        self.assertIn("fallback_reason", text_payload)
        self.assertIn("RuntimeError", text_payload["fallback_reason"])
        self.assertEqual(assessment.nlp_validity, "related_infrastructure")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="configured-nlp-path")
    def test_roberta_provider_records_underlying_not_configured_reason(self):
        self._set_provider("roberta_tagalog")
        concern = self._make_concern()

        with patch("apps.concerns.ai.text_classifier.RobertaTagalogClassifier") as classifier:
            classifier.return_value.classify.side_effect = TextClassifierNotConfigured(
                "Tagalog RoBERTa model path is not configured."
            )
            assessment = process_concern_ai(concern.id)

        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "keyword_baseline")
        self.assertEqual(text_payload["fallback_reason"], "Tagalog RoBERTa model path is not configured.")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="configured-nlp-path")
    def test_roberta_suspicious_flag_fires_on_model_native_label_not_keyword_vocabulary(self):
        # Fix round 1: the fine-tuned RoBERTa checkpoint emits its own label
        # vocabulary (here "LABEL_3_scam_report"), which does not contain the
        # keyword baseline's "suspicious"/"fake" substrings. Flagging must be
        # driven by the explicit `is_suspicious` boolean on the result, not by
        # sniffing `label` text, so this must still flag as suspicious_text.
        self._set_provider("roberta_tagalog")
        concern = self._make_concern()
        native_label_result = TextClassificationResult(
            label="LABEL_3_scam_report",
            confidence=0.97,
            category="",
            severity="medium",
            model_version="roberta-tagalog-fake",
            is_suspicious=True,
            is_irrelevant=False,
        )

        with patch("apps.concerns.ai.text_classifier.RobertaTagalogClassifier") as classifier:
            classifier.return_value.classify.return_value = native_label_result
            assessment = process_concern_ai(concern.id)

        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "roberta_tagalog")
        self.assertEqual(text_payload["label"], "LABEL_3_scam_report")
        self.assertTrue(assessment.flagged)
        self.assertIn(
            "suspicious_text",
            [reason["reason"] for reason in assessment.flag_reasons],
        )

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="configured-nlp-path")
    def test_roberta_irrelevant_flag_fires_on_model_native_label_not_keyword_vocabulary(self):
        # Same bug, other flag: a model-native "off_topic_chatter" label has
        # no substring overlap with the keyword baseline's "needs_review"
        # label, so this only flags correctly if the pipeline reads
        # `is_irrelevant` instead of comparing `label == "needs_review"`.
        self._set_provider("roberta_tagalog")
        concern = self._make_concern()
        native_label_result = TextClassificationResult(
            label="off_topic_chatter",
            confidence=0.6,
            category="",
            severity="medium",
            model_version="roberta-tagalog-fake",
            is_suspicious=False,
            is_irrelevant=True,
        )

        with patch("apps.concerns.ai.text_classifier.RobertaTagalogClassifier") as classifier:
            classifier.return_value.classify.return_value = native_label_result
            assessment = process_concern_ai(concern.id)

        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "roberta_tagalog")
        self.assertEqual(text_payload["label"], "off_topic_chatter")
        self.assertTrue(assessment.flagged)
        self.assertIn(
            "irrelevant_text",
            [reason["reason"] for reason in assessment.flag_reasons],
        )
