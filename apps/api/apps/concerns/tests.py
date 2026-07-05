from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from datetime import timedelta
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AuditLog, ResidenceProof
from apps.accounts.services import sha256_file

from .models import Announcement, BarangayEvent, Concern, ConcernComment, ConcernMedia, ConcernStatusEvent, ConcernVote


class PrivateMediaAccessTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(email="owner@example.com", phone_number="+639100000001", password="pass")
        self.other = User.objects.create_user(email="other@example.com", phone_number="+639100000002", password="pass")
        self.staff = User.objects.create_user(
            email="staff@example.com",
            phone_number="+639100000003",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
        )
        proof_file = SimpleUploadedFile("proof.pdf", b"raw proof bytes", content_type="application/pdf")
        self.proof = ResidenceProof.objects.create(
            user=self.owner,
            file=proof_file,
            original_filename="proof.pdf",
            mime_type="application/pdf",
            file_size=proof_file.size,
            sha256_hash=sha256_file(proof_file),
        )
        self.concern = Concern.objects.create(reporter=self.owner, title="Broken streetlight")
        media_file = SimpleUploadedFile("evidence.jpg", b"raw evidence bytes", content_type="image/jpeg")
        self.media = ConcernMedia.objects.create(
            concern=self.concern,
            file=media_file,
            original_filename="evidence.jpg",
            mime_type="image/jpeg",
            file_size=media_file.size,
        )

    def test_unauthorized_resident_cannot_access_raw_residence_proof(self):
        self.client.force_authenticate(self.other)
        response = self.client.get(f"/api/auth/media/residence-proofs/{self.proof.pk}/raw/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AuditLog.objects.filter(action="media.raw_accessed").exists())

    def test_public_can_access_safe_residence_proof_preview(self):
        response = self.client.get(f"/api/auth/media/residence-proofs/{self.proof.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(b"E-BOSES SAFE PREVIEW", b"".join(response.streaming_content))

    def test_staff_can_access_raw_concern_media_and_access_is_audited(self):
        self.client.force_authenticate(self.staff)
        response = self.client.get(f"/api/concerns/media/{self.media.pk}/raw/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(b"".join(response.streaming_content), b"raw evidence bytes")
        self.assertTrue(
            AuditLog.objects.filter(
                action="media.raw_accessed",
                actor=self.staff,
                target_user=self.owner,
                metadata__media_type="concern_media",
                metadata__object_id=self.media.pk,
            ).exists()
        )

    def test_public_can_access_community_image_concern_media_preview(self):
        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertEqual(b"".join(response.streaming_content), b"raw evidence bytes")

    def test_public_cannot_access_private_concern_media_preview(self):
        self.concern.visibility = Concern.Visibility.PRIVATE
        self.concern.save(update_fields=["visibility"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_non_image_preview_does_not_leak_uploaded_filename(self):
        self.media.mime_type = "application/pdf"
        self.media.save(update_fields=["mime_type"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")
        body = b"".join(response.streaming_content)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn(b"evidence.jpg", body)
        self.assertNotIn(str(self.media.file.name).encode("utf-8"), body)


class ResidentDashboardAPITests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="resident-dashboard@example.com",
            phone_number="+639100000101",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.other = User.objects.create_user(
            email="other-dashboard@example.com",
            phone_number="+639100000102",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(self.resident)

    def test_resident_can_create_report_with_initial_status_event(self):
        response = self.client.post(
            "/api/concerns/",
            {
                "title": "Broken streetlight",
                "description": "Madilim sa kanto.",
                "category": "infrastructure",
                "visibility": "community",
                "address": "Bayan-Bayanan St.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        concern = Concern.objects.get(pk=response.data["id"])
        self.assertEqual(concern.reporter, self.resident)
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)
        self.assertEqual(concern.status_events.count(), 1)
        self.assertEqual(concern.status_events.get().status, Concern.Status.SUBMITTED)

    def test_private_reports_are_hidden_from_feed_and_non_owner_detail(self):
        private = Concern.objects.create(
            reporter=self.resident,
            title="Private concern",
            visibility=Concern.Visibility.PRIVATE,
        )
        Concern.objects.create(
            reporter=self.resident,
            title="Public concern",
            visibility=Concern.Visibility.COMMUNITY,
        )

        feed_response = self.client.get("/api/concerns/feed/")
        self.assertEqual(feed_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["title"] for item in feed_response.data], ["Public concern"])

        self.client.force_authenticate(self.other)
        detail_response = self.client.get(f"/api/concerns/{private.pk}/")
        self.assertEqual(detail_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_upvote_is_persistent_and_unique_per_user(self):
        concern = Concern.objects.create(
            reporter=self.other,
            title="Community concern",
            visibility=Concern.Visibility.COMMUNITY,
        )

        first_response = self.client.post(f"/api/concerns/{concern.pk}/vote/", {"value": 1}, format="json")
        second_response = self.client.post(f"/api/concerns/{concern.pk}/vote/", {"value": 1}, format="json")

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(ConcernVote.objects.filter(concern=concern, user=self.resident).count(), 1)
        self.assertEqual(second_response.data["vote_count"], 1)

    def test_comments_and_nested_replies_persist(self):
        concern = Concern.objects.create(
            reporter=self.other,
            title="Community concern",
            visibility=Concern.Visibility.COMMUNITY,
        )

        comment_response = self.client.post(
            f"/api/concerns/{concern.pk}/comments/",
            {"body": "I saw this too."},
            format="json",
        )
        reply_response = self.client.post(
            f"/api/concerns/{concern.pk}/comments/",
            {"body": "Thanks for confirming.", "parent": comment_response.data["id"]},
            format="json",
        )

        self.assertEqual(comment_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(reply_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ConcernComment.objects.filter(concern=concern).count(), 2)
        self.assertEqual(ConcernComment.objects.get(pk=reply_response.data["id"]).parent_id, comment_response.data["id"])

    def test_announcements_events_responders_and_summary(self):
        User = get_user_model()
        Concern.objects.create(reporter=self.resident, title="Active", status=Concern.Status.IN_PROGRESS)
        Concern.objects.create(reporter=self.resident, title="Done", status=Concern.Status.RESOLVED)
        Announcement.objects.create(title="Published", body="Body", is_published=True, published_at=timezone.now())
        Announcement.objects.create(title="Draft", body="Body", is_published=False)
        BarangayEvent.objects.create(title="Clinic", detail="BP check", starts_at=timezone.now(), is_published=True)
        BarangayEvent.objects.create(title="Draft event", starts_at=timezone.now(), is_published=False)
        responder = User.objects.create_user(
            email="responder@example.com",
            phone_number="+639100000103",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            last_seen_at=timezone.now(),
        )
        User.objects.create_user(
            email="stale-responder@example.com",
            phone_number="+639100000104",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            last_seen_at=timezone.now() - timedelta(minutes=10),
        )

        summary = self.client.get("/api/concerns/summary/")
        announcements = self.client.get("/api/announcements/")
        events = self.client.get("/api/barangay-events/today/")
        responders = self.client.get("/api/responders/active/")

        self.assertEqual(summary.data["reports_submitted"], 2)
        self.assertEqual(summary.data["reports_resolved"], 1)
        self.assertEqual([item["title"] for item in announcements.data], ["Published"])
        self.assertEqual([item["title"] for item in events.data], ["Clinic"])
        self.assertEqual([item["id"] for item in responders.data], [responder.pk])
