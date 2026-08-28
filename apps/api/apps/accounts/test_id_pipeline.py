"""The order the three ID checks run in, and what never runs after a block.

The point of these tests is not that a bad document is rejected — the layers
already had opinions before this. It is that OCR is never *reached*. Reading
crisp text off a cartoon ID costs a hosted provider call and produces a field
table that invites an official to argue with a decision the picture already
settled. So every test here asserts on the recognizer being untouched, not just
on the outcome.
"""

from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from apps.accounts.id_integrity import RESUBMIT_MESSAGE
from apps.accounts.id_pipeline import (
    FORENSICS_RESUBMIT_MESSAGE,
    STAGE_FORENSICS,
    STAGE_INTEGRITY,
    STAGE_OCR,
    run_pre_ocr_gate,
)
from apps.accounts.models import (
    OCRConfigurationVersion,
    OCRDocumentType,
    OCRTestRun,
)

FORENSICS = "apps.accounts.id_pipeline.forensics_findings"
INTEGRITY = "apps.accounts.id_pipeline._safe_id_integrity"

CLEAN_FILE = {"checked": True, "flagged": False, "layer": "", "message": ""}
EDITED_FILE = {
    "checked": True,
    "flagged": True,
    "layer": "exif",
    "message": "Edited or manipulated media is not allowed.",
}


def integrity_result(*, flagged=False, signals=None):
    return {
        "checked": True,
        "compared_to_sample": True,
        "format_verdict": "format_matches",
        "integrity_verdict": "suspected_ai" if flagged else "authentic",
        "confidence": 0.92,
        "flagged": flagged,
        "signals": signals or (["the portrait is a cartoon"] if flagged else []),
        "note": "",
    }


class GateOrderTests(TestCase):
    def setUp(self):
        self.configuration = OCRConfigurationVersion.objects.create(
            scope="residence_proof", version=1, settings={}
        )
        self.document_type = OCRDocumentType.objects.create(
            configuration=self.configuration, code="barangay_id", name="Barangay ID"
        )

    def _gate(self, **kwargs):
        return run_pre_ocr_gate(
            contents=[b"image-bytes"],
            document_type=self.document_type,
            configuration=self.configuration,
            **kwargs,
        )

    def test_a_flagged_file_never_reaches_the_picture_check(self):
        with patch(FORENSICS, return_value=EDITED_FILE), patch(INTEGRITY) as vision:
            gate = self._gate()
        vision.assert_not_called()
        self.assertFalse(gate["passed"])
        self.assertEqual(gate["blocked_by"], STAGE_FORENSICS)
        self.assertEqual(gate["reached"], STAGE_FORENSICS)
        self.assertEqual(gate["message"], FORENSICS_RESUBMIT_MESSAGE)
        self.assertIn("Edited", gate["detail"])

    def test_a_flagged_picture_stops_the_gate_with_the_resubmit_message(self):
        with patch(FORENSICS, return_value=CLEAN_FILE), patch(
            INTEGRITY, return_value=integrity_result(flagged=True)
        ):
            gate = self._gate()
        self.assertFalse(gate["passed"])
        self.assertEqual(gate["blocked_by"], STAGE_INTEGRITY)
        self.assertEqual(gate["message"], RESUBMIT_MESSAGE)
        self.assertEqual(
            gate["detail"],
            "Please upload an unedited photo of the original document.",
        )

    def test_both_layers_clean_reaches_ocr(self):
        with patch(FORENSICS, return_value=CLEAN_FILE), patch(
            INTEGRITY, return_value=integrity_result()
        ):
            gate = self._gate()
        self.assertTrue(gate["passed"])
        self.assertIsNone(gate["blocked_by"])
        self.assertEqual(gate["reached"], STAGE_OCR)

    def test_a_picture_check_outage_lets_the_document_through(self):
        """An outage must never tell a real resident their real ID is fake."""
        with patch(FORENSICS, return_value=CLEAN_FILE), patch(INTEGRITY, return_value=None):
            gate = self._gate()
        self.assertTrue(gate["passed"])
        self.assertIsNone(gate["integrity"])

    def test_one_bad_photo_condemns_the_whole_submission(self):
        with patch(FORENSICS, return_value=CLEAN_FILE), patch(
            INTEGRITY, side_effect=[integrity_result(), integrity_result(flagged=True)]
        ):
            gate = run_pre_ocr_gate(
                contents=[b"front", b"back"],
                document_type=self.document_type,
                configuration=self.configuration,
            )
        self.assertFalse(gate["passed"])
        self.assertEqual(gate["blocked_by"], STAGE_INTEGRITY)

    def test_each_uploaded_side_uses_its_matching_picture_check(self):
        with patch(FORENSICS, return_value=CLEAN_FILE), patch(
            INTEGRITY, side_effect=[integrity_result(), integrity_result()]
        ) as picture_check:
            gate = run_pre_ocr_gate(
                contents=[b"front", b"back"],
                document_type=self.document_type,
                configuration=self.configuration,
                sides=["front", "back"],
            )

        self.assertTrue(gate["passed"])
        self.assertEqual(
            [call.kwargs["side"] for call in picture_check.call_args_list],
            ["front", "back"],
        )
        self.assertEqual(len(gate["integrity_checks"]), 2)

    def test_a_precomputed_file_verdict_is_used_instead_of_rereading_bytes(self):
        """Normalized bytes cannot answer layer 1, so the caller's answer wins."""
        with patch(FORENSICS) as reread, patch(
            INTEGRITY, return_value=integrity_result()
        ):
            gate = self._gate(forensics=EDITED_FILE)
        reread.assert_not_called()
        self.assertFalse(gate["passed"])
        self.assertEqual(gate["blocked_by"], STAGE_FORENSICS)


