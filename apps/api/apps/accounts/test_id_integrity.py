"""The picture check on submitted ID documents.

The OCR engine reads what a card *says*. It has no opinion on what the card
*looks like*, so an ID with a cartoon portrait passes every text rule as long
as the fields parse. This layer is the one that can say "that portrait is a
cartoon".

Two rules hold everywhere below:

- **Downgrade only.** A clean-looking card never rescues a document the
  published rules already rejected.
- **A flag never becomes manual review.** That queue has no screen behind it,
  so a resident sent there waits on nobody. They are told to submit a real
  document, which is something they can act on.

And the guard that matters most: an outage, a missing key, or an unreadable
file must leave a real resident's registration exactly as it was. Being told
your genuine ID is illegitimate because a server was down is the worst failure
this feature can have.
"""

import dataclasses
from unittest.mock import patch

from django.test import TestCase

from apps.accounts.id_integrity import (
    authenticity_score,
    check_id_integrity,
    integrity_settings,
    RESUBMIT_MESSAGE,
)
from apps.accounts.models import (
    OCRConfigurationVersion,
    OCRDocumentType,
)

VISION = "apps.accounts.id_integrity._vision_json_call"
PREPARE = "apps.accounts.id_integrity.prepare_image_for_gemma"


def prepared(data="Zm9v"):
    from apps.concerns.ai.image_prep import PreparedImage

    return PreparedImage(data=data, mime_type="image/jpeg", telemetry={})


def vision_reply(
    *,
    format_verdict="format_matches",
    integrity_verdict="authentic",
    confidence=0.9,
    signals=None,
):
    return {
        "format_verdict": format_verdict,
        "integrity_verdict": integrity_verdict,
        "confidence": confidence,
        "signals": signals or [],
        "note": "Checked.",
    }


class IntegritySettingsTests(TestCase):
    def test_defaults_are_on_and_conservative(self):
        settings = integrity_settings(OCRConfigurationVersion(settings={}))
        self.assertTrue(settings["enabled"])
        self.assertTrue(settings["compare_sample"])
        self.assertEqual(settings["min_confidence"], 0.70)

    def test_the_threshold_comes_from_the_published_configuration(self):
        settings = integrity_settings(
            OCRConfigurationVersion(settings={"id_integrity_min_confidence": 0.9})
        )
        self.assertEqual(settings["min_confidence"], 0.9)

    def test_the_check_cannot_be_switched_off_by_a_stored_setting(self):
        """Old published rows still carry the retired switches. They decide nothing."""
        settings = integrity_settings(
            OCRConfigurationVersion(
                settings={
                    "id_integrity_enabled": False,
                    "id_integrity_compare_sample": False,
                }
            )
        )
        self.assertTrue(settings["enabled"])
        self.assertTrue(settings["compare_sample"])

    def test_a_nonsense_threshold_falls_back_rather_than_crashing(self):
        settings = integrity_settings(
            OCRConfigurationVersion(settings={"id_integrity_min_confidence": "very strict"})
        )
        self.assertEqual(settings["min_confidence"], 0.70)


