import asyncio
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, override_settings
from django.utils import timezone
from PIL import Image, ImageDraw
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AuditLog, ResidentProfile
from apps.notifications.models import Notification

from .models import EmergencyAlert, EmergencyAppeal, EmergencyChatAttachment, EmergencyChatMessage, EmergencyEscalation, EmergencyLocationPing, EmergencyMedia, EmergencyResponderAssignment, EmergencyStatusEvent, EmergencyTypeRoleMap, MapGeometry, ResponderShift, WitnessNotification
from apps.concerns.models import Department
from apps.concerns.test_helpers import grant_position
from .views import auto_route_alert


TEST_CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}

def png_bytes():
    output = BytesIO()
    image = Image.new("RGB", (640, 480), color=(240, 244, 248))
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((70, 70, 570, 410), fill=(190, 210, 230), outline=(20, 55, 90), width=8)
    drawing.line((100, 350, 280, 170, 440, 300, 540, 130), fill=(190, 45, 45), width=16)
    image.save(output, format="PNG")
    return output.getvalue()

def png_upload(name="emergency.png", content=None):
    return SimpleUploadedFile(name, content or png_bytes(), content_type="image/png")


@override_settings(CHANNEL_LAYERS=TEST_CHANNEL_LAYERS, OSM_ROUTE_URL="")
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
        grant_position(self.official)
        self.responder = User.objects.create_user(
            email="emergency-responder@example.com",
            phone_number="+639360000004",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(self.resident)
        bhw = Department.objects.get(code="bhw")
        bdrrmo = Department.objects.get(code="bdrrmo")
        # update_or_create, not create: migration 0027 now seeds a default
        # routing table so a fresh barangay dispatches out of the box, and
        # these two rows are part of it.
        EmergencyTypeRoleMap.objects.update_or_create(
            emergency_type=EmergencyAlert.Type.MEDICAL,
            department=bhw,
            defaults={"responder_unit": "bhw", "is_active": True},
        )
        EmergencyTypeRoleMap.objects.update_or_create(
            emergency_type=EmergencyAlert.Type.FIRE,
            department=bdrrmo,
            defaults={"responder_unit": "bdrrmo", "is_active": True},
        )

    def create_alert(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "note": "Chest pain near the covered court.",
                "latitude": "14.6510000",
                "longitude": "121.1150000",
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
        self.assertTrue(alert.status_events.filter(status=EmergencyAlert.Status.SUBMITTED).exists())

    def test_non_resident_roles_cannot_create_emergency(self):
        User = get_user_model()
        for role in [User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER]:
            user = User.objects.create_user(
                email=f"{role}-cannot-create-emergency@example.com",
                phone_number=f"+63936{len(role):07d}",
                password="pass",
                role=role,
                status=User.Status.VERIFIED,
            )
            self.client.force_authenticate(user)
            response = self.client.post(
                "/api/emergencies/",
                {
                    "type": EmergencyAlert.Type.MEDICAL,
                    "latitude": "14.6510000",
                    "longitude": "121.1150000",
                    "address": "Covered court",
                },
                format="json",
            )

            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.assertFalse(EmergencyAlert.objects.filter(address="Covered court").exists())

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
        self.assertIn("must be inside Barangay Marikina Heights", str(response.data))
        self.assertFalse(EmergencyAlert.objects.filter(address="Outside boundary").exists())

    def test_duplicate_optional_media_is_skipped_without_blocking_alert(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "latitude": "14.6510000",
                "longitude": "121.1150000",
                "address": "Covered court",
                "media": [png_upload("first.png"), png_upload("second.png")],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get(pk=response.data["id"])
        self.assertEqual(alert.media.count(), 1)
        self.assertIn("second.png: duplicate attachment was skipped.", alert.media_warnings)

    def test_emergency_media_hash_is_stored(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "latitude": "14.6510000",
                "longitude": "121.1150000",
                "address": "Covered court",
                "media": png_upload("hash.png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = EmergencyAlert.objects.get(pk=response.data["id"]).media.get()
        self.assertEqual(len(media.sha256_hash), 64)

    def test_emergency_media_preview_is_authorized_and_raw_access_is_audited(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "latitude": "14.6510000",
                "longitude": "121.1150000",
                "address": "Covered court",
                "media": png_upload("authorized.png"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = EmergencyAlert.objects.get(pk=response.data["id"]).media.get()

        preview = self.client.get(f"/api/emergencies/media/{media.pk}/preview/")
        raw = self.client.get(f"/api/emergencies/media/{media.pk}/raw/")
        self.client.force_authenticate(self.other)
        forbidden = self.client.get(f"/api/emergencies/media/{media.pk}/preview/")

        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(preview["Content-Type"], "image/jpeg")
        self.assertTrue(b"".join(preview.streaming_content).startswith(b"\xff\xd8"))
        self.assertEqual(raw.status_code, status.HTTP_200_OK)
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(
            AuditLog.objects.filter(
                action="media.raw_accessed",
                actor=self.resident,
                metadata__media_type="emergency_media",
                metadata__object_id=media.pk,
            ).exists()
        )

    def test_resident_emergency_history_only_returns_own_alerts(self):
        alert = self.create_alert()
        EmergencyAlert.objects.create(
            reporter=self.other,
            type=EmergencyAlert.Type.FIRE,
            latitude="14.6516000",
            longitude="121.1208000",
            address="Other resident alert",
        )

        response = self.client.get("/api/emergencies/mine/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [alert.pk])

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
            current_latitude="14.6511000",
            current_longitude="121.1151000",
            location_updated_at=timezone.now(),
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

        witness_delivery = alert.witness_notifications.get(resident=witness)
        self.assertIsNotNone(witness_delivery.in_app_delivered_at)
        self.assertEqual(
            witness_delivery.push_status,
            WitnessNotification.PushStatus.NOT_CONFIGURED,
        )
        self.assertTrue(Notification.objects.filter(recipient=witness, emergency=alert, type=Notification.Type.WITNESS_ALERT).exists())

        self.client.force_authenticate(self.official)
        detail = self.client.get(f"/api/emergencies/{alert.pk}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        summary = detail.data["witness_notification_summary"]
        self.assertEqual(summary["recipient_count"], 1)
        self.assertEqual(summary["in_app_delivered_count"], 1)
        self.assertEqual(summary["push_status_counts"]["not_configured"], 1)

    def test_resident_cannot_create_second_active_emergency(self):
        alert = self.create_alert()

        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.FIRE,
                "latitude": "14.6510000",
                "longitude": "121.1150000",
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
            {"latitude": "14.6516000", "longitude": "121.1208000", "accuracy": 8.2},
            format="json",
        )

        self.assertEqual(ack_response.status_code, status.HTTP_200_OK)
        self.assertEqual(ack_response.data["status"], EmergencyAlert.Status.ACKNOWLEDGED)
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
            current_latitude="14.6560000",
            current_longitude="121.1250000",
            location_updated_at=timezone.now(),
        )
        bhw_near = User.objects.create_user(
            email="bhw-near@example.com",
            phone_number="+639360000011",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        for responder, first_name in ((bhw_far, "Far"), (bhw_near, "Near")):
            ResidentProfile.objects.create(
                user=responder,
                first_name=first_name,
                last_name="Responder",
                date_of_birth="1990-01-01",
                address="Marikina Heights",
                barangay="Marikina Heights",
            )
        User.objects.create_user(
            email="tanod-near@example.com",
            phone_number="+639360000012",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.TANOD,
            is_on_duty=True,
            current_latitude="14.6515500",
            current_longitude="121.1207500",
            location_updated_at=timezone.now(),
        )

        alert = self.create_alert()

        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(alert.assignments.count(), 1)
        self.assertTrue(alert.assignments.filter(responder=bhw_near).exists())
        self.assertFalse(alert.assignments.filter(responder=bhw_far).exists())
        self.assertFalse(alert.assignments.filter(responder__responder_unit=User.ResponderUnit.TANOD).exists())
        route_event = EmergencyStatusEvent.objects.get(alert=alert, status=EmergencyAlert.Status.ROUTED)
        self.assertEqual(route_event.note, "A responder was automatically assigned.")
        self.assertTrue(Notification.objects.filter(recipient=bhw_near, emergency=alert, type=Notification.Type.EMERGENCY_ROUTED).exists())
        self.assertFalse(
            Notification.objects.filter(
                recipient=bhw_far,
                emergency=alert,
                type=Notification.Type.EMERGENCY_ROUTED,
            ).exclude(metadata__standby=True).exists()
        )

    def test_auto_routing_excludes_nearest_responder_from_another_barangay(self):
        User = get_user_model()
        responder = User.objects.create_user(
            email="bhw-other-barangay@example.com",
            phone_number="+639360000014",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
            current_latitude="14.6515000",
            current_longitude="121.1207000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=responder,
            first_name="Other",
            last_name="Barangay",
            date_of_birth="1990-01-01",
            address="Other Barangay",
            barangay="Other Barangay",
        )

        alert = self.create_alert()

        self.assertFalse(alert.assignments.filter(responder=responder).exists())

    def test_off_shift_bdrrmo_is_not_auto_routed(self):
        User = get_user_model()
        responder = User.objects.create_user(
            email="offshift-bdrrmo@example.com",
            phone_number="+639360000013",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BDRRMO,
            is_on_duty=False,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=responder,
            first_name="Offshift",
            last_name="BDRRMO",
            date_of_birth="1990-01-01",
            address="Marikina Heights",
            barangay="Marikina Heights",
        )

        alert = self.create_alert()

        self.assertEqual(alert.status, EmergencyAlert.Status.SUBMITTED)
        self.assertFalse(alert.assignments.exists())

    def test_official_can_reassign_and_cancel_previous_active_assignment(self):
        alert = self.create_alert()
        original = EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        replacement = get_user_model().objects.create_user(
            email="replacement-responder@example.com",
            phone_number="+639360000014",
            password="pass",
            role=get_user_model().Role.FIRST_RESPONDER,
            status=get_user_model().Status.VERIFIED,
            responder_unit=get_user_model().ResponderUnit.BHW,
        )
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/reassign/",
            {"responder_id": replacement.pk, "note": "Unit change"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        original.refresh_from_db()
        self.assertEqual(original.status, EmergencyResponderAssignment.Status.CANCELLED)
        self.assertEqual(response.data["current_assignment"]["responder"]["id"], replacement.pk)
        self.assertTrue(AuditLog.objects.filter(action="emergency.reassigned", metadata__alert_id=alert.pk).exists())

    @patch("apps.live_map.route_for_assignment", return_value=None)
    def test_reporter_resident_map_receives_own_responder_location(self, _route):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)
        self.client.post(
            f"/api/emergencies/{alert.pk}/location-pings/",
            {"latitude": "14.6516000", "longitude": "121.1208000"},
            format="json",
        )
        self.client.force_authenticate(self.resident)

        response = self.client.get("/api/locations/resident-alerts-map/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        emergency = next(item for item in response.data["emergencies"] if item["id"] == alert.pk)
        self.assertEqual(emergency["responder_location"]["latitude"], "14.6516000")

    def test_responder_can_update_duty_location(self):
        self.responder.responder_unit = get_user_model().ResponderUnit.BHW
        self.responder.save(update_fields=["responder_unit"])
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            "/api/emergencies/duty/",
            {
                "is_on_duty": True,
                "latitude": "14.6516000",
                "longitude": "121.1208000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.responder.refresh_from_db()
        self.assertTrue(self.responder.is_on_duty)
        self.assertEqual(self.responder.responder_unit, get_user_model().ResponderUnit.BHW)
        self.assertIsNotNone(self.responder.location_updated_at)
        shift = ResponderShift.objects.get(responder=self.responder, status=ResponderShift.Status.ACTIVE)
        self.assertEqual(shift.responder_unit, get_user_model().ResponderUnit.BHW)
        self.assertEqual(str(shift.start_latitude), "14.6516000")
        self.assertEqual(str(shift.start_longitude), "121.1208000")
        self.assertTrue(AuditLog.objects.filter(actor=self.responder, action="responder.shift_started").exists())

    def test_responder_cannot_change_own_unit_through_duty_endpoint(self):
        """Going on duty reports availability; it must not re-badge the responder.

        Honouring `responder_unit` here let a BHW volunteer post `bdrrmo` and
        start receiving fire dispatches.
        """
        User = get_user_model()
        self.responder.responder_unit = User.ResponderUnit.BHW
        self.responder.save(update_fields=["responder_unit"])
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            "/api/emergencies/duty/",
            {
                "is_on_duty": True,
                "responder_unit": User.ResponderUnit.BDRRMO,
                "latitude": "14.6516000",
                "longitude": "121.1208000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.responder.refresh_from_db()
        self.assertEqual(self.responder.responder_unit, User.ResponderUnit.BHW)
        self.assertEqual(response.data["responder_unit"], User.ResponderUnit.BHW)
        shift = ResponderShift.objects.get(responder=self.responder, status=ResponderShift.Status.ACTIVE)
        self.assertEqual(shift.responder_unit, User.ResponderUnit.BHW)

    def test_responder_cannot_change_own_unit_by_starting_a_shift(self):
        """The unit on a shift comes from the official-assigned membership."""
        User = get_user_model()
        self.responder.responder_unit = User.ResponderUnit.BHW
        self.responder.save(update_fields=["responder_unit"])
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            "/api/emergencies/shifts/start/",
            {
                "responder_unit": User.ResponderUnit.TANOD,
                "latitude": "14.6516000",
                "longitude": "121.1208000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["responder_unit"], User.ResponderUnit.BHW)
        self.responder.refresh_from_db()
        self.assertEqual(self.responder.responder_unit, User.ResponderUnit.BHW)

    def test_turning_duty_off_closes_the_active_shift(self):
        self.client.force_authenticate(self.responder)
        self.client.post(
            "/api/emergencies/duty/",
            {
                "is_on_duty": True,
                "responder_unit": get_user_model().ResponderUnit.BHW,
                "latitude": "14.6516000",
                "longitude": "121.1208000",
            },
            format="json",
        )
        shift = ResponderShift.objects.get(responder=self.responder, status=ResponderShift.Status.ACTIVE)

        response = self.client.post(
            "/api/emergencies/duty/",
            {
                "is_on_duty": False,
                "latitude": "14.6517000",
                "longitude": "121.1209000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        shift.refresh_from_db()
        self.responder.refresh_from_db()
        self.assertEqual(shift.status, ResponderShift.Status.ENDED)
        self.assertIsNotNone(shift.ended_at)
        self.assertEqual(str(shift.end_latitude), "14.6517000")
        self.assertEqual(str(shift.end_longitude), "121.1209000")
        self.assertFalse(self.responder.is_on_duty)
        self.assertTrue(AuditLog.objects.filter(actor=self.responder, action="responder.shift_ended").exists())

    def test_responder_can_start_view_end_and_list_shift(self):
        self.responder.responder_unit = get_user_model().ResponderUnit.BHW
        self.responder.save(update_fields=["responder_unit"])
        self.client.force_authenticate(self.responder)

        start_response = self.client.post(
            "/api/emergencies/shifts/start/",
            {
                "latitude": "14.6516000",
                "longitude": "121.1208000",
            },
            format="json",
        )
        active_response = self.client.get("/api/emergencies/shifts/active/")
        end_response = self.client.post(
            "/api/emergencies/shifts/end/",
            {
                "latitude": "14.6517000",
                "longitude": "121.1209000",
            },
            format="json",
        )
        history_response = self.client.get("/api/emergencies/shifts/")

        self.assertEqual(start_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(start_response.data["status"], "active")
        self.assertEqual(start_response.data["responder_unit"], get_user_model().ResponderUnit.BHW)
        self.assertIsNone(start_response.data["ended_at"])
        self.assertEqual(active_response.status_code, status.HTTP_200_OK)
        self.assertEqual(active_response.data["id"], start_response.data["id"])
        self.assertEqual(end_response.status_code, status.HTTP_200_OK)
        self.assertEqual(end_response.data["status"], "ended")
        self.assertIsNotNone(end_response.data["ended_at"])
        self.assertEqual(history_response.status_code, status.HTTP_200_OK)
        self.assertEqual(history_response.data[0]["id"], start_response.data["id"])
        self.responder.refresh_from_db()
        self.assertFalse(self.responder.is_on_duty)

    def test_starting_shift_closes_previous_active_shift(self):
        self.client.force_authenticate(self.responder)

        first = self.client.post(
            "/api/emergencies/shifts/start/",
            {
                "responder_unit": get_user_model().ResponderUnit.TANOD,
                "latitude": "14.6516000",
                "longitude": "121.1208000",
            },
            format="json",
        )
        second = self.client.post(
            "/api/emergencies/shifts/start/",
            {
                "responder_unit": get_user_model().ResponderUnit.BDRRMO,
                "latitude": "14.6517000",
                "longitude": "121.1209000",
            },
            format="json",
        )
        history = self.client.get("/api/emergencies/shifts/")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.data["status"], "active")
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        self.assertEqual(len([item for item in history.data if item["status"] == "active"]), 1)
        closed = next(item for item in history.data if item["id"] == first.data["id"])
        self.assertEqual(closed["status"], "ended")

    def test_non_responder_cannot_start_shift(self):
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/emergencies/shifts/start/",
            {
                "responder_unit": get_user_model().ResponderUnit.TANOD,
                "latitude": "14.6516000",
                "longitude": "121.1208000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_responder_can_view_assigned_emergencies_only(self):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)

        response = self.client.get("/api/emergencies/assigned/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], alert.pk)

    def test_official_can_assign_multiple_responders_additively(self):
        User = get_user_model()
        second = User.objects.create_user(
            email="emergency-second-responder@example.com",
            phone_number="+639360000013",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        alert = self.create_alert()
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assign/",
            {"responder_ids": [self.responder.pk, second.pk]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(alert.assignments.count(), 2)
        self.assertEqual(len(response.data["active_assignments"]), 2)

    def test_official_can_remove_supporting_responder_with_audited_notifications(self):
        User = get_user_model()
        support = User.objects.create_user(
            email="emergency-removable-support@example.com",
            phone_number="+639360000023",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        alert = self.create_alert()
        alert.status = EmergencyAlert.Status.ROUTED
        alert.status_version = 3
        alert.save(update_fields=["status", "status_version", "updated_at"])
        primary_assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
        )
        support_assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=support,
        )
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{support_assignment.pk}/remove/",
            {"reason": "Support is no longer required.", "status_version": 3},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        primary_assignment.refresh_from_db()
        support_assignment.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(alert.status_version, 4)
        self.assertEqual(primary_assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertEqual(support_assignment.status, EmergencyResponderAssignment.Status.CANCELLED)
        self.assertEqual(
            [item["id"] for item in response.data["active_assignments"]],
            [primary_assignment.pk],
        )
        self.assertTrue(
            alert.status_events.filter(
                actor=self.official,
                status=EmergencyAlert.Status.ROUTED,
                note__contains="Support is no longer required.",
            ).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                recipient=support,
                emergency=alert,
                type=Notification.Type.EMERGENCY_CANCELLED,
            ).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.resident,
                emergency=alert,
                type=Notification.Type.EMERGENCY_ROUTED,
            ).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                actor=self.official,
                action="emergency.assignment_removed",
                metadata__alert_id=alert.pk,
                metadata__assignment_id=support_assignment.pk,
                metadata__responder_id=support.pk,
                metadata__reason="Support is no longer required.",
            ).exists()
        )

    def test_official_cannot_remove_the_only_active_responder(self):
        alert = self.create_alert()
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
        )
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{assignment.pk}/remove/",
            {"reason": "Responder unavailable."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("last active responder", response.data["detail"].lower())
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertFalse(AuditLog.objects.filter(action="emergency.assignment_removed").exists())

    def test_non_official_cannot_remove_an_emergency_assignment(self):
        User = get_user_model()
        support = User.objects.create_user(
            email="emergency-protected-support@example.com",
            phone_number="+639360000024",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        alert = self.create_alert()
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        assignment = EmergencyResponderAssignment.objects.create(alert=alert, responder=support)

        for actor in (self.resident, self.responder):
            self.client.force_authenticate(actor)
            response = self.client.post(
                f"/api/emergencies/{alert.pk}/assignments/{assignment.pk}/remove/",
                {"reason": "Unauthorized removal."},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)

    def test_official_can_add_a_previously_removed_responder_again(self):
        User = get_user_model()
        support = User.objects.create_user(
            email="emergency-returning-support@example.com",
            phone_number="+639360000025",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        alert = self.create_alert()
        alert.status = EmergencyAlert.Status.ROUTED
        alert.status_version = 2
        alert.save(update_fields=["status", "status_version", "updated_at"])
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        removed_assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=support,
            status=EmergencyResponderAssignment.Status.CANCELLED,
        )
        original_assigned_at = removed_assignment.assigned_at
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assign/",
            {"responder_id": support.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        removed_assignment.refresh_from_db()
        self.assertEqual(removed_assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertGreater(removed_assignment.assigned_at, original_assigned_at)
        self.assertEqual(alert.status_version, 3)
        self.assertEqual(len(response.data["active_assignments"]), 2)
        self.assertTrue(
            Notification.objects.filter(
                recipient=support,
                emergency=alert,
                type=Notification.Type.EMERGENCY_ROUTED,
            ).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                actor=self.official,
                action="emergency.assigned",
                metadata__alert_id=alert.pk,
                metadata__responder_ids=[support.pk],
            ).exists()
        )

    def test_official_adds_support_without_regressing_active_response_status(self):
        User = get_user_model()
        support = User.objects.create_user(
            email="emergency-en-route-support@example.com",
            phone_number="+639360000027",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        alert = self.create_alert()
        alert.status = EmergencyAlert.Status.EN_ROUTE
        alert.status_version = 7
        alert.save(update_fields=["status", "status_version", "updated_at"])
        EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.EN_ROUTE,
        )
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assign/",
            {"responder_id": support.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        support_assignment = alert.assignments.get(responder=support)
        self.assertEqual(alert.status, EmergencyAlert.Status.EN_ROUTE)
        self.assertEqual(alert.status_version, 8)
        self.assertEqual(support_assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertIsNone(support_assignment.acknowledged_at)
        self.assertFalse(
            alert.status_events.filter(status=EmergencyAlert.Status.ACKNOWLEDGED).exists()
        )

    def test_official_reassignment_notifies_and_audits_removed_responder(self):
        User = get_user_model()
        replacement = User.objects.create_user(
            email="emergency-replacement@example.com",
            phone_number="+639360000026",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        alert = self.create_alert()
        alert.status = EmergencyAlert.Status.ROUTED
        alert.status_version = 5
        alert.save(update_fields=["status", "status_version", "updated_at"])
        previous_assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
        )
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/reassign/",
            {
                "responder_id": replacement.pk,
                "note": "Primary responder reported a vehicle failure.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        previous_assignment.refresh_from_db()
        self.assertEqual(previous_assignment.status, EmergencyResponderAssignment.Status.CANCELLED)
        replacement_assignment = alert.assignments.get(responder=replacement)
        self.assertEqual(replacement_assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertFalse(
            alert.assignments.filter(status=EmergencyResponderAssignment.Status.ACKNOWLEDGED).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.responder,
                emergency=alert,
                type=Notification.Type.EMERGENCY_CANCELLED,
                body__contains="vehicle failure",
            ).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                recipient=replacement,
                emergency=alert,
                type=Notification.Type.EMERGENCY_ROUTED,
            ).exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(
                actor=self.official,
                action="emergency.reassigned",
                metadata__alert_id=alert.pk,
                metadata__responder_id=replacement.pk,
                metadata__removed_assignment_ids=[previous_assignment.pk],
                metadata__removed_responder_ids=[self.responder.pk],
                metadata__reason="Primary responder reported a vehicle failure.",
            ).exists()
        )

    def test_official_can_add_backup_after_missing_location_update(self):
        User = get_user_model()
        alert = self.create_alert()
        backup = User.objects.create_user(
            email="emergency-backup@example.com",
            phone_number="+639360000014",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=backup,
            first_name="Backup",
            last_name="Responder",
            date_of_birth="1990-01-01",
            address="Marikina Heights",
            barangay="Marikina Heights",
        )
        assignment = EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        assignment.assigned_at = timezone.now() - timedelta(minutes=10)
        assignment.save(update_fields=["assigned_at"])
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.official)

        response = self.client.post("/api/emergencies/escalate-overdue/", {"minutes": 5}, format="json")
        repeated_response = self.client.post("/api/emergencies/escalate-overdue/", {"minutes": 5}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(repeated_response.status_code, status.HTTP_200_OK)
        self.assertEqual(repeated_response.data, [])
        self.assertEqual(EmergencyEscalation.objects.filter(alert=alert, escalated_to=backup).count(), 1)
        assignment.refresh_from_db()
        # The unacknowledged assignment is closed out rather than left
        # sitting against a responder who never replied.
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ESCALATED)
        self.assertTrue(alert.assignments.filter(responder=backup).exists())
        # The replacement is genuinely assigned, so they get the assignment
        # notification; the escalation notice goes to the reporter.
        self.assertTrue(Notification.objects.filter(recipient=backup).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.resident, type=Notification.Type.EMERGENCY_ESCALATED).exists())

    def test_resident_can_appeal_closed_emergency_and_official_reviews(self):
        alert = self.create_alert()
        alert.status = EmergencyAlert.Status.RESOLVED
        alert.resolved_at = timezone.now()
        alert.save(update_fields=["status", "resolved_at", "updated_at"])
        self.client.force_authenticate(self.resident)

        appeal_response = self.client.post(
            f"/api/emergencies/{alert.pk}/appeals/",
            {"reason": "Response record needs correction."},
            format="json",
        )

        self.assertEqual(appeal_response.status_code, status.HTTP_201_CREATED)
        appeal = EmergencyAppeal.objects.get(alert=alert)
        self.assertEqual(appeal.status, EmergencyAppeal.Status.SUBMITTED)
        self.assertTrue(Notification.objects.filter(recipient=self.official, type=Notification.Type.EMERGENCY_APPEAL_SUBMITTED).exists())

        self.client.force_authenticate(self.official)
        list_response = self.client.get("/api/emergencies/appeals/?status=submitted")
        review_response = self.client.post(
            f"/api/emergencies/appeals/{appeal.pk}/review/",
            {"status": EmergencyAppeal.Status.APPROVED, "decision_note": "Correction noted."},
            format="json",
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data[0]["id"], appeal.pk)
        self.assertEqual(review_response.status_code, status.HTTP_200_OK)
        appeal.refresh_from_db()
        alert.refresh_from_db()
        self.assertEqual(appeal.status, EmergencyAppeal.Status.APPROVED)
        self.assertEqual(alert.status, EmergencyAlert.Status.RESOLVED)
        self.assertTrue(Notification.objects.filter(recipient=self.resident, type=Notification.Type.EMERGENCY_APPEAL_APPROVED).exists())

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
            {"latitude": "14.6516000", "longitude": "121.1208000"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_arrival_and_resolve_close_emergency(self):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
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

    def test_responder_acknowledges_routed_emergency(self):
        alert = self.create_alert()
        assignment = EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.responder)

        response = self.client.post(f"/api/emergencies/{alert.pk}/acknowledge/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ACKNOWLEDGED)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ACKNOWLEDGED)
        self.assertIsNotNone(assignment.acknowledged_at)
        self.assertTrue(
            EmergencyStatusEvent.objects.filter(alert=alert, status=EmergencyAlert.Status.ACKNOWLEDGED).exists()
        )

    def test_acknowledge_rejects_wrong_state(self):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.EN_ROUTE,
        )
        alert.status = EmergencyAlert.Status.EN_ROUTE
        alert.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.responder)

        response = self.client.post(f"/api/emergencies/{alert.pk}/acknowledge/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.EN_ROUTE)

    def test_non_assignee_cannot_acknowledge(self):
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        other_responder = get_user_model().objects.create_user(
            email="emergency-other-responder@example.com",
            phone_number="+639360000005",
            password="pass",
            role=get_user_model().Role.FIRST_RESPONDER,
            status=get_user_model().Status.VERIFIED,
        )
        self.client.force_authenticate(other_responder)

        response = self.client.post(f"/api/emergencies/{alert.pk}/acknowledge/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)

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

    def test_resident_cancellation_requires_reason_and_records_it(self):
        alert = self.create_alert()

        missing_reason = self.client.post(
            f"/api/emergencies/{alert.pk}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(missing_reason.status_code, status.HTTP_400_BAD_REQUEST)

        reason = "Sent by accident; everyone here is safe."
        cancelled = self.client.post(
            f"/api/emergencies/{alert.pk}/cancel/",
            {"reason": reason},
            format="json",
        )

        self.assertEqual(cancelled.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.CANCELLED)
        event = EmergencyStatusEvent.objects.get(
            alert=alert,
            status=EmergencyAlert.Status.CANCELLED,
        )
        self.assertIn(reason, event.note)

    def test_resident_cancellation_notifies_assigned_responder(self):
        alert = self.create_alert()
        assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
        )
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        reason = "The alarm was accidental and everyone is safe."

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/cancel/",
            {"reason": reason},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.CANCELLED)
        responder_notification = Notification.objects.get(
            recipient=self.responder,
            emergency=alert,
            type=Notification.Type.EMERGENCY_CANCELLED,
        )
        self.assertIn(reason, responder_notification.body)

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
            {"latitude": "14.6516000", "longitude": "121.1208000"},
            format="json",
        )
        message = async_to_sync(asyncio.wait_for)(channel_layer.receive(channel_name), timeout=1)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(message["type"], "emergency.update")
        self.assertEqual(message["payload"]["id"], alert.pk)

    def test_official_live_map_snapshot_is_official_only(self):
        alert = self.create_alert()
        self.responder.is_on_duty = True
        self.responder.current_latitude = "14.6516000"
        self.responder.current_longitude = "121.1208000"
        self.responder.location_updated_at = timezone.now()
        self.responder.save(update_fields=["is_on_duty", "current_latitude", "current_longitude", "location_updated_at", "updated_at"])
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)

        self.client.force_authenticate(self.resident)
        denied = self.client.get("/api/dashboard/official/live-map/")
        self.client.force_authenticate(self.official)
        allowed = self.client.get("/api/dashboard/official/live-map/")

        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(allowed.status_code, status.HTTP_200_OK)
        self.assertEqual(allowed.data["map"]["provider"], "OpenStreetMap")
        self.assertTrue(any(item["id"] == alert.pk for item in allowed.data["emergencies"]))
        self.assertTrue(any(item["id"] == self.responder.pk for item in allowed.data["people"]))

    @patch("apps.geo_services.collect_service_pois", return_value=[])
    def test_resident_alerts_map_is_public_safe(self, _collect_service_pois):
        from apps.concerns.models import Concern

        ResidentProfile.objects.update_or_create(
            user=self.resident,
            defaults={
                "first_name": "Map",
                "last_name": "Reporter",
                "date_of_birth": "1990-01-01",
                "address": "123 Private Home Street",
                "barangay": "Marikina Heights",
            },
        )
        alert = self.create_alert()
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        public = Concern.objects.create(
            reporter=self.resident,
            title="Broken streetlight",
            description="Near the plaza",
            category=Concern.Category.INFRASTRUCTURE,
            visibility=Concern.Visibility.COMMUNITY,
            latitude="14.6507000",
            longitude="121.1133000",
            address="Plaza",
            status=Concern.Status.UNDER_REVIEW,
        )
        private = Concern.objects.create(
            reporter=self.resident,
            title="Private only",
            visibility=Concern.Visibility.PRIVATE,
            latitude="14.6508000",
            longitude="121.1134000",
            status=Concern.Status.SUBMITTED,
        )

        self.client.force_authenticate(self.resident)
        response = self.client.get("/api/locations/resident-alerts-map/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("concerns", response.data)
        self.assertIn("emergencies", response.data)
        self.assertIn("services", response.data)
        # Official ops fields must never appear on the resident path
        self.assertNotIn("people", response.data)
        self.assertNotIn("routes", response.data)
        self.assertTrue(response.data["summary"]["has_ongoing_emergencies"])
        self.assertGreaterEqual(response.data["summary"]["active_emergencies"], 1)
        self.assertTrue(any(item["id"] == public.pk for item in response.data["concerns"]))
        self.assertFalse(any(item["id"] == private.pk for item in response.data["concerns"]))
        public_row = next(item for item in response.data["concerns"] if item["id"] == public.pk)
        self.assertEqual(public_row["category"], Concern.Category.INFRASTRUCTURE)
        self.assertEqual(public_row["kind"], "concern")
        self.assertIn("latitude", public_row)
        self.assertEqual(public_row["reporter"]["full_name"], "Map R.")
        self.assertNotIn("address", public_row["reporter"])
        emergency = next(item for item in response.data["emergencies"] if item["id"] == alert.pk)
        self.assertNotIn("reporter", emergency)
        self.assertNotIn("current_assignment", emergency)
        self.assertEqual(emergency["kind"], "emergency")
        self.assertIn("type", emergency)
        # Resident pins need coordinates; address is shown in the banner.
        self.assertEqual(emergency["latitude"], "14.6510000")
        self.assertEqual(emergency["longitude"], "121.1150000")
        self.assertEqual(emergency["address"], "Covered court")
        # Official live map remains staff-only
        still_denied = self.client.get("/api/dashboard/official/live-map/")
        self.assertEqual(still_denied.status_code, status.HTTP_403_FORBIDDEN)

    @patch("apps.geo_services.collect_service_pois", return_value=[])
    def test_resident_emergency_payload_null_coords_without_gps(self, _collect_service_pois):
        alert = self.create_alert()
        alert.latitude = None
        alert.longitude = None
        alert.save(update_fields=["latitude", "longitude", "updated_at"])

        self.client.force_authenticate(self.resident)
        response = self.client.get("/api/locations/resident-alerts-map/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        emergency = next(item for item in response.data["emergencies"] if item["id"] == alert.pk)
        self.assertIsNone(emergency["latitude"])
        self.assertIsNone(emergency["longitude"])
        self.assertEqual(emergency["address"], "Covered court")

    def test_official_live_map_snapshot_serves_cached_geometry(self):
        cache.delete("live-map-static-geometry:v2")
        MapGeometry.objects.all().delete()
        MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Marikina Heights",
            osm_type="R",
            osm_id=371327,
            geometry={"type": "Polygon", "coordinates": [[[121.1, 14.6], [121.2, 14.6], [121.2, 14.7], [121.1, 14.6]]]},
        )
        MapGeometry.objects.create(
            kind=MapGeometry.Kind.STREET,
            name="Santa Elena Street",
            osm_type="W",
            osm_id=73964486,
            street_type="residential",
            geometry={"type": "LineString", "coordinates": [[121.11, 14.65], [121.12, 14.66]]},
        )
        MapGeometry.objects.create(
            kind=MapGeometry.Kind.STREET,
            name="Narra Street",
            osm_type="W",
            osm_id=4357042,
            street_type="residential",
            geometry={"type": "LineString", "coordinates": [[121.10, 14.64], [121.11, 14.65]]},
        )
        self.client.force_authenticate(self.official)

        response = self.client.get("/api/dashboard/official/live-map/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["map"]["boundary"]["geometry"]["type"], "Polygon")
        streets = {item["name"]: item for item in response.data["map"]["streets"]["streets"]}
        self.assertIn("Santa Elena Street", streets)
        self.assertIn("Narra Street", streets)
        self.assertEqual(streets["Santa Elena Street"]["osm_ids"], ["W73964486"])
        self.assertEqual(streets["Santa Elena Street"]["geometries"][0]["type"], "LineString")

    def _boundary_row(self, **overrides):
        cache.delete("live-map-static-geometry:v2")
        MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY).delete()
        fields = {
            "kind": MapGeometry.Kind.BOUNDARY,
            "name": "Marikina Heights",
            "osm_type": "R",
            "osm_id": 371327,
            "is_home": True,
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[121.1, 14.6], [121.2, 14.6], [121.2, 14.7], [121.1, 14.6]]],
            },
        }
        fields.update(overrides)
        return MapGeometry.objects.create(**fields)

    def test_official_edits_barangay_boundary_and_every_map_redraws_it(self):
        boundary = self._boundary_row()
        self.client.force_authenticate(self.official)
        moved = [[121.11, 14.61], [121.21, 14.61], [121.21, 14.71]]

        response = self.client.patch(
            f"/api/locations/boundaries/{boundary.pk}/",
            {"geometry": {"type": "Polygon", "coordinates": [moved]}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        boundary.refresh_from_db()
        ring = boundary.geometry["coordinates"][0]
        # An open ring is closed on the way in, so the stored outline is valid.
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual(len(ring), 4)
        self.assertEqual(ring[0], [121.11, 14.61])

        # The edit has to reach the maps, not sit behind the geometry cache.
        snapshot = self.client.get("/api/dashboard/official/live-map/")
        self.assertEqual(snapshot.status_code, status.HTTP_200_OK)
        self.assertEqual(snapshot.data["map"]["boundary"]["geometry"]["coordinates"][0], ring)

    def test_boundary_edit_rejects_a_ring_that_is_not_a_shape(self):
        boundary = self._boundary_row()
        self.client.force_authenticate(self.official)

        response = self.client.patch(
            f"/api/locations/boundaries/{boundary.pk}/",
            {"geometry": {"type": "Polygon", "coordinates": [[[121.1, 14.6], [121.2, 14.6]]]}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resident_cannot_edit_a_barangay_boundary(self):
        boundary = self._boundary_row()
        original = boundary.geometry
        self.client.force_authenticate(self.resident)

        response = self.client.patch(
            f"/api/locations/boundaries/{boundary.pk}/",
            {
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[121.11, 14.61], [121.21, 14.61], [121.21, 14.71]]],
                }
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        boundary.refresh_from_db()
        self.assertEqual(boundary.geometry, original)

    def test_live_map_snapshot_prefers_home_boundary_over_other_active_boundaries(self):
        cache.delete("live-map-static-geometry:v2")
        MapGeometry.objects.all().delete()
        MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Alpha Barangay",
            osm_type="R",
            osm_id=999999,
            is_home=False,
            geometry={"type": "Polygon", "coordinates": [[[121.0, 14.5], [121.1, 14.5], [121.1, 14.6], [121.0, 14.5]]]},
        )
        MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Marikina Heights",
            osm_type="R",
            osm_id=371327,
            is_home=True,
            geometry={"type": "Polygon", "coordinates": [[[121.1, 14.6], [121.2, 14.6], [121.2, 14.7], [121.1, 14.6]]]},
        )
        self.client.force_authenticate(self.official)

        response = self.client.get("/api/dashboard/official/live-map/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["map"]["boundary"]["name"], "Marikina Heights")
        self.assertEqual(response.data["map"]["boundary"]["osm_relation_id"], 371327)

    def test_location_ping_updates_current_user_and_broadcasts_live_map(self):
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        channel_name = async_to_sync(channel_layer.new_channel)("test.live-map")
        async_to_sync(channel_layer.group_add)("official_live_map", channel_name)
        self.client.force_authenticate(self.resident)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/locations/ping/",
                {"latitude": "14.6516000", "longitude": "121.1208000", "accuracy": 8, "source": "active_session"},
                format="json",
            )
        message = async_to_sync(asyncio.wait_for)(channel_layer.receive(channel_name), timeout=1)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.resident.refresh_from_db()
        self.assertEqual(str(self.resident.current_latitude), "14.6516000")
        self.assertEqual(message["type"], "live_map.update")
        self.assertEqual(message["payload"]["type"], "location.updated")
        self.assertEqual(message["payload"]["payload"]["person"]["id"], self.resident.pk)

    def test_location_ping_rejects_out_of_bounds_coordinates(self):
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            "/api/locations/ping/",
            {"latitude": "14.9000000", "longitude": "121.5000000"},
            format="json",
        )

        # Soft 200: GPS noise outside barangay should not error the client
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data.get("accepted", True))

    def make_on_duty_responder(self, user, *, unit=None, first_name="Ready"):
        User = get_user_model()
        user.responder_unit = unit or User.ResponderUnit.BHW
        user.is_on_duty = True
        user.save(update_fields=["responder_unit", "is_on_duty", "updated_at"])
        ResidentProfile.objects.get_or_create(
            user=user,
            defaults={
                "first_name": first_name,
                "last_name": "Responder",
                "date_of_birth": "1990-01-01",
                "address": "Marikina Heights",
                "barangay": "Marikina Heights",
            },
        )
        return user

    def direct_alert(self, **overrides):
        values = {
            "reporter": self.resident,
            "type": EmergencyAlert.Type.MEDICAL,
            "note": "Private medical details",
            "latitude": "14.6515000",
            "longitude": "121.1207000",
            "address": "Private home address",
            "barangay": "Marikina Heights",
        }
        values.update(overrides)
        return EmergencyAlert.objects.create(**values)

    def test_claimable_requires_eligible_profile_and_hides_ineligible_alerts(self):
        alert = self.direct_alert()
        self.make_on_duty_responder(self.responder)
        self.client.force_authenticate(self.responder)

        allowed = self.client.get("/api/emergencies/claimable/")
        self.responder.resident_profile.delete()
        self.responder.refresh_from_db()
        self.client.force_authenticate(self.responder)
        denied = self.client.get("/api/emergencies/claimable/")
        self.make_on_duty_responder(self.responder, unit=get_user_model().ResponderUnit.TANOD)
        ineligible = self.client.get("/api/emergencies/claimable/")

        self.assertEqual(allowed.status_code, status.HTTP_200_OK)
        self.assertEqual(allowed.data[0]["id"], alert.pk)
        self.assertEqual(allowed.data[0]["address"], "Private home address")
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(ineligible.status_code, status.HTTP_200_OK)
        self.assertEqual(ineligible.data, [])
        self.assertNotIn("Private home address", str(ineligible.data))

    def test_claim_success_runs_routing_effects_and_repeat_conflicts(self):
        alert = self.direct_alert()
        self.make_on_duty_responder(self.responder)
        self.client.force_authenticate(self.responder)

        with patch("apps.notifications.services.broadcast_live_map_event") as live_map:
            with self.captureOnCommitCallbacks(execute=True):
                claimed = self.client.post(f"/api/emergencies/{alert.pk}/claim/", {}, format="json")
        repeated = self.client.post(f"/api/emergencies/{alert.pk}/claim/", {}, format="json")

        self.assertEqual(claimed.status_code, status.HTTP_200_OK)
        live_map.assert_called_once()
        self.assertEqual(live_map.call_args.args[0], "emergency.updated")
        self.assertEqual(repeated.status_code, status.HTTP_409_CONFLICT)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(alert.assignments.get().responder, self.responder)
        self.assertEqual(alert.status_events.filter(status=EmergencyAlert.Status.ROUTED, note="A responder was automatically assigned.").count(), 1)
        self.assertTrue(Notification.objects.filter(recipient=self.responder, emergency=alert, type=Notification.Type.EMERGENCY_ROUTED).exists())
        self.assertTrue(EmergencyChatMessage.objects.filter(alert=alert, sender=self.responder).exists())
        self.assertTrue(AuditLog.objects.filter(action="emergency.claimed", actor=self.responder, metadata__alert_id=alert.pk).exists())

    def test_claim_without_resident_profile_returns_controlled_403(self):
        self.responder.is_on_duty = True
        self.responder.responder_unit = get_user_model().ResponderUnit.BHW
        self.responder.save(update_fields=["is_on_duty", "responder_unit", "updated_at"])
        alert = self.direct_alert()
        self.client.force_authenticate(self.responder)

        response = self.client.post(f"/api/emergencies/{alert.pk}/claim/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(alert.assignments.exists())

    def test_backup_is_additive_idempotent_and_keeps_primary_assignment(self):
        User = get_user_model()
        first = self.make_on_duty_responder(self.responder, first_name="First")
        second = self.make_on_duty_responder(User.objects.create_user(
            email="backup-second@example.com", phone_number="+639360000020", password="pass",
            role=User.Role.FIRST_RESPONDER, status=User.Status.VERIFIED,
        ), first_name="Second")
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        original = EmergencyResponderAssignment.objects.create(alert=alert, responder=first)
        self.client.force_authenticate(first)

        initial = self.client.post(f"/api/emergencies/{alert.pk}/request-backup/", {"backup_type": "medical", "reason": "Need another pair of hands", "urgency": "high"}, format="json")
        repeated = self.client.post(f"/api/emergencies/{alert.pk}/request-backup/", {"backup_type": "medical", "reason": "Need another pair of hands", "urgency": "high"}, format="json")

        self.assertEqual(initial.status_code, status.HTTP_200_OK)
        self.assertEqual(repeated.status_code, status.HTTP_200_OK)
        original.refresh_from_db()
        self.assertEqual(original.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertEqual(alert.assignments.filter(status=EmergencyResponderAssignment.Status.ASSIGNED).count(), 2)
        self.assertEqual(initial.data["current_assignment"]["id"], original.pk)
        self.assertEqual([item["id"] for item in initial.data["active_assignments"]], [original.pk, alert.assignments.get(responder=second).pk])
        self.assertEqual(alert.escalations.count(), 2)

    def test_backup_authorization_and_no_candidate(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        self.make_on_duty_responder(self.responder)
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.other)
        denied = self.client.post(f"/api/emergencies/{alert.pk}/request-backup/", {"backup_type": "medical", "reason": "Need another pair of hands", "urgency": "high"}, format="json")
        self.client.force_authenticate(self.responder)
        unavailable = self.client.post(f"/api/emergencies/{alert.pk}/request-backup/", {"backup_type": "medical", "reason": "Need another pair of hands", "urgency": "high"}, format="json")

        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        # With nobody free the request is still recorded and escalated to an
        # official rather than rejected outright.
        self.assertEqual(unavailable.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.BACKUP_REQUESTED)
        self.assertTrue(alert.escalations.exists())

    def test_first_ping_needs_no_acknowledgement_and_quantizes_browser_gps(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        assignment = EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)
        accepted = self.client.post(
            f"/api/emergencies/{alert.pk}/location-pings/",
            {"latitude": 14.651600012345, "longitude": 121.120800012345},
            format="json",
        )
        self.responder.refresh_from_db()
        assignment.refresh_from_db()

        self.assertEqual(accepted.status_code, status.HTTP_201_CREATED)
        self.assertEqual(accepted.data["status"], EmergencyAlert.Status.EN_ROUTE)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.EN_ROUTE)
        self.assertEqual(self.responder.current_latitude, Decimal("14.6516000"))
        self.assertEqual(self.responder.current_longitude, Decimal("121.1208000"))
        self.assertIsNotNone(assignment.acknowledged_at)

        arrived = self.client.post(f"/api/emergencies/{alert.pk}/arrived/", {}, format="json")
        resolved = self.client.post(f"/api/emergencies/{alert.pk}/resolve/", {}, format="json")
        self.assertEqual(arrived.status_code, status.HTTP_200_OK)
        self.assertEqual(resolved.status_code, status.HTTP_200_OK)

    def test_location_ping_auto_acknowledges_unacknowledged_assignment(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        assignment = EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)
        self.assertIsNone(assignment.acknowledged_at)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/location-pings/",
            {"latitude": "14.6516000", "longitude": "121.1208000"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.EN_ROUTE)
        self.assertIsNotNone(assignment.acknowledged_at)

    def test_auto_route_is_idempotent_when_retried_for_the_same_alert(self):
        User = get_user_model()
        responder = User.objects.create_user(
            email="retry-route@example.com",
            phone_number="+639360000099",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        from apps.accounts.models import ResidentProfile
        ResidentProfile.objects.create(
            user=responder,
            first_name="Retry",
            last_name="Responder",
            date_of_birth="1990-01-01",
            address="Marikina Heights",
            barangay="Marikina Heights",
        )
        alert = self.create_alert()
        request = RequestFactory().post("/api/emergencies/")

        auto_route_alert(alert, request)

        alert.refresh_from_db()
        self.assertEqual(alert.assignments.filter(responder=responder).count(), 1)
        self.assertEqual(alert.status_events.filter(status=EmergencyAlert.Status.ROUTED).count(), 1)

    def test_responder_action_rejects_stale_status_version(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/arrived/",
            {"status_version": 99},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)

    def test_chat_accepts_text_or_attachment_and_rejects_empty(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        text = self.client.post(f"/api/emergencies/{alert.pk}/chat/", {"body": "Help is coming"}, format="json")
        attachment = self.client.post(
            f"/api/emergencies/{alert.pk}/chat/",
            {"attachment": png_upload("chat.png")},
            format="multipart",
        )
        empty = self.client.post(f"/api/emergencies/{alert.pk}/chat/", {"body": "   "}, format="json")

        self.assertEqual(text.status_code, status.HTTP_201_CREATED)
        self.assertEqual(attachment.status_code, status.HTTP_201_CREATED)
        self.assertEqual(attachment.data["attachment"]["analysis_status"], "pending")
        self.assertEqual(attachment.data["attachment"]["authenticity"], "pending")
        self.assertEqual(attachment.data["attachment"]["edited"], "pending")
        self.assertEqual(empty.status_code, status.HTTP_400_BAD_REQUEST)

    def test_chat_rejects_historical_only_assignment(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.ESCALATED,
        )

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/chat/",
            {"body": "Can anyone still see this?"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("active responder", response.data["detail"].lower())
        self.assertFalse(EmergencyChatMessage.objects.filter(alert=alert).exists())

    def test_chat_rejects_messages_after_resolution(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.RESOLVED)
        EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.responder,
            status=EmergencyResponderAssignment.Status.RESOLVED,
        )

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/chat/",
            {"body": "This case is already closed."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("closed", response.data["detail"].lower())
        self.assertFalse(EmergencyChatMessage.objects.filter(alert=alert).exists())

    def test_image_detector_unavailable_is_conservative_and_video_codec_failure_requires_review(self):
        from django.core.exceptions import ValidationError

        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        with patch("apps.emergencies.media_services.check_media_authenticity", side_effect=ValidationError("Edited media detected.")):
            detected = self.client.post(
                f"/api/emergencies/{alert.pk}/chat/",
                {"attachment": png_upload("detected.png")},
                format="multipart",
            )
        with patch("apps.emergencies.media_services.check_media_authenticity", side_effect=RuntimeError("offline")):
            image = self.client.post(
                f"/api/emergencies/{alert.pk}/chat/",
                {"attachment": png_upload("offline.png")},
                format="multipart",
            )
        video_upload = SimpleUploadedFile(
            "clip.mp4", b"\x00\x00\x00\x18ftypisom" + b"\x00" * 32, content_type="video/mp4"
        )
        with patch("apps.emergencies.media_services.scan_uploaded_file"):
            video = self.client.post(
                f"/api/emergencies/{alert.pk}/chat/",
                {"attachment": video_upload},
                format="multipart",
            )

        self.assertEqual(detected.status_code, status.HTTP_201_CREATED)
        detected_attachment = EmergencyChatAttachment.objects.get(pk=detected.data["attachment"]["id"])
        self.assertEqual(detected_attachment.analysis_status, "complete")
        self.assertEqual(detected_attachment.analysis["authenticity"], "detected")
        self.assertTrue(detected_attachment.analysis["edited"])
        self.assertEqual(detected.data["attachment"]["authenticity"], "detected")
        self.assertTrue(detected.data["attachment"]["edited"])
        self.assertEqual(image.status_code, status.HTTP_201_CREATED)
        self.assertEqual(image.data["attachment"]["analysis_status"], "unavailable")
        self.assertEqual(image.data["attachment"]["authenticity"], "unavailable")
        self.assertEqual(image.data["attachment"]["edited"], "unavailable")
        self.assertEqual(video.status_code, status.HTTP_201_CREATED)
        stored = EmergencyChatAttachment.objects.get(pk=video.data["attachment"]["id"])
        self.assertEqual(stored.analysis["frame_tamper"], "review_required")
        self.assertTrue(stored.analysis["manual_review_required"])
        self.assertEqual(video.data["attachment"]["authenticity"], "unavailable")
        preview = self.client.get(video.data["attachment"]["preview_url"] or f"/api/emergencies/chat-attachments/{stored.pk}/preview/")
        self.assertEqual(preview.status_code, status.HTTP_404_NOT_FOUND)

    def test_emergency_video_attachment_persists_sampled_authenticity_result(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        video_upload = SimpleUploadedFile(
            "incident.mp4",
            b"\x00\x00\x00\x18ftypisom" + b"\x00" * 32,
            content_type="video/mp4",
        )
        sampled_result = {
            "status": "clear",
            "detail": "No obvious edit detected in 3 sampled video frames.",
            "sampled_frames": 3,
        }

        with patch(
            "apps.emergencies.media_services.analyze_video_authenticity",
            create=True,
            return_value=sampled_result,
        ), patch("apps.emergencies.media_services.scan_uploaded_file"):
            response = self.client.post(
                f"/api/emergencies/{alert.pk}/chat/",
                {"attachment": video_upload},
                format="multipart",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        attachment = EmergencyChatAttachment.objects.get(pk=response.data["attachment"]["id"])
        self.assertEqual(attachment.analysis_status, "complete")
        self.assertEqual(attachment.analysis["authenticity"], "clear")
        self.assertFalse(attachment.analysis["edited"])
        self.assertEqual(attachment.analysis["frame_tamper"], "sampled_clear")
        self.assertEqual(attachment.analysis["sampled_frames"], 3)
        self.assertFalse(attachment.analysis["manual_review_required"])

    def test_chat_attachment_raw_preview_authorization_and_audit(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        created = self.client.post(
            f"/api/emergencies/{alert.pk}/chat/",
            {"attachment": png_upload("private-chat.png")},
            format="multipart",
        )
        attachment_id = created.data["attachment"]["id"]
        preview = self.client.get(f"/api/emergencies/chat-attachments/{attachment_id}/preview/")
        raw = self.client.get(f"/api/emergencies/chat-attachments/{attachment_id}/raw/")
        self.client.force_authenticate(self.other)
        denied = self.client.get(f"/api/emergencies/chat-attachments/{attachment_id}/raw/")

        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(raw.status_code, status.HTTP_200_OK)
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(AuditLog.objects.filter(
            action="media.raw_accessed", actor=self.resident,
            metadata__media_type="emergency_chat_attachment", metadata__object_id=attachment_id,
        ).exists())

    def test_escalated_historical_responder_loses_alert_chat_media_and_assignment_listing(self):
        alert = self.direct_alert(status=EmergencyAlert.Status.ROUTED)
        assignment = EmergencyResponderAssignment.objects.create(
            alert=alert, responder=self.responder, status=EmergencyResponderAssignment.Status.ESCALATED,
        )
        message = EmergencyChatMessage.objects.create(alert=alert, sender=self.resident, body="private")
        attachment = EmergencyChatAttachment.objects.create(
            message=message, file=png_upload("historical.png"), media_type="image",
            original_filename="historical.png", mime_type="image/png", file_size=len(png_bytes()),
            sha256_hash="a" * 64, analysis_status=EmergencyChatAttachment.AnalysisStatus.PENDING,
        )
        self.client.force_authenticate(self.responder)

        detail = self.client.get(f"/api/emergencies/{alert.pk}/")
        chat = self.client.get(f"/api/emergencies/{alert.pk}/chat/")
        raw = self.client.get(f"/api/emergencies/chat-attachments/{attachment.pk}/raw/")
        assigned = self.client.get("/api/emergencies/assigned/")
        alert.refresh_from_db()

        self.assertEqual(detail.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(chat.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(raw.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(assigned.status_code, status.HTTP_200_OK)
        self.assertEqual(assigned.data, [])
        self.assertIsNone(assigned.data[0].get("current_assignment") if assigned.data else None)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ESCALATED)
