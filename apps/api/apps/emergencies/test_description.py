from types import SimpleNamespace

from django.test import SimpleTestCase

from .description import description_for_display, fallback_description


class EmergencyDescriptionTests(SimpleTestCase):
    def alert(self, **overrides):
        values = {
            "type": "fire",
            "note": "",
            "triage": {"detail": "contained", "injuries": "yes", "people_affected": "few"},
            "canonical_street": "Champaca Street",
            "resolved_location": "",
            "address": "",
            "reported_area": "",
            "ai_assist": {},
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_fallback_composes_location_and_triage_as_one_sentence(self):
        description = fallback_description(self.alert())

        self.assertEqual(
            description,
            "The resident reported a fire around Champaca Street that has been contained, affecting a few people, with reported injuries.",
        )
        self.assertNotIn("Detail:", description)
        self.assertNotIn("Injuries:", description)
        self.assertNotIn("People affected:", description)

    def test_legacy_stored_labels_are_never_returned_to_the_ui(self):
        alert = self.alert(
            ai_assist={
                "description": "The resident reported Detail: contained, Injuries: yes, People affected: few."
            }
        )

        self.assertEqual(description_for_display(alert), fallback_description(alert))
