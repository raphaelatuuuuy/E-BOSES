from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.emergencies.models import MapDispatchPolicy
from apps.geo_services import validate_emergency_location, validate_report_location


INSIDE_ACCEPTANCE = (14.6507, 121.1133)
INSIDE_BARANGAY_OUTSIDE_ACCEPTANCE = (14.6507, 121.115)


class LocationPolicyTests(TestCase):
    def setUp(self):
        self.policy = MapDispatchPolicy.current()
        self.policy.acceptance_center_latitude = INSIDE_ACCEPTANCE[0]
        self.policy.acceptance_center_longitude = INSIDE_ACCEPTANCE[1]
        self.policy.acceptance_radius_meters = 100
        self.policy.save()

    def test_emergency_uses_community_boundary_not_radius(self):
        community = validate_emergency_location(*INSIDE_BARANGAY_OUTSIDE_ACCEPTANCE)
        self.assertIsNotNone(community)

    def test_report_accepts_inside_boundary_when_old_policy_blocks(self):
        self.policy.out_of_zone_action = MapDispatchPolicy.OutOfZoneAction.BLOCK
        self.policy.save(update_fields=["out_of_zone_action"])

        self.assertEqual(validate_report_location(*INSIDE_BARANGAY_OUTSIDE_ACCEPTANCE)["action"], "accept")

    def test_report_warns_when_policy_warns(self):
        self.policy.out_of_zone_action = MapDispatchPolicy.OutOfZoneAction.WARN
        self.policy.save(update_fields=["out_of_zone_action"])

        result = validate_report_location(*INSIDE_BARANGAY_OUTSIDE_ACCEPTANCE)

        self.assertEqual(result["action"], "accept")

    def test_report_reviews_when_policy_reviews(self):
        self.policy.out_of_zone_action = MapDispatchPolicy.OutOfZoneAction.REVIEW
        self.policy.save(update_fields=["out_of_zone_action"])

        result = validate_report_location(*INSIDE_BARANGAY_OUTSIDE_ACCEPTANCE)

        self.assertEqual(result["action"], "accept")
