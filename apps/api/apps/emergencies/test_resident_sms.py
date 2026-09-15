from django.test import SimpleTestCase

from apps.sms.gateway import count_segments
from apps.sms.management.commands.preview_sms import alert_templates, sample_alert


class EmergencySmsContractTests(SimpleTestCase):
    def test_pipeline_has_exactly_six_outbound_formats(self):
        self.assertEqual(
            set(alert_templates(sample_alert())),
            {
                "unit_dispatch",
                "resident_confirmation",
                "resident_en_route",
                "resident_nearby",
                "resident_arrived",
                "resident_resolved",
                "resident_exception",
            },
        )

    def test_messages_have_no_tracking_or_reply_instructions(self):
        for body in alert_templates(sample_alert()).values():
            self.assertNotIn("E-BOSES STATUS", body)
            self.assertNotIn("Reply ", body)
            self.assertNotIn("E-1042", body)
            self.assertNotIn("http", body)

    def test_resident_updates_are_one_segment(self):
        for name, body in alert_templates(sample_alert()).items():
            if name == "unit_dispatch":
                continue
            self.assertEqual(count_segments(body), 1, name)

    def test_unit_dispatch_contains_resolved_location_and_all_quick_answers(self):
        body = alert_templates(sample_alert())["unit_dispatch"]
        self.assertIn("assigned to your unit, BDRRMC", body)
        self.assertIn("Mayon Street, Hacienda Heights, Marikina", body)
        self.assertIn("waist-deep water or higher", body)
        self.assertIn("affecting one person", body)
        self.assertIn("with reported injuries", body)
