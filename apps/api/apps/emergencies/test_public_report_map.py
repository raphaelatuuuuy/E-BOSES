from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile, User
from apps.concerns.models import (
    Concern,
    ConcernAiAssessment,
    ConcernResolutionEvidence,
    ConcernStatusEvent,
)
from apps.emergencies.models import Community, EmergencyAlert, EmergencyCategory


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
        ConcernAiAssessment.objects.create(
            concern=accepted,
            status=ConcernAiAssessment.Status.COMPLETED,
            severity_estimate="high",
            raw_result={
                "review": {
                    "current_danger": True,
                    "incident_timing": "ongoing",
                }
            },
        )

        response = self.client.get(reverse("public-report-map"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data["concerns"]], [accepted.pk])
        self.assertEqual(
            response.data["concerns"][0]["description"],
            accepted.description,
        )
        # Current danger with an "ongoing" timing does not lift an ordinary
        # high-severity report into the Critical band; only an explicit
        # "critical" review does.
        self.assertEqual(response.data["concerns"][0]["severity"], "high")
        self.assertTrue(response.data["concerns"][0]["severity_assessed"])
        self.assertNotIn("public-map-resident@example.com", response.content.decode())
        self.assertIn("Community resident", response.content.decode())

    def test_public_map_includes_resolution_evidence_for_resolved_concerns(self):
        reporter = User.objects.create_user(
            email="public-map-resolved@example.com",
            password="Str0ng!Passw0rd",
            phone_number="+639170000002",
            status=User.Status.VERIFIED,
        )
        resolved = Concern.objects.create(
            reporter=reporter,
            community=self.community,
            title="Slippery sidewalk",
            description="The sidewalk was slippery when wet.",
            address="Champaca Street, Marikina Heights",
            latitude=self.latitude,
            longitude=self.longitude,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.RESOLVED,
        )
        evidence = ConcernResolutionEvidence.objects.create(
            concern=resolved,
            file=SimpleUploadedFile("fixed.jpg", b"resolution", content_type="image/jpeg"),
            original_filename="fixed.jpg",
            mime_type="image/jpeg",
            file_size=10,
        )
        ConcernStatusEvent.objects.create(
            concern=resolved,
            status=Concern.Status.RESOLVED,
            note="Sidewalk repaired.",
        )
        active = Concern.objects.create(
            reporter=reporter,
            community=self.community,
            title="Active public concern",
            description="Still being handled.",
            address="Dao Street, Marikina Heights",
            latitude=self.latitude,
            longitude=self.longitude,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        response = self.client.get(reverse("public-report-map"))

        self.assertEqual(response.status_code, 200)
        rows = {row["id"]: row for row in response.data["concerns"]}
        self.assertEqual(
            rows[resolved.pk]["resolution_evidence"],
            [
                {
                    "preview_url": f"/api/concerns/resolution-evidence/{evidence.pk}/preview/",
                    "original_filename": "fixed.jpg",
                    "mime_type": "image/jpeg",
                }
            ],
        )
        self.assertIsNotNone(rows[resolved.pk]["resolved_at"])
        self.assertEqual(rows[active.pk]["resolution_evidence"], [])
        self.assertIsNone(rows[active.pk]["resolved_at"])

    def test_public_emergency_uses_reported_street_while_reverse_geocoding_is_pending(self):
        reporter = User.objects.create_user(
            email="offline-sos-map@example.com",
            password="Str0ng!Passw0rd",
            phone_number="09640746068",
            status=User.Status.VERIFIED,
        )
        EmergencyCategory.objects.update_or_create(
            community=self.community,
            code=EmergencyAlert.Type.FIRE,
            defaults={
                "label": "Fire",
                "is_active": True,
                "visible_to_residents": True,
            },
        )
        alert = EmergencyAlert.objects.create(
            reporter=reporter,
            community=self.community,
            type=EmergencyAlert.Type.FIRE,
            status=EmergencyAlert.Status.ROUTING,
            latitude=self.latitude,
            longitude=self.longitude,
            barangay=self.community.name,
            reported_area="Champaca Street",
            address="",
            resolved_location="",
            reverse_geocoding_status=EmergencyAlert.ReverseGeocodingStatus.PENDING,
        )

        response = self.client.get(reverse("public-report-map"))

        self.assertEqual(response.status_code, 200)
        emergency = next(row for row in response.data["emergencies"] if row["id"] == alert.pk)
        self.assertEqual(emergency["address"], f"Champaca Street, {self.community.name}")

    @patch("apps.concerns.views.transaction.on_commit", side_effect=lambda callback: callback())
    @patch("apps.concerns.views._validate_concern_before_commit", return_value=None)
    def test_guest_report_routes_to_the_incident_community(self, validate, on_commit):
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
        self.assertEqual(concern.visibility, Concern.Visibility.COMMUNITY)
        self.assertFalse(concern.reporter.is_active)
        self.assertFalse(concern.reporter.has_usable_password())
        self.assertFalse(ResidentProfile.objects.filter(user=concern.reporter).exists())
        self.assertEqual(set(response.data), {"submitted", "community", "status", "assigned_unit"})
        self.assertNotIn('"id"', response.content.decode())
        validate.assert_called_once_with(concern)

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
