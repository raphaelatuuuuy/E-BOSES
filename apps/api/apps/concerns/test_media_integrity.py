"""Content-level authenticity on concern and emergency photos.

Two properties are defended here, and the second one matters more than the
first.

1. A photo that is edited, generated, impossible, or a picture of a screen is
   caught — the cases byte-level forensics cannot see, because nothing in the
   file is wrong.

2. **An ordinary photo from an ordinary phone is never flagged.** A wrong flag
   turns away a real resident reporting a real problem, and they have no way to
   argue with it. Every guard below — the confidence floor, the second opinion,
   the no-image clamp, the uncertainty gate — exists to make a false flag hard
   rather than to make a true one easy.
"""

from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase
from PIL import Image, ImageDraw

from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.gemma_analyzer import (
    _coerce_integrity,
    flagged_integrity_findings,
    integrity_overall,
    parse_gemma_result,
)
from apps.concerns.ai_fixtures import gemma_result
from apps.concerns.models import (
    Concern,
    ConcernClassificationConfiguration,
    ConcernMedia,
)

User = get_user_model()

Actions = ConcernClassificationConfiguration.MediaIntegrityAction


def photo_bytes():
    output = BytesIO()
    image = Image.new("RGB", (800, 600), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 50, 750, 550), fill=(70, 90, 120))
    image.save(output, "JPEG", quality=90)
    return output.getvalue()


def integrity_finding(index=0, verdict="impossible_content", confidence=0.9, signals=None):
    return {
        "index": index,
        "verdict": verdict,
        "confidence": confidence,
        "signals": signals or ["the shadow falls opposite to every other shadow"],
        "note": "An object in the sky does not match the lighting of the scene.",
    }


class IntegrityCoercionTests(TestCase):
    """Whatever the model returns, only in-contract values survive."""

    def test_a_clean_finding_passes_through(self):
        findings = _coerce_integrity([integrity_finding()], count=1, min_confidence=0.7)
        self.assertEqual(findings[0]["verdict"], "impossible_content")
        self.assertEqual(findings[0]["confidence"], 0.9)

    def test_an_unknown_verdict_becomes_inconclusive(self):
        findings = _coerce_integrity(
            [integrity_finding(verdict="definitely_fake")], count=1, min_confidence=0.7
        )
        self.assertEqual(findings[0]["verdict"], "inconclusive")

    def test_a_verdict_below_the_confidence_floor_becomes_inconclusive(self):
        findings = _coerce_integrity(
            [integrity_finding(confidence=0.55)], count=1, min_confidence=0.7
        )
        self.assertEqual(findings[0]["verdict"], "inconclusive")
        self.assertEqual(findings[0]["signals"], [])

    def test_signals_are_dropped_for_an_unflagged_verdict(self):
        findings = _coerce_integrity(
            [integrity_finding(verdict="authentic", signals=["something"])],
            count=1,
            min_confidence=0.7,
        )
        self.assertEqual(findings[0]["signals"], [])

    def test_a_finding_for_a_photo_that_was_not_sent_is_discarded(self):
        findings = _coerce_integrity([integrity_finding(index=5)], count=1, min_confidence=0.7)
        self.assertEqual(findings, [])

    def test_a_repeated_index_is_taken_once(self):
        findings = _coerce_integrity(
            [integrity_finding(), integrity_finding(verdict="authentic")],
            count=1,
            min_confidence=0.7,
        )
        self.assertEqual(len(findings), 1)

    def test_rubbish_confidence_becomes_zero_and_so_never_acts(self):
        findings = _coerce_integrity(
            [integrity_finding(confidence="very sure")], count=1, min_confidence=0.7
        )
        self.assertEqual(findings[0]["confidence"], 0.0)
        self.assertEqual(findings[0]["verdict"], "inconclusive")

    def test_signals_are_capped(self):
        findings = _coerce_integrity(
            [integrity_finding(signals=[f"signal {n}" for n in range(12)])],
            count=1,
            min_confidence=0.7,
        )
        self.assertLessEqual(len(findings[0]["signals"]), 4)

    def test_the_overall_verdict_is_the_most_serious_one(self):
        findings = [
            integrity_finding(index=0, verdict="authentic"),
            integrity_finding(index=1, verdict="suspected_edit"),
            integrity_finding(index=2, verdict="impossible_content"),
        ]
        self.assertEqual(integrity_overall(findings), "impossible_content")

    def test_no_findings_reads_as_inconclusive_not_authentic(self):
        # "Nobody looked" and "nothing was found" are different answers, and
        # only one of them is a claim about the photo.
        self.assertEqual(integrity_overall([]), "inconclusive")


