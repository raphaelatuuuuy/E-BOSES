from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from types import SimpleNamespace
from unittest.mock import patch
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.ai import process_concern_ai
from apps.concerns.models import Concern, ConcernAiAssessment, ConcernClassificationConfiguration
from apps.concerns.ai.image_detector import ImageDetectionResult
from apps.concerns.ai.ollama_text_classifier import OllamaTextClassifier, parse_ollama_result, payload_from_result
from apps.concerns.ai.text_classifier import TextClassificationResult


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

    def test_classification_supported_classes_stay_at_15(self):
        ConcernClassificationConfiguration.objects.filter(pk=1).delete()
        ConcernClassificationConfiguration.objects.create(pk=1, supported_classes=[])

        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["supported_classes"]), 15)
        self.assertEqual(response.data["supported_classes"], [
            "person",
            "bicycle",
            "car",
            "motorcycle",
            "bus",
            "truck",
            "bench",
            "parking meter",
            "traffic light",
            "knife",
            "dog",
            "cat",
            "handbag",
            "backpack",
            "suitcase",
        ])

    def test_configuration_rejects_non_base_text_model(self):
        self.client.force_authenticate(self.official)
        response = self.client.patch("/api/concerns/classification/", {
            "text_model": "custom-roberta-checkpoint",
        }, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("text_model", response.data)

    @override_settings(OLLAMA_API_KEY="test-key")
    @patch("apps.concerns.ai.ollama_text_classifier.OllamaTextClassifier.classify")
    def test_ollama_detects_matching_concern(self, classify):
        self.client.force_authenticate(self.official)
        classify.return_value = TextClassificationResult(
            label="related_infrastructure",
            confidence=0.84,
            category="infrastructure",
            severity="medium",
            model_version="gemma4:cloud",
            details={"relevance": "VALID", "recommended_action": "accept"},
        )
        response = self.client.post("/api/concerns/classification/test-text/", {
            "title": "Baradong kanal", "description": "May baradong kanal at lubak sa aming kalsada.",
            "category": "infrastructure",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["classification"], "related")
        self.assertEqual(response.data["outcome"], "approved")
        self.assertTrue(response.data["category_match"])
        self.assertFalse(response.data["calibrated"])
        classify.assert_called_once()

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

    @override_settings(EBOSES_YOLO_MODEL_PATH="configured.pt")
    @patch("apps.concerns.classification_api.os.path.exists", return_value=True)
    @patch("apps.concerns.classification_api.YoloImageDetector")
    def test_image_test_filters_to_supported_classes(self, detector, _exists):
        self.client.force_authenticate(self.official)
        detector.return_value.detect.return_value = ImageDetectionResult(
            objects=[
                {"label": "traffic light", "confidence": 0.93, "bbox": [10, 20, 100, 160], "source": "safe.png"},
                {"label": "airplane", "confidence": 0.99, "bbox": [1, 2, 3, 4], "source": "safe.png"},
            ],
            confidence=0.96,
            model_version="yolov8m.pt",
            annotated_image="",
        )
        from django.core.files.uploadedfile import SimpleUploadedFile
        from io import BytesIO
        from PIL import Image, ImageDraw
        output = BytesIO()
        image = Image.new("RGB", (800, 600), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((50, 50, 750, 550), fill=(60, 100, 140))
        draw.ellipse((250, 150, 550, 450), fill=(230, 180, 50))
        draw.text((80, 80), "SYNTHETIC TEST", fill="black")
        image.save(output, "PNG")
        upload = SimpleUploadedFile("safe.png", output.getvalue(), content_type="image/png")

        response = self.client.post(
            "/api/concerns/classification/test-image/",
            {"file": upload, "category": "infrastructure"},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["label"] for item in response.data["objects"]], ["traffic light"])
        called_kwargs = detector.return_value.detect.call_args.kwargs
        self.assertEqual(called_kwargs["supported_classes"], ConcernClassificationConfiguration.current().supported_classes)
        self.assertEqual(called_kwargs["confidence_threshold"], ConcernClassificationConfiguration.current().image_confidence_threshold)

    @override_settings(EBOSES_YOLO_MODEL_PATH="configured.pt", OLLAMA_API_KEY="test-key")
    @patch("apps.concerns.classification_api.os.path.exists", return_value=True)
    @patch("apps.concerns.classification_api.classification_payload")
    @patch("apps.concerns.classification_api.YoloImageDetector")
    def test_submission_test_combines_text_and_image_evidence(self, detector, classify, _exists):
        self.client.force_authenticate(self.official)
        detector.return_value.detect.return_value = ImageDetectionResult(
            objects=[{"label": "car", "confidence": 0.91, "bbox": [10, 20, 100, 160], "source": "safe.png"}],
            confidence=0.91,
            model_version="yolov8m.pt",
            annotated_image="data:image/jpeg;base64,c2FmZQ==",
        )
        classify.return_value = {
            "outcome": "related",
            "confidence": 0.88,
            "category_match": True,
            "notice": "Vehicle blocking driveway; blur plate and face.",
            "model_version": "gemma4:cloud",
            "details": {
                "relevance": "VALID",
                "primary_category": "vehicle",
                "possible_categories": ["public_safety"],
                "content_flags": [],
                "image_flags": ["vehicle_detected", "license_plate_visible", "face_visible"],
                "privacy_sensitive_information_detected": True,
                "disturbing_content_detected": False,
                "urgent_attention": False,
                "evidence_relationship": "supports_report",
                "severity": "medium",
                "ai_result_uncertain": False,
                "recommended_action": "accept_with_privacy_review",
                "public_media_treatment": "blur_sensitive_details_before_public_display",
            },
        }
        from django.core.files.uploadedfile import SimpleUploadedFile
        from io import BytesIO
        from PIL import Image, ImageDraw
        output = BytesIO()
        image = Image.new("RGB", (800, 600), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((50, 50, 750, 550), fill=(60, 100, 140))
        draw.ellipse((250, 150, 550, 450), fill=(230, 180, 50))
        image.save(output, "PNG")
        upload = SimpleUploadedFile("safe.png", output.getvalue(), content_type="image/png")

        response = self.client.post(
            "/api/concerns/classification/test-submission/",
            {
                "file": upload,
                "category": "vehicle",
                "title": "Blocked driveway",
                "description": "May sasakyang nakaharang sa driveway sa Rosal Street.",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["primary_category"], "vehicle")
        self.assertEqual(response.data["possible_categories"], ["public_safety"])
        self.assertTrue(response.data["privacy_sensitive_information_detected"])
        self.assertEqual(response.data["image"]["detected_label"], "vehicle")
        self.assertEqual(response.data["image"]["objects"][0]["display_label"], "vehicle")
        self.assertEqual(classify.call_args.kwargs["image_objects"][0]["display_label"], "vehicle")

    @patch("apps.concerns.classification_api.validate_concern_media_file", side_effect=lambda uploaded: uploaded)
    @patch("apps.concerns.classification_api.classification_payload")
    def test_resident_precheck_passes_image_data_to_shared_classifier(self, classify, _validate):
        self.client.force_authenticate(self.resident)
        classify.return_value = {
            "outcome": "related",
            "confidence": 0.81,
            "category_match": True,
            "notice": "The text and photo support the report.",
            "model_version": "gemma4:cloud",
            "details": {
                "primary_category": "vehicle",
                "evidence_relationship": "supports_report",
                "recommended_action": "accept",
                "short_explanation": "The text and photo support the report.",
            },
        }
        from django.core.files.uploadedfile import SimpleUploadedFile
        from io import BytesIO
        from PIL import Image
        output = BytesIO()
        Image.new("RGB", (800, 600), "white").save(output, "PNG")
        upload = SimpleUploadedFile("safe.png", output.getvalue(), content_type="image/png")

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {"media": upload, "category": "vehicle", "title": "Blocked driveway", "description": "May sasakyang nakaharang sa driveway."},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["can_submit"])
        self.assertTrue(classify.call_args.kwargs["image_data"])
        self.assertEqual(classify.call_args.kwargs["image_mime_type"], "image/jpeg")

    def test_resident_precheck_blocks_low_information_text(self):
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/concerns/classification/precheck/",
            {"category": "others", "title": "test", "description": "asdf asdf qwerty 12345"},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["can_submit"])
        self.assertEqual(response.data["field_errors"]["description"], "Add a clearer description of the issue.")

    def test_stats_do_not_claim_unmeasured_accuracy(self):
        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/stats/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["accuracy"])


class ConcernClassificationNlpProviderConfigTests(APITestCase):
    """Ollama is the only text classification provider."""

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
        self.assertEqual(ConcernClassificationConfiguration.current().nlp_provider, "ollama_cloud")

    def test_rejects_roberta_tagalog_provider(self):
        self.client.force_authenticate(self.official)
        response = self.client.patch("/api/concerns/classification/", {
            "nlp_provider": "roberta_tagalog",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("nlp_provider", response.data)

    @override_settings(OLLAMA_API_KEY="")
    def test_ollama_text_is_unavailable_without_key(self):
        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/")
        self.assertEqual(response.data["nlp_provider"], "ollama_cloud")
        self.assertFalse(response.data["text_available"])

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ollama_text_is_available_with_key(self):
        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/classification/")
        self.assertEqual(response.data["nlp_provider"], "ollama_cloud")
        self.assertTrue(response.data["text_available"])


class ConcernAiTextProviderPipelineTests(TestCase):
    """Ollama-powered classifier selection inside process_concern_ai."""

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

    @override_settings(EBOSES_YOLO_MODEL_PATH="", OLLAMA_API_KEY="")
    def test_missing_ollama_key_routes_to_review(self):
        concern = self._make_concern()

        assessment = process_concern_ai(concern.id)

        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "ollama_cloud")
        self.assertIn("fallback_reason", text_payload)
        self.assertEqual(assessment.nlp_validity, "needs_review")
        self.assertEqual(text_payload["model_version"], "gemma4:31b")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", OLLAMA_API_KEY="test-key")
    def test_ollama_provider_is_used_and_recorded(self):
        concern = self._make_concern()
        fake_result = TextClassificationResult(
            label="related_infrastructure",
            confidence=0.88,
            category=Concern.Category.INFRASTRUCTURE,
            severity="medium",
            model_version="gemma4:cloud",
            details={"relevance": "VALID", "recommended_action": "accept"},
        )

        with patch("apps.concerns.ai.pipeline.OllamaTextClassifier") as classifier:
            classifier.return_value.classify.return_value = fake_result
            assessment = process_concern_ai(concern.id)

        classifier.assert_called_once()
        classifier.return_value.classify.assert_called_once_with(
            title=concern.title,
            description=concern.description,
            selected_category=concern.category,
            image_objects=[],
            image_data=None,
            image_mime_type="",
        )
        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "ollama_cloud")
        self.assertNotIn("fallback_reason", text_payload)
        self.assertEqual(text_payload["model_version"], "gemma4:cloud")
        self.assertEqual(assessment.nlp_validity, "related_infrastructure")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", OLLAMA_API_KEY="test-key")
    def test_ollama_provider_fails_safely_when_inference_raises(self):
        concern = self._make_concern()

        with patch("apps.concerns.ai.pipeline.OllamaTextClassifier") as classifier:
            classifier.return_value.classify.side_effect = RuntimeError("weights corrupted")
            assessment = process_concern_ai(concern.id)

        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "ollama_cloud")
        self.assertIn("fallback_reason", text_payload)
        self.assertIn("RuntimeError", text_payload["fallback_reason"])
        self.assertEqual(assessment.nlp_validity, "needs_review")

    @override_settings(EBOSES_YOLO_MODEL_PATH="", OLLAMA_API_KEY="test-key")
    def test_ollama_suspicious_flag_fires_from_result_flag(self):
        concern = self._make_concern()
        native_label_result = TextClassificationResult(
            label="possible_fake_report",
            confidence=0.6,
            category="",
            severity="medium",
            model_version="gemma4:cloud",
            is_suspicious=True,
            is_irrelevant=False,
            details={"relevance": "IRRELEVANT", "content_flags": ["possible_fake_report"]},
        )

        with patch("apps.concerns.ai.pipeline.OllamaTextClassifier") as classifier:
            classifier.return_value.classify.return_value = native_label_result
            assessment = process_concern_ai(concern.id)

        text_payload = assessment.raw_result["text"]
        self.assertEqual(text_payload["provider"], "ollama_cloud")
        self.assertEqual(text_payload["label"], "possible_fake_report")
        self.assertTrue(assessment.flagged)
        self.assertIn(
            "suspicious_text",
            [reason["reason"] for reason in assessment.flag_reasons],
        )


