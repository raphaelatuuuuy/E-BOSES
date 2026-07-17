from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentSettings
from apps.concerns.models import Concern, ConcernStatusEvent
from apps.emergencies.models import EmergencyAlert

from .models import BrowserPushSubscription, Notification
from .tickets import consume_websocket_ticket


class NotificationPreferenceTests(TestCase):
    def test_status_event_remains_persistent_when_report_updates_disabled(self):
        user = get_user_model().objects.create_user(
            email="report-updates-off@example.com",
            phone_number="+639351111111",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        ResidentSettings.objects.create(user=user, report_updates=False)
        concern = Concern.objects.create(
            reporter=user,
            title="Broken streetlight",
            description="Streetlight near the corner is out.",
        )

        ConcernStatusEvent.objects.create(
            concern=concern,
            status=Concern.Status.IN_PROGRESS,
            note="Responder assigned.",
        )

        self.assertTrue(Notification.objects.filter(recipient=user, concern=concern).exists())

    def test_status_event_creates_notification_when_report_updates_enabled(self):
        user = get_user_model().objects.create_user(
            email="report-updates-on@example.com",
            phone_number="+639352222222",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=user,
            title="Drainage concern",
            description="Drainage is blocked.",
        )

        ConcernStatusEvent.objects.create(
            concern=concern,
            status=Concern.Status.IN_PROGRESS,
            note="Responder assigned.",
        )

        self.assertTrue(Notification.objects.filter(recipient=user, concern=concern).exists())


class NotificationPreferenceAPITests(APITestCase):
    def create_verified_user(self, suffix="base"):
        return get_user_model().objects.create_user(
            email=f"notification-{suffix}@example.com",
            phone_number=f"+639354{len(suffix):06d}",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )

    def test_notification_list_and_count_remain_visible_when_push_alerts_disabled(self):
        user = get_user_model().objects.create_user(
            email="push-alerts-off@example.com",
            phone_number="+639353333333",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        ResidentSettings.objects.create(user=user, push_alerts=False)
        concern = Concern.objects.create(
            reporter=user,
            title="Flooded sidewalk",
            description="Water is pooling near the walkway.",
        )
        Notification.objects.create(
            recipient=user,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title=concern.title,
            body="Your report was submitted.",
        )
        self.client.force_authenticate(user)

        list_response = self.client.get("/api/notifications/")
        count_response = self.client.get("/api/notifications/unread-count/")

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(count_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in list_response.data], [Notification.objects.get(recipient=user).pk])
        self.assertEqual(count_response.data["count"], 1)

    def test_user_can_register_browser_push_subscription(self):
        user = get_user_model().objects.create_user(
            email="push-sub@example.com",
            phone_number="+639353333334",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            "/api/notifications/browser-push/subscriptions/",
            {
                "endpoint": "https://push.example.test/sub/1",
                "keys": {"p256dh": "p256dh-key", "auth": "auth-key"},
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(BrowserPushSubscription.objects.filter(user=user, endpoint="https://push.example.test/sub/1", is_active=True).exists())

    def test_notification_payload_includes_public_resource_ids(self):
        user = self.create_verified_user("public-ids")
        concern = Concern.objects.create(reporter=user, title="Drainage update")
        emergency = EmergencyAlert.objects.create(
            reporter=user,
            type=EmergencyAlert.Type.MEDICAL,
            latitude="14.6515000",
            longitude="121.1207000",
            barangay="Marikina Heights",
        )
        Notification.objects.create(
            recipient=user,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title="Report update",
        )
        Notification.objects.create(
            recipient=user,
            emergency=emergency,
            type=Notification.Type.EMERGENCY_SUBMITTED,
            title="Emergency update",
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        by_type = {item["type"]: item for item in response.data}
        self.assertEqual(by_type[Notification.Type.SUBMITTED]["concern_public_id"], str(concern.public_id))
        self.assertEqual(by_type[Notification.Type.EMERGENCY_SUBMITTED]["emergency_public_id"], str(emergency.public_id))

    def test_realtime_ticket_is_single_use(self):
        user = self.create_verified_user("ticket")
        self.client.force_authenticate(user)

        response = self.client.post("/api/notifications/realtime-ticket/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ticket = response.data["ticket"]
        self.assertEqual(consume_websocket_ticket(ticket), user.pk)
        self.assertIsNone(consume_websocket_ticket(ticket))