class IntegrityParsingTests(TestCase):
    """`parse_gemma_result` must not let a claim outlive the image it is about."""

    def _parse(self, payload, **kwargs):
        options = {
            "model_version": "gemma4:test",
            "selected_category": "environment",
            "image_attached": True,
            "image_review_succeeded": True,
            "photo_count": 1,
        }
        options.update(kwargs)
        return parse_gemma_result(payload, **options)

    def test_an_integrity_claim_survives_a_normal_parse(self):
        result = self._parse(
            '{"relevance": "VALID", "primary_category": "environment",'
            ' "media_integrity": [{"index": 0, "verdict": "suspected_ai",'
            ' "confidence": 0.88, "signals": ["the surface has no grain"]}]}'
        )
        self.assertEqual(result.details["media_integrity_overall"], "suspected_ai")

    def test_no_image_means_no_integrity_claim(self):
        result = self._parse(
            '{"relevance": "VALID", "primary_category": "environment",'
            ' "media_integrity": [{"index": 0, "verdict": "suspected_ai", "confidence": 0.99}]}',
            image_attached=False,
            image_review_succeeded=None,
            photo_count=0,
        )
        self.assertEqual(result.details["media_integrity"], [])
        self.assertEqual(result.details["media_integrity_overall"], "inconclusive")

    def test_an_unreadable_image_means_no_integrity_claim(self):
        result = self._parse(
            '{"relevance": "VALID", "primary_category": "environment",'
            ' "media_integrity": [{"index": 0, "verdict": "suspected_ai", "confidence": 0.99}]}',
            image_review_succeeded=False,
        )
        self.assertEqual(result.details["media_integrity"], [])

    def test_unreadable_json_never_produces_a_flag(self):
        result = self._parse("not json at all")
        self.assertEqual(result.details["media_integrity"], [])
        self.assertEqual(result.details["media_integrity_overall"], "inconclusive")
        self.assertTrue(result.details["ai_result_uncertain"])

    def test_a_missing_integrity_key_is_not_an_accusation(self):
        result = self._parse('{"relevance": "VALID", "primary_category": "environment"}')
        self.assertEqual(result.details["media_integrity"], [])
        self.assertEqual(result.details["media_integrity_overall"], "inconclusive")


