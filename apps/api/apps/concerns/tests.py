from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AuditLog, ResidenceProof
from apps.accounts.services import sha256_file

from .models import Concern, ConcernMedia


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

    def test_public_can_access_safe_concern_media_preview(self):
        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(b"E-BOSES SAFE PREVIEW", b"".join(response.streaming_content))
