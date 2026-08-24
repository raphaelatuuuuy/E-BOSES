"""The reporter-contact mirror: reporter/official reveal the responder's number."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.test_helpers import active_test_community, grant_position
from apps.concerns.units import sync_responder_designation

from .models import (
    EmergencyAlert,
    EmergencyResponderAssignment,
    ResponderShift,
)

TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


@override_settings(
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
)
class ResponderContactTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.community = active_test_community()
        self.resident = self._user("rc-resident@example.com", "+639478000001", "Maria", "Santos")
        self.other = self._user("rc-other@example.com", "+639478000002", "Ana", "Reyes")
        self.responder = self._user(
            "rc-responder@example.com",
            "+639478000003",
            "Juan",
            "Responder",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.BDRRMO,
            is_on_duty=True,
        )
        ResponderShift.objects.create(
            responder=self.responder,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=5),
        )
        sync_responder_designation(self.responder)
        self.official = self._user(
            "rc-official@example.com",
            "+639478000004",
            "Rico",
            "Official",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
        )
        grant_position(self.official, department_code="bdrrmo")
        self.alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="fire",
            note="Smoke on the second floor.",
            latitude="14.6507000",
            longitude="121.1133000",
            address="Champaca Street",
            reported_area="Champaca Street",
            barangay="Marikina Heights",
            community=self.community,
            status=EmergencyAlert.Status.ROUTED,
        )
        EmergencyResponderAssignment.objects.create(
            alert=self.alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            source=EmergencyResponderAssignment.Source.AUTO,
        )

    def _user(self, email, phone, first, last, **extra):
        User = get_user_model()
        user = User.objects.create_user(
            email=email, phone_number=phone, password="pass", status=User.Status.VERIFIED, **extra
        )
        ResidentProfile.objects.create(
            user=user,
            first_name=first,
            last_name=last,
            date_of_birth="1990-01-01",
            address="Somewhere",
            barangay="Marikina Heights",
            community=self.community,
        )
        return user

    def url(self):
        return f"/api/emergencies/{self.alert.pk}/responder-contact/"

    def test_reporter_can_reveal_the_responder_number(self):
        self.client.force_authenticate(self.resident)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["phone_number"], "+639478000003")

    def test_official_can_reveal_the_responder_number(self):
        self.client.force_authenticate(self.official)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_unrelated_resident_is_refused(self):
        self.client.force_authenticate(self.other)
        response = self.client.get(self.url())
        self.assertIn(response.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))

    def test_reveal_is_audit_logged(self):
        from apps.accounts.models import AuditLog

        self.client.force_authenticate(self.resident)
        self.client.get(self.url())
        self.assertTrue(
            AuditLog.objects.filter(
                action="emergency.responder_contact_revealed",
                actor=self.resident,
                target_user=self.responder,
            ).exists()
        )

    def test_missing_number_returns_404(self):
        User = get_user_model()
        self.responder.phone_number = ""
        self.responder.save(update_fields=["phone_number"])
        self.client.force_authenticate(self.resident)
        response = self.client.get(self.url())
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