class ConcernIntegrityActionTests(TransactionTestCase):
    """Each configured action, and what the resident and the queue end up with."""

    def setUp(self):
        cache.delete(ConcernClassificationConfiguration.CLASSIFICATION_CONFIG_CACHE_KEY)
        self.resident = User.objects.create_user(
            email="integrity-resident@example.com",
            phone_number="+639181112221",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        self.config = ConcernClassificationConfiguration.current_fresh()

    def _set_action(self, action, **extra):
        # save(), not queryset.update(): saving is what an official does, and
        # it is what invalidates the 60-second config cache the pipeline reads.
        config = ConcernClassificationConfiguration.objects.get(pk=self.config.pk)
        config.media_integrity_action = action
        for field, value in extra.items():
            setattr(config, field, value)
        config.save()
        return config

    def _concern_with_photo(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Basura sa kanto",
            description="May malaking tumpok ng basura sa kanto ng Rosal Street mula noong Lunes.",
            category=Concern.Category.ENVIRONMENT,
        )
        upload = SimpleUploadedFile("evidence.jpg", photo_bytes(), content_type="image/jpeg")
        ConcernMedia.objects.create(
            concern=concern,
            file=upload,
            original_filename=upload.name,
            mime_type="image/jpeg",
            file_size=upload.size,
            sha256_hash="b" * 64,
        )
        return concern

    def _run(self, *, verdict="impossible_content", confidence=0.92, second_opinion_agrees=True):
        """`second_opinion_agrees=None` means the second call failed outright."""
        concern = self._concern_with_photo()
        flagged = gemma_result(
            category=Concern.Category.ENVIRONMENT,
            evidence_relationship="supports_report",
            image_review_succeeded=True,
            media_integrity=[integrity_finding(verdict=verdict, confidence=confidence)],
            media_integrity_overall=verdict,
        )
        if second_opinion_agrees is None:
            second = None
        else:
            second = {
                "agrees": second_opinion_agrees,
                "verdict": verdict if second_opinion_agrees else "authentic",
                "confidence": confidence,
                "signals": ["the shadow falls the wrong way"] if second_opinion_agrees else [],
            }
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, patch(
            "apps.concerns.ai.pipeline.confirm_media_integrity", return_value=second
        ), patch("apps.concerns.tasks.enqueue_concern_media_privacy"):
            classifier.return_value.analyze.return_value = flagged
            assessment = process_concern_ai(concern.pk)
        concern.refresh_from_db()
        return concern, assessment

    def test_hold_keeps_the_report_pending_for_an_official(self):
        self._set_action(Actions.HOLD)
        concern, _ = self._run()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.PENDING)
        self.assertNotEqual(concern.status, Concern.Status.REJECTED)

    def test_resubmit_turns_the_report_back_with_a_plain_message(self):
        self._set_action(Actions.RESUBMIT)
        concern, _ = self._run()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.REJECTED)
        self.assertEqual(concern.rejection_code, "automated_media_integrity_resubmit")
        self.assertIn("camera", concern.validation_summary.lower())

    def test_auto_reject_turns_the_report_down(self):
        self._set_action(Actions.AUTO_REJECT)
        concern, _ = self._run()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.REJECTED)
        self.assertEqual(concern.rejection_code, "automated_media_integrity")

    def test_flag_notify_lets_the_report_through_but_records_the_finding(self):
        self._set_action(Actions.FLAG_NOTIFY)
        concern, assessment = self._run()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)
        reasons = [item.get("reason") for item in assessment.flag_reasons]
        self.assertIn("media_integrity", reasons)

    def test_changing_the_configured_action_changes_the_outcome(self):
        # The single check that the Configuration screen is wired to the
        # pipeline rather than merely storing a value.
        self._set_action(Actions.FLAG_NOTIFY)
        accepted, _ = self._run()
        self._set_action(Actions.AUTO_REJECT)
        rejected, _ = self._run()
        self.assertEqual(accepted.validation_status, Concern.ValidationStatus.ACCEPTED)
        self.assertEqual(rejected.validation_status, Concern.ValidationStatus.REJECTED)

    def test_a_second_opinion_that_disagrees_drops_the_flag(self):
        self._set_action(Actions.AUTO_REJECT)
        concern, assessment = self._run(second_opinion_agrees=False)
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)
        reasons = [item.get("reason") for item in assessment.flag_reasons]
        self.assertNotIn("media_integrity", reasons)

    def test_a_low_confidence_verdict_never_acts(self):
        self._set_action(Actions.AUTO_REJECT)
        concern, _ = self._run(confidence=0.4)
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    def test_an_authentic_photo_is_left_alone(self):
        self._set_action(Actions.AUTO_REJECT)
        concern, assessment = self._run(verdict="authentic")
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)
        reasons = [item.get("reason") for item in assessment.flag_reasons]
        self.assertNotIn("media_integrity", reasons)

    def test_an_inconclusive_photo_is_left_alone(self):
        # The everyday outcome for a dark, blurry, or plain photo. It must
        # read as "no opinion", never as a soft accusation.
        self._set_action(Actions.AUTO_REJECT)
        concern, _ = self._run(verdict="inconclusive")
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    def test_the_check_can_be_switched_off(self):
        self._set_action(Actions.AUTO_REJECT, media_integrity_enabled=False)
        concern, _ = self._run()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    def test_an_uncertain_run_never_acts_on_a_flag(self):
        self._set_action(Actions.AUTO_REJECT)
        concern = self._concern_with_photo()
        uncertain = gemma_result(
            category=Concern.Category.ENVIRONMENT,
            image_review_succeeded=True,
            ai_result_uncertain=True,
            media_integrity=[integrity_finding()],
            media_integrity_overall="impossible_content",
        )
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, patch(
            "apps.concerns.ai.pipeline.confirm_media_integrity",
            return_value={"agrees": True, "verdict": "impossible_content", "confidence": 0.95, "signals": []},
        ), patch("apps.concerns.tasks.enqueue_concern_media_privacy"):
            classifier.return_value.analyze.return_value = uncertain
            process_concern_ai(concern.pk)
        concern.refresh_from_db()
        self.assertNotEqual(concern.validation_status, Concern.ValidationStatus.REJECTED)

    def test_a_second_opinion_outage_drops_the_flag(self):
        # confirm_media_integrity returns None when the model is unreachable.
        # An outage must not be able to reject a resident's report.
        self._set_action(Actions.AUTO_REJECT)
        concern, _ = self._run(second_opinion_agrees=None)
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    def test_a_report_with_no_photo_is_never_flagged(self):
        self._set_action(Actions.AUTO_REJECT)
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Sirang ilaw",
            description="Sirang street light sa Rosal Street mula pa noong isang linggo.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, patch(
            "apps.concerns.tasks.enqueue_concern_media_privacy"
        ):
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.INFRASTRUCTURE,
            )
            process_concern_ai(concern.pk)
        concern.refresh_from_db()
        self.assertNotEqual(concern.validation_status, Concern.ValidationStatus.REJECTED)