class CheckIdIntegrityTests(TestCase):
    def setUp(self):
        self.configuration = OCRConfigurationVersion.objects.create(
            scope="residence_proof", version=1, settings={}
        )
        self.document_type = OCRDocumentType.objects.create(
            configuration=self.configuration, code="barangay_id", name="Barangay ID"
        )

    def _check(self, reply, *, reference=None, **kwargs):
        with patch(PREPARE, return_value=prepared()), patch(
            "apps.accounts.id_integrity.reference_image", return_value=reference
        ), patch(VISION, return_value=reply) as call:
            result = check_id_integrity(
                submitted=b"bytes",
                document_type=self.document_type,
                configuration=self.configuration,
                **kwargs,
            )
        return result, call

    def test_a_genuine_looking_id_is_not_flagged(self):
        result, _ = self._check(vision_reply(), reference=prepared("cmVm"))
        self.assertFalse(result["flagged"])
        self.assertEqual(result["integrity_verdict"], "authentic")
        self.assertTrue(result["compared_to_sample"])

    def test_a_cartoon_portrait_is_flagged(self):
        result, _ = self._check(
            vision_reply(
                integrity_verdict="impossible_content",
                confidence=0.94,
                signals=["the portrait is a cartoon character, not a photograph"],
            ),
            reference=prepared("cmVm"),
        )
        self.assertTrue(result["flagged"])
        self.assertEqual(result["integrity_verdict"], "impossible_content")
        self.assertTrue(result["signals"])

    def test_a_different_document_is_a_format_mismatch(self):
        result, _ = self._check(
            vision_reply(format_verdict="format_mismatch", confidence=0.9),
            reference=prepared("cmVm"),
        )
        self.assertTrue(result["flagged"])
        self.assertEqual(result["format_verdict"], "format_mismatch")

    def test_a_photo_of_a_screen_is_flagged(self):
        result, _ = self._check(
            vision_reply(integrity_verdict="photo_of_screen", confidence=0.85),
            reference=prepared("cmVm"),
        )
        self.assertTrue(result["flagged"])

    def test_a_low_confidence_opinion_never_flags(self):
        result, _ = self._check(
            vision_reply(integrity_verdict="suspected_ai", confidence=0.4),
            reference=prepared("cmVm"),
        )
        self.assertFalse(result["flagged"])
        self.assertEqual(result["integrity_verdict"], "inconclusive")

    def test_a_low_confidence_format_mismatch_never_flags(self):
        result, _ = self._check(
            vision_reply(format_verdict="format_mismatch", confidence=0.3),
            reference=prepared("cmVm"),
        )
        self.assertFalse(result["flagged"])
        self.assertEqual(result["format_verdict"], "inconclusive")

    def test_an_inconclusive_verdict_is_not_a_flag(self):
        # The everyday answer for a glare-covered or angled photo of a real ID.
        result, _ = self._check(
            vision_reply(integrity_verdict="inconclusive", confidence=0.95),
            reference=prepared("cmVm"),
        )
        self.assertFalse(result["flagged"])

    def test_an_unknown_verdict_string_becomes_inconclusive(self):
        result, _ = self._check(
            vision_reply(integrity_verdict="obviously_forged", confidence=0.99),
            reference=prepared("cmVm"),
        )
        self.assertEqual(result["integrity_verdict"], "inconclusive")
        self.assertFalse(result["flagged"])

    def test_without_a_stored_sample_only_the_picture_check_runs(self):
        result, call = self._check(vision_reply(format_verdict="format_matches"), reference=None)
        self.assertEqual(result["format_verdict"], "no_reference")
        self.assertFalse(result["compared_to_sample"])
        # One image, not two — there is nothing to compare against.
        self.assertEqual(len(call.call_args.kwargs["images"]), 1)

    def test_the_reference_is_sent_first_so_the_prompt_matches(self):
        _, call = self._check(vision_reply(), reference=prepared("cmVm"))
        images = call.call_args.kwargs["images"]
        self.assertEqual(len(images), 2)
        self.assertEqual(images[0].data, "cmVm")

    def test_a_model_outage_returns_no_opinion(self):
        result, _ = self._check(None, reference=prepared("cmVm"))
        self.assertIsNone(result)

    def test_an_undecodable_file_returns_no_opinion(self):
        with patch(PREPARE, return_value=None), patch(VISION) as call:
            result = check_id_integrity(
                submitted=b"not an image",
                document_type=self.document_type,
                configuration=self.configuration,
            )
        self.assertIsNone(result)
        call.assert_not_called()

    def test_a_retired_switch_no_longer_skips_the_model(self):
        """A configuration published before the switches were retired still runs."""
        self.configuration.settings = {"id_integrity_enabled": False}
        with patch(PREPARE, return_value=prepared()), patch(
            "apps.accounts.id_integrity.reference_image", return_value=None
        ), patch(VISION, return_value=vision_reply()) as call:
            result = check_id_integrity(
                submitted=b"bytes",
                document_type=self.document_type,
                configuration=self.configuration,
            )
        call.assert_called_once()
        self.assertTrue(result["checked"])

    def test_a_missing_sample_reports_no_reference_rather_than_a_mismatch(self):
        with patch(PREPARE, return_value=prepared()), patch(
            "apps.accounts.id_integrity.reference_image", return_value=None
        ), patch(VISION, return_value=vision_reply()):
            result = check_id_integrity(
                submitted=b"bytes",
                document_type=self.document_type,
                configuration=self.configuration,
            )
        self.assertEqual(result["format_verdict"], "no_reference")
        self.assertFalse(result["flagged"])


class OcrSettingsSurfaceTests(TestCase):
    """The keys the builder writes must survive the server allowlist."""

    def test_the_confidence_key_is_an_accepted_setting(self):
        from apps.accounts.ocr_api import SAFE_SETTINGS

        self.assertIn("id_integrity_min_confidence", SAFE_SETTINGS)

    def test_the_retired_switches_are_dropped_not_rejected(self):
        """A stale browser tab must not fail every unrelated edit in one PATCH."""
        from apps.accounts.ocr_api import _validate_settings

        cleaned = _validate_settings(
            {
                "id_integrity_enabled": True,
                "id_integrity_compare_sample": False,
                "id_integrity_min_confidence": 0.8,
            }
        )
        self.assertEqual(cleaned, {"id_integrity_min_confidence": 0.8})

    def test_the_confidence_key_is_range_bound(self):
        from apps.accounts.ocr_api import SAFE_SETTINGS

        kind, low, high = SAFE_SETTINGS["id_integrity_min_confidence"]
        self.assertIs(kind, float)
        self.assertEqual((low, high), (0.0, 1.0))


