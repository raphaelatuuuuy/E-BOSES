from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image, ImageDraw
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.models import Concern
from apps.emergencies.models import EmergencyAlert


CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
PASSWORD = "ProductionFlow!123"


def synthetic_photo():
    output = BytesIO()
    image = Image.new("RGB", (640, 480), (180, 205, 225))
    draw = ImageDraw.Draw(image)
    for offset in range(0, 640, 32):
        draw.line((offset, 0, 640 - offset // 2, 480), fill=(35, 70 + offset % 120, 95), width=5)
    draw.rectangle((90, 250, 550, 390), fill=(70, 85, 90), outline=(230, 235, 240), width=8)
    image.save(output, format="PNG")
    return SimpleUploadedFile("blocked-drainage.png", output.getvalue(), content_type="image/png")


@override_settings(CHANNEL_LAYERS=CHANNEL_LAYERS, OSM_ROUTE_URL="")
class ProductionAPIFlowTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = self._user(
            "flow-resident@example.invalid", "+639170000001", User.Role.RESIDENT, "Maria", "Santos"
        )
        self.responder = self._user(
            "flow-responder@example.invalid", "+639170000002", User.Role.FIRST_RESPONDER, "Jose", "Reyes"
        )
        self.responder.is_on_duty = True
        self.responder.responder_unit = "bhw"
        self.responder.save(update_fields=["is_on_duty", "responder_unit"])
        self.official = self._user(
            "flow-official@example.invalid", "+639170000003", User.Role.BARANGAY_OFFICIAL, "Ana", "Cruz"
        )

    def _user(self, email, phone, role, first_name, last_name):
        User = get_user_model()
        user = User.objects.create_user(
            email=email,
            phone_number=phone,
            password=PASSWORD,
            role=role,
            status=User.Status.VERIFIED,
            is_onboarded=True,
        )
        ResidentProfile.objects.create(
            user=user,
            first_name=first_name,
            last_name=last_name,
            date_of_birth="1990-01-01",
            address="Fictional Test Street",
            barangay="Marikina Heights",
        )
        return user

    def _login(self, user, *, csrf=False):
        client = APIClient(enforce_csrf_checks=csrf)
        response = client.post(
            "/api/auth/login/",
            {"identifier": user.email, "password": PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        return client

    def test_auth_login_me_refresh_and_logout_use_real_session_contract(self):
        client = self._login(self.resident, csrf=True)
        me = client.get("/api/auth/me/")
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        self.assertEqual(me.data["email"], self.resident.email)

        csrf = client.get("/api/auth/csrf/")
        self.assertEqual(csrf.status_code, status.HTTP_200_OK)
        token = client.cookies["csrftoken"].value
        refreshed = client.post("/api/auth/refresh/", {}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(refreshed.status_code, status.HTTP_200_OK)
        self.assertIn("access", refreshed.data)

        logged_out = client.post("/api/auth/logout/", {}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(logged_out.status_code, status.HTTP_204_NO_CONTENT)

    @patch("apps.concerns.tasks.process_concern_ai_task.delay")
    def test_resident_report_emergency_and_dashboard_flow(self, enqueue_ai):
        client = self._login(self.resident)
        with self.captureOnCommitCallbacks(execute=True):
            report = client.post(
                "/api/concerns/",
                {
                    "title": "Blocked drainage near the walkway",
                    "description": "Rain water cannot drain and residents must walk on the road.",
                    "category": "infrastructure",
                    "visibility": "community",
                    "address": "Fictional Test Street",
                    "latitude": "14.6515000",
                    "longitude": "121.1207000",
                    "location_source": "manual_pin",
                    "media": synthetic_photo(),
                },
                format="multipart",
            )
        self.assertEqual(report.status_code, status.HTTP_201_CREATED, report.data)
        enqueue_ai.assert_called_once()

        mine = client.get("/api/concerns/mine/")
        detail = client.get(f"/api/concerns/{report.data['public_id']}/")
        self.assertEqual(mine.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["id"], report.data["id"])

        emergency = client.post(
            "/api/emergencies/",
            {
                "type": "medical",
                "note": "A resident needs medical help near the covered court.",
                "latitude": "14.6510000",
                "longitude": "121.1150000",
                "address": "Covered court",
            },
            format="json",
        )
        self.assertEqual(emergency.status_code, status.HTTP_201_CREATED, emergency.data)
        active = client.get("/api/emergencies/mine/active/")
        summary = client.get("/api/dashboard/resident/summary/")
        self.assertEqual(active.status_code, status.HTTP_200_OK)
        self.assertEqual(active.data["id"], emergency.data["id"])
        self.assertEqual(summary.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(summary.data["reports_active"], 1)
        self.assertGreaterEqual(summary.data["active_emergencies"], 1)

    def test_official_and_responder_frontend_api_workspaces(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Streetlight outage",
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type=EmergencyAlert.Type.MEDICAL,
            latitude="14.6510000",
            longitude="121.1150000",
            address="Covered court",
        )

        official = self._login(self.official)
        managed = official.get("/api/concerns/manage/")
        queue = official.get("/api/emergencies/queue/")
        overview = official.get("/api/dashboard/official/summary/")
        categories = official.get("/api/concerns/admin/categories/")
        self.assertEqual(managed.status_code, status.HTTP_200_OK)
        self.assertIn(concern.pk, [item["id"] for item in managed.data])
        self.assertEqual(queue.status_code, status.HTTP_200_OK)
        self.assertIn(alert.pk, [item["id"] for item in queue.data])
        self.assertEqual(overview.status_code, status.HTTP_200_OK)
        self.assertEqual(categories.status_code, status.HTTP_200_OK)

        responder = self._login(self.responder)
        dispatch = responder.get("/api/emergencies/claimable/")
        assigned = responder.get("/api/emergencies/assigned/")
        shift = responder.get("/api/emergencies/shifts/active/")
        summary = responder.get("/api/dashboard/responder/summary/")
        self.assertEqual(dispatch.status_code, status.HTTP_200_OK)
        self.assertEqual(assigned.status_code, status.HTTP_200_OK)
        self.assertEqual(shift.status_code, status.HTTP_200_OK)
        self.assertEqual(summary.status_code, status.HTTP_200_OK)
