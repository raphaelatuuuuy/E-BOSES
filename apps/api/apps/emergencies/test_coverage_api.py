from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.test_helpers import grant_position
from apps.geo_services import invalidate_coverage_cache

from .models import MapDispatchPolicy, MapGeometry


COVERAGE_URL = "/api/config/coverage/"


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


class CoverageAreaApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.official = User.objects.create_user(
            email="coverage-official@example.com",
            phone_number="+639620000001",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        grant_position(self.official)

        self.home = MapGeometry.objects.get(kind=MapGeometry.Kind.BOUNDARY, is_home=True)
        self.adjacent = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Adjacent Barangay",
            osm_type="R",
            osm_id=999100001,
            locality="Marikina",
            geometry=_square(14.665, 14.670, 121.125, 121.135),
        )
        self.distant = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Distant Barangay",
            osm_type="R",
            osm_id=999100002,
            locality="Antipolo",
            geometry=_square(14.700, 14.705, 121.160, 121.170),
        )
        self.home.neighbors.add(self.adjacent)
        self.adjacent.neighbors.add(self.distant)

        MapDispatchPolicy.current().covered.clear()
        invalidate_coverage_cache()
        self.client.force_authenticate(self.official)

    def tearDown(self):
        invalidate_coverage_cache()

    def test_get_offers_only_neighbours_of_covered(self):
        response = self.client.get(COVERAGE_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row["name"] for row in response.data["covered"]], ["Marikina Heights"])
        available = [row["name"] for row in response.data["available"]]
        self.assertIn("Adjacent Barangay", available)
        self.assertNotIn("Distant Barangay", available)

    def test_adding_a_neighbour_surfaces_the_next_ring(self):
        response = self.client.put(
            COVERAGE_URL, {"covered": [self.home.pk, self.adjacent.pk]}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            sorted(row["name"] for row in response.data["covered"]),
            ["Adjacent Barangay", "Marikina Heights"],
        )
        self.assertIn("Distant Barangay", [row["name"] for row in response.data["available"]])

    def test_disconnected_coverage_is_rejected(self):
        response = self.client.put(
            COVERAGE_URL, {"covered": [self.home.pk, self.distant.pk]}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Distant Barangay", response.data["detail"])
        self.assertEqual(MapDispatchPolicy.current().covered.count(), 0)

    def test_home_is_always_kept(self):
        response = self.client.put(COVERAGE_URL, {"covered": []}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row["name"] for row in response.data["covered"]], ["Marikina Heights"])

    def test_cross_locality_neighbour_is_offered(self):
        self.home.neighbors.add(self.distant)

        response = self.client.get(COVERAGE_URL)

        offered = {row["name"]: row["locality"] for row in response.data["available"]}
        self.assertEqual(offered.get("Distant Barangay"), "Antipolo")

    def test_resident_cannot_read_coverage(self):
        User = get_user_model()
        resident = User.objects.create_user(
            email="coverage-resident@example.com",
            phone_number="+639620000002",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(resident)

        response = self.client.get(COVERAGE_URL)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