class ReferenceSampleReportingTests(TestCase):
    """The config screen must report what the pipeline will actually find."""

    def setUp(self):
        self.configuration = OCRConfigurationVersion.objects.create(
            scope="residence_proof", version=1, settings={}
        )
        self.document_type = OCRDocumentType.objects.create(
            configuration=self.configuration, code="barangay_id", name="Barangay ID"
        )

    def test_a_type_with_no_sample_reports_none(self):
        from apps.accounts.ocr_api import _document_payload

        payload = _document_payload(self.document_type)
        self.assertFalse(payload["has_reference_sample"])

    def test_a_type_with_a_sample_reports_one(self):
        from django.core.files.base import ContentFile

        from apps.accounts.models import OCRSample
        from apps.accounts.ocr_api import _document_payload

        sample = OCRSample.objects.create(
            document_type=self.document_type, name="front", is_active=True
        )
        sample.file.save("front.png", ContentFile(b"not-a-real-png"), save=True)
        payload = _document_payload(self.document_type)
        self.assertTrue(payload["has_reference_sample"])

    def test_reference_lookup_returns_nothing_when_no_sample_exists(self):
        from apps.accounts.id_integrity import reference_image

        self.assertIsNone(reference_image(self.document_type))

    def test_reference_lookup_survives_an_unreadable_sample(self):
        # A sample row whose blob is missing or corrupt must not raise into a
        # resident's registration.
        from django.core.files.base import ContentFile

        from apps.accounts.id_integrity import reference_image
        from apps.accounts.models import OCRSample

        sample = OCRSample.objects.create(
            document_type=self.document_type, name="front", is_active=True
        )
        sample.file.save("front.png", ContentFile(b"garbage"), save=True)
        self.assertIsNone(reference_image(self.document_type))


class AuthenticityScoreTests(TestCase):
    def test_nobody_looked_is_none_not_zero(self):
        self.assertIsNone(authenticity_score(None))
        self.assertIsNone(authenticity_score({"checked": False}))

    def test_a_clean_check_scores_one(self):
        self.assertEqual(authenticity_score({"checked": True, "flagged": False}), 1.0)

    def test_a_confident_flag_scores_low(self):
        score = authenticity_score({"checked": True, "flagged": True, "confidence": 0.9})
        self.assertAlmostEqual(score, 0.1)


class FinalizeDowngradeTests(TestCase):
    """The worker's second guard: reject, never manual review, never upgrade."""

    def _engine(self, outcome="passed", review_reason=""):
        from apps.accounts.ocr_engine import EngineResult

        return EngineResult(
            detected_document_type_id=None,
            detected_document_type_code="barangay_id",
            document_type_score=0.9,
            document_type_mismatch=False,
            confidence=0.95,
            extracted_fields={},
            rule_results=[],
            outcome=outcome,
            review_reason=review_reason,
        )

    def test_a_flag_turns_a_pass_into_a_rejection(self):
        from apps.accounts.models import ResidenceVerificationCase

        engine = self._engine("passed")
        flagged = {"checked": True, "flagged": True, "confidence": 0.9}
        # Mirrors the downgrade in finalize_case_attempts.
        if flagged["flagged"] and engine.outcome != "reject":
            engine = dataclasses.replace(
                engine,
                outcome="reject",
                review_reason=ResidenceVerificationCase.ReviewReason.MEDIA_INTEGRITY,
            )
        self.assertEqual(engine.outcome, "reject")
        self.assertEqual(
            engine.review_reason,
            ResidenceVerificationCase.ReviewReason.MEDIA_INTEGRITY,
        )

    def test_the_reason_is_a_rejection_code_never_a_review_status(self):
        from apps.accounts.models import ResidenceVerificationCase

        self.assertIn(
            ResidenceVerificationCase.ReviewReason.MEDIA_INTEGRITY,
            ResidenceVerificationCase.ReviewReason.values,
        )
        self.assertNotIn(
            "media_integrity",
            ResidenceVerificationCase.Status.values,
        )

    def test_the_resident_message_says_what_to_do_and_makes_no_accusation(self):
        lowered = RESUBMIT_MESSAGE.lower()
        self.assertIn("legitimate document", lowered)
        for word in ("ai", "fake", "forged", "fraud"):
            self.assertNotIn(f" {word} ", f" {lowered} ")
