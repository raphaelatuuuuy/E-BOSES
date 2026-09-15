from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from .description import description_for_display, fallback_description
from .description import generate_description, generate_title, incident_title, title_for_display


class EmergencyDescriptionTests(SimpleTestCase):
    def test_wizard_sms_answers_reach_complete_incident_descriptions(self):
        from apps.sms.parsing import parse_emergency_sms, TRIAGE_PHRASES

        for phrase, detail in TRIAGE_PHRASES['detail'].items():
            with self.subTest(detail=detail, phrase=phrase):
                parsed = parse_emergency_sms(
                    'I need immediate help. This is a Flood emergency near Mayon Street. '
                    f'1 person affected, {phrase}, someone is injured. Please send assistance.\n'
                    'LOC:14.650123,121.112345'
                )
                self.assertEqual(parsed.triage, {
                    'people_affected': 'one', 'detail': detail, 'injuries': 'yes'})
                result = fallback_description(self.alert(
                    type=parsed.category_code, note=parsed.note, triage=parsed.triage,
                    canonical_street=parsed.reported_area))
                self.assertIn('Mayon Street', result)
                self.assertIn('affecting one person, with reported injuries.', result)
                self.assertNotIn('Please send', result)
                self.assertNotIn('LOC:', result)
                self.assertNotIn('_', result)

    def test_unknown_answers_are_explicit(self):
        result = fallback_description(self.alert(triage={
            'people_affected': 'unknown', 'injuries': 'unknown'}))
        self.assertIn('number of people affected unknown', result)
        self.assertIn('injuries unknown', result)

    def test_status_sms_is_not_displayed_as_incident_prose(self):
        raw = ('E-BOSES STATUS - E-313\nFire emergency\nDao Street\n'
               'Status: Being reviewed\nReceived: 9:26 PM\n'
               'Reply SAFE if you are now safe. Reply CANCEL to request cancellation.')
        alert = self.alert(note=raw, triage={}, canonical_street='Dao Street',
                           ai_assist={'description': 'The resident reported ' + raw})
        self.assertEqual(description_for_display(alert),
                         'The resident reported a fire around Dao Street.')

    def test_flood_depth_is_complete_without_a_model(self):
        alert = self.alert(type='flood', triage={
            'detail': 'waist', 'people_affected': 'one', 'injuries': 'yes'})
        with self.settings(OLLAMA_API_KEY=''):
            result = generate_description(alert)
        self.assertIn('waist-deep water or higher', result)
        self.assertIn('affecting one person, with reported injuries.', result)

    def test_model_receives_incident_data_and_rejects_sms_boilerplate(self):
        alert = self.alert(note='E-BOSES STATUS - E-313\nReply SAFE if safe.')
        alert.media = Mock()
        alert.media.all.return_value = []
        with self.settings(OLLAMA_API_KEY='test-only'), patch('ollama.Client') as client:
            client.return_value.chat.return_value = {'message': {'content':
                '{"description": "The resident reported E-BOSES STATUS - E-313."}'}}
            self.assertEqual(generate_description(alert), fallback_description(alert))
            client.assert_not_called()

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
            "The resident reported a fire around Champaca Street that has been contained, affecting 2–5 people, with reported injuries.",
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

    def test_deterministic_title_names_the_type_and_street(self):
        self.assertEqual(incident_title(self.alert()), "Fire around Champaca Street")
        self.assertEqual(incident_title(self.alert(canonical_street="")), "Fire emergency")
        self.assertEqual(incident_title(self.alert(type="")), "Emergency report around Champaca Street")
        self.assertEqual(incident_title(self.alert(type="", canonical_street="")), "Emergency report")

    def test_title_uses_the_model_when_it_answers_well(self):
        alert = self.alert()
        with self.settings(OLLAMA_API_KEY='test-only'), patch('ollama.Client') as client:
            client.return_value.chat.return_value = {'message': {'content':
                '{"title": "House fire on Champaca Street"}'}}
            self.assertEqual(generate_title(alert), "House fire on Champaca Street")

    def test_title_falls_back_when_the_model_is_unavailable_or_off_topic(self):
        alert = self.alert()
        with self.settings(OLLAMA_API_KEY=''):
            self.assertEqual(generate_title(alert), incident_title(alert))
        with self.settings(OLLAMA_API_KEY='test-only'), patch('ollama.Client') as client:
            client.return_value.chat.return_value = {'message': {'content':
                '{"title": "E-BOSES STATUS - E-313 Reply SAFE"}'}}
            self.assertEqual(generate_title(alert), incident_title(alert))

    def test_display_title_never_leaks_boilerplate(self):
        alert = self.alert(ai_assist={"title": "E-BOSES STATUS Reply SAFE if safe"})
        self.assertEqual(title_for_display(alert), incident_title(alert))
        alert = self.alert(ai_assist={"title": "Vehicle collision near Ayala Malls"})
        self.assertEqual(title_for_display(alert), "Vehicle collision near Ayala Malls")
        self.assertEqual(title_for_display(self.alert(ai_assist={})), incident_title(alert))
