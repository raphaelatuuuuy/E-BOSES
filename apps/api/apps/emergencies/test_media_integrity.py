"""The photo check on emergency alerts, and the line it must never cross.

An emergency is not a concern. A photo that looks fabricated is still possibly
attached to someone in real trouble, and no model is confident enough to be
worth the one case where it is wrong. So the check exists here only to tell a
responder what to expect.

Three properties, all of them about what does NOT happen:

- the alert dispatches before the check runs, and never waits for it
- no configuration value can reject, hold, or delay an alert
- the resident is never shown anything about it
"""

from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from apps.concerns.models import ConcernClassificationConfiguration
from apps.emergencies.models import EmergencyAlert, EmergencyMedia
from apps.emergencies.tasks import check_emergency_media_integrity_task

User = get_user_model()

CONFIRM = "apps.concerns.ai.gemma_analyzer.confirm_media_integrity"
PREPARE = "apps.concerns.ai.image_prep.prepare_image_for_gemma"


def photo_bytes():
    output = BytesIO()
    Image.new("RGB", (640, 480), (90, 110, 130)).save(output, "JPEG", quality=88)
    return output.getvalue()


def detailed_photo_bytes():
    """A photo with visible detail, so the soft quality gate passes."""
    import random

    from PIL import ImageDraw

    random.seed(20260911)
    image = Image.new("RGB", (640, 480), (90, 110, 130))
    draw = ImageDraw.Draw(image)
    draw.rectangle([40, 60, 300, 220], fill=(200, 80, 60))
    draw.ellipse([330, 120, 560, 380], fill=(60, 170, 90))
    draw.line([0, 400, 640, 320], fill=(240, 230, 200), width=9)
    pixels = image.load()
    for x in range(0, 640, 4):
        for y in range(0, 480, 4):
            jitter = random.randint(-14, 14)
            r, g, b = pixels[x, y]
            pixels[x, y] = (
                max(0, min(255, r + jitter)),
                max(0, min(255, g + jitter)),
                max(0, min(255, b + jitter)),
            )
    output = BytesIO()
    image.save(output, "JPEG", quality=88)
    return output.getvalue()


def prepared():
    from apps.concerns.ai.image_prep import PreparedImage

    return PreparedImage(data="Zm9v", mime_type="image/jpeg", telemetry={})


class EmergencyIntegrityActionTests(TestCase):
    def setUp(self):
        self.resident = User.objects.create_user(
            email="sos-resident@example.com",
            phone_number="+639181113331",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        self.alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="fire",
            note="May sunog sa kabilang bahay.",
            status=EmergencyAlert.Status.SUBMITTED,
        )
        upload = SimpleUploadedFile("sos.jpg", photo_bytes(), content_type="image/jpeg")
        EmergencyMedia.objects.create(
            alert=self.alert,
            file=upload,
            original_filename=upload.name,
            mime_type="image/jpeg",
            file_size=upload.size,
            sha256_hash="c" * 64,
        )

    def _run(self, verdict):
        with patch(PREPARE, return_value=prepared()), patch(CONFIRM, return_value=verdict):
            result = check_emergency_media_integrity_task.run(self.alert.pk)
        self.alert.refresh_from_db()
        return result

    def test_a_flagged_photo_is_recorded_on_the_alert(self):
        self._run(
            {
                "agrees": True,
                "verdict": "suspected_ai",
                "confidence": 0.88,
                "signals": ["the surface has no camera grain"],
            }
        )
        self.assertTrue(self.alert.media_integrity["flagged"])
        self.assertEqual(self.alert.media_integrity["findings"][0]["verdict"], "suspected_ai")

    def test_a_flagged_photo_never_changes_the_alert_status(self):
        before = self.alert.status
        self._run({"agrees": True, "verdict": "impossible_content", "confidence": 0.99, "signals": []})
        self.assertEqual(self.alert.status, before)
        self.assertNotEqual(self.alert.status, EmergencyAlert.Status.CANCELLED)

    def test_no_configuration_value_can_block_an_alert(self):
        # The emergency enum has no reject and no resubmit. Even the strongest
        # setting available leaves the alert exactly where it was.
        config = ConcernClassificationConfiguration.current_fresh()
        for action in ConcernClassificationConfiguration.EmergencyMediaIntegrityAction.values:
            config.media_integrity_emergency_action = action
            config.save()
            before = self.alert.status
            self._run({"agrees": True, "verdict": "impossible_content", "confidence": 0.99, "signals": []})
            self.assertEqual(self.alert.status, before)

    def test_the_emergency_enum_offers_no_blocking_option(self):
        values = set(ConcernClassificationConfiguration.EmergencyMediaIntegrityAction.values)
        self.assertNotIn("auto_reject", values)
        self.assertNotIn("request_resubmission", values)

    def test_a_clean_photo_is_recorded_without_a_flag(self):
        self._run({"agrees": False, "verdict": "authentic", "confidence": 0.9, "signals": []})
        self.assertFalse(self.alert.media_integrity["flagged"])

    def test_a_model_outage_leaves_the_alert_untouched(self):
        before = self.alert.status
        self._run(None)
        self.assertEqual(self.alert.status, before)
        self.assertEqual(self.alert.media_integrity["status"], "skipped")

    def test_the_check_can_be_switched_off(self):
        config = ConcernClassificationConfiguration.current_fresh()
        config.media_integrity_enabled = False
        config.save()
        result = self._run({"agrees": True, "verdict": "suspected_ai", "confidence": 0.9, "signals": []})
        self.assertEqual(result["status"], "disabled")
        self.assertEqual(self.alert.media_integrity, {})

    def test_an_alert_without_photos_is_skipped(self):
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="medical",
            note="Kailangan ng ambulansya.",
            status=EmergencyAlert.Status.SUBMITTED,
        )
        result = check_emergency_media_integrity_task.run(alert.pk)
        self.assertEqual(result["status"], "no_photo")

    def test_a_deleted_alert_does_not_raise(self):
        alert_id = self.alert.pk
        self.alert.delete()
        result = check_emergency_media_integrity_task.run(alert_id)
        self.assertEqual(result["status"], "missing")