class DecisionLogTests(TransactionTestCase):
    """Without an audit row there is nothing behind the monitoring counters."""

    def setUp(self):
        # The singleton config is cached for 60 seconds and the cache is not
        # per-test, so a config another test saved would otherwise decide this
        # one's outcome.
        cache.delete(ConcernClassificationConfiguration.CLASSIFICATION_CONFIG_CACHE_KEY)
        self.resident = User.objects.create_user(
            email="log-resident@example.com",
            phone_number="+639181114441",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )

    def _run(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Basura sa kanto",
            description="May malaking tumpok ng basura sa kanto ng Rosal Street mula noong Lunes.",
            category=Concern.Category.ENVIRONMENT,
        )
        upload = SimpleUploadedFile("evidence.jpg", photo_bytes(), content_type="image/jpeg")
        ConcernMedia.objects.create(
            concern=concern,
            file=upload,
            original_filename=upload.name,
            mime_type="image/jpeg",
            file_size=upload.size,
            sha256_hash="d" * 64,
        )
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, patch(
            "apps.concerns.ai.pipeline.confirm_media_integrity",
            return_value={"agrees": True, "verdict": "suspected_ai", "confidence": 0.9, "signals": ["no grain"]},
        ), patch("apps.concerns.tasks.enqueue_concern_media_privacy"):
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.ENVIRONMENT,
                evidence_relationship="supports_report",
                image_review_succeeded=True,
                media_integrity=[integrity_finding(verdict="suspected_ai", confidence=0.9)],
                media_integrity_overall="suspected_ai",
            )
            process_concern_ai(concern.pk)
        return concern

    def test_a_production_row_is_written_for_the_concern_domain(self):
        from apps.concerns.models import LlmDecisionLog

        concern = self._run()
        row = LlmDecisionLog.objects.filter(concern=concern).first()
        self.assertIsNotNone(row)
        self.assertEqual(row.domain, LlmDecisionLog.Domain.CONCERN)
        self.assertEqual(row.run_kind, LlmDecisionLog.RunKind.PRODUCTION)

    def test_the_row_carries_the_integrity_verdict(self):
        from apps.concerns.models import LlmDecisionLog

        concern = self._run()
        row = LlmDecisionLog.objects.filter(concern=concern).first()
        self.assertEqual(row.output_snapshot["media_integrity_overall"], "suspected_ai")
        self.assertEqual(row.output_snapshot["second_opinion"], "confirmed")

    def test_the_row_records_how_long_the_call_took(self):
        from apps.concerns.models import LlmDecisionLog

        concern = self._run()
        row = LlmDecisionLog.objects.filter(concern=concern).first()
        self.assertIsNotNone(row.duration_ms)

    def test_a_logging_failure_never_breaks_the_run(self):
        from apps.concerns.models import LlmDecisionLog

        with patch.object(
            LlmDecisionLog.objects, "create", side_effect=RuntimeError("table gone")
        ):
            concern = self._run()
        concern.refresh_from_db()
        # The validation result still landed; only the audit row was lost.
        self.assertIn(
            concern.validation_status,
            {Concern.ValidationStatus.ACCEPTED, Concern.ValidationStatus.PENDING},
        )


