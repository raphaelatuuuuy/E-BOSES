from django.contrib.auth import get_user_model
from datetime import datetime

from django.test import TestCase, override_settings
from django.utils import timezone
from unittest.mock import patch
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentSettings
from apps.concerns.models import Announcement, Concern, ConcernMedia, Department
from apps.concerns.notification_subject import build_notification_subject, normalise_notification_subject
from apps.concerns.test_helpers import active_test_community, ensure_test_profile
from apps.emergencies.models import EmergencyAlert, EmergencyMedia, WitnessNotification

from .models import BrowserPushSubscription, Notification
from .selectors import notification_queryset
from .services import (
    broadcast_notification,
    create_user_notification,
    notification_display_payload,
    notify_status_change,
    send_browser_push,
)
from .tickets import consume_websocket_ticket, issue_websocket_ticket


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


class NotificationRealtimeTests(TestCase):
    TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="notification-realtime@example.com",
            phone_number="+639353333399",
            password="Str0ng!Pass123",
            status=User.Status.VERIFIED,
        )

    @patch("apps.notifications.tasks.deliver_notification_task.delay")
    def test_creating_notification_queues_realtime_delivery_after_commit(self, deliver):
        with self.captureOnCommitCallbacks(execute=True):
            notification = create_user_notification(
                recipient=self.user,
                type=Notification.Type.ANNOUNCEMENT,
                title="Barangay update",
                body="Water service resumes at noon.",
            )

        deliver.assert_called_once_with(notification.pk)

    @patch("apps.notifications.services.send_browser_push")
    @patch("apps.notifications.services._broadcast")
    def test_delivery_targets_the_recipient_realtime_group(self, realtime_broadcast, browser_push):
        notification = Notification.objects.create(
            recipient=self.user,
            type=Notification.Type.CHAT_MESSAGE,
            title="New message on your report",
            body="An official replied.",
        )

        broadcast_notification(notification)

        realtime_broadcast.assert_called_once()
        group_name, event_type, payload = realtime_broadcast.call_args.args
        self.assertEqual(group_name, f"user_{self.user.pk}")
        self.assertEqual(event_type, "notification.created")
        self.assertEqual(payload["id"], notification.pk)
        self.assertEqual(payload["type"], Notification.Type.CHAT_MESSAGE)
        browser_push.assert_called_once()

    @override_settings(CHANNEL_LAYERS=TEST_CHANNEL_LAYERS)
    def test_authenticated_user_receives_notification_over_websocket(self):
        from asgiref.sync import async_to_sync
        from channels.testing import WebsocketCommunicator
        from config.asgi import application

        communicator = WebsocketCommunicator(
            application,
            f"/ws/notifications/?ticket={issue_websocket_ticket(self.user)}",
        )

        async def scenario():
            connected, _ = await communicator.connect()
            if not connected:
                return connected, None
            from channels.layers import get_channel_layer

            await get_channel_layer().group_send(
                f"user_{self.user.pk}",
                {
                    "type": "notification.created",
                    "payload": {"id": 42, "type": Notification.Type.ANNOUNCEMENT},
                },
            )
            event = await communicator.receive_json_from(timeout=5)
            await communicator.disconnect()
            return connected, event

        connected, event = async_to_sync(scenario)()
        self.assertTrue(connected)
        self.assertEqual(event["type"], "notification.created")
        self.assertEqual(event["payload"]["id"], 42)

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

    def test_unread_count_excludes_archived_notifications(self):
        user = self.create_verified_user("archived-count")
        Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title="Visible unread",
        )
        Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title="Archived unread",
            is_archived=True,
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/unread-count/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)

    def test_mark_all_read_updates_unread_count_immediately(self):
        user = self.create_verified_user("read-all-count")
        Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title="Unread update",
        )
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get("/api/notifications/unread-count/").data["count"], 1)

        response = self.client.post("/api/notifications/read-all/", {}, format="json")
        refreshed_count = self.client.get("/api/notifications/unread-count/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(refreshed_count.data["count"], 0)

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

    def test_registering_browser_push_reenables_resident_push_preference(self):
        user = self.create_verified_user("reenable-push")
        settings_obj = ResidentSettings.objects.create(user=user, push_alerts=False)
        self.client.force_authenticate(user)

        response = self.client.post(
            "/api/notifications/browser-push/subscriptions/",
            {
                "endpoint": "https://push.example.test/sub/reenabled",
                "keys": {"p256dh": "p256dh-key", "auth": "auth-key"},
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        settings_obj.refresh_from_db()
        self.assertTrue(settings_obj.push_alerts)

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

    def test_notification_greeting_uses_manila_send_time_and_last_name(self):
        user = self.create_verified_user("greeting")
        ensure_test_profile(user, first_name="Ana", last_name="Santos")

        cases = [
            (9, "Good morning, Santos."),
            (14, "Good afternoon, Santos."),
            (20, "Good evening, Santos."),
        ]
        for hour, expected in cases:
            notification = Notification.objects.create(
                recipient=user,
                type=Notification.Type.ANNOUNCEMENT,
                title="Community update",
                body="Water service resumes after inspection.",
            )
            notification.created_at = timezone.make_aware(datetime(2026, 8, 28, hour, 0))
            notification.save(update_fields=["created_at"])

            payload = notification_display_payload(notification)

            self.assertTrue(payload["body"].startswith(expected))

    def test_report_notification_includes_assigned_unit_and_community_context(self):
        user = self.create_verified_user("assigned-context")
        ensure_test_profile(user, last_name="Santos")
        community = active_test_community()
        department = Department.objects.filter(community=community).first()
        self.assertIsNotNone(department)
        concern = Concern.objects.create(
            reporter=user,
            community=community,
            assigned_department=department,
            title="Blocked drainage",
            status=Concern.Status.ASSIGNED,
        )
        notification = Notification.objects.create(
            recipient=user,
            concern=concern,
            type=Notification.Type.ASSIGNED,
            title="Concern report assigned",
            body="The report is now assigned.",
        )

        payload = notification_display_payload(notification)

        self.assertEqual(payload["context"]["community"]["id"], community.pk)
        self.assertEqual(payload["context"]["department"]["id"], department.pk)
        self.assertEqual(payload["context"]["response"]["assigned_unit"]["id"], department.pk)
        self.assertIn(department.name, payload["body"])

    def test_responder_dispatch_uses_dynamic_address_without_internal_sos_id(self):
        User = get_user_model()
        reporter = self.create_verified_user("dispatch-address-reporter")
        responder = User.objects.create_user(
            email="dispatch-address-responder@example.com",
            phone_number="+639353333388",
            password="Str0ng!Pass123",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(responder, last_name="Salazar")
        community = active_test_community()
        department = Department.objects.filter(community=community).first()
        self.assertIsNotNone(department)
        emergency = EmergencyAlert.objects.create(
            reporter=reporter,
            type=EmergencyAlert.Type.FIRE,
            community=community,
            barangay=community.name,
            address="Champaca Street",
            reported_area="near Champaca Street",
            resolved_location="Champaca Street, Marikina Heights",
        )
        notification = Notification.objects.create(
            recipient=responder,
            emergency=emergency,
            community=community,
            department=department,
            type=Notification.Type.EMERGENCY_ROUTED,
            title="Emergency routed",
        )

        payload = notification_display_payload(notification)

        self.assertIn("Dispatch assignment", payload["title"])
        self.assertIn("Champaca Street", payload["title"])
        self.assertNotIn("SOS #", payload["title"])
        self.assertNotIn(f"#{emergency.pk}", payload["title"])
        self.assertIsNone(payload["context"]["reference"])
        self.assertIn("reported around Champaca Street, Marikina Heights", payload["body"])
        self.assertIn(department.short_name or department.name, payload["body"])

    def test_report_notification_uses_specific_one_to_three_word_subject(self):
        user = self.create_verified_user("subject-specific")
        concern = Concern.objects.create(
            reporter=user,
            title="Sobrang laki at lalim na ng pothole sa kalsada",
            description="A deep pothole is affecting vehicles.",
            category=Concern.Category.INFRASTRUCTURE,
            notification_subject="Roadside Pothole",
        )
        notification = Notification.objects.create(
            recipient=user,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title="Report received",
        )

        payload = notification_display_payload(notification)

        self.assertIn("Roadside Pothole", payload["context"]["subject"])
        self.assertIn("Roadside Pothole", payload["body"])
        self.assertLessEqual(len(payload["context"]["subject"].split()), 3)

    def test_report_notification_subject_rejects_vague_or_long_model_output(self):
        self.assertEqual(normalise_notification_subject("Community Concern"), "")
        self.assertEqual(normalise_notification_subject("This is a long explanation"), "")
        self.assertEqual(
            build_notification_subject(
                "Community Concern",
                title="Sobrang laki at lalim na ng pothole sa kalsada",
                category=Concern.Category.INFRASTRUCTURE,
            ),
            "Roadside Pothole",
        )

    def test_notification_without_last_name_uses_time_greeting_without_none(self):
        user = self.create_verified_user("greeting-no-name")
        notification = Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title="Community update",
            body="A new announcement is available.",
        )
        notification.created_at = timezone.make_aware(datetime(2026, 8, 28, 20, 0))
        notification.save(update_fields=["created_at"])

        payload = notification_display_payload(notification)

        self.assertTrue(payload["body"].startswith("Good evening."))
        self.assertNotIn("None", payload["body"])

    def test_browser_push_test_endpoint_is_removed(self):
        user = self.create_verified_user("no-test-endpoint")
        self.client.force_authenticate(user)

        response = self.client.post("/api/notifications/browser-push/test/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_notification_inbox_only_returns_the_authenticated_users_rows(self):
        user = self.create_verified_user("recipient-isolation")
        other = self.create_verified_user("recipient-isolation-other")
        own = Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title="For this user",
        )
        Notification.objects.create(
            recipient=other,
            type=Notification.Type.ANNOUNCEMENT,
            title="For another user",
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [own.pk])

    def test_concern_notification_uses_authenticated_image_preview(self):
        user = self.create_verified_user("concern-image")
        concern = Concern.objects.create(reporter=user, title="Report with a photo")
        media = ConcernMedia.objects.create(
            concern=concern,
            file="raw/concern-media/test-notification.jpg",
            original_filename="report.jpg",
            mime_type="image/jpeg",
        )
        Notification.objects.create(
            recipient=user,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title="Report received",
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data[0]["image_url"],
            f"/api/concerns/media/{media.pk}/preview/",
        )
        self.assertEqual(
            response.data[0]["images"],
            [
                {
                    "url": f"/api/concerns/media/{media.pk}/preview/",
                    "filename": "report.jpg",
                    "mime_type": "image/jpeg",
                }
            ],
        )

    def test_notification_returns_every_image_for_preview_and_omits_empty_media(self):
        user = self.create_verified_user("notification-gallery")
        concern = Concern.objects.create(reporter=user, title="Report gallery")
        first = ConcernMedia.objects.create(
            concern=concern,
            file="raw/concern-media/gallery-one.jpg",
            original_filename="one.jpg",
            mime_type="image/jpeg",
        )
        second = ConcernMedia.objects.create(
            concern=concern,
            file="raw/concern-media/gallery-two.png",
            original_filename="two.png",
            mime_type="image/png",
        )
        with_images = Notification.objects.create(
            recipient=user,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title="Report received",
        )
        without_images = Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title="Text only",
        )
        emergency = EmergencyAlert.objects.create(
            reporter=user,
            type=EmergencyAlert.Type.MEDICAL,
            latitude="14.6500000",
            longitude="121.1200000",
            barangay="Marikina Heights",
        )
        emergency_media = EmergencyMedia.objects.create(
            alert=emergency,
            file="raw/emergency-media/gallery-emergency.jpg",
            original_filename="emergency.jpg",
            mime_type="image/jpeg",
        )
        emergency_notification = Notification.objects.create(
            recipient=user,
            emergency=emergency,
            type=Notification.Type.EMERGENCY_SUBMITTED,
            title="Emergency received",
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/")

        by_id = {item["id"]: item for item in response.data}
        self.assertEqual(
            [image["url"] for image in by_id[with_images.pk]["images"]],
            [
                f"/api/concerns/media/{first.pk}/preview/",
                f"/api/concerns/media/{second.pk}/preview/",
            ],
        )
        self.assertEqual(by_id[without_images.pk]["images"], [])
        self.assertIsNone(by_id[without_images.pk]["image_url"])
        self.assertEqual(
            by_id[emergency_notification.pk]["images"][0],
            {
                "url": f"/api/emergencies/media/{emergency_media.pk}/preview/",
                "filename": "emergency.jpg",
                "mime_type": "image/jpeg",
            },
        )

    def test_announcement_notification_exposes_its_photo_for_preview(self):
        user = self.create_verified_user("announcement-photo")
        announcement = Announcement.objects.create(
            title="Weather advisory",
            body="Heavy rain expected.",
            image="announcements/test-advisory.jpg",
        )
        notification = Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title=announcement.title,
            metadata={"announcement_id": announcement.pk},
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/")

        payload = next(item for item in response.data if item["id"] == notification.pk)
        self.assertEqual(payload["image_url"], "/media/announcements/test-advisory.jpg")
        self.assertEqual(payload["images"][0]["url"], payload["image_url"])

    def test_public_concern_preview_is_in_system_push_payload(self):
        user = self.create_verified_user("concern-push-image")
        concern = Concern.objects.create(reporter=user, title="Public report with a photo")
        ConcernMedia.objects.create(
            concern=concern,
            file="raw/concern-media/test-push.jpg",
            preview_file="previews/concern-media/test-push.jpg",
            original_filename="report.jpg",
            mime_type="image/jpeg",
            public_visible=True,
        )
        notification = Notification.objects.create(
            recipient=user,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title="Report received",
        )

        payload = notification_display_payload(notification)

        self.assertEqual(payload["image"], "/media/previews/concern-media/test-push.jpg")

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
        EmergencyMedia.objects.create(
            alert=emergency,
            file="raw/emergency-media/private-test.jpg",
            preview_file="previews/emergency-media/public-test.jpg",
            original_filename="incident.jpg",
            mime_type="image/jpeg",
        )
        self.client.force_authenticate(user)

        response = self.client.get("/api/notifications/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data[0]
        self.assertTrue(payload["safety_limited"])
        self.assertIsNone(payload["emergency_id"])
        self.assertIsNone(payload["emergency_public_id"])
        self.assertIsNone(payload["emergency_status"])
        self.assertIsNone(payload["image_url"])
        self.assertEqual(payload["images"], [])
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

    @override_settings(WEB_PUSH_PUBLIC_KEY="public-key", WEB_PUSH_PRIVATE_KEY="private-key")
    def test_vapid_mismatch_deactivates_stale_subscription(self):
        from unittest.mock import Mock
        from pywebpush import WebPushException

        user = self.create_verified_user("stale-vapid")
        subscription = BrowserPushSubscription.objects.create(
            user=user,
            endpoint="https://push.example.test/stale-vapid",
            p256dh="old-key",
            auth="old-auth",
        )
        notification = Notification.objects.create(
            recipient=user,
            type=Notification.Type.ANNOUNCEMENT,
            title="Test stale subscription",
        )
        response = Mock(status_code=403, reason="Forbidden", text="VAPID key mismatch")

        with patch(
            "pywebpush.webpush",
            side_effect=WebPushException("Push failed", response=response),
        ):
            result = send_browser_push(notification)

        subscription.refresh_from_db()
        self.assertEqual(result["status"], "failed")
        self.assertFalse(subscription.is_active)


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

        community = active_test_community()
        resident = self._user("map-resident@example.com", get_user_model().Role.RESIDENT)
        ensure_test_profile(resident, community=community)
        department = Department.objects.get(community=community, code="bhw")
        concern = Concern.objects.create(
            reporter=resident,
            community=community,
            assigned_department=department,
            title="Map update",
        )
        broadcast_live_map_event("concern.updated", {"concern": {"id": concern.pk}})
        groups = [call.args[0] for call in broadcast.call_args_list]
        self.assertIn(f"official_live_map_department_{department.pk}", groups)
        self.assertIn(f"official_live_map_community_{community.pk}", groups)
        resident_broadcast.assert_called_once()

        broadcast.reset_mock()
        resident_broadcast.reset_mock()
        broadcast_live_map_event("location.updated", {"person": {"id": 9, "latitude": "14.65"}})
        groups = [call.args[0] for call in broadcast.call_args_list]
        self.assertEqual(groups, [])
        resident_broadcast.assert_not_called()
