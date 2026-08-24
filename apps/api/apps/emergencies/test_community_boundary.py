from django.test import SimpleTestCase, TestCase

from django.core.cache import cache

from apps.geo_services import point_in_geojson_inclusive, validate_emergency_location, validate_report_location
from apps.live_map import static_map_payload
from apps.emergencies.models import Community, MapGeometry


class CommunityBoundaryTests(SimpleTestCase):
    def setUp(self):
        self.polygon = {
            "type": "Polygon",
            "coordinates": [[
                [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
            ], [
                [4, 4], [6, 4], [6, 6], [4, 6], [4, 4],
            ]],
        }

    def test_outer_boundary_edge_is_inside(self):
        self.assertTrue(point_in_geojson_inclusive(0, 5, self.polygon))

    def test_point_just_outside_is_not_inside(self):
        self.assertFalse(point_in_geojson_inclusive(-0.000001, 5, self.polygon))

    def test_polygon_hole_is_outside(self):
        self.assertFalse(point_in_geojson_inclusive(5, 5, self.polygon))

    def test_multipolygon_is_supported(self):
        geometry = {"type": "MultiPolygon", "coordinates": [self.polygon["coordinates"]]}
        self.assertTrue(point_in_geojson_inclusive(2, 2, geometry))


class CommunityBoundaryRevisionTests(TestCase):
    def test_direct_boundary_edit_increments_revision(self):
        boundary = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Test boundary",
            osm_type="r",
            osm_id=900001,
            geometry={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
        )
        community = Community.objects.create(
            code="test-community",
            name="Test Community",
            boundary=boundary,
            center_latitude=0.5,
            center_longitude=0.5,
        )

        boundary.geometry = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 0]]]}
        boundary.save(update_fields=["geometry", "updated_at"])

        community.refresh_from_db()
        self.assertEqual(community.boundary_revision, 2)

    def test_second_community_boundary_drives_validation_and_map(self):
        boundary = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Second Community",
            osm_type="R",
            osm_id=900002,
            geometry={"type": "Polygon", "coordinates": [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]]},
        )
        community = Community.objects.create(
            code="second-community",
            name="Second Community",
            status=Community.Status.ACTIVE,
            boundary=boundary,
            center_latitude=20.5,
            center_longitude=20.5,
        )
        cache.clear()

        self.assertEqual(validate_emergency_location(20.5, 20.5), community)
        self.assertEqual(validate_report_location(20.5, 20.5)["community_id"], community.pk)
        self.assertEqual(static_map_payload(community)["boundary"]["name"], "Second Community")
