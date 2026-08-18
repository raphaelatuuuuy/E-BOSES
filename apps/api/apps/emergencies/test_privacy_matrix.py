import hashlib
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AuditLog
from apps.concerns.test_helpers import grant_position

from .models import (
    EmergencyAlert,
    EmergencyChatAttachment,
    EmergencyChatMessage,
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResponderAssignment,
)


TEST_CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}


def _png_bytes():
    output = BytesIO()
    Image.new("RGB", (96, 72), color=(72, 118, 155)).save(output, format="PNG")
    return output.getvalue()


def _png_upload(name):
    return SimpleUploadedFile(name, _png_bytes(), content_type="image/png")


@override_settings(
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class EmergencyPrivacyAccessMatrixTests(APITestCase):
    """Cross-role contract for one private emergency and its live response data."""

    PRIVATE_NOTE = "Resident reports private medical symptoms."
    PRIVATE_ADDRESS = "17 Private Street, Marikina Heights"
    PRIVATE_CHAT = "My breathing is getting worse."
    ALERT_LATITUDE = "14.6515000"
    ALERT_LONGITUDE = "121.1207000"
    RESPONDER_LATITUDE = "14.6516000"
    RESPONDER_LONGITUDE = "121.1208000"

    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(
            email="privacy-owner@example.com",
            phone_number="+639370000001",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.unrelated_resident = User.objects.create_user(
            email="privacy-unrelated-resident@example.com",
            phone_number="+639370000002",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.assigned_responder = User.objects.create_user(
            email="privacy-assigned-responder@example.com",
            phone_number="+639370000003",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
        )
        self.unrelated_responder = User.objects.create_user(
            email="privacy-unrelated-responder@example.com",
            phone_number="+639370000004",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
        )
        self.official = User.objects.create_user(
            email="privacy-official@example.com",
            phone_number="+639370000005",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        grant_position(self.official)

        self.alert = EmergencyAlert.objects.create(
            reporter=self.owner,
            type=EmergencyAlert.Type.MEDICAL,
            note=self.PRIVATE_NOTE,
            status=EmergencyAlert.Status.EN_ROUTE,
            barangay="Marikina Heights",
            latitude=self.ALERT_LATITUDE,
            longitude=self.ALERT_LONGITUDE,
            location_source="gps",
            location_accuracy=6.5,
            address=self.PRIVATE_ADDRESS,
        )
        self.assignment = EmergencyResponderAssignment.objects.create(
            alert=self.alert,
            responder=self.assigned_responder,
            status=EmergencyResponderAssignment.Status.EN_ROUTE,
        )
        self.initial_ping = EmergencyLocationPing.objects.create(
            assignment=self.assignment,
            responder=self.assigned_responder,
            latitude=self.RESPONDER_LATITUDE,
            longitude=self.RESPONDER_LONGITUDE,
            accuracy=8.0,
        )

        incident_bytes = _png_bytes()
        self.incident_media = EmergencyMedia.objects.create(
            alert=self.alert,
            file=_png_upload("private-incident.png"),
            original_filename="private-incident.png",
            mime_type="image/png",
            file_size=len(incident_bytes),
            sha256_hash=hashlib.sha256(incident_bytes).hexdigest(),
        )
        self.message = EmergencyChatMessage.objects.create(
            alert=self.alert,
            sender=self.owner,
            body=self.PRIVATE_CHAT,
        )
        self.chat_attachment = EmergencyChatAttachment.objects.create(
            message=self.message,
            file=_png_upload("private-chat.png"),
            media_type=EmergencyChatAttachment.MediaType.IMAGE,
            original_filename="private-chat.png",
            mime_type="image/png",
            file_size=len(incident_bytes),
            sha256_hash=hashlib.sha256(incident_bytes).hexdigest(),
            analysis_status=EmergencyChatAttachment.AnalysisStatus.PENDING,
        )

        self.allowed_roles = {
            "owner resident": self.owner,
            "assigned responder": self.assigned_responder,
            "official": self.official,
        }
        self.denied_roles = {
            "unrelated resident": self.unrelated_resident,
            "unrelated responder": self.unrelated_responder,
        }

    def tearDown(self):
        for media in EmergencyMedia.objects.filter(pk=self.incident_media.pk):
            media.file.delete(save=False)
            media.preview_file.delete(save=False)
        for attachment in EmergencyChatAttachment.objects.filter(pk=self.chat_attachment.pk):
            attachment.file.delete(save=False)
            attachment.preview_file.delete(save=False)
        super().tearDown()

    def _authenticate(self, user):
        self.client.force_authenticate(user)

    def _close_file_response(self, response):
        close = getattr(response, "close", None)
        if close:
            close()

    def _assert_denial_does_not_echo_private_data(self, response):
        serialized = str(response.data)
        self.assertNotIn(self.PRIVATE_NOTE, serialized)
        self.assertNotIn(self.PRIVATE_ADDRESS, serialized)
        self.assertNotIn(self.PRIVATE_CHAT, serialized)
        self.assertNotIn(self.ALERT_LATITUDE, serialized)
        self.assertNotIn(self.ALERT_LONGITUDE, serialized)
        self.assertNotIn(self.RESPONDER_LATITUDE, serialized)
        self.assertNotIn(self.RESPONDER_LONGITUDE, serialized)

    def test_detail_exposes_exact_incident_and_responder_location_only_to_participants_and_official(self):
        detail_url = f"/api/emergencies/{self.alert.pk}/"

        for role_name, user in self.allowed_roles.items():
            with self.subTest(role=role_name):
                self._authenticate(user)
                response = self.client.get(detail_url)

                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(response.data["note"], self.PRIVATE_NOTE)
                self.assertEqual(response.data["address"], self.PRIVATE_ADDRESS)
                self.assertEqual(response.data["latitude"], self.ALERT_LATITUDE)
                self.assertEqual(response.data["longitude"], self.ALERT_LONGITUDE)
                self.assertEqual(
                    response.data["current_assignment"]["responder"]["id"],
                    self.assigned_responder.pk,
                )
                self.assertEqual(
                    response.data["current_assignment"]["last_location"]["latitude"],
                    self.RESPONDER_LATITUDE,
                )
                self.assertEqual(
                    response.data["current_assignment"]["last_location"]["longitude"],
                    self.RESPONDER_LONGITUDE,
                )

        for role_name, user in self.denied_roles.items():
            with self.subTest(role=role_name):
                self._authenticate(user)
                response = self.client.get(detail_url)

                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                self._assert_denial_does_not_echo_private_data(response)

    def test_chat_history_and_attachment_metadata_follow_the_same_role_matrix(self):
        chat_url = f"/api/emergencies/{self.alert.pk}/chat/"

        for role_name, user in self.allowed_roles.items():
            with self.subTest(role=role_name):
                self._authenticate(user)
                response = self.client.get(chat_url)

                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(len(response.data), 1)
                self.assertEqual(response.data[0]["body"], self.PRIVATE_CHAT)
                self.assertEqual(
                    response.data[0]["attachment"]["original_filename"],
                    "private-chat.png",
                )
                self.assertIn(
                    f"/api/emergencies/chat-attachments/{self.chat_attachment.pk}/raw/",
                    response.data[0]["attachment"]["raw_url"],
                )

        for role_name, user in self.denied_roles.items():
            with self.subTest(role=role_name):
                self._authenticate(user)
                response = self.client.get(chat_url)

                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                self._assert_denial_does_not_echo_private_data(response)
                self.assertNotIn("private-chat.png", str(response.data))

    def test_incident_media_and_chat_attachment_bytes_follow_the_role_matrix(self):
        protected_urls = {
            "incident preview": f"/api/emergencies/media/{self.incident_media.pk}/preview/",
            "incident raw": f"/api/emergencies/media/{self.incident_media.pk}/raw/",
            "chat preview": f"/api/emergencies/chat-attachments/{self.chat_attachment.pk}/preview/",
            "chat raw": f"/api/emergencies/chat-attachments/{self.chat_attachment.pk}/raw/",
        }

        for role_name, user in self.allowed_roles.items():
            self._authenticate(user)
            for resource_name, url in protected_urls.items():
                with self.subTest(role=role_name, resource=resource_name):
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, status.HTTP_200_OK)
                    self._close_file_response(response)

        for role_name, user in self.denied_roles.items():
            self._authenticate(user)
            for resource_name, url in protected_urls.items():
                with self.subTest(role=role_name, resource=resource_name):
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                    self._assert_denial_does_not_echo_private_data(response)

        for user in self.allowed_roles.values():
            self.assertTrue(
                AuditLog.objects.filter(
                    action="media.raw_accessed",
                    actor=user,
                    metadata__media_type="emergency_media",
                    metadata__object_id=self.incident_media.pk,
                ).exists()
            )
            self.assertTrue(
                AuditLog.objects.filter(
                    action="media.raw_accessed",
                    actor=user,
                    metadata__media_type="emergency_chat_attachment",
                    metadata__object_id=self.chat_attachment.pk,
                ).exists()
            )

        self.assertFalse(
            AuditLog.objects.filter(
                action="media.raw_accessed",
                actor__in=self.denied_roles.values(),
            ).exists()
        )

    def test_only_assigned_responder_can_publish_incident_location(self):
        location_url = f"/api/emergencies/{self.alert.pk}/location-pings/"
        new_location = {
            "latitude": "14.6517000",
            "longitude": "121.1209000",
            "accuracy": 5.0,
        }
        denied_roles = {
            "owner resident": self.owner,
            "unrelated resident": self.unrelated_resident,
            "unrelated responder": self.unrelated_responder,
            "official": self.official,
        }

        for role_name, user in denied_roles.items():
            with self.subTest(role=role_name):
                self._authenticate(user)
                response = self.client.post(location_url, new_location, format="json")

                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(self.assignment.location_pings.count(), 1)
                self._assert_denial_does_not_echo_private_data(response)

        self._authenticate(self.assigned_responder)
        accepted = self.client.post(location_url, new_location, format="json")

        self.assertEqual(accepted.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.assignment.location_pings.count(), 2)
        self.assertEqual(
            accepted.data["current_assignment"]["last_location"]["latitude"],
            new_location["latitude"],
        )
        self.assertEqual(
            accepted.data["current_assignment"]["last_location"]["longitude"],
            new_location["longitude"],
        )

        self._authenticate(self.owner)
        owner_detail = self.client.get(f"/api/emergencies/{self.alert.pk}/")
        self.assertEqual(owner_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(
            owner_detail.data["current_assignment"]["last_location"]["latitude"],
            new_location["latitude"],
        )
        self.assertEqual(
            owner_detail.data["current_assignment"]["last_location"]["longitude"],
            new_location["longitude"],
        )