class TestRunPipelineTests(TestCase):
    """The official's Test panel runs the same order a resident's upload does."""

    def setUp(self):
        self.configuration = OCRConfigurationVersion.objects.create(
            scope="residence_proof", version=1, settings={}
        )
        self.document_type = OCRDocumentType.objects.create(
            configuration=self.configuration, code="barangay_id", name="Barangay ID"
        )

    def _run(self, *, forensics=CLEAN_FILE):
        return OCRTestRun.objects.create(
            configuration=self.configuration,
            document_type=self.document_type,
            file=SimpleUploadedFile("id.jpg", b"not-a-real-jpeg", content_type="image/jpeg"),
            original_filename="id.jpg",
            mime_type="image/jpeg",
            file_size=15,
            metadata={"forensics": forensics},
        )

    def test_a_flagged_picture_produces_a_failed_run_with_no_ocr_call(self):
        from apps.accounts import ocr_runtime

        run = self._run()
        provider = object()
        with patch.object(ocr_runtime, "_read_private_file", return_value=b"bytes"), patch(
            INTEGRITY, return_value=integrity_result(flagged=True)
        ), patch.object(ocr_runtime, "_recognize_with_cache") as recognize:
            result = ocr_runtime.process_test_run(run.pk, provider=provider)

        recognize.assert_not_called()
        self.assertEqual(result.status, OCRTestRun.Status.FAILED)
        self.assertEqual(result.ocr_confidence, Decimal("0"))
        self.assertEqual(result.rule_results, [])
        self.assertTrue(result.metadata["ocr_skipped"])
        pipeline = result.extracted_fields["__pipeline__"]
        self.assertEqual(pipeline["blocked_by"], STAGE_INTEGRITY)
        self.assertEqual(result.error_message, RESUBMIT_MESSAGE)

    def test_an_edited_file_stops_before_the_picture_check_too(self):
        from apps.accounts import ocr_runtime

        run = self._run(forensics=EDITED_FILE)
        with patch.object(ocr_runtime, "_read_private_file", return_value=b"bytes"), patch(
            INTEGRITY
        ) as vision, patch.object(ocr_runtime, "_recognize_with_cache") as recognize:
            result = ocr_runtime.process_test_run(run.pk, provider=object())

        vision.assert_not_called()
        recognize.assert_not_called()
        self.assertEqual(result.status, OCRTestRun.Status.FAILED)
        pipeline = result.extracted_fields["__pipeline__"]
        self.assertEqual(pipeline["blocked_by"], STAGE_FORENSICS)
        self.assertEqual(pipeline["forensics"]["layer"], "exif")
        self.assertEqual(result.error_message, FORENSICS_RESUBMIT_MESSAGE)

    def test_the_results_payload_carries_the_stages_and_hides_the_internals(self):
        from apps.accounts.ocr_api import _test_payload

        run = self._run()
        with patch("apps.accounts.ocr_runtime._read_private_file", return_value=b"bytes"), patch(
            INTEGRITY, return_value=integrity_result(flagged=True)
        ), patch("apps.accounts.ocr_runtime._recognize_with_cache"):
            from apps.accounts import ocr_runtime

            ocr_runtime.process_test_run(run.pk, provider=object())

        run.refresh_from_db()
        payload = _test_payload(run)
        self.assertEqual(payload["pipeline"]["blocked_by"], STAGE_INTEGRITY)
        self.assertTrue(payload["id_integrity"]["flagged"])
        self.assertEqual(payload["extracted_fields"], {})


