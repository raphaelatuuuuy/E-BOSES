"""
OCR integration tests using PaddleOCR API.

Requires a valid token in .env / settings (PADDLEOCR_TOKEN).
Tests are skipped when no token is configured.
"""

import os
from io import BytesIO
from unittest.mock import patch

import requests
from django.conf import settings
from django.core.files.base import ContentFile
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import (
    OCRConfigurationVersion,
    OCRServiceStatus,
    ResidenceProof,
    ResidenceVerificationCase,
    ResidentProfile,
    User,
    VerificationCheck,
)
from apps.accounts.ocr import OCRProviderUnavailable, ocr_file
from apps.accounts.ocr_engine import EngineResult, run_engine
from apps.accounts.ocr_runtime import decide_case, finalize_case_attempts, process_verification_case

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


def _png_content():
    image = Image.new("RGB", (420, 260), "white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class ConfigurableOCRWorkflowTests(TestCase):
    def test_duplicate_ocr_identifier_routes_registration_to_manual_review(self):
        configuration = OCRConfigurationVersion.objects.get(status="published")
        document_type = configuration.document_types.get(code="barangay_id")

        def registration_case(email, phone_number, digest):
            user = User.objects.create_user(
                email=email,
                phone_number=phone_number,
                password="Str0ng!Pass123",
                status=User.Status.PENDING_VERIFICATION,
            )
            ResidentProfile.objects.create(
                user=user,
                first_name="Juan",
                last_name="Dela Cruz",
                address="123 Sampaguita St, Marikina Heights",
                date_of_birth=timezone.now().date(),
            )
            content = _png_content()
            proof = ResidenceProof.objects.create(
                user=user,
                document_type=document_type,
                original_filename=f"{digest}.png",
                mime_type="image/png",
                file_size=len(content),
                sha256_hash=digest * 64,
            )
            proof.file.save(f"{digest}.png", ContentFile(content), save=True)
            case = ResidenceVerificationCase.objects.create(
                user=user,
                configuration=configuration,
                document_type=document_type,
                status=ResidenceVerificationCase.Status.PROCESSING,
            )
            proof.case = case
            proof.save(update_fields=["case"])
            attempt = VerificationCheck.objects.create(
                user=user,
                proof=proof,
                case=case,
                configuration=configuration,
                document_type=document_type,
                status=VerificationCheck.Status.PROCESSING,
                trigger=VerificationCheck.Trigger.REGISTRATION,
            )
            return user, case, attempt

        engine = EngineResult(
            detected_document_type_id=document_type.pk,
            detected_document_type_code=document_type.code,
            document_type_score=0.99,
            document_type_mismatch=False,
            confidence=0.98,
            extracted_fields={
                "document_number": {
                    "label": "Document number",
                    "value": "BRGY-ID-2026-00001",
                    "normalized": "BRGYID202600001",
                    "confidence": 0.98,
                }
            },
            rule_results=[],
            outcome="passed",
            review_reason="",
        )

        first_user, first_case, first_attempt = registration_case(
            "first-identity@example.com", "+639700000021", "a"
        )
        first_result = finalize_case_attempts(first_case.pk, [first_attempt], [], engine)
        self.assertEqual(first_result.status, ResidenceVerificationCase.Status.APPROVED)
        first_user.refresh_from_db()
        self.assertEqual(first_user.status, User.Status.VERIFIED)

        second_user, second_case, second_attempt = registration_case(
            "second-identity@example.com", "+639700000022", "b"
        )
        second_result = finalize_case_attempts(second_case.pk, [second_attempt], [], engine)

        self.assertEqual(second_result.status, ResidenceVerificationCase.Status.MANUAL_REVIEW)
        self.assertEqual(second_result.review_reason, ResidenceVerificationCase.ReviewReason.DUPLICATE_IDENTITY)
        second_user.refresh_from_db()
        self.assertEqual(second_user.status, User.Status.PENDING_VERIFICATION)
        second_attempt.refresh_from_db()
        self.assertTrue(second_attempt.duplicate_match_found)
        official = User.objects.create_user(
            email="duplicate-review-official@example.com",
            phone_number="+639700000023",
            password="Str0ng!Pass123",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        resident_client = APIClient()
        resident_client.force_authenticate(second_user)
        self.assertEqual(
            resident_client.get(f"/api/auth/ocr/verification-cases/{second_case.pk}/").status_code,
            403,
        )

        official_client = APIClient()
        official_client.force_authenticate(official)
        detail = official_client.get(f"/api/auth/ocr/verification-cases/{second_case.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["resident"]["id"], second_user.pk)
        self.assertTrue(detail.data["latest_attempt"]["duplicate_match_found"])
        self.assertEqual(
            detail.data["latest_attempt"]["duplicate_identity_matches"][0]["matching_user_id"],
            first_user.pk,
        )
        self.assertNotIn("value_hash", detail.data["latest_attempt"])

        approval = official_client.post(
            f"/api/auth/ocr/verification-cases/{second_case.pk}/decision/",
            {"decision": "approve", "reason": "The submitted card appears readable."},
            format="json",
        )
        self.assertEqual(approval.status_code, 409)
        self.assertIn("already belongs", str(approval.data))
        second_case.refresh_from_db()
        self.assertEqual(second_case.status, ResidenceVerificationCase.Status.MANUAL_REVIEW)

    def test_registration_soft_mismatch_remains_in_manual_review_queue(self):
        configuration = OCRConfigurationVersion.objects.get(status="published")
        document_type = configuration.document_types.get(code="barangay_certificate")
        user = User.objects.create_user(
            email="soft-review@example.com",
            phone_number="+639700000024",
            password="Str0ng!Pass123",
            status=User.Status.PENDING_VERIFICATION,
        )
        ResidentProfile.objects.create(
            user=user,
            first_name="Maria",
            last_name="Reyes",
            address="456 Sampaguita St, Marikina Heights",
            date_of_birth=timezone.now().date(),
        )
        content = _png_content()
        proof = ResidenceProof.objects.create(
            user=user,
            document_type=document_type,
            original_filename="soft-review.png",
            mime_type="image/png",
            file_size=len(content),
            sha256_hash="c" * 64,
        )
        proof.file.save("soft-review.png", ContentFile(content), save=True)
        case = ResidenceVerificationCase.objects.create(
            user=user,
            configuration=configuration,
            document_type=document_type,
            status=ResidenceVerificationCase.Status.PROCESSING,
        )
        proof.case = case
        proof.save(update_fields=["case"])
        attempt = VerificationCheck.objects.create(
            user=user,
            proof=proof,
            case=case,
            configuration=configuration,
            document_type=document_type,
            status=VerificationCheck.Status.PROCESSING,
            trigger=VerificationCheck.Trigger.REGISTRATION,
        )
        engine = EngineResult(
            detected_document_type_id=document_type.pk,
            detected_document_type_code=document_type.code,
            document_type_score=0.90,
            document_type_mismatch=False,
            confidence=0.72,
            extracted_fields={},
            rule_results=[],
            outcome="manual_review",
            review_reason=ResidenceVerificationCase.ReviewReason.LOW_CONFIDENCE,
        )

        result = finalize_case_attempts(case.pk, [attempt], [], engine)

        self.assertEqual(result.status, ResidenceVerificationCase.Status.MANUAL_REVIEW)
        self.assertEqual(result.review_reason, ResidenceVerificationCase.ReviewReason.LOW_CONFIDENCE)
        user.refresh_from_db()
        self.assertEqual(user.status, User.Status.PENDING_VERIFICATION)

    def test_migration_seeds_published_and_draft_policy(self):
        published = OCRConfigurationVersion.objects.get(scope="residence_proof", status="published")
        self.assertEqual(published.version, 1)
        self.assertTrue(OCRConfigurationVersion.objects.filter(scope="residence_proof", status="draft").exists())
        self.assertIn("electricity_bill", set(published.document_types.values_list("code", flat=True)))
        self.assertGreater(published.document_types.filter(fields__required=True).count(), 0)
        self.assertEqual(OCRServiceStatus.objects.get(provider="paddleocr").status, "not_configured")

    def test_barangay_id_front_card_vocabulary_is_configured(self):
        configuration = OCRConfigurationVersion.objects.get(status="draft")
        document = configuration.document_types.get(code="barangay_id")
        field_codes = set(document.fields.values_list("code", flat=True))
        self.assertTrue({"full_name", "address", "date_of_birth", "place_of_birth", "civil_status", "gender", "issue_date", "document_number", "expiry_date"}.issubset(field_codes))
        self.assertIn("identification card", document.keywords)
        self.assertIn("valid until", document.fields.get(code="expiry_date").aliases)
        self.assertTrue(configuration.rules.filter(code="barangay_id_document_keyword", document_type=document).exists())

    def test_published_failure_action_controls_automatic_outcome(self):
        user = User.objects.create_user(email="action-engine@example.com", password="Str0ng!Pass123")
        profile = ResidentProfile.objects.create(
            user=user,
            first_name="Sample",
            last_name="Resident",
            address="123 Sample Street",
            date_of_birth=timezone.now().date(),
        )
        configuration = OCRConfigurationVersion.objects.get(status="published")
        document_type = configuration.document_types.get(code="barangay_certificate")
        lines = [{"text": "BARANGAY CERTIFICATE", "confidence": 0.98}]

        configuration.settings = {**configuration.settings, "failure_action": "reject"}
        result = run_engine(configuration, document_type, profile, lines)
        self.assertEqual(result.outcome, "reject")

        configuration.settings = {**configuration.settings, "failure_action": "request_resubmission"}
        result = run_engine(configuration, document_type, profile, lines)
        self.assertEqual(result.outcome, "request_resubmission")

    def test_required_multi_field_rule_and_seeded_threshold_are_evaluated(self):
        user = User.objects.create_user(email="engine@example.com", password="Str0ng!Pass123")
        profile = ResidentProfile.objects.create(
            user=user,
            first_name="Juan",
            last_name="Dela Cruz",
            address="123 Sampaguita St, Marikina Heights",
            date_of_birth=timezone.now().date(),
        )
        configuration = OCRConfigurationVersion.objects.get(status="published")
        document_type = configuration.document_types.get(code="barangay_certificate")
        today = timezone.now().date().strftime("%m/%d/%Y")
        result = run_engine(
            configuration,
            document_type,
            profile,
            [
                {"text": "BARANGAY CERTIFICATE", "confidence": 0.98},
                {"text": "Resident Name: JUAN DELA CRUZ", "confidence": 0.98},
                {"text": "Address: 123 Sampaguita St, Marikina Heights", "confidence": 0.98},
                {"text": f"Issue Date: {today}", "confidence": 0.98},
            ],
        )
        self.assertEqual(result.outcome, "passed")
        self.assertGreaterEqual(result.confidence, 0.8)
        self.assertTrue(all(item["passed"] for item in result.rule_results))

    def test_provider_outage_routes_case_to_manual_review_without_rejecting_user(self):
        user = User.objects.create_user(email="outage@example.com", password="Str0ng!Pass123")
        ResidentProfile.objects.create(
            user=user,
            first_name="Juan",
            last_name="Dela Cruz",
            address="123 Sampaguita St, Marikina Heights",
            date_of_birth=timezone.now().date(),
        )
        configuration = OCRConfigurationVersion.objects.get(status="published")
        document_type = configuration.document_types.get(code="barangay_certificate")
        content = _png_content()
        proof = ResidenceProof.objects.create(
            user=user,
            document_type=document_type,
            original_filename="certificate.png",
            mime_type="image/png",
            file_size=len(content),
            sha256_hash="a" * 64,
        )
        proof.file.save("certificate.png", ContentFile(content), save=True)
        case = ResidenceVerificationCase.objects.create(
            user=user,
            configuration=configuration,
            document_type=document_type,
            status=ResidenceVerificationCase.Status.QUEUED,
        )
        proof.case = case
        proof.save(update_fields=["case"])

        class DownProvider:
            def recognize(self, content, *, suffix):
                raise OCRProviderUnavailable("provider offline")

        with patch.object(settings, "PADDLEOCR_TOKEN", "configured"):
            result = process_verification_case(case.pk, provider=DownProvider())
        self.assertEqual(result.status, ResidenceVerificationCase.Status.MANUAL_REVIEW)
        self.assertEqual(result.review_reason, ResidenceVerificationCase.ReviewReason.OCR_UNAVAILABLE)
        user.refresh_from_db()
        self.assertEqual(user.status, User.Status.PENDING_VERIFICATION)
        self.assertEqual(result.checks.latest("created_at").status, VerificationCheck.Status.ERROR)

    def test_public_options_endpoint_and_official_draft_endpoint(self):
        client = APIClient()
        response = client.get("/api/auth/residence-proof-options/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("barangay_id", {item["code"] for item in response.json()["document_types"]})

        official = User.objects.create_user(
            email="official@example.com",
            password="Str0ng!Pass123",
            role=User.Role.BARANGAY_OFFICIAL,
        )
        client.force_authenticate(official)
        response = client.get("/api/auth/ocr/config/draft/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "draft")

    def test_official_can_save_and_publish_a_revisioned_draft(self):
        official = User.objects.create_user(
            email="publisher@example.com",
            phone_number="+639700000003",
            password="Str0ng!Pass123",
            role=User.Role.BARANGAY_OFFICIAL,
        )
        client = APIClient()
        client.force_authenticate(official)
        draft = client.get("/api/auth/ocr/config/draft/").json()
        response = client.patch(
            "/api/auth/ocr/config/draft/",
            {"revision": draft["revision"], "settings": {"confidence_threshold": 0.75, "failure_action": "request_resubmission"}},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["settings"]["confidence_threshold"], 0.75)
        self.assertEqual(response.data["settings"]["failure_action"], "request_resubmission")
        response = client.post(
            "/api/auth/ocr/config/publish/",
            {"revision": response.data["revision"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["published"]["status"], "published")
        self.assertEqual(response.data["draft"]["status"], "draft")
        audit = client.get("/api/auth/ocr/audit/")
        self.assertEqual(audit.status_code, 200, audit.data)
        self.assertTrue(any(item["action"] == "ocr.configuration_published" for item in audit.data["results"]))

    def test_official_can_save_typed_rule_and_field_aliases(self):
        official = User.objects.create_user(
            email="rule-editor@example.com",
            password="Str0ng!Pass123",
            role=User.Role.BARANGAY_OFFICIAL,
        )
        client = APIClient()
        client.force_authenticate(official)
        draft = client.get("/api/auth/ocr/config/draft/").json()
        document = next(item for item in draft["document_types"] if item["code"] == "electricity_bill")
        field = next(item for item in document["fields"] if item["code"] == "account_name")
        rule = next(item for item in draft["rules"] if item["document_type_id"] == document["id"] and item["field_id"] == field["id"])
        response = client.patch(
            "/api/auth/ocr/config/draft/",
            {
                "revision": draft["revision"],
                "document_types": [{
                    "id": document["id"],
                    "code": document["code"],
                    "fields": [{"id": field["id"], "code": field["code"], "label": field["label"], "aliases": ["subscriber name"]}],
                }],
                "rules": [{
                    "id": rule["id"],
                    "code": rule["code"],
                    "name": rule["name"],
                    "rule_type": rule["rule_type"],
                    "operator": rule["operator"],
                    "value": rule["value"],
                    "threshold": rule["threshold"],
                    "on_failure": rule["on_failure"],
                    "document_type_id": document["id"],
                    "field_id": field["id"],
                }],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        saved_document = next(item for item in response.data["document_types"] if item["id"] == document["id"])
        saved_field = next(item for item in saved_document["fields"] if item["id"] == field["id"])
        self.assertEqual(saved_field["aliases"], ["subscriber name"])
        saved_rule = next(item for item in response.data["rules"] if item["id"] == rule["id"])
        self.assertEqual(saved_rule["field_id"], field["id"])

    def test_official_decision_is_terminal_and_requires_reason(self):
        user = User.objects.create_user(email="decision@example.com", phone_number="+639700000001", password="Str0ng!Pass123")
        official = User.objects.create_user(
            email="decision-official@example.com",
            phone_number="+639700000002",
            password="Str0ng!Pass123",
            role=User.Role.BARANGAY_OFFICIAL,
        )
        configuration = OCRConfigurationVersion.objects.get(status="published")
        document_type = configuration.document_types.get(code="barangay_id")
        case = ResidenceVerificationCase.objects.create(
            user=user,
            configuration=configuration,
            document_type=document_type,
            status=ResidenceVerificationCase.Status.MANUAL_REVIEW,
        )
        with self.assertRaises(Exception):
            decide_case(case.pk, official=official, approve=True, reason="")
        decided = decide_case(case.pk, official=official, approve=True, reason="Document reviewed by the barangay official.")
        self.assertEqual(decided.status, ResidenceVerificationCase.Status.APPROVED)
        with self.assertRaises(Exception):
            decide_case(case.pk, official=official, approve=False, reason="Changed mind")
