"""The resident-facing SMS path.

Before this was wired, an emergency raised in the app told the resident nothing:
emergency_ack was only reachable from the inbound-SMS router, so six written
templates had no call site at all.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.sms import notify, templates
from apps.sms.models import SmsPurpose

from .models import EmergencyAlert


class ResidentAcknowledgementTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="sms-resident@example.com",
            phone_number="+639171112221",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type=EmergencyAlert.Type.FIRE,
            resolved_location="Champaca Street",
            reporter_contact_number="+639171112221",
        )

    def test_acknowledgement_reaches_the_reporter(self):
        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_reporter_ack(self.alert, unit_name="Barangay Tanod")

        self.assertEqual(queued.call_count, 1)
        number, body = queued.call_args[0]
        self.assertEqual(number, "+639171112221")
        self.assertIn("E-BOSES Emergency", body)
        self.assertIn("Champaca Street", body)
        self.assertIn("Barangay Tanod", body)
        self.assertEqual(queued.call_args[1]["purpose"], SmsPurpose.EMERGENCY_ACK)

    def test_unassigned_alert_says_so_rather_than_promising_a_responder(self):
        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_reporter_ack(self.alert, assigned=False)

        body = queued.call_args[0][1]
        self.assertIn("officer on duty", body)
        self.assertNotIn("is on the way", body)

    def test_a_reporter_with_no_number_is_skipped_silently(self):
        self.alert.reporter_contact_number = ""
        self.alert.save(update_fields=["reporter_contact_number"])
        self.resident.phone_number = ""
        self.resident.save(update_fields=["phone_number"])

        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_reporter_ack(self.alert)

        queued.assert_not_called()

    def test_a_gateway_failure_never_propagates(self):
        with patch("apps.sms.notify.queue_sms", side_effect=RuntimeError("gateway down")):
            notify.notify_reporter_ack(self.alert)

    def test_resolution_notice_is_sent(self):
        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_reporter_resolved(self.alert)

        body = queued.call_args[0][1]
        self.assertIn("resolved", body.lower())
        self.assertIn(templates.reference(self.alert), body)

    def test_backup_notice_is_sent(self):
        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_reporter_backup(self.alert)

        self.assertIn("responder", queued.call_args[0][1].lower())

    def test_each_notice_uses_a_distinct_idempotency_key(self):
        keys = []
        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_reporter_ack(self.alert)
            notify.notify_reporter_resolved(self.alert)
            notify.notify_reporter_backup(self.alert)
            keys = [call[1]["idempotency_key"] for call in queued.call_args_list]

        self.assertEqual(len(keys), len(set(keys)))
        for key in keys:
            self.assertIn(str(self.alert.pk), key)


class OfficialAlertTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="sms-reporter@example.com",
            phone_number="+639171112222",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="sms-official@example.com",
            phone_number="+639171112223",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.alert = EmergencyAlert.objects.create(
            reporter=self.resident, type=EmergencyAlert.Type.MEDICAL
        )

    def test_officials_are_told_about_a_new_emergency(self):
        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_officials_new_emergency(self.alert, unit_name="BHW")

        self.assertEqual(queued.call_count, 1)
        self.assertEqual(queued.call_args[0][0], "+639171112223")
        self.assertIn("E-BOSES", queued.call_args[0][1])

    def test_an_official_with_no_number_is_not_contacted(self):
        self.official.phone_number = ""
        self.official.save(update_fields=["phone_number"])

        with patch("apps.sms.notify.queue_sms") as queued:
            notify.notify_officials_new_emergency(self.alert)

        queued.assert_not_called()


class TemplateContractTests(TestCase):
    """Every emergency template must stay inside GSM-7 and stay short."""

    def setUp(self):
        User = get_user_model()
        reporter = User.objects.create_user(
            email="sms-template@example.com",
            phone_number="+639171112224",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.alert = EmergencyAlert.objects.create(
            reporter=reporter,
            type=EmergencyAlert.Type.FIRE,
            resolved_location="Champaca Street",
        )

    def test_every_resident_template_fits_a_reasonable_segment_count(self):
        from apps.sms.gateway import count_segments

        bodies = {
            "ack": templates.emergency_ack(self.alert, surname="Cruz", unit_name="Tanod"),
            "unregistered": templates.emergency_ack_unregistered(self.alert),
            "resolved": templates.resident_resolved_notice(self.alert),
            "backup": templates.resident_backup_notice(self.alert),
            "outside": templates.outside_service_area(self.alert),
        }
        for name, body in bodies.items():
            with self.subTest(template=name):
                self.assertLessEqual(count_segments(body), 4, f"{name} is too long")

    def test_no_template_leaks_an_unmasked_reporter_number(self):
        body = templates.responder_dispatch(
            self.alert, priority="HIGH", summary="", contact="+639171234567"
        )
        self.assertNotIn("+639171234567", body)
        self.assertIn("4567", body)
