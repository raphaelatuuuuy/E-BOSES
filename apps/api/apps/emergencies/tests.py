import asyncio
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.notifications.models import Notification

from .models import EmergencyAlert, EmergencyLocationPing, EmergencyMedia, EmergencyResponderAssignment, EmergencyStatusEvent


TEST_CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}

def png_bytes():
    output = BytesIO()
    Image.new("RGB", (1, 1), color=(255, 0, 0)).save(output, format="PNG")
    return output.getvalue()

def png_upload(name="emergency.png", content=None):
    return SimpleUploadedFile(name, content or png_bytes(), content_type="image/png")


@override_settings(CHANNEL_LAYERS=TEST_CHANNEL_LAYERS)
class EmergencyAPITests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="emergency-resident@example.com",
            phone_number="+639360000001",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.other = User.objects.create_user(
            email="emergency-other@example.com",
            phone_number="+639360000002",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="emergency-official@example.com",
            phone_number="+639360000003",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.responder = User.objects.create_user(
            email="emergency-responder@example.com",
            phone_number="+639360000004",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(self.resident)

    def create_alert(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "note": "Chest pain near the covered court.",
                "latitude": "14.6500000",
                "longitude": "121.1100000",
                "address": "Covered court",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return EmergencyAlert.objects.get(pk=response.data["id"])

    def test_resident_can_create_and_get_active_emergency(self):
        alert = self.create_alert()

        active_response = self.client.get("/api/emergencies/mine/active/")

        self.assertEqual(active_response.status_code, status.HTTP_200_OK)
        self.assertEqual(active_response.data["id"], alert.pk)
        self.assertEqual(active_response.data["status"], EmergencyAlert.Status.SUBMITTED)
        self.assertEqual(alert.status_events.count(), 1)
        self.assertEqual(alert.status_events.get().status, EmergencyAlert.Status.SUBMITTED)

    def test_emergency_location_outside_barangay_boundary_is_rejected(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "latitude": "14.9000000",
                "longitude": "121.5000000",
                "address": "Outside boundary",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Location must be inside Barangay Marikina Heights", str(response.data))
        self.assertFalse(EmergencyAlert.objects.filter(address="Outside boundary").exists())

    def test_duplicate_emergency_media_is_rejected_without_creating_alert(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "latitude": "14.6500000",
                "longitude": "121.1100000",
                "address": "Covered court",
                "media": [png_upload("first.png"), png_upload("second.png")],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("duplicate media upload detected", response.data["media"][0])
        self.assertFalse(EmergencyAlert.objects.filter(address="Covered court").exists())

    def test_emergency_media_hash_is_stored(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "latitude": "14.6500000",
                "longitude": "121.1100000",
                "address": "Covered court",
                "media": png_upload("hash.png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = EmergencyAlert.objects.get(pk=response.data["id"]).media.get()
        self.assertEqual(len(media.sha256_hash), 64)

    def test_emergency_create_records_resident_notification(self):
        alert = self.create_alert()

        notification = Notification.objects.get(recipient=self.resident, emergency=alert)

        self.assertEqual(notification.type, Notification.Type.EMERGENCY_SUBMITTED)
        self.assertFalse(notification.is_read)

    def test_emergency_create_records_witness_notifications_for_same_barangay_residents(self):
        witness = get_user_model().objects.create_user(
            email="emergency-witness@example.com",
            phone_number="+639360000009",
            password="pass",
            status=get_user_model().Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Emergency",
            last_name="Resident",
            date_of_birth="1990-01-01",
            address="A Street",
            barangay="Marikina Heights",
        )
        ResidentProfile.objects.create(
            user=witness,
            first_name="Nearby",
            last_name="Witness",
            date_of_birth="1990-01-01",
            address="B Street",
            barangay="Marikina Heights",
        )

        alert = self.create_alert()

        self.assertTrue(alert.witness_notifications.filter(resident=witness).exists())
        self.assertTrue(Notification.objects.filter(recipient=witness, emergency=alert, type=Notification.Type.WITNESS_ALERT).exists())

    def test_resident_cannot_create_second_active_emergency(self):
        alert = self.create_alert()

        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.FIRE,
                "latitude": "14.6500000",
                "longitude": "121.1100000",
                "address": "Second alert",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["active_emergency"]["id"], alert.pk)
        self.assertEqual(EmergencyAlert.objects.filter(reporter=self.resident).count(), 1)

    def test_resident_can_only_view_own_emergency(self):
        alert = self.create_alert()
        self.client.force_authenticate(self.other)

        response = self.client.get(f"/api/emergencies/{alert.pk}/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_official_assigns_responder_and_responder_sends_location_ping(self):
        alert = self.create_alert()
        self.client.force_authenticate(self.official)

        assign_response = self.client.post(
            f"/api/emergencies/{alert.pk}/assign/",
            {"responder_id": self.responder.pk},
            format="json",
        )

        self.assertEqual(assign_response.status_code, status.HTTP_200_OK)
        self.assertEqual(assign_response.data["status"], EmergencyAlert.Status.ROUTED)
        self.assertEqual(alert.assignments.count(), 1)

        self.client.force_authenticate(self.responder)
        ack_response = self.client.post(f"/api/emergencies/{alert.pk}/acknowledge/", {}, format="json")
        ping_response = self.client.post(
            f"/api/emergencies/{alert.pk}/location-pings/",
            {"latitude": "14.6510000", "longitude": "121.1110000", "accuracy": 8.2},
            format="json",
        )

        self.assertEqual(ack_response.status_code, status.HTTP_200_OK)
        self.assertEqual(ping_response.status_code, status.HTTP_201_CREATED)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.EN_ROUTE)
        self.assertEqual(EmergencyLocationPing.objects.filter(assignment__alert=alert).count(), 1)
        self.assertIsNotNone(ping_response.data["current_assignment"]["last_location"])

    def test_official_can_view_active_emergency_queue(self):
        alert = self.create_alert()
        self.client.force_authenticate(self.official)

        response = self.client.get("/api/emergencies/queue/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]["id"], alert.pk)

    def test_emergency_create_auto_routes_to_nearest_on_duty_matching_unit(self):
        User = get_user_model()
        bhw_far = User.objects.create_user(
            email="bhw-far@example.com",
            phone_number="+639360000010",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
            current_latitude="14.6600000",
            current_longitude="121.1200000",
        )
        bhw_near = User.objects.create_user(
            email="bhw-near@example.com",
            phone_number="+639360000011",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
            current_latitude="14.6510000",
            current_longitude="121.1110000",
        )
        User.objects.create_user(
            email="tanod-near@example.com",
            phone_number="+639360000012",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.TANOD,
            is_on_duty=True,
            current_latitude="14.6501000",
            current_longitude="121.1101000",
        )

        alert = self.create_alert()

        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertTrue(alert.assignments.filter(responder=bhw_near).exists())
        self.assertFalse(alert.assignments.filter(responder=bhw_far).exists())
        self.assertTrue(EmergencyStatusEvent.objects.filter(alert=alert, status=EmergencyAlert.Status.ROUTED, note__icontains="Auto-routed").exists())
        self.assertTrue(Notification.objects.filter(recipient=bhw_near, emergency=alert, type=Notification.Type.EMERGENCY_ROUTED).exists())

    def test_responder_can_update_duty_location(self):
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            "/api/emergencies/duty/",
            {
                "is_on_duty": True,
                "responder_unit": get_user_model().ResponderUnit.TANOD,
                "latitude": "14.6510000",
                "longitude": "121.1110000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.responder.refresh_from_db()
        self.assertTrue(self.responder.is_on_duty)
        self.assertEqual(self.responder.responder_unit, get_user_model().ResponderUnit.TANOD)
        self.assertIsNotNone(self.responder.location_updated_at)

    def test_responder_can_view_assigned_emergencies_only(self):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)

        response = self.client.get("/api/emergencies/assigned/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], alert.pk)

    def test_responder_ping_outside_barangay_boundary_is_rejected(self):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/location-pings/",
            {"latitude": "14.9000000", "longitude": "121.5000000"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Location must be inside Barangay Marikina Heights", str(response.data))
        self.assertFalse(EmergencyLocationPing.objects.filter(assignment__alert=alert).exists())

    def test_unassigned_responder_cannot_send_location_ping(self):
        alert = self.create_alert()
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/location-pings/",
            {"latitude": "14.6510000", "longitude": "121.1110000"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_arrival_and_resolve_close_emergency(self):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)

        arrived_response = self.client.post(f"/api/emergencies/{alert.pk}/arrived/", {}, format="json")
        resolve_response = self.client.post(
            f"/api/emergencies/{alert.pk}/resolve/",
            {"note": "Patient assisted."},
            format="json",
        )

        self.assertEqual(arrived_response.status_code, status.HTTP_200_OK)
        self.assertEqual(resolve_response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.RESOLVED)
        self.assertIsNotNone(alert.resolved_at)
        self.assertTrue(EmergencyStatusEvent.objects.filter(alert=alert, status=EmergencyAlert.Status.RESOLVED).exists())

    def test_resident_cannot_cancel_after_acknowledgement(self):
        alert = self.create_alert()
        assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.ACKNOWLEDGED,
        )
        alert.status = EmergencyAlert.Status.ACKNOWLEDGED
        alert.save(update_fields=["status", "updated_at"])

        response = self.client.post(f"/api/emergencies/{alert.pk}/cancel/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        alert.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ACKNOWLEDGED)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ACKNOWLEDGED)

    def test_location_ping_broadcasts_tracking_update(self):
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        channel_layer = get_channel_layer()
        channel_name = async_to_sync(channel_layer.new_channel)("test.emergency")
        async_to_sync(channel_layer.group_add)(f"emergency_{alert.pk}", channel_name)
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/location-pings/",
            {"latitude": "14.6510000", "longitude": "121.1110000"},
            format="json",
        )
        message = async_to_sync(asyncio.wait_for)(channel_layer.receive(channel_name), timeout=1)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(message["type"], "emergency.update")
        self.assertEqual(message["payload"]["id"], alert.pk)
