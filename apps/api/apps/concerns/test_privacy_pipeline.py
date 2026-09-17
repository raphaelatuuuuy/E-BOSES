"""Gemma-gated SAM3 privacy processing.

The property every test here defends is the same one: **an image is restricted
until something has actually looked at it and cleared it.** Not "probably fine",
not "the scan didn't run so it must be safe" — cleared.

The old pipeline had the opposite default. Any photo on an accepted community
concern was published, with a Haar face blur applied blind and no record of what
it had or had not covered.
"""

from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings, TransactionTestCase, override_settings
from PIL import Image, ImageDraw
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AuditLog
from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.pipeline import sam3_classes_for, should_run_sam3
from apps.concerns.ai.privacy import privacy_cache_key, process_media_privacy
from apps.concerns.ai.privacy.sam3_client import Sam3NotConfigured, Sam3Unavailable
from apps.concerns.ai_fixtures import gemma_result, privacy_scan_result
from apps.concerns.models import Concern, ConcernAiAssessment, ConcernMedia, ConcernMediaRedaction, Department, Designation, Position
from apps.concerns.test_helpers import ensure_test_profile

User = get_user_model()

FACE_BOX = {"class": "face", "x": 400, "y": 300, "width": 120, "height": 140}
PLATE_BOX = {"class": "license plate", "x": 200, "y": 460, "width": 160, "height": 60}
BLOOD_BOX = {"class": "blood", "x": 600, "y": 200, "width": 100, "height": 90}
STREET_SIGN_BOX = {"class": "street sign", "x": 600, "y": 200, "width": 150, "height": 90}


def sam3_payload(*boxes):
    return {"predictions": list(boxes)}


def photo_bytes():
    output = BytesIO()
    image = Image.new("RGB", (800, 600), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 50, 750, 550), fill=(60, 100, 140))
    draw.ellipse((250, 150, 550, 450), fill=(230, 180, 50))
    image.save(output, "JPEG", quality=92)
    return output.getvalue()


class Sam3GateTests(TestCase):
    """The four conditions that must all hold before Roboflow is called."""

    def test_a_face_suspicion_requests_a_face_scan(self):
        details = privacy_scan_result(classes=["face"]).details
        self.assertEqual(sam3_classes_for(details), ["face"])
        self.assertTrue(should_run_sam3(image_uploaded=True, gemma_image_review_succeeded=True, gemma_result=details))

    def test_a_plate_suspicion_requests_a_plate_scan(self):
        from apps.concerns.ai.pipeline import privacy_classes_for

        details = privacy_scan_result(classes=["license plate"]).details
        self.assertEqual(
            privacy_classes_for(
                details,
                image_uploaded=True,
                gemma_image_review_succeeded=True,
            ),
            ["face", "license plate"],
        )

    def test_multiple_suspicions_request_all_of_them(self):
        details = privacy_scan_result(classes=["face", "license plate"]).details
        self.assertEqual(sam3_classes_for(details), ["face", "license plate"])
        self.assertTrue(should_run_sam3(image_uploaded=True, gemma_image_review_succeeded=True, gemma_result=details))

    def test_no_suspicion_means_no_scan(self):
        details = gemma_result(category="environment", image_review_succeeded=True).details
        self.assertEqual(sam3_classes_for(details), [])
        self.assertFalse(should_run_sam3(image_uploaded=True, gemma_image_review_succeeded=True, gemma_result=details))

    def test_non_blurrable_object_never_reaches_sam3(self):
        details = privacy_scan_result(classes=["street sign"]).details
        self.assertEqual(sam3_classes_for(details), [])
        self.assertFalse(should_run_sam3(image_uploaded=True, gemma_image_review_succeeded=True, gemma_result=details))

    def test_a_suspicion_with_no_photo_never_runs(self):
        details = privacy_scan_result(classes=["face"]).details
        self.assertFalse(should_run_sam3(image_uploaded=False, gemma_image_review_succeeded=True, gemma_result=details))

    def test_a_suspicion_about_an_unread_photo_is_not_gemmas_request(self):
        """Gemma's own gate stays shut — the fallback below is a separate rule."""
        details = privacy_scan_result(classes=["face"]).details
        self.assertFalse(should_run_sam3(image_uploaded=True, gemma_image_review_succeeded=False, gemma_result=details))

    def test_an_unreadable_photo_falls_back_to_the_core_classes(self):
        from apps.concerns.ai.pipeline import privacy_classes_for

        details = gemma_result(category="vehicle", image_review_succeeded=False).details

        self.assertEqual(
            privacy_classes_for(details, image_uploaded=True, gemma_image_review_succeeded=False),
            ["face", "license plate", "blood"],
        )

    def test_no_photo_means_no_classes_even_on_failure(self):
        from apps.concerns.ai.pipeline import privacy_classes_for

        details = gemma_result(category="vehicle", image_review_succeeded=False).details

        self.assertEqual(
            privacy_classes_for(details, image_uploaded=False, gemma_image_review_succeeded=False),
            [],
        )