class ConfigApiTests(TestCase):
    """The Report checking screen must actually reach the pipeline's config."""

    def setUp(self):
        from rest_framework.test import APIClient

        cache.delete(ConcernClassificationConfiguration.CLASSIFICATION_CONFIG_CACHE_KEY)
        self.official = User.objects.create_user(
            email="config-official@example.com",
            phone_number="+639181115551",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
            is_staff=True,
            is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.official)

    def test_the_settings_are_returned(self):
        response = self.client.get("/api/concerns/classification/")
        self.assertEqual(response.status_code, 200)
        for field in (
            "media_integrity_enabled",
            "media_integrity_action",
            "media_integrity_min_confidence",
            "media_integrity_second_opinion_enabled",
            "media_integrity_emergency_action",
        ):
            self.assertIn(field, response.data)

    def test_saving_an_action_reaches_the_configuration(self):
        response = self.client.patch(
            "/api/concerns/classification/",
            {"media_integrity_action": "request_resubmission"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        config = ConcernClassificationConfiguration.current_fresh()
        self.assertEqual(config.media_integrity_action, "request_resubmission")

    def test_a_confidence_outside_zero_to_one_is_refused(self):
        response = self.client.patch(
            "/api/concerns/classification/",
            {"media_integrity_min_confidence": 4},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("media_integrity_min_confidence", response.data)

    def test_an_emergency_action_outside_the_two_allowed_is_refused(self):
        response = self.client.patch(
            "/api/concerns/classification/",
            {"media_integrity_emergency_action": "auto_reject"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class TesterPreviewTests(TestCase):
    """The official tester must run the real check, not a description of it."""

    def setUp(self):
        cache.delete(ConcernClassificationConfiguration.CLASSIFICATION_CONFIG_CACHE_KEY)
        self.config = ConcernClassificationConfiguration.current_fresh()

    def _preview(self, details, images, **kwargs):
        from apps.concerns.classification_api import _media_integrity_preview

        return _media_integrity_preview(self.config, details=details, images=images, **kwargs)

    def test_the_preview_calls_the_same_pipeline_function(self):
        from apps.concerns.ai.image_prep import PreparedImage

        image = PreparedImage(data="Zm9v", mime_type="image/jpeg", telemetry={})
        details = {
            "media_integrity": [integrity_finding()],
            "image_review_succeeded": True,
        }
        with patch(
            "apps.concerns.ai.pipeline.confirm_media_integrity",
            return_value={"agrees": True, "verdict": "impossible_content", "confidence": 0.95, "signals": ["a UFO"]},
        ):
            result = self._preview(details, [image])
        self.assertEqual(result["status"], "checked")
        self.assertEqual(result["overall"], "impossible_content")
        self.assertEqual(result["second_opinion"], "confirmed")

    def test_the_preview_applies_the_same_confidence_floor(self):
        from apps.concerns.ai.image_prep import PreparedImage

        image = PreparedImage(data="Zm9v", mime_type="image/jpeg", telemetry={})
        details = {
            "media_integrity": [integrity_finding(confidence=0.2)],
            "image_review_succeeded": True,
        }
        result = self._preview(details, [image])
        self.assertEqual(result["overall"], "inconclusive")

    def test_the_preview_reports_a_skip_without_a_readable_photo(self):
        result = self._preview({"image_review_succeeded": None}, [])
        self.assertEqual(result["status"], "skipped")


class FlaggedFindingHelperTests(TestCase):
    def test_only_real_verdicts_count_as_flagged(self):
        findings = [
            integrity_finding(index=0, verdict="authentic"),
            integrity_finding(index=1, verdict="inconclusive"),
            integrity_finding(index=2, verdict="photo_of_screen"),
        ]
        flagged = flagged_integrity_findings(findings)
        self.assertEqual([item["index"] for item in flagged], [2])
