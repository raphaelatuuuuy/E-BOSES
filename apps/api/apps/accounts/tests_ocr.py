"""
OCR integration tests using PaddleOCR API.

Requires a valid token in .env / settings (PADDLEOCR_TOKEN).
Tests are skipped when no token is configured.
"""

import os
from unittest.mock import patch

import requests
from django.conf import settings
from django.test import SimpleTestCase

from apps.accounts.ocr import ocr_file

TEST_IMAGE = "C:\\Users\\TO GOD BE THE GLORY\\Downloads\\5207cdef-1047-45a1-ab29-b7f0df616458.jpg"


class OCRApiTest(SimpleTestCase):
    """Live integration tests against the PaddleOCR API."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.has_token = bool(
            getattr(settings, "PADDLEOCR_TOKEN", None)
            or os.environ.get("PADDLEOCR_TOKEN")
        )
        cls.has_test_image = os.path.exists(TEST_IMAGE)

    def _skip_if_no_token(self):
        if not self.has_token:
            self.skipTest("PADDLEOCR_TOKEN not configured")

    def _skip_if_no_test_image(self):
        if not self.has_test_image:
            self.skipTest(f"Test image not found at {TEST_IMAGE}")

    def test_ocr_file_missing_path(self):
        """ocr_file should raise FileNotFoundError for a nonexistent path."""
        with self.assertRaises(FileNotFoundError):
            ocr_file("/nonexistent/image.png")

    @patch("apps.accounts.ocr.requests.post")
    def test_ocr_file_submission_failure(self, mock_post):
        """ocr_file should raise on HTTP errors during submission."""
        mock_post.side_effect = ConnectionError("connection refused")
        with self.assertRaises((ConnectionError,)):
            ocr_file("https://example.com/test.png")

    def test_ocr_missing_token_raises(self):
        """ocr_file should raise RuntimeError when token is empty."""
        with patch.object(settings, "PADDLEOCR_TOKEN", ""):
            with self.assertRaises(RuntimeError):
                ocr_file("https://example.com/test.png")

    def test_ocr_real_id_returns_text(self):
        """Given the barangay ID photo, OCR should return recognised text entries."""
        self._skip_if_no_token()
        self._skip_if_no_test_image()

        results = ocr_file(TEST_IMAGE)

        self.assertIsInstance(results, list)
        self.assertGreater(len(results), 0)

        for entry in results:
            self.assertIn("text", entry)
            self.assertIn("confidence", entry)
            self.assertIn("bbox", entry)
            self.assertIsInstance(entry["text"], str)
            self.assertIsInstance(entry["confidence"], (int, float))
