from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.emergencies.models import MapDispatchPolicy, MapGeometry
from apps.geo_services import (
    coverage_result,
    invalidate_coverage_cache,
    validate_emergency_location,
    validate_report_location,
)


INSIDE_HOME = (14.6507, 121.1133)
NEIGHBOUR_BOX = (14.665, 14.670, 121.125, 121.135)
INSIDE_NEIGHBOUR = (14.6675, 121.130)
# ~33 m past the home boundary: the soft edge the out-of-zone action governs.
JUST_OUTSIDE_HOME = (14.6519, 121.1133)
FAR_AWAY = (14.5995, 120.9842)


def _square(min_lat, max_lat, min_lng, max_lng):
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [min_lng, min_lat],
                [max_lng, min_lat],
                [max_lng, max_lat],
                [min_lng, max_lat],
                [min_lng, min_lat],
            ]
        ],
    }


class CoverageAreaTests(TestCase):
    def setUp(self):
        self.policy = MapDispatchPolicy.current()
        self.policy.covered.clear()
        self.neighbour = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Test Neighbour",
            osm_type="R",
            osm_id=999000001,
            locality="Marikina",
            geometry=_square(*NEIGHBOUR_BOX),
        )
        invalidate_coverage_cache()

    def tearDown(self):
        invalidate_coverage_cache()

    def test_home_barangay_is_covered_by_default(self):
        result = coverage_result(*INSIDE_HOME)

        self.assertTrue(result["within"])
        self.assertEqual(result["barangay"], "Marikina Heights")

    def test_uncovered_neighbour_is_rejected(self):
        self.policy.out_of_zone_action = MapDispatchPolicy.OutOfZoneAction.BLOCK
        self.policy.save(update_fields=["out_of_zone_action"])

        self.assertFalse(coverage_result(*INSIDE_NEIGHBOUR)["within"])
        with self.assertRaises(ValidationError):
            validate_report_location(*INSIDE_NEIGHBOUR)

    def test_adding_a_neighbour_accepts_pins_inside_it(self):
        home = MapGeometry.objects.get(kind=MapGeometry.Kind.BOUNDARY, is_home=True)
        self.policy.covered.set([home, self.neighbour])
        invalidate_coverage_cache()

        result = coverage_result(*INSIDE_NEIGHBOUR)

        self.assertTrue(result["within"])
        self.assertEqual(result["barangay"], "Test Neighbour")
        self.assertEqual(
            validate_report_location(*INSIDE_NEIGHBOUR)["action"], "accept"
        )

    def test_home_stays_covered_after_adding_a_neighbour(self):
        home = MapGeometry.objects.get(kind=MapGeometry.Kind.BOUNDARY, is_home=True)
        self.policy.covered.set([home, self.neighbour])
        invalidate_coverage_cache()

        self.assertTrue(coverage_result(*INSIDE_HOME)["within"])

    def test_emergency_outside_coverage_is_rejected(self):
        with self.assertRaises(ValidationError):
            validate_emergency_location(*FAR_AWAY)

    def test_edge_pin_warns_when_policy_warns(self):
        self.policy.out_of_zone_action = MapDispatchPolicy.OutOfZoneAction.WARN
        self.policy.save(update_fields=["out_of_zone_action"])

        self.assertEqual(validate_report_location(*JUST_OUTSIDE_HOME)["action"], "warn")

    def test_edge_pin_reviews_when_policy_reviews(self):
        self.policy.out_of_zone_action = MapDispatchPolicy.OutOfZoneAction.REVIEW
        self.policy.save(update_fields=["out_of_zone_action"])

        self.assertEqual(validate_report_location(*JUST_OUTSIDE_HOME)["action"], "review")

    def test_far_pin_is_rejected_even_when_policy_only_reviews(self):
        """The out-of-zone action governs the soft edge, never a distant pin."""
        self.policy.out_of_zone_action = MapDispatchPolicy.OutOfZoneAction.REVIEW
        self.policy.save(update_fields=["out_of_zone_action"])

        with self.assertRaises(ValidationError):
            validate_report_location(*FAR_AWAY)
        with self.assertRaises(ValidationError):
            validate_report_location(*INSIDE_NEIGHBOUR)