@override_settings(OLLAMA_API_KEY="test-key", ROBOFLOW_API_KEY="test-key")
class PipelineQueuesPrivacyWorkTests(TransactionTestCase):
    """TransactionTestCase because the queueing happens in `transaction.on_commit`.

    Under the usual TestCase every test runs inside a transaction that is rolled
    back, so on_commit callbacks never fire and the assertion would pass or fail
    for the wrong reason.
    """

    def setUp(self):
        self.resident = User.objects.create_user(
            email="privacy-resident@example.com", phone_number="+639181110001",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )

    def _concern_with_photo(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Sasakyang nakaharang",
            description="May sasakyang nakaharang sa driveway sa Rosal Street mula kaninang umaga.",
            category=Concern.Category.VEHICLE,
        )
        upload = SimpleUploadedFile("evidence.jpg", photo_bytes(), content_type="image/jpeg")
        media = ConcernMedia.objects.create(
            concern=concern,
            file=upload,
            original_filename=upload.name,
            mime_type="image/jpeg",
            file_size=upload.size,
            sha256_hash="a" * 64,
        )
        return concern, media

    def test_a_requested_scan_queues_the_media_and_keeps_it_restricted(self):
        concern, media = self._concern_with_photo()

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, \
             patch("apps.concerns.tasks.enqueue_concern_media_privacy") as enqueue:
            classifier.return_value.analyze.return_value = privacy_scan_result(
                classes=["face", "license plate"], category=Concern.Category.VEHICLE,
            )
            assessment = process_concern_ai(concern.pk)

        media.refresh_from_db()
        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.QUEUED)
        self.assertEqual(media.privacy_requested_classes, ["face", "license plate"])
        self.assertFalse(media.public_visible)
        self.assertTrue(assessment.privacy_scan_required)
        self.assertTrue(assessment.raw_result["photo"]["sam3_triggered"])
        enqueue.assert_called_once_with(media.pk)

    def test_no_suspicion_clears_the_photo_without_calling_roboflow(self):
        concern, media = self._concern_with_photo()

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, \
             patch("apps.concerns.tasks.enqueue_concern_media_privacy") as enqueue:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.VEHICLE,
                image_review_succeeded=True,
                evidence_relationship="supports_report",
            )
            process_concern_ai(concern.pk)

        media.refresh_from_db()
        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.NOT_REQUIRED)
        self.assertTrue(media.public_visible)
        self.assertTrue(media.preview_file.name)
        enqueue.assert_not_called()

    def test_a_failed_image_review_still_scans_for_faces_and_plates(self):
        """SAM3 does not need Gemma to find a face.

        The first version cleared the class list when Gemma's image call failed,
        so SAM3 never ran and a photo containing a face was published unblurred
        — purely because a different model had returned a 500. Ollama Cloud
        fails that way often enough that this was the common path, not the edge
        case. Blurring a face that did not need it costs nothing; publishing one
        that did is the failure the pipeline exists to prevent.
        """
        concern, media = self._concern_with_photo()

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, \
             patch("apps.concerns.tasks.enqueue_concern_media_privacy") as enqueue:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.VEHICLE,
                image_review_succeeded=False,
                evidence_relationship="image_review_failed",
            )
            assessment = process_concern_ai(concern.pk)

        media.refresh_from_db()
        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.QUEUED)
        self.assertEqual(media.privacy_requested_classes, ["face", "license plate", "blood"])
        self.assertFalse(media.public_visible, "unscanned media must not be public in the meantime")
        enqueue.assert_called_once_with(media.pk)
        # A photo we could not read must not make the report irrelevant, and we
        # still must not claim anything about what is in it.
        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertFalse(assessment.image_review_succeeded)
        self.assertEqual(assessment.detected_objects, [])
        concern.refresh_from_db()
        self.assertNotEqual(concern.status, Concern.Status.REJECTED)

    def test_a_report_with_no_photo_never_queues_a_scan(self):
        concern = Concern.objects.create(
            reporter=self.resident, title="Text only",
            description="May baradong kanal sa gilid ng kalsada.",
            category=Concern.Category.INFRASTRUCTURE,
        )

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, \
             patch("apps.concerns.tasks.enqueue_concern_media_privacy") as enqueue:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.INFRASTRUCTURE,
            )
            process_concern_ai(concern.pk)

        enqueue.assert_not_called()


