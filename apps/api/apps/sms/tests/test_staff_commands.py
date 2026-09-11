from django.test import SimpleTestCase

from apps.sms.parsing import parse_command


class StaffCommandContractTests(SimpleTestCase):
    def test_only_progress_keywords_remain_operational(self):
        self.assertEqual(parse_command("ENROUTE").keyword, "ENROUTE")
        self.assertEqual(parse_command("ONSCENE").keyword, "ONSCENE")
        self.assertEqual(parse_command("RESOLVED").keyword, "RESOLVED")

    def test_accept_and_decline_are_not_progress(self):
        self.assertNotIn(parse_command("ACCEPT").keyword, {"ENROUTE", "ONSCENE", "RESOLVED"})
        self.assertNotIn(parse_command("DECLINE").keyword, {"ENROUTE", "ONSCENE", "RESOLVED"})
