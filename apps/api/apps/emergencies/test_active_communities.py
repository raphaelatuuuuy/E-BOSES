from datetime import date

from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile, User
from apps.concerns.models import Concern
from apps.concerns.test_helpers import grant_position
from apps.emergencies.models import MapGeometry


BARANGAY = "Marikina Heights"

NEIGHBOUR_GEOMETRY = {
    "type": "Polygon",
    "coordinates": [[[121.10, 14.64], [121.11, 14.64], [121.11, 14.65], [121.10, 14.65], [121.10, 14.64]]],
}


def make_neighbour(name="Concepcion Uno", osm_id=900001):
    return MapGeometry.objects.create(
        kind=MapGeometry.Kind.BOUNDARY,
        name=name,
        locality="Marikina",
        osm_type="R",
        osm_id=osm_id,
        geometry=NEIGHBOUR_GEOMETRY,
        is_active=True,
        is_home=False,
    )


def make_user(email, role, barangay=BARANGAY):
    user = User.objects.create_user(
        email=email,
        password="Str0ng!Passw0rd",
        role=role,
        status=User.Status.VERIFIED,
        phone_number=f"+639{abs(hash(email)) % 1000000000:09d}",
    )
    ResidentProfile.objects.create(
        user=user,
        first_name="Ana",
        last_name="Cruz",
        date_of_birth=date(1990, 1, 1),
        address="12 Champaca Street",
        barangay=barangay,
    )
    return user


class ActiveCommunityBoundariesTests(APITestCase):
    def setUp(self):
        self.url = reverse("location-active-communities")
        self.official = make_user("official@example.com", User.Role.BARANGAY_OFFICIAL)
        grant_position(self.official)
        self.resident = make_user("resident@example.com", User.Role.RESIDENT)

    def test_requires_authentication(self):
        response = self.client.get(self.url)

        self.assertIn(response.status_code, (401, 403))

    def test_a_resident_cannot_read_the_coverage_neighbours(self):
        self.client.force_authenticate(self.resident)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 403)

    def test_home_barangay_is_always_listed_with_its_outline(self):
        self.client.force_authenticate(self.official)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        home = [item for item in response.data if item["is_home"]]
        self.assertEqual(len(home), 1)
        self.assertEqual(home[0]["name"], BARANGAY)
        self.assertIsNotNone(home[0]["geometry"])

    def test_a_barangay_with_no_activity_is_not_a_community(self):
        make_neighbour()
        self.client.force_authenticate(self.official)

        response = self.client.get(self.url)

        names = {item["name"] for item in response.data}
        self.assertNotIn("Concepcion Uno", names)

    def test_a_barangay_with_real_records_is_listed_as_a_community(self):
        make_neighbour()
        Concern.objects.create(
            reporter=self.resident, title="Fallen tree", barangay="Concepcion Uno"
        )
        self.client.force_authenticate(self.official)

        response = self.client.get(self.url)

        listed = {item["name"]: item for item in response.data}
        self.assertIn("Concepcion Uno", listed)
        self.assertFalse(listed["Concepcion Uno"]["is_home"])
        self.assertEqual(listed["Concepcion Uno"]["geometry"], NEIGHBOUR_GEOMETRY)

    def test_the_same_barangay_is_never_listed_twice(self):
        make_neighbour(osm_id=900001)
        make_neighbour(osm_id=900002)
        Concern.objects.create(
            reporter=self.resident, title="Fallen tree", barangay="Concepcion Uno"
        )
        self.client.force_authenticate(self.official)

        response = self.client.get(self.url)

        names = [item["name"] for item in response.data]
        self.assertEqual(names.count("Concepcion Uno"), 1)

    def test_a_differently_spelled_locality_is_not_a_fake_neighbour(self):
        # The national PSGC import can hold a second row for the home barangay
        # with the locality spelled "City of Marikina" instead of "Marikina" —
        # same place, different text. That must not read as a neighbour of
        # itself just because the strings don't match byte-for-byte.
        MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name=BARANGAY,
            locality="City of Marikina",
            osm_type="R",
            osm_id=900099,
            geometry=NEIGHBOUR_GEOMETRY,
            is_active=True,
            is_home=False,
        )
        self.client.force_authenticate(self.official)

        response = self.client.get(self.url)

        names = [item["name"] for item in response.data]
        self.assertEqual(names.count(BARANGAY), 1)
