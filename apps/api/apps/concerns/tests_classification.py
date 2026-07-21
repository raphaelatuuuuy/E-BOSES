from django.contrib.auth import get_user_model
from django.test import override_settings
from unittest.mock import patch
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.models import ConcernClassificationConfiguration
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
        self.assertEqual({item["key"] for item in response.data["categories"]}, {"infrastructure", "environment", "public_safety", "others"})
        self.assertFalse(next(item for item in response.data["categories"] if item["key"] == "others")["enabled"])
        self.assertEqual(len(response.data["supported_classes"]), 80)
        self.assertIn("traffic light", response.data["supported_classes"])
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
