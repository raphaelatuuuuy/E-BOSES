from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import AuditLog, DataSubjectRequest, ResidenceProof
from apps.concerns.models import Concern, ConcernChatMessage, ConcernMedia
from apps.notifications.models import Notification
from apps.retention import enforce_retention_limits_task, erase_user_data


def days_ago(days):
    return timezone.now() - timedelta(days=days)


class RetentionSweepTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="retention@example.com",
            phone_number="+639180004001",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        self.old_concern = Concern.objects.create(
            reporter=self.user,
            title="Old resolved",
            description="Closed long ago.",
            category=Concern.Category.INFRASTRUCTURE,
            status=Concern.Status.RESOLVED,
        )
        # auto_now ignores assigned values on save; .update() bypasses it.
        Concern.objects.filter(pk=self.old_concern.pk).update(updated_at=days_ago(3 * 365))
        self.recent_concern = Concern.objects.create(
            reporter=self.user,
            title="Fresh open",
            description="Still active.",
            category=Concern.Category.INFRASTRUCTURE,
            status=Concern.Status.SUBMITTED,
        )

    def test_sweep_deletes_only_expired_content(self):
        Notification.objects.bulk_create([
            Notification(recipient=self.user, type=Notification.Type.ANNOUNCEMENT, title="ancient"),
            Notification(recipient=self.user, type=Notification.Type.ANNOUNCEMENT, title="fresh"),
        ])
        Notification.objects.update(created_at=days_ago(400))
        Notification.objects.filter(title="fresh").update(created_at=timezone.now())

        old_message = ConcernChatMessage.objects.create(concern=self.old_concern, sender=self.user, body="stale")
        fresh_message = ConcernChatMessage.objects.create(concern=self.recent_concern, sender=self.user, body="keep")
        old_media = ConcernMedia.objects.create(concern=self.old_concern)
        AuditLog.objects.create(
            action="auth.login",
            metadata={"summary": "old entry"},
        )
        audit_qs = AuditLog.objects.all()
        audit_qs.update(created_at=days_ago(6 * 365))

        result = enforce_retention_limits_task.run()

        self.assertGreaterEqual(result["notifications"], 1)
        self.assertEqual(result["chat_messages"], 1)
        self.assertEqual(result["concern_media"], 1)
        self.assertGreaterEqual(result["audit_logs"], 1)
        self.assertFalse(Notification.objects.filter(title="ancient").exists())
        self.assertTrue(Notification.objects.filter(title="fresh").exists())
        self.assertFalse(ConcernChatMessage.objects.filter(pk=old_message.pk).exists())
        self.assertTrue(ConcernChatMessage.objects.filter(pk=fresh_message.pk).exists())
        self.assertFalse(ConcernMedia.objects.filter(pk=old_media.pk).exists())

    def test_erasure_removes_account_and_personal_rows(self):
        ResidenceProof.objects.create(
            user=self.user,
            side=ResidenceProof.Side.SINGLE,
            original_filename="proof.jpg",
            mime_type="image/jpeg",
            file_size=1,
            sha256_hash="x" * 64,
        )
        request = DataSubjectRequest.objects.create(user=self.user)
        request.status = DataSubjectRequest.Status.APPROVED
        request.save(update_fields=["status"])

        from apps.retention import process_data_subject_request_task

        result = process_data_subject_request_task.run(request.pk)

        self.assertTrue(result["erased"])
        User = get_user_model()
        self.assertFalse(User.objects.filter(pk=self.user.pk).exists())
        self.assertFalse(ResidenceProof.objects.exists())
        request.refresh_from_db()
        self.assertEqual(request.status, DataSubjectRequest.Status.COMPLETED)
        self.assertIsNone(request.user)


class DataSubjectRequestEndpointTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="dsr@example.com",
            phone_number="+639180004002",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_filing_creates_one_active_request(self):
        first = self.client.post("/api/auth/account/data-request/")
        second = self.client.post("/api/auth/account/data-request/")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(DataSubjectRequest.objects.count(), 1)

    def test_status_is_readable(self):
        self.client.post("/api/auth/account/data-request/")
        response = self.client.get("/api/auth/account/data-request/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "pending")
