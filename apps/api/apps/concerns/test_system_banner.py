from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.emergencies.models import EmergencyAlert

from .models import SystemBanner


class SystemBannerTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="banner-resident@example.com",
            phone_number="+639100000901",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="banner-official@example.com",
            phone_number="+639100000902",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
            status=User.Status.VERIFIED,
        )

    def open_emergency(self):
        return EmergencyAlert.objects.create(
            reporter=self.resident,
            type=EmergencyAlert.Type.FIRE,
            status=EmergencyAlert.Status.IN_PROGRESS,
        )

    def test_status_endpoint_is_public(self):
        response = self.client.get("/api/system/status/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["maintenance"])
        self.assertIsNone(response.data["ticker"])

    def test_resident_cannot_create_a_banner(self):
        self.client.force_authenticate(self.resident)
        response = self.client.post(
            "/api/system/banners/", {"message": "Nope"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_official_can_publish_a_ticker(self):
        self.client.force_authenticate(self.official)
        response = self.client.post(
            "/api/system/banners/",
            {"kind": "ticker", "message": "Water interruption on Saturday."},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(None)
        public = self.client.get("/api/system/status/")
        self.assertEqual(public.data["ticker"]["message"], "Water interruption on Saturday.")

    def test_maintenance_is_refused_while_an_emergency_is_active(self):
        self.open_emergency()
        self.client.force_authenticate(self.official)

        response = self.client.post(
            "/api/system/banners/",
            {"kind": "maintenance", "message": "Upgrading the system."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "emergency_in_progress")
        self.assertIsNone(SystemBanner.live(SystemBanner.Kind.MAINTENANCE))

    def test_maintenance_is_allowed_once_emergencies_are_closed(self):
        alert = self.open_emergency()
        alert.status = EmergencyAlert.Status.RESOLVED
        alert.save(update_fields=["status"])
        self.client.force_authenticate(self.official)

        response = self.client.post(
            "/api/system/banners/",
            {"kind": "maintenance", "message": "Upgrading the system."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNotNone(SystemBanner.live(SystemBanner.Kind.MAINTENANCE))

    def test_resident_cannot_sign_in_during_maintenance(self):
        SystemBanner.objects.create(
            kind=SystemBanner.Kind.MAINTENANCE, message="Back at 6pm."
        )
        response = self.client.post(
            "/api/auth/login/",
            {"identifier": "banner-resident@example.com", "password": "pass"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(response.data["code"], "maintenance")

    def test_official_can_still_sign_in_during_maintenance(self):
        SystemBanner.objects.create(
            kind=SystemBanner.Kind.MAINTENANCE, message="Back at 6pm."
        )
        response = self.client.post(
            "/api/auth/login/",
            {"identifier": "banner-official@example.com", "password": "pass"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

    def test_an_inactive_banner_is_not_live(self):
        SystemBanner.objects.create(
            kind=SystemBanner.Kind.MAINTENANCE, message="Old", is_active=False
        )
        self.assertIsNone(SystemBanner.live(SystemBanner.Kind.MAINTENANCE))

    def test_a_future_banner_is_not_live_yet(self):
        from datetime import timedelta

        from django.utils import timezone

        SystemBanner.objects.create(
            kind=SystemBanner.Kind.TICKER,
            message="Later",
            starts_at=timezone.now() + timedelta(days=1),
        )
        self.assertIsNone(SystemBanner.live(SystemBanner.Kind.TICKER))

    def test_an_expired_banner_is_not_live(self):
        from datetime import timedelta

        from django.utils import timezone

        SystemBanner.objects.create(
            kind=SystemBanner.Kind.TICKER,
            message="Over",
            ends_at=timezone.now() - timedelta(hours=1),
        )
        self.assertIsNone(SystemBanner.live(SystemBanner.Kind.TICKER))

    def test_publishing_maintenance_retires_the_previous_one(self):
        self.client.force_authenticate(self.official)
        self.client.post(
            "/api/system/banners/",
            {"kind": "maintenance", "message": "First"},
            format="json",
        )
        self.client.post(
            "/api/system/banners/",
            {"kind": "maintenance", "message": "Second"},
            format="json",
        )
        live = SystemBanner.live(SystemBanner.Kind.MAINTENANCE)
        self.assertEqual(live.message, "Second")
        self.assertEqual(
            SystemBanner.objects.filter(
                kind=SystemBanner.Kind.MAINTENANCE, is_active=True
            ).count(),
            1,
        )
