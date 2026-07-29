from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from unittest.mock import patch
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentSettings
from apps.concerns.models import Concern
from apps.emergencies.models import EmergencyAlert, WitnessNotification

from .models import BrowserPushSubscription, Notification
from .selectors import notification_queryset
from .services import broadcast_notification, notify_status_change
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
            status=Concern.Status.IN_PROGRESS,
        )

        notify_status_change(concern)

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
            status=Concern.Status.IN_PROGRESS,
        )

        notify_status_change(concern)

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

    def test_responder_concern_notification_targets_responder_map(self):
        User = get_user_model()
        reporter = self.create_verified_user("responder-concern-reporter")
        responder = User.objects.create_user(
            email="notification-responder@example.com",
            phone_number="+639353333390",
            password="Str0ng!Pass123",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(reporter=reporter, title="Assigned field report")
        Notification.objects.create(
            recipient=responder,
            concern=concern,
            type=Notification.Type.ASSIGNED,
            title="Concern report assigned",
        )
        self.client.force_authenticate(responder)

        response = self.client.get("/api/notifications/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]["action_url"], "/dashboard/responders/map")

    def test_realtime_ticket_is_single_use(self):
        user = self.create_verified_user("ticket")
        self.client.force_authenticate(user)

        response = self.client.post("/api/notifications/realtime-ticket/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ticket = response.data["ticket"]
        self.assertEqual(consume_websocket_ticket(ticket), user.pk)
        self.assertIsNone(consume_websocket_ticket(ticket))

    def test_notification_selector_uses_persistent_read_state(self):
        user = self.create_verified_user("selector")
        unread = Notification.objects.create(
            recipient=user,
            type=Notification.Type.SUBMITTED,
            title="Unread",
        )
        Notification.objects.create(
            recipient=user,
            type=Notification.Type.SUBMITTED,
            title="Read",
            is_read=True,
        )

        result = notification_queryset(Notification.objects.all(), recipient=user, unread_only=True)

        self.assertEqual(list(result.values_list("pk", flat=True)), [unread.pk])

    def test_witness_notification_payload_hides_emergency_identity_and_adds_guidance(self):
        user = self.create_verified_user("witness")
        emergency = EmergencyAlert.objects.create(
            reporter=self.create_verified_user("witness-reporter"),
            type=EmergencyAlert.Type.FIRE,
            latitude="14.6515000",
            longitude="121.1207000",
            barangay="Marikina Heights",
        )
        Notification.objects.create(
            recipient=user,
            emergency=emergency,
            type=Notification.Type.WITNESS_ALERT,
            title="Emergency reported nearby",
            body="Stay alert.",
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data[0]
        self.assertTrue(payload["safety_limited"])
        self.assertIsNone(payload["emergency_id"])
        self.assertIsNone(payload["emergency_public_id"])
        self.assertIsNone(payload["emergency_status"])
        self.assertIn("do not intervene", payload["safety_guidance"])

    def test_reading_witness_notification_records_delivery_receipt(self):
        user = self.create_verified_user("witness-read")
        emergency = EmergencyAlert.objects.create(
            reporter=self.create_verified_user("witness-read-reporter"),
            type=EmergencyAlert.Type.FIRE,
            latitude="14.6515000",
            longitude="121.1207000",
            barangay="Marikina Heights",
        )
        witness = WitnessNotification.objects.create(
            alert=emergency,
            resident=user,
            distance_meters=350,
        )
        notification = Notification.objects.create(
            recipient=user,
            emergency=emergency,
            type=Notification.Type.WITNESS_ALERT,
            title="Emergency reported nearby",
            body="Stay alert.",
        )
        self.client.force_authenticate(user)

        response = self.client.patch(f"/api/notifications/{notification.pk}/read/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        witness.refresh_from_db()
        self.assertIsNotNone(witness.read_at)

    @override_settings(WEB_PUSH_PUBLIC_KEY="", WEB_PUSH_PRIVATE_KEY="")
    @patch("apps.notifications.services._broadcast")
    def test_witness_notification_records_unavailable_push_delivery(self, _broadcast):
        user = self.create_verified_user("witness-push-state")
        emergency = EmergencyAlert.objects.create(
            reporter=self.create_verified_user("witness-push-reporter"),
            type=EmergencyAlert.Type.FIRE,
            latitude="14.6515000",
            longitude="121.1207000",
            barangay="Marikina Heights",
        )
        witness = WitnessNotification.objects.create(
            alert=emergency,
            resident=user,
            distance_meters=120,
        )
        notification = Notification.objects.create(
            recipient=user,
            emergency=emergency,
            type=Notification.Type.WITNESS_ALERT,
            title="Emergency reported nearby",
            body="Stay alert.",
        )

        broadcast_notification(notification)

        witness.refresh_from_db()
        self.assertEqual(witness.push_status, WitnessNotification.PushStatus.NOT_CONFIGURED)
        self.assertIsNone(witness.push_attempted_at)

    @override_settings(WEB_PUSH_PUBLIC_KEY="public-key", WEB_PUSH_PRIVATE_KEY="private-key")
    @patch("apps.notifications.services._broadcast")
    @patch("pywebpush.webpush")
    def test_witness_notification_records_successful_push_delivery(self, webpush, _broadcast):
        user = self.create_verified_user("witness-push-delivered")
        emergency = EmergencyAlert.objects.create(
            reporter=self.create_verified_user("witness-delivery-reporter"),
            type=EmergencyAlert.Type.MEDICAL,
            latitude="14.6515000",
            longitude="121.1207000",
            barangay="Marikina Heights",
        )
        witness = WitnessNotification.objects.create(alert=emergency, resident=user, distance_meters=90)
        BrowserPushSubscription.objects.create(
            user=user,
            endpoint="https://push.example.test/delivered",
            p256dh="key",
            auth="auth",
        )
        notification = Notification.objects.create(
            recipient=user,
            emergency=emergency,
            type=Notification.Type.WITNESS_ALERT,
            title="Emergency reported nearby",
            body="Stay alert.",
        )

        broadcast_notification(notification)

        witness.refresh_from_db()
        self.assertEqual(witness.push_status, WitnessNotification.PushStatus.DELIVERED)
        self.assertIsNotNone(witness.push_attempted_at)
        self.assertIsNotNone(witness.push_delivered_at)
        self.assertEqual(witness.push_failure_count, 0)
        webpush.assert_called_once()

    @override_settings(WEB_PUSH_PUBLIC_KEY="public-key", WEB_PUSH_PRIVATE_KEY="private-key")
    @patch("apps.notifications.services._broadcast")
    @patch("pywebpush.webpush", side_effect=RuntimeError("provider unavailable"))
    def test_witness_notification_records_failed_push_delivery(self, webpush, _broadcast):
        user = self.create_verified_user("witness-push-failed")
        emergency = EmergencyAlert.objects.create(
            reporter=self.create_verified_user("witness-failure-reporter"),
            type=EmergencyAlert.Type.FIRE,
            latitude="14.6515000",
            longitude="121.1207000",
            barangay="Marikina Heights",
        )
        witness = WitnessNotification.objects.create(alert=emergency, resident=user, distance_meters=140)
        BrowserPushSubscription.objects.create(
            user=user,
            endpoint="https://push.example.test/failed",
            p256dh="key",
            auth="auth",
        )
        notification = Notification.objects.create(
            recipient=user,
            emergency=emergency,
            type=Notification.Type.WITNESS_ALERT,
            title="Emergency reported nearby",
            body="Stay alert.",
        )

        broadcast_notification(notification)

        witness.refresh_from_db()
        self.assertEqual(witness.push_status, WitnessNotification.PushStatus.FAILED)
        self.assertIsNotNone(witness.push_attempted_at)
        self.assertIsNone(witness.push_delivered_at)
        self.assertEqual(witness.push_failure_count, 1)
        webpush.assert_called_once()


class LiveMapEventFanoutTests(TestCase):
    def _user(self, email, role):
        User = get_user_model()
        return User.objects.create_user(
            email=email,
            phone_number="+63935" + str(abs(hash(email)))[:9],
            password="Str0ng!Pass123",
            role=role,
            status=User.Status.VERIFIED,
        )

    @patch("apps.notifications.services._broadcast_resident_map_event")
    @patch("apps.notifications.services._broadcast")
    def test_public_map_events_fan_out_to_residents_but_location_events_do_not(self, broadcast, resident_broadcast):
        from apps.notifications.services import broadcast_live_map_event

        broadcast_live_map_event("concern.updated", {"concern": {"id": 7}})
        groups = [call.args[0] for call in broadcast.call_args_list]
        self.assertIn("official_live_map", groups)
        resident_broadcast.assert_called_once()

        broadcast.reset_mock()
        resident_broadcast.reset_mock()
        broadcast_live_map_event("location.updated", {"person": {"id": 9, "latitude": "14.65"}})
        groups = [call.args[0] for call in broadcast.call_args_list]
        self.assertEqual(groups, ["official_live_map"])
        resident_broadcast.assert_not_called()
