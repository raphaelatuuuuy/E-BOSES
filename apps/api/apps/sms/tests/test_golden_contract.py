"""The parser must read back exactly what the device renders.

Paired with apps/web/src/features/dashboard/components/sos-fallback.test.mjs,
which asserts the renderer produces these same strings.
"""

import json
from decimal import Decimal
from pathlib import Path

from django.test import SimpleTestCase

from apps.sms.parsing import parse_emergency_sms

GOLDEN_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "sms_golden_messages.json"


class GoldenMessageContractTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cases = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["cases"]

    def test_fixture_file_is_populated(self):
        self.assertGreaterEqual(len(self.cases), 5)

    def test_every_golden_message_parses_to_its_expected_fields(self):
        for case in self.cases:
            with self.subTest(case=case["name"]):
                parsed = parse_emergency_sms(case["message"], sender_is_known=True)
                expected = case["expected"]

                self.assertTrue(parsed.is_emergency)
                self.assertEqual(parsed.category_code, expected["category_code"])
                self.assertEqual(parsed.reported_area, expected["reported_area"])

                if expected["latitude"] is None:
                    self.assertIsNone(parsed.latitude)
                    self.assertIsNone(parsed.longitude)
                else:
                    self.assertEqual(parsed.latitude, Decimal(expected["latitude"]))
                    self.assertEqual(parsed.longitude, Decimal(expected["longitude"]))

                self.assertEqual(parsed.triage, expected["triage"])

                if expected.get("note_contains"):
                    self.assertIn(expected["note_contains"], parsed.note)

    def test_no_golden_message_leaks_identifiers(self):
        for case in self.cases:
            with self.subTest(case=case["name"]):
                message = case["message"]
                for banned in ("EBOSES-SOS", "User ID", "Request ID", "Timestamp", "Latitude:", "Longitude:"):
                    self.assertNotIn(banned, message)
