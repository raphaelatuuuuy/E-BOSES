"""The street a community alert names.

The witness fan-out is created before reverse geocoding runs, so the phrase has
to read well in both states: the barangay right after dispatch, and the street
once the resolver has answered.
"""

from django.test import SimpleTestCase

from apps.emergencies.location_services import alert_street_address
from apps.emergencies.models import EmergencyAlert


class AlertStreetAddressTests(SimpleTestCase):
    def alert(self, **fields):
        # Never saved: this is the wording rule, not persistence. A null
        # reporter is fine for an unsaved instance.
        return EmergencyAlert(reporter=None, type=EmergencyAlert.Type.FIRE, **fields)

    def test_reverse_geocoded_street_wins_over_the_typed_area(self):
        alert = self.alert(
            resolved_location="Champaca Street, Marikina Heights",
            reported_area="near the school",
            address="99 Champaca Street",
        )

        self.assertEqual(alert_street_address(alert), "Champaca Street")

    def test_canonical_street_from_the_sms_geocoder_wins(self):
        alert = self.alert(
            canonical_street="Dao Street",
            resolved_location="Champaca Street, Marikina Heights",
        )

        self.assertEqual(alert_street_address(alert), "Dao Street")

    def test_typed_street_is_normalised_and_loses_its_house_number(self):
        alert = self.alert(reported_area="malapit sa 99 Champaca Street")

        self.assertEqual(alert_street_address(alert), "Champaca Street")

    def test_placeholders_and_coordinates_are_not_streets(self):
        for value in (
            "Pinned location on the map",
            "Location needs confirmation",
            "Address unavailable",
            "14.6501234, 121.1133000",
            "   ",
        ):
            with self.subTest(value=value):
                self.assertEqual(alert_street_address(self.alert(address=value)), "")

    def test_area_only_address_has_no_street(self):
        alert = self.alert(
            address="Marikina Heights, Marikina City",
            resolved_location="Marikina Heights, Marikina City",
        )

        self.assertEqual(alert_street_address(alert), "")