class EmergencyDispatchOrderTests(TestCase):
    def test_the_integrity_task_is_queued_after_the_dispatch_broadcast(self):
        # Reading the source is the honest way to assert ordering here: both
        # are on_commit callbacks, and the one that notifies responders must
        # be registered first.
        import inspect

        from apps.emergencies import views

        source = inspect.getsource(views)
        broadcast = source.index("enqueue_emergency_created_broadcast(alert.pk)")
        integrity = source.index("enqueue_emergency_media_integrity(alert.pk)")
        self.assertLess(broadcast, integrity)

    def test_the_enqueue_helper_has_no_inline_fallback(self):
        # The preview helper deliberately runs inline in development when the
        # broker is down. This one must not: that would put a vision call back
        # on the dispatch path.
        import inspect

        from apps.emergencies.tasks import enqueue_emergency_media_integrity

        source = inspect.getsource(enqueue_emergency_media_integrity)
        self.assertNotIn(".run(", source)


CLASSIFY = "apps.concerns.ai.classification.classification_payload"
INTEGRITY_PREVIEW = "apps.concerns.classification_api._media_integrity_preview"


class EmergencyMediaCheckViewTests(TestCase):
    """Immediate upload-time checks for SOS attachments.

    The composer check must mirror the submit gate (byte validation, exact
    duplicate) and add the forensics plus AI authenticity verdicts per file,
    without persisting anything.
    """

    def setUp(self):
        from rest_framework.test import APIClient

        self.resident = User.objects.create_user(
            email="sos-check-resident@example.com",
            phone_number="+639181113332",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.resident)

    def _upload(self, content=None):
        return SimpleUploadedFile(
            "sos-check.jpg",
            content or detailed_photo_bytes(),
            content_type="image/jpeg",
        )

    def _check(self, upload):
        with (
            patch(CLASSIFY, return_value={"details": {}}),
            patch(
                INTEGRITY_PREVIEW,
                return_value={"status": "checked", "findings": []},
            ),
        ):
            return self.client.post(
                "/api/emergencies/media/check/",
                {"media": upload},
                format="multipart",
            )

    def test_clean_photo_is_accepted_with_per_file_verdict(self):
        response = self._check(self._upload())
        self.assertEqual(response.status_code, 200)
        files = response.data["files"]
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["status"], "accepted")
        self.assertEqual(files[0]["index"], 0)
        self.assertFalse(
            EmergencyMedia.objects.exists(),
            "The check endpoint must not persist uploads.",
        )

    def test_duplicate_photo_is_rejected_immediately(self):
        from apps.accounts.services import validate_emergency_media_file
        from apps.media_utils import sha256_file
        from django.core.files.base import ContentFile

        content = detailed_photo_bytes()
        # Validation re-encodes uploads, so the stored hash must come from the
        # normalized bytes — exactly what the endpoint hashes.
        normalized = validate_emergency_media_file(
            SimpleUploadedFile("sos-check.jpg", content, content_type="image/jpeg")
        )
        stored_hash = sha256_file(normalized)
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="fire",
            note="May sunog.",
            status=EmergencyAlert.Status.SUBMITTED,
        )
        EmergencyMedia.objects.create(
            alert=alert,
            file=ContentFile(content, name="sos-check.jpg"),
            original_filename="sos-check.jpg",
            mime_type="image/jpeg",
            file_size=len(content),
            sha256_hash=stored_hash,
        )
        response = self._check(self._upload(content))
        self.assertEqual(response.status_code, 400)
        self.assertIn("already uploaded", str(response.data["media"]))

    def test_empty_request_is_rejected(self):
        response = self.client.post(
            "/api/emergencies/media/check/", {}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)

    def test_unauthenticated_request_is_rejected(self):
        self.client.force_authenticate(user=None)
        with (
            patch(CLASSIFY, return_value={"details": {}}),
            patch(
                INTEGRITY_PREVIEW,
                return_value={"status": "checked", "findings": []},
            ),
        ):
            response = self.client.post(
                "/api/emergencies/media/check/",
                {"media": self._upload()},
                format="multipart",
            )
        self.assertIn(response.status_code, (401, 403))
