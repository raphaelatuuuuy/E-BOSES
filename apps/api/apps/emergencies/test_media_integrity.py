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
