import asyncio
from datetime import timedelta
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image, ImageDraw
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AuditLog, ResidentProfile
from apps.notifications.models import Notification

from .models import EmergencyAlert, EmergencyAppeal, EmergencyEscalation, EmergencyLocationPing, EmergencyMedia, EmergencyResponderAssignment, EmergencyStatusEvent, MapGeometry


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
                "latitude": "14.6515000",
                "longitude": "121.1207000",
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
                    "latitude": "14.6515000",
                    "longitude": "121.1207000",
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
        self.assertIn("Location must be inside Barangay Marikina Heights", str(response.data))
        self.assertFalse(EmergencyAlert.objects.filter(address="Outside boundary").exists())

    def test_duplicate_optional_media_is_skipped_without_blocking_alert(self):
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "latitude": "14.6515000",
                "longitude": "121.1207000",
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
                "latitude": "14.6515000",
                "longitude": "121.1207000",
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
                "latitude": "14.6515000",
                "longitude": "121.1207000",
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
            current_latitude="14.6516000",
            current_longitude="121.1208000",
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

        self.assertTrue(alert.witness_notifications.filter(resident=witness).exists())
        self.assertTrue(Notification.objects.filter(recipient=witness, emergency=alert, type=Notification.Type.WITNESS_ALERT).exists())

    def test_resident_cannot_create_second_active_emergency(self):
        alert = self.create_alert()

        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.FIRE,
                "latitude": "14.6515000",
                "longitude": "121.1207000",
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
        # All on-duty BHW (medical unit) get the case; tanod does not (crime unit)
        self.assertTrue(alert.assignments.filter(responder=bhw_near).exists())
        self.assertTrue(alert.assignments.filter(responder=bhw_far).exists())
        self.assertFalse(
            alert.assignments.filter(responder__responder_unit=User.ResponderUnit.TANOD).exists()
        )
        # Nearest is listed first in auto-route note
        route_event = EmergencyStatusEvent.objects.filter(
            alert=alert, status=EmergencyAlert.Status.ROUTED, note__icontains="Auto-routed"
        ).first()
        self.assertIsNotNone(route_event)
        self.assertIn("Near", route_event.note)
        self.assertTrue(
            Notification.objects.filter(
                recipient=bhw_near, emergency=alert, type=Notification.Type.EMERGENCY_ROUTED
            ).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                recipient=bhw_far, emergency=alert, type=Notification.Type.EMERGENCY_ROUTED
            ).exists()
        )

    def test_responder_can_update_duty_location(self):
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            "/api/emergencies/duty/",
            {
                "is_on_duty": True,
                "responder_unit": get_user_model().ResponderUnit.TANOD,
                "latitude": "14.6516000",
                "longitude": "121.1208000",
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

    def test_official_can_assign_multiple_responders(self):
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
        self.assertTrue(Notification.objects.filter(recipient=self.responder, type=Notification.Type.EMERGENCY_ROUTED).exists())
        self.assertTrue(Notification.objects.filter(recipient=second, type=Notification.Type.EMERGENCY_ROUTED).exists())

    def test_official_can_escalate_unacknowledged_assignment_to_backup(self):
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
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ESCALATED)
        self.assertTrue(alert.assignments.filter(responder=backup).exists())
        self.assertTrue(Notification.objects.filter(recipient=backup, type=Notification.Type.EMERGENCY_ESCALATED).exists())
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

        acknowledge_response = self.client.post(f"/api/emergencies/{alert.pk}/acknowledge/", {}, format="json")
        arrived_response = self.client.post(f"/api/emergencies/{alert.pk}/arrived/", {}, format="json")
        resolve_response = self.client.post(
            f"/api/emergencies/{alert.pk}/resolve/",
            {"note": "Patient assisted."},
            format="json",
        )

        self.assertEqual(acknowledge_response.status_code, status.HTTP_200_OK)
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

    def test_resident_alerts_map_is_public_safe(self):
        from apps.concerns.models import Concern

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
        emergency = next(item for item in response.data["emergencies"] if item["id"] == alert.pk)
        self.assertNotIn("reporter", emergency)
        self.assertNotIn("current_assignment", emergency)
        self.assertEqual(emergency["kind"], "emergency")
        self.assertIn("type", emergency)
        self.assertIn("latitude", emergency)
        # Official live map remains staff-only
        still_denied = self.client.get("/api/dashboard/official/live-map/")
        self.assertEqual(still_denied.status_code, status.HTTP_403_FORBIDDEN)

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

    def test_location_ping_updates_current_user_and_broadcasts_live_map(self):
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        channel_layer = get_channel_layer()
        channel_name = async_to_sync(channel_layer.new_channel)("test.live-map")
        async_to_sync(channel_layer.group_add)("official_live_map", channel_name)
        self.client.force_authenticate(self.resident)

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