class OllamaTextClassifierParserTests(TestCase):
    @override_settings(OLLAMA_API_KEY="test-key")
    @patch("ollama.Client")
    def test_classifier_reads_object_style_ollama_response(self, client):
        client.return_value.chat.return_value = SimpleNamespace(
            message=SimpleNamespace(
                content='{"relevance":"VALID","primary_category":"vehicle","possible_categories":[],"selected_category_match":true,"content_flags":[],"image_flags":["vehicle_detected"],"privacy_sensitive_information_detected":false,"disturbing_content_detected":false,"urgent_attention":false,"evidence_relationship":"supports_report","severity":"medium","confidence":0.9,"ai_result_uncertain":false,"recommended_action":"accept","public_media_treatment":"safe_to_display","short_explanation":"Vehicle report matches the evidence."}'
            )
        )

        result = OllamaTextClassifier().classify(
            title="Blocked driveway",
            description="May sasakyang nakaharang sa driveway.",
            selected_category="vehicle",
            image_objects=[{"label": "car", "confidence": 0.91}],
        )

        self.assertEqual(result.category, "vehicle")
        self.assertEqual(result.confidence, 0.9)
        self.assertEqual(client.return_value.chat.call_args.kwargs["format"], "json")

    def test_parser_accepts_markdown_wrapped_json(self):
        content = """```json
        {
          "relevance": "VALID",
          "primary_category": "vehicle",
          "possible_categories": ["public_safety"],
          "selected_category_match": true,
          "content_flags": [],
          "image_flags": ["vehicle_detected"],
          "privacy_sensitive_information_detected": true,
          "disturbing_content_detected": false,
          "urgent_attention": false,
          "evidence_relationship": "supports_report",
          "severity": "medium",
          "confidence": 0.82,
          "ai_result_uncertain": false,
          "recommended_action": "accept_with_privacy_review",
          "public_media_treatment": "blur_sensitive_details_before_public_display",
          "short_explanation": "Vehicle evidence supports the report."
        }
        ```"""

        result = parse_ollama_result(content, model_version="gemma4:cloud", selected_category="vehicle")

        self.assertEqual(result.category, "vehicle")
        self.assertEqual(result.confidence, 0.82)
        self.assertEqual(result.details["evidence_relationship"], "supports_report")
        self.assertEqual(result.details["possible_categories"], ["public_safety"])

    def test_invalid_json_with_image_evidence_keeps_image_context(self):
        result = parse_ollama_result(
            "This should be reviewed by an official.",
            model_version="gemma4:cloud",
            selected_category="vehicle",
            image_objects=[{"label": "person", "confidence": 0.77}],
        )

        self.assertEqual(result.label, "needs_review")
        self.assertEqual(result.details["evidence_relationship"], "no_useful_image_evidence")
        self.assertIn("person_detected", result.details["image_flags"])
        self.assertIn("text_classifier_invalid_output", result.details["content_flags"])

    def test_photo_mapping_can_satisfy_selected_category_match(self):
        config = ConcernClassificationConfiguration.current()
        config.label_mappings = {**config.label_mappings, "car": "public_safety"}
        config.save(update_fields=["label_mappings", "updated_at"])
        content = '{"relevance":"VALID","primary_category":"vehicle","possible_categories":[],"selected_category_match":false,"content_flags":[],"image_flags":["vehicle_visible"],"privacy_sensitive_information_detected":false,"disturbing_content_detected":false,"urgent_attention":false,"evidence_relationship":"supports_report","severity":"medium","confidence":0.9,"ai_result_uncertain":false,"recommended_action":"accept","public_media_treatment":"safe_to_display","short_explanation":"The report and photo both describe a vehicle blocking access."}'

        result = parse_ollama_result(
            content,
            model_version="gemma4:cloud",
            selected_category="public_safety",
            configuration=config,
            image_objects=[{"label": "car", "category": "public_safety", "confidence": 0.91}],
            image_attached=True,
        )

        payload = payload_from_result(result, selected_category="public_safety")
        self.assertTrue(payload["category_match"])
        self.assertEqual(payload["outcome"], "related")