@override_settings(ROBOFLOW_API_KEY="test-key")
class PrivacyProcessingTests(TestCase):
    def setUp(self):
        self.resident = User.objects.create_user(
            email="privacy-processing@example.com", phone_number="+639181110002",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )
        self.concern = Concern.objects.create(
            reporter=self.resident, title="Photo", description="A photo was submitted.",
            category=Concern.Category.VEHICLE,
        )
        upload = SimpleUploadedFile("evidence.jpg", photo_bytes(), content_type="image/jpeg")
        self.media = ConcernMedia.objects.create(
            concern=self.concern, file=upload, original_filename=upload.name,
            mime_type="image/jpeg", file_size=upload.size, sha256_hash="b" * 64,
        )

    def _run(self, payload, classes=("face",), **kwargs):
        with patch("apps.concerns.ai.privacy.service.run_segmentation", return_value=payload) as segment:
            media = process_media_privacy(self.media, requested_classes=list(classes), **kwargs)
        return media, segment

    def test_face_and_plate_masks_produce_a_published_protected_copy(self):
        media, _ = self._run(sam3_payload(FACE_BOX, PLATE_BOX), classes=("face", "license plate"))

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.PROTECTED)
        self.assertTrue(media.public_visible)
        self.assertTrue(media.preview_file.name)
        self.assertEqual(len(media.privacy_regions), 2)
        self.assertEqual(sorted(media.privacy_detected_classes), ["face", "license plate"])
        self.assertEqual(media.redactions.filter(source=ConcernMediaRedaction.Source.SAM3).count(), 2)

    def test_public_street_sign_is_not_blurred_with_private_regions(self):
        media, _ = self._run(
            sam3_payload(FACE_BOX, STREET_SIGN_BOX),
            classes=("face", "street sign"),
        )

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.PROTECTED)
        self.assertEqual(media.privacy_detected_classes, ["face"])
        self.assertEqual(len(media.privacy_regions), 1)
        self.assertEqual(media.privacy_regions[0]["label"], "face")
        self.assertEqual(media.redactions.filter(source=ConcernMediaRedaction.Source.SAM3).count(), 1)

    def test_a_legacy_street_sign_request_is_published_without_blurring(self):
        from apps.concerns.ai.privacy.service import process_media_privacy

        with patch("apps.concerns.ai.privacy.service.run_segmentation") as segment:
            media = process_media_privacy(self.media, requested_classes=["street sign"])

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.NOT_REQUIRED)
        self.assertTrue(media.public_visible)
        self.assertEqual(media.privacy_regions, [])
        self.assertEqual(media.redactions.count(), 0)
        segment.assert_not_called()

    def test_rerender_removes_stale_street_sign_redactions(self):
        from apps.concerns.ai.privacy import rerender_protected_copy

        stale = ConcernMediaRedaction.objects.create(
            media=self.media,
            x=0.2,
            y=0.2,
            width=0.2,
            height=0.2,
            label="street sign",
            source=ConcernMediaRedaction.Source.SAM3,
        )
        self.media.privacy_requested_classes = ["street sign"]
        self.media.privacy_detected_classes = ["street sign"]
        self.media.save(update_fields=["privacy_requested_classes", "privacy_detected_classes"])

        rerender_protected_copy(self.media)
        self.media.refresh_from_db()

        self.assertFalse(ConcernMediaRedaction.objects.filter(pk=stale.pk).exists())
        self.assertEqual(self.media.privacy_requested_classes, [])
        self.assertEqual(self.media.privacy_detected_classes, [])
        self.assertEqual(self.media.privacy_regions, [])

    def test_the_protected_copy_is_never_the_original_bytes(self):
        media, _ = self._run(sam3_payload(FACE_BOX))

        with media.preview_file.open("rb") as handle:
            protected = handle.read()
        self.assertNotEqual(protected, photo_bytes())
        self.assertTrue(protected.startswith(b"\xff\xd8"))

    def test_blood_like_content_restricts_instead_of_publishing(self):
        """Never treated as confirmed, and never shown to the public either."""
        media, _ = self._run(sam3_payload(BLOOD_BOX), classes=("blood",))

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.SENSITIVE_REVIEW_REQUIRED)
        self.assertFalse(media.public_visible)

    def test_no_returned_mask_is_not_a_clearance(self):
        media, _ = self._run(sam3_payload())

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.NO_MATCH_FOUND)
        self.assertTrue(media.public_visible)

    def test_unusable_masks_are_discarded_rather_than_approximated(self):
        """A mask covering most of the photo, or a sliver, is not a face."""
        media, _ = self._run(
            sam3_payload(
                {"class": "face", "x": 400, "y": 300, "width": 790, "height": 590},
                {"class": "face", "x": 10, "y": 10, "width": 2, "height": 2},
            )
        )

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.NO_MATCH_FOUND)
        self.assertTrue(media.public_visible)
        self.assertEqual(media.privacy_regions, [])

    def test_a_sam3_outage_leaves_the_original_restricted(self):
        with patch("apps.concerns.ai.privacy.service.run_segmentation", side_effect=Sam3Unavailable("ReadTimeout")):
            media = process_media_privacy(self.media, requested_classes=["face"])

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.FAILED_RESTRICTED)
        self.assertFalse(media.public_visible)
        self.assertIn("sam3_unavailable", media.privacy_failure["reason"])

    def test_an_unconfigured_key_leaves_the_original_restricted(self):
        with patch("apps.concerns.ai.privacy.service.run_segmentation", side_effect=Sam3NotConfigured("no key")):
            media = process_media_privacy(self.media, requested_classes=["face"])

        self.assertEqual(media.privacy_state, ConcernMedia.PrivacyState.FAILED_RESTRICTED)
        self.assertFalse(media.public_visible)
        self.assertEqual(media.privacy_failure["reason"], "media_protection_not_configured")

    def test_an_unchanged_image_and_class_list_reuses_the_cached_result(self):
        media, first = self._run(sam3_payload(FACE_BOX))
        self.assertEqual(first.call_count, 1)
        self.assertEqual(media.privacy_cache_key, privacy_cache_key(media, ["face"]))

        _media, second = self._run(sam3_payload(FACE_BOX))

        self.assertEqual(second.call_count, 0, "Roboflow was called again for an identical run")

    def test_a_changed_class_list_reruns_the_scan(self):
        self._run(sam3_payload(FACE_BOX))

        _media, again = self._run(sam3_payload(FACE_BOX, PLATE_BOX), classes=("face", "license plate"))

        self.assertEqual(again.call_count, 1)

    def test_an_official_can_force_a_rerun(self):
        self._run(sam3_payload(FACE_BOX))

        _media, again = self._run(sam3_payload(FACE_BOX), force=True)

        self.assertEqual(again.call_count, 1)

    def test_a_previous_failure_is_never_cached_as_success(self):
        with patch("apps.concerns.ai.privacy.service.run_segmentation", side_effect=Sam3Unavailable("ReadTimeout")):
            process_media_privacy(self.media, requested_classes=["face"])

        _media, retry = self._run(sam3_payload(FACE_BOX))

        self.assertEqual(retry.call_count, 1)