class SignUpDetectPipelineTests(TestCase):
    """The resident-facing path. Nothing here may spend an OCR call on a block."""

    def setUp(self):
        self.configuration = OCRConfigurationVersion.objects.create(
            scope="residence_proof", version=1, status="published", settings={}
        )
        self.document_type = OCRDocumentType.objects.create(
            configuration=self.configuration,
            code="barangay_id",
            name="Barangay ID",
            enabled=True,
        )

    def _detect(self, **kwargs):
        from django.core.files.base import ContentFile

        from apps.accounts.ocr_runtime import detect_residence_proof

        return detect_residence_proof(
            ContentFile(b"image-bytes", name="id.jpg"),
            hint_type=self.document_type.code,
            configuration=self.configuration,
            **kwargs,
        )

    def test_a_flagged_picture_returns_the_resubmit_message_without_reading_text(self):
        from apps.accounts import ocr_runtime

        with patch(INTEGRITY, return_value=integrity_result(flagged=True)), patch.object(
            ocr_runtime, "OCRSpaceProvider"
        ) as cloud, patch.object(ocr_runtime, "EasyOCRProvider") as local:
            result = self._detect(forensics=CLEAN_FILE)

        cloud.assert_not_called()
        local.assert_not_called()
        self.assertFalse(result["detected"])
        self.assertEqual(result["message"], RESUBMIT_MESSAGE)
        self.assertEqual(result["pipeline"]["blocked_by"], STAGE_INTEGRITY)
        self.assertEqual(result["extracted_fields"], {})

    def test_an_edited_file_stops_before_the_picture_check(self):
        from apps.accounts import ocr_runtime

        with patch(INTEGRITY) as vision, patch.object(
            ocr_runtime, "OCRSpaceProvider"
        ) as cloud, patch.object(ocr_runtime, "EasyOCRProvider") as local:
            result = self._detect(forensics=EDITED_FILE)

        vision.assert_not_called()
        cloud.assert_not_called()
        local.assert_not_called()
        self.assertFalse(result["detected"])
        self.assertEqual(result["message"], FORENSICS_RESUBMIT_MESSAGE)
        self.assertEqual(result["pipeline"]["blocked_by"], STAGE_FORENSICS)


class RegistrationWorkerPipelineTests(TestCase):
    """A submission can reach the worker without ever hitting detect."""

    def setUp(self):
        from apps.accounts.models import ResidenceProof, ResidenceVerificationCase, User
        from apps.concerns.test_helpers import active_test_community

        self.community = active_test_community()
        # The community is seeded with its own published configuration, and the
        # scope is unique per community — reuse it rather than fight the row.
        self.configuration = OCRConfigurationVersion.objects.filter(
            community=self.community, scope="residence_proof"
        ).first() or OCRConfigurationVersion.objects.create(
            scope="residence_proof", version=1, status="published", community=self.community, settings={}
        )
        self.document_type = self.configuration.document_types.filter(enabled=True).first()
        if self.document_type is None:
            self.document_type = OCRDocumentType.objects.create(
                configuration=self.configuration, code="barangay_id", name="Barangay ID", enabled=True
            )
        self.user = User.objects.create_user(
            email="resident@example.com", password="Str0ng!Passphrase", first_name="Juan", last_name="Cruz"
        )
        self.case = ResidenceVerificationCase.objects.create(
            user=self.user,
            community=self.community,
            configuration=self.configuration,
            document_type=self.document_type,
            status=ResidenceVerificationCase.Status.AWAITING_EMAIL,
        )
        ResidenceProof.objects.create(
            user=self.user,
            case=self.case,
            document_type=self.document_type,
            file=SimpleUploadedFile("id.jpg", b"bytes", content_type="image/jpeg"),
            original_filename="id.jpg",
            mime_type="image/jpeg",
            file_size=5,
        )

    def test_a_flagged_picture_rejects_the_case_with_no_ocr_call(self):
        from apps.accounts import ocr_runtime
        from apps.accounts.models import ResidenceVerificationCase, User, VerificationCheck

        provider = type("P", (), {"recognize": lambda self, *a, **k: None})()
        with patch(FORENSICS, return_value=CLEAN_FILE), patch(
            INTEGRITY, return_value=integrity_result(flagged=True)
        ), patch.object(ocr_runtime, "_read_private_file", return_value=b"bytes"), patch.object(
            provider, "recognize"
        ) as recognize:
            case = ocr_runtime.process_verification_case(self.case.pk, provider=provider)

        recognize.assert_not_called()
        self.assertEqual(case.status, ResidenceVerificationCase.Status.REJECTED)
        self.assertEqual(case.decision_reason, RESUBMIT_MESSAGE)
        self.assertFalse(case.retry_eligible)
        case.user.refresh_from_db()
        self.assertEqual(case.user.status, User.Status.REJECTED)
        check = VerificationCheck.objects.get(case=case)
        self.assertEqual(check.status, VerificationCheck.Status.FAILED)
        self.assertTrue(check.metadata["ocr_skipped"])
        self.assertEqual(check.metadata["pipeline"]["blocked_by"], STAGE_INTEGRITY)
        self.assertEqual(check.extracted_fields, {})
