from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Notification


class NotificationWorkflowTests(APITestCase):
    def test_user_can_poll_and_mark_notifications_read(self):
        user = get_user_model().objects.create_user(email="notify@example.com", phone_number="+639133333333", password="Str0ng!Pass123", status=get_user_model().Status.VERIFIED)
        Notification.objects.create(recipient=user, type=Notification.Type.RESIDENT_UPDATE, title="Report updated", body="Your report is in progress")
        self.client.force_authenticate(user)
        list_response = self.client.get("/api/notifications/?unread=1")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data.get("results", list_response.data)), 1)
        items = list_response.data.get("results", list_response.data)
        notification_id = items[0]["id"]
        read_response = self.client.patch(f"/api/notifications/{notification_id}/read/")
        self.assertEqual(read_response.status_code, status.HTTP_200_OK)
        read_all = self.client.post("/api/notifications/read-all/")
        self.assertEqual(read_all.status_code, status.HTTP_200_OK)