class SensitiveVocabularyTests(TestCase):
    """Gemma names what to blur; these rules keep the names findable.

    SAM3 is open-vocabulary, so the class list is not fixed — but it can only
    segment things that are visible. An abstraction returns nothing, and an
    empty scan is indistinguishable from "no sensitive content here", so the
    guard has to run before the request, not after.
    """

    def test_gemma_can_name_classes_beyond_the_core_three(self):
        from apps.concerns.ai.gemma_analyzer import sensitive_classes_from

        self.assertEqual(
            sensitive_classes_from(["id card", "house number", "phone screen"]),
            ["id card", "house number", "phone screen"],
        )

    def test_long_phrasings_collapse_to_the_core_terms(self):
        from apps.concerns.ai.gemma_analyzer import sensitive_classes_from

        self.assertEqual(
            sensitive_classes_from(["Human Face", "blood-like stain", "number plate"]),
            ["face", "blood", "license plate"],
        )

    def test_abstractions_are_dropped_before_they_reach_sam3(self):
        """"injury" finds nothing, and nothing reads as an all-clear."""
        from apps.concerns.ai.gemma_analyzer import sensitive_classes_from

        self.assertEqual(
            sensitive_classes_from(["injury", "personal information", "sensitive content", "face"]),
            ["face"],
        )

    def test_descriptions_longer_than_two_words_are_dropped(self):
        from apps.concerns.ai.gemma_analyzer import sensitive_classes_from

        self.assertEqual(sensitive_classes_from(["the face of a child in the photo"]), [])

    def test_duplicates_collapse_and_the_list_is_capped(self):
        from apps.concerns.ai.gemma_analyzer import MAX_SENSITIVE_CLASSES, sensitive_classes_from

        result = sensitive_classes_from(
            ["face", "human face", "id card", "name tag", "receipt", "tattoo", "signature"]
        )
        self.assertEqual(result[:2], ["face", "id card"])
        self.assertLessEqual(len(result), MAX_SENSITIVE_CLASSES)


