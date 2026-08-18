from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta
from rest_framework import status
from rest_framework.test import APITestCase

from apps.emergencies.models import EmergencyAlert, EmergencyCommunityComment

from .models import Announcement, AnnouncementComment, BarangayEvent, Concern, Department, Designation, Position


class CommunityTestBase(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="community-resident@example.com",
            phone_number="+639100000601",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.neighbour = User.objects.create_user(
            email="community-neighbour@example.com",
            phone_number="+639100000602",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="community-official@example.com",
            phone_number="+639100000603",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
            status=User.Status.VERIFIED,
        )
        Designation.objects.create(
            user=self.official,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.announcement = Announcement.objects.create(
            title="Water interruption",
            body="Service is paused on Saturday.",
            is_published=True,
        )


class AnnouncementCommentTests(CommunityTestBase):
    def url(self):
        return f"/api/announcements/{self.announcement.pk}/comments/"

    def test_resident_can_post_and_read_a_comment(self):
        self.client.force_authenticate(self.resident)
        created = self.client.post(self.url(), {"body": "Which streets?"}, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)

        listed = self.client.get(self.url())
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(len(listed.data), 1)
        row = listed.data[0]
        self.assertEqual(row["body"], "Which streets?")
        self.assertTrue(row["is_mine"])
        self.assertFalse(row["is_official_reply"])
        self.assertEqual(row["status"], "visible")

    def test_official_comment_is_marked_as_an_official_reply(self):
        self.client.force_authenticate(self.official)
        created = self.client.post(self.url(), {"body": "Champaca and Ipil."}, format="json")
        self.assertTrue(created.data["is_official_reply"])
        self.assertEqual(created.data["author_label"], "Barangay Official")

    def test_reply_is_nested_under_its_parent(self):
        self.client.force_authenticate(self.resident)
        parent = self.client.post(self.url(), {"body": "Which streets?"}, format="json")
        self.client.post(
            self.url(), {"body": "Same question.", "parent": parent.data["id"]}, format="json"
        )

        listed = self.client.get(self.url())
        self.assertEqual(len(listed.data), 1)
        self.assertEqual(len(listed.data[0]["replies"]), 1)
        self.assertEqual(listed.data[0]["replies"][0]["body"], "Same question.")

    def test_reply_to_a_reply_flattens_to_one_level(self):
        self.client.force_authenticate(self.resident)
        parent = self.client.post(self.url(), {"body": "Root"}, format="json")
        reply = self.client.post(
            self.url(), {"body": "First", "parent": parent.data["id"]}, format="json"
        )
        self.client.post(
            self.url(), {"body": "Second", "parent": reply.data["id"]}, format="json"
        )

        listed = self.client.get(self.url())
        self.assertEqual(len(listed.data), 1)
        self.assertEqual(len(listed.data[0]["replies"]), 2)

    def test_author_can_remove_their_own_comment(self):
        self.client.force_authenticate(self.resident)
        created = self.client.post(self.url(), {"body": "Typo"}, format="json")

        removed = self.client.delete(
            f"{self.url()}{created.data['id']}/", {"reason": "typo"}, format="json"
        )

        self.assertEqual(removed.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(len(self.client.get(self.url()).data), 0)

    def test_a_neighbour_cannot_remove_someone_elses_comment(self):
        self.client.force_authenticate(self.resident)
        created = self.client.post(self.url(), {"body": "Mine"}, format="json")

        self.client.force_authenticate(self.neighbour)
        removed = self.client.delete(f"{self.url()}{created.data['id']}/", {}, format="json")

        self.assertEqual(removed.status_code, status.HTTP_403_FORBIDDEN)

    def test_official_can_moderate_any_comment(self):
        self.client.force_authenticate(self.resident)
        created = self.client.post(self.url(), {"body": "Off topic"}, format="json")

        self.client.force_authenticate(self.official)
        removed = self.client.delete(
            f"{self.url()}{created.data['id']}/", {"reason": "off topic"}, format="json"
        )

        self.assertEqual(removed.status_code, status.HTTP_204_NO_CONTENT)
        comment = AnnouncementComment.objects.get(pk=created.data["id"])
        self.assertEqual(comment.status, AnnouncementComment.Status.REMOVED)
        self.assertEqual(comment.moderation_note, "off topic")

    def test_empty_comment_is_rejected(self):
        self.client.force_authenticate(self.resident)
        response = self.client.post(self.url(), {"body": "   "}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class EmergencyCommunityCommentTests(CommunityTestBase):
    def setUp(self):
        super().setUp()
        self.alert = EmergencyAlert.objects.create(
            reporter=self.resident, type=EmergencyAlert.Type.FIRE
        )

    def url(self):
        return f"/api/emergencies/{self.alert.pk}/community-comments/"

    def test_resident_can_post_and_read(self):
        self.client.force_authenticate(self.resident)
        created = self.client.post(self.url(), {"body": "Smoke is gone now."}, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)

        listed = self.client.get(self.url())
        self.assertEqual(len(listed.data), 1)
        self.assertFalse(listed.data[0]["is_official_update"])

    def test_official_comment_is_an_official_update_and_records_the_verifier(self):
        self.client.force_authenticate(self.official)
        created = self.client.post(self.url(), {"body": "Responders on scene."}, format="json")

        self.assertTrue(created.data["is_official_update"])
        comment = EmergencyCommunityComment.objects.get(pk=created.data["id"])
        self.assertEqual(comment.verified_by, self.official)

    def test_removed_comment_disappears_from_the_thread(self):
        self.client.force_authenticate(self.resident)
        created = self.client.post(self.url(), {"body": "Wrong info"}, format="json")
        self.client.delete(f"{self.url()}{created.data['id']}/", {}, format="json")

        self.assertEqual(len(self.client.get(self.url()).data), 0)


class BarangayEventCalendarTests(CommunityTestBase):
    def test_calendar_returns_published_events_inside_the_window(self):
        now = timezone.now()
        BarangayEvent.objects.create(
            title="Clean-up drive", starts_at=now + timedelta(days=3), is_published=True
        )
        BarangayEvent.objects.create(
            title="Far future", starts_at=now + timedelta(days=200), is_published=True
        )
        BarangayEvent.objects.create(
            title="Draft", starts_at=now + timedelta(days=2), is_published=False
        )

        self.client.force_authenticate(self.resident)
        response = self.client.get("/api/barangay-events/calendar/?days=60")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [row["title"] for row in response.data]
        self.assertEqual(titles, ["Clean-up drive"])

    def test_days_parameter_is_clamped_and_survives_garbage(self):
        self.client.force_authenticate(self.resident)
        for value in ("abc", "-5", "99999"):
            response = self.client.get(f"/api/barangay-events/calendar/?days={value}")
            self.assertEqual(response.status_code, status.HTTP_200_OK)


class ConcernReopenCancelTests(CommunityTestBase):
    def make_concern(self, status_value=Concern.Status.RESOLVED):
        return Concern.objects.create(
            reporter=self.resident,
            title="Broken light",
            description="Still dark.",
            status=status_value,
        )

    def test_reporter_can_reopen_a_resolved_report(self):
        concern = self.make_concern()
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/reopen-request/",
            {"reason": "It broke again."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.UNDER_REVIEW)
        self.assertEqual(concern.reopen_count, 1)
        self.assertIsNotNone(concern.reopened_at)

    def test_an_open_report_cannot_be_reopened(self):
        concern = self.make_concern(Concern.Status.IN_PROGRESS)
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/reopen-request/", {"reason": "x"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_a_neighbour_cannot_reopen_someone_elses_report(self):
        concern = self.make_concern()
        self.client.force_authenticate(self.neighbour)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/reopen-request/", {"reason": "x"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_reopen_requires_a_reason(self):
        concern = self.make_concern()
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/reopen-request/", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reporter_can_cancel_an_open_report(self):
        concern = self.make_concern(Concern.Status.SUBMITTED)
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/cancel/",
            {"reason": "Sorted it myself."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.REJECTED)
        self.assertEqual(concern.rejection_code, "cancelled_by_reporter")
        self.assertIsNotNone(concern.archived_at)

    def test_a_closed_report_cannot_be_cancelled(self):
        concern = self.make_concern(Concern.Status.RESOLVED)
        self.client.force_authenticate(self.resident)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/cancel/", {"reason": "x"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_a_cancelled_report_cannot_then_be_reopened(self):
        concern = self.make_concern(Concern.Status.SUBMITTED)
        self.client.force_authenticate(self.resident)
        self.client.post(
            f"/api/concerns/{concern.pk}/cancel/", {"reason": "done"}, format="json"
        )

        response = self.client.post(
            f"/api/concerns/{concern.pk}/reopen-request/", {"reason": "oops"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
