from datetime import date

from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile, User
from apps.concerns.models import Concern
from apps.emergencies.models import EmergencyAlert, MapGeometry
from apps.emergencies.public_api import centroid


BARANGAY = "Marikina Heights"


def make_user(email, role, status=User.Status.VERIFIED, first="Ana", last="Cruz"):
    user = User.objects.create_user(
        email=email,
        password="Str0ng!Passw0rd",
        role=role,
        status=status,
        phone_number=f"+639{abs(hash(email)) % 1000000000:09d}",
    )
    ResidentProfile.objects.create(
        user=user,
        first_name=first,
        last_name=last,
        date_of_birth=date(1990, 1, 1),
        address="12 Champaca Street",
        barangay=BARANGAY,
    )
    return user


class PublicCommunitiesTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.url = reverse("public-communities")
        self.home = MapGeometry.objects.get(kind=MapGeometry.Kind.BOUNDARY, is_home=True)
        self.resident = make_user("resident@example.com", User.Role.RESIDENT, first="Maria", last="Santos")
        make_user("resident2@example.com", User.Role.RESIDENT)
        make_user("responder@example.com", User.Role.FIRST_RESPONDER)
        make_user("official@example.com", User.Role.BARANGAY_OFFICIAL)
        make_user("pending@example.com", User.Role.RESIDENT, status=User.Status.PENDING_VERIFICATION)

        Concern.objects.create(reporter=self.resident, title="Blocked drainage", barangay=BARANGAY)
        Concern.objects.create(
            reporter=self.resident,
            title="Broken street light",
            barangay=BARANGAY,
            status=Concern.Status.RESOLVED,
        )
        EmergencyAlert.objects.create(
            reporter=self.resident, type=EmergencyAlert.Type.FIRE, barangay=BARANGAY
        )
        EmergencyAlert.objects.create(
            reporter=self.resident,
            type=EmergencyAlert.Type.MEDICAL,
            barangay=BARANGAY,
            status=EmergencyAlert.Status.CLOSED,
        )

    def test_anonymous_can_read_communities(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["communities"], 1)
        self.assertEqual(response.data["totals"]["cities"], 1)

    def test_counts_match_created_objects(self):
        response = self.client.get(self.url)
        community = response.data["communities"][0]

        self.assertEqual(community["name"], BARANGAY)
        self.assertEqual(community["city"], "Marikina City")
        self.assertEqual(community["region"], "National Capital Region")
        self.assertTrue(community["is_home"])
        self.assertEqual(community["residents"], 2)
        self.assertEqual(community["responders"], 1)
        self.assertEqual(community["officials"], 1)
        self.assertEqual(community["reports"], 2)
        self.assertEqual(community["resolved_reports"], 1)
        self.assertEqual(community["emergencies"], 2)
        self.assertEqual(community["closed_emergencies"], 1)
        self.assertEqual(community["center"], centroid(self.home.geometry))
        self.assertEqual(response.data["totals"]["residents"], 2)
        self.assertEqual(response.data["totals"]["reports"], 2)
        self.assertEqual(response.data["totals"]["emergencies"], 2)

    def test_exposes_no_personal_data(self):
        response = self.client.get(self.url)
        body = response.content.decode()

        for secret in ("Maria", "Santos", "resident@example.com", "Champaca", "Blocked drainage"):
            self.assertNotIn(secret, body)

    def test_empty_state_returns_zeroed_totals(self):
        MapGeometry.objects.all().delete()
        Concern.objects.all().delete()
        EmergencyAlert.objects.all().delete()
        ResidentProfile.objects.all().delete()
        cache.clear()

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["communities"], [])
        self.assertEqual(response.data["totals"]["communities"], 0)


class PublicCommunityBoundaryTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.home = MapGeometry.objects.get(kind=MapGeometry.Kind.BOUNDARY, is_home=True)
        self.other = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            osm_type="way",
            osm_id=999999,
            name="Unserved Barangay",
            locality="Marikina",
            geometry={"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
            is_active=True,
        )

    def test_returns_geometry_for_a_served_barangay(self):
        response = self.client.get(reverse("public-community-boundary", args=[self.home.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], self.home.name)
        self.assertEqual(response.data["geometry"], self.home.geometry)

    def test_rejects_a_barangay_that_isnt_an_active_community(self):
        response = self.client.get(reverse("public-community-boundary", args=[self.other.pk]))

        self.assertEqual(response.status_code, 404)

    def test_rejects_an_unknown_id(self):
        response = self.client.get(reverse("public-community-boundary", args=[999999999]))

        self.assertEqual(response.status_code, 404)


class PublicCommunityRequestTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.url = reverse("public-community-requests")
        self.payload = {
            "kind": "community",
            "name": "Juan Dela Cruz",
            "email": "juan@example.com",
            "organization": "Barangay Concepcion Uno",
            "role": "Barangay Secretary",
            "message": "We would like a walkthrough for our council.",
        }

    def test_rejects_a_bad_email(self):
        response = self.client.post(self.url, {**self.payload, "email": "not-an-email"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_accepts_a_good_payload(self):
        response = self.client.post(self.url, self.payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "received")

    def test_throttles_a_flood(self):
        codes = [
            self.client.post(self.url, self.payload, format="json").status_code for _ in range(7)
        ]

        self.assertIn(429, codes)
        self.assertEqual(codes.count(201), 5)