class MaskValidationTests(TestCase):
    """What counts as a usable mask, and what gets thrown away."""

    def test_a_close_up_face_is_not_discarded_by_the_size_ceiling(self):
        """Regression: a real 265x212 portrait went out unblurred.

        SAM3 returned a 90%-confident `face` mask covering 41% of the
        frame. The area check then ran on the *padded* box — 64% — which
        exceeded the old 0.60 ceiling, so a detected face was discarded and the
        photo was published as "no matching sensitive region". Padding is our
        own safety margin; it must never disqualify the detection it protects.
        """
        from apps.concerns.ai.privacy.masks import parse_regions

        payload = sam3_payload({"class": "face", "confidence": 0.9, "x": 124.5, "y": 120.0, "width": 143.0, "height": 164.0})

        regions = parse_regions(payload, image_width=265, image_height=212)

        self.assertEqual(len(regions), 1, "a confident close-up face mask was thrown away")
        self.assertEqual(regions[0].label, "face")

    def test_a_mask_covering_the_whole_photo_is_still_rejected(self):
        """The ceiling still has to catch a detection that selected everything."""
        from apps.concerns.ai.privacy.masks import parse_regions

        payload = sam3_payload({"class": "face", "x": 132.0, "y": 106.0, "width": 264.0, "height": 211.0})

        self.assertEqual(parse_regions(payload, image_width=265, image_height=212), [])

    def test_a_padded_region_never_escapes_the_image_bounds(self):
        from apps.concerns.ai.privacy.masks import parse_regions

        payload = sam3_payload({"class": "face", "x": 20.0, "y": 20.0, "width": 30.0, "height": 30.0})

        region = parse_regions(payload, image_width=265, image_height=212)[0]
        left, top, right, bottom = region.to_pixels(265, 212)
        self.assertGreaterEqual(left, 0)
        self.assertGreaterEqual(top, 0)
        self.assertLessEqual(right, 265)
        self.assertLessEqual(bottom, 212)

    def test_the_real_workflow_response_shape_is_understood(self):
        """Pins the live shape: nested predictions, centre+size, spaced class."""
        from apps.concerns.ai.privacy.masks import detected_classes, parse_regions

        payload = {
            "annotated_image": {"type": "base64", "value": "ignored"},
            "predictions": {
                "image": {"width": 1248, "height": 650},
                "predictions": [
                    # Roboflow echoes the class list back unstripped, so the
                    # second and later classes arrive with a leading space.
                    {"class": " license plate", "confidence": 0.92, "x": 455.0, "y": 414.0,
                     "width": 168.0, "height": 286.0, "rle_mask": {"size": [650, 1248], "counts": "ignored"}},
                ],
            },
        }

        regions = parse_regions(payload, image_width=1248, image_height=650)

        self.assertEqual(len(regions), 1)
        self.assertEqual(detected_classes(regions), ["license plate"])

    def test_only_privacy_sensitive_labels_are_blurrable(self):
        from apps.concerns.ai.privacy.masks import is_privacy_sensitive_label

        self.assertTrue(is_privacy_sensitive_label("face"))
        self.assertTrue(is_privacy_sensitive_label("license_plate"))
        self.assertFalse(is_privacy_sensitive_label("id card"))
        self.assertFalse(is_privacy_sensitive_label("street sign"))
        self.assertFalse(is_privacy_sensitive_label("person"))

    def test_automatic_blur_ignores_old_non_private_regions(self):
        from apps.concerns.ai.privacy.masks import Region, blur_regions

        image = Image.new("RGB", (160, 100), "white")
        draw = ImageDraw.Draw(image)
        for y in range(10, 45, 3):
            for x in range(10, 65, 3):
                draw.point((x, y), fill="black")
        for y in range(55, 90, 3):
            for x in range(95, 150, 3):
                draw.point((x, y), fill="black")

        redacted = blur_regions(
            image,
            [
                Region(x=0.05, y=0.10, width=0.40, height=0.35, label="street sign", source="sam3"),
                Region(x=0.58, y=0.55, width=0.35, height=0.35, label="face", source="sam3"),
            ],
        )

        self.assertEqual(redacted.crop((8, 8, 72, 48)).tobytes(), image.crop((8, 8, 72, 48)).tobytes())
        self.assertNotEqual(redacted.crop((92, 52, 152, 94)).tobytes(), image.crop((92, 52, 152, 94)).tobytes())


