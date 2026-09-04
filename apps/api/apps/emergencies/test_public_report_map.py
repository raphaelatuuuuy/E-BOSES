from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile, User
from apps.concerns.models import Concern
from apps.emergencies.models import Community


class PublicReportMapAndGuestConcernTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.community = (
            Community.objects.filter(
                status=Community.Status.ACTIVE,
                boundary__is_active=True,
            )
            .select_related("boundary")
            .first()
        )
        assert self.community is not None
        self.latitude = float(self.community.center_latitude)
        self.longitude = float(self.community.center_longitude)

    def test_public_map_excludes_pending_concerns(self):
        reporter = User.objects.create_user(
            email="public-map-resident@example.com",
            password="Str0ng!Passw0rd",
            phone_number="+639170000001",
            status=User.Status.VERIFIED,
        )
        Concern.objects.create(
            reporter=reporter,
            community=self.community,
            title="Pending private detail",
            description="This report has not completed validation.",
            address="Champaca Street, Marikina Heights",
            latitude=self.latitude,
            longitude=self.longitude,
        )
        accepted = Concern.objects.create(
            reporter=reporter,
            community=self.community,
            title="Accepted public concern",
            description="A public concern that has passed validation.",
            address="Champaca Street, Marikina Heights",
            latitude=self.latitude,
            longitude=self.longitude,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        response = self.client.get(reverse("public-report-map"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data["concerns"]], [accepted.pk])
        self.assertNotIn("public-map-resident@example.com", response.content.decode())
        self.assertIn("Community resident", response.content.decode())

    @patch("apps.concerns.views.transaction.on_commit", side_effect=lambda callback: callback())
    @patch("apps.concerns.views.enqueue_concern_ai")
    def test_guest_report_routes_to_the_incident_community(self, enqueue, on_commit):
        response = self.client.post(
            reverse("public-guest-concern"),
            {
                "description": "Water is pooling beside the road and blocking the sidewalk for pedestrians.",
                "latitude": f"{self.latitude:.7f}",
                "longitude": f"{self.longitude:.7f}",
                "address": "Champaca Street, Marikina Heights",
                "location_source": "manual_pin",
                "client_request_id": str(uuid4()),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["community"]["public_id"], str(self.community.public_id))
        concern = Concern.objects.latest("pk")
        self.assertTrue(concern.is_anonymous)
        self.assertEqual(concern.community_id, self.community.pk)
        self.assertIsNone(concern.reporter_community_id)
        self.assertFalse(concern.reporter.is_active)
        self.assertFalse(concern.reporter.has_usable_password())
        self.assertFalse(ResidentProfile.objects.filter(user=concern.reporter).exists())
        self.assertEqual(set(response.data), {"submitted", "community", "status"})
        self.assertNotIn('"id"', response.content.decode())
        enqueue.assert_called_once_with(concern.pk)

    def test_guest_report_rejects_a_pin_outside_active_communities(self):
        response = self.client.post(
            reverse("public-guest-concern"),
            {
                "description": "This location is outside every active served community boundary.",
                "latitude": "0",
                "longitude": "0",
                "address": "Somewhere outside the served area",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "location_outside_active_community")