class Sam3ClientTests(TestCase):
    """The HTTP call itself, including the one thing that must never leak."""

    @override_settings(ROBOFLOW_API_KEY="")
    def test_a_missing_key_is_not_configured_rather_than_unavailable(self):
        from apps.concerns.ai.privacy.sam3_client import run_segmentation

        with self.assertRaises(Sam3NotConfigured):
            run_segmentation("ignored.jpg", ["face"])

    @override_settings(
        ROBOFLOW_API_KEY="secret-key",
        ROBOFLOW_WORKSPACE="eboses-north",
        ROBOFLOW_WORKFLOW_ID="general-segmentation-api-3",
    )
    def test_the_workflow_is_called_with_the_requested_classes(self):
        from apps.concerns.ai.privacy import sam3_client

        with patch.object(sam3_client, "requests") as http, \
             patch("builtins.open", create=True) as opened:
            opened.return_value.__enter__.return_value.read.return_value = b"jpeg-bytes"
            http.post.return_value.json.return_value = {"outputs": [sam3_payload(FACE_BOX)]}
            result = sam3_client.run_segmentation("photo.jpg", ["face", "license plate"])

        url, kwargs = http.post.call_args[0][0], http.post.call_args[1]
        self.assertEqual(url, "https://serverless.roboflow.com/infer/workflows/eboses-north/general-segmentation-api-3")
        self.assertEqual(kwargs["json"]["inputs"]["classes"], "face, license plate")
        self.assertTrue(kwargs["json"]["use_cache"])
        self.assertEqual(result, sam3_payload(FACE_BOX))

    @override_settings(ROBOFLOW_API_KEY="secret-key")
    def test_a_transport_failure_never_carries_the_key_into_the_exception(self):
        """requests renders the whole request on error, and the key is in the body."""
        from apps.concerns.ai.privacy import sam3_client

        with patch.object(sam3_client, "requests") as http, \
             patch("builtins.open", create=True) as opened:
            opened.return_value.__enter__.return_value.read.return_value = b"jpeg-bytes"
            http.post.side_effect = RuntimeError("POST body: api_key=secret-key")

            with self.assertRaises(Sam3Unavailable) as raised:
                sam3_client.run_segmentation("photo.jpg", ["face"])

        self.assertNotIn("secret-key", str(raised.exception))
        self.assertEqual(str(raised.exception), "RuntimeError")


@override_settings(ROBOFLOW_API_KEY="test-key")
class PrivacyTaskTests(TestCase):
    """The task wrapper: claim the row, run, and never strand it mid-flight."""

    def setUp(self):
        self.resident = User.objects.create_user(
            email="privacy-task@example.com", phone_number="+639181110005",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=self.resident, title="Photo", description="A photo was submitted.",
            category=Concern.Category.VEHICLE,
        )
        upload = SimpleUploadedFile("evidence.jpg", photo_bytes(), content_type="image/jpeg")
        self.media = ConcernMedia.objects.create(
            concern=concern, file=upload, original_filename=upload.name,
            mime_type="image/jpeg", file_size=upload.size, sha256_hash="d" * 64,
            privacy_state=ConcernMedia.PrivacyState.QUEUED,
            privacy_requested_classes=["face"],
        )

    def test_a_queued_row_is_claimed_processed_and_published(self):
        from apps.concerns.tasks import process_concern_media_privacy_task

        with patch("apps.concerns.ai.privacy.service.run_segmentation", return_value=sam3_payload(FACE_BOX)):
            result = process_concern_media_privacy_task.apply(args=[self.media.pk]).get()

        self.media.refresh_from_db()
        self.assertFalse(result["skipped"])
        self.assertEqual(self.media.privacy_state, ConcernMedia.PrivacyState.PROTECTED)
        self.assertTrue(self.media.public_visible)

    def test_a_row_nobody_queued_is_skipped_rather_than_processed(self):
        from apps.concerns.tasks import process_concern_media_privacy_task

        self.media.privacy_state = ConcernMedia.PrivacyState.NOT_REQUIRED
        self.media.save(update_fields=["privacy_state"])

        with patch("apps.concerns.ai.privacy.service.run_segmentation") as segment:
            result = process_concern_media_privacy_task.apply(args=[self.media.pk]).get()

        self.assertTrue(result["skipped"])
        segment.assert_not_called()

    def test_a_crash_never_leaves_the_row_stuck_in_processing(self):
        """PROCESSING reads as "in progress" forever and blocks the next claim."""
        from apps.concerns.tasks import process_concern_media_privacy_task

        with patch("apps.concerns.ai.privacy.service.run_segmentation", side_effect=MemoryError("boom")):
            with self.assertRaises(MemoryError):
                process_concern_media_privacy_task.apply(args=[self.media.pk]).get()

        self.media.refresh_from_db()
        self.assertEqual(self.media.privacy_state, ConcernMedia.PrivacyState.FAILED_RESTRICTED)
        self.assertFalse(self.media.public_visible)


class ManualBlurTests(APITestCase):
    def setUp(self):
        self.resident = User.objects.create_user(
            email="manual-blur-resident@example.com", phone_number="+639181110003",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="manual-blur-official@example.com", phone_number="+639181110004",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )
        designation = Designation.objects.create(
            user=self.official,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        ensure_test_profile(self.resident, community=designation.department.community)
        self.concern = Concern.objects.create(
            reporter=self.resident, title="Photo", description="A photo was submitted.",
            category=Concern.Category.VEHICLE,
            assigned_department=designation.department,
        )
        upload = SimpleUploadedFile("evidence.jpg", photo_bytes(), content_type="image/jpeg")
        self.media = ConcernMedia.objects.create(
            concern=self.concern, file=upload, original_filename=upload.name,
            mime_type="image/jpeg", file_size=upload.size, sha256_hash="c" * 64,
            privacy_state=ConcernMedia.PrivacyState.NO_MATCH_FOUND,
        )

    def test_an_official_can_blur_an_area_the_scan_missed(self):
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/concerns/media/{self.media.pk}/redactions/",
            [{"x": 0.3, "y": 0.3, "width": 0.2, "height": 0.2, "label": "house number"}],
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.media.refresh_from_db()
        self.assertEqual(self.media.privacy_state, ConcernMedia.PrivacyState.PROTECTED)
        self.assertTrue(self.media.public_visible)
        self.assertEqual(self.media.redactions.filter(source=ConcernMediaRedaction.Source.OFFICIAL).count(), 1)
        self.assertTrue(
            AuditLog.objects.filter(action="concern.media_redacted", actor=self.official).exists()
        )

    def test_a_resident_cannot_edit_redactions(self):
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            f"/api/concerns/media/{self.media.pk}/redactions/",
            [{"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2}],
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.media.redactions.count(), 0)

    def test_an_area_outside_the_photo_is_rejected(self):
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/concerns/media/{self.media.pk}/redactions/",
            [{"x": 0.9, "y": 0.9, "width": 0.5, "height": 0.5}],
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_official_cannot_delete_an_automatic_region(self):
        """Removing a SAM3 region here would un-blur a face with no record."""
        automatic = ConcernMediaRedaction.objects.create(
            media=self.media, x=0.4, y=0.4, width=0.1, height=0.1,
            label="face", source=ConcernMediaRedaction.Source.SAM3,
        )
        self.client.force_authenticate(self.official)

        response = self.client.delete(
            f"/api/concerns/media/{self.media.pk}/redactions/{automatic.pk}/"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ConcernMediaRedaction.objects.filter(pk=automatic.pk).exists())

    def test_redaction_coordinates_are_hidden_from_residents(self):
        ConcernMediaRedaction.objects.create(
            media=self.media, x=0.4, y=0.4, width=0.1, height=0.1,
            source=ConcernMediaRedaction.Source.OFFICIAL, created_by=self.official,
        )
        self.client.force_authenticate(self.resident)

        response = self.client.get(f"/api/concerns/{self.concern.pk}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["media"][0]["redactions"], [])
