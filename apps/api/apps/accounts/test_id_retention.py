from datetime import timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .models import (
    IdentityIdentifierClaim,
    ResidenceProof,
    ResidenceVerificationCase,
)
from .storage import PrivateMediaStorage, PublicMediaStorage


class IdImageRetentionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="retention@example.com",
            phone_number="+639100000801",
            password="pass",
            status=User.Status.VERIFIED,
        )
        upload = SimpleUploadedFile("id.jpg", b"pretend jpeg bytes", content_type="image/jpeg")
        self.proof = ResidenceProof.objects.create(
            user=self.user,
            file=upload,
            original_filename="id.jpg",
            mime_type="image/jpeg",
            file_size=upload.size,
            sha256_hash="a" * 64,
            phash="b" * 16,
            phash_blocks=["c" * 16],
        )
        self.claim = IdentityIdentifierClaim.objects.create(
            user=self.user,
            document_type_code="barangay_id",
            field_code="id_number",
            value_hash="d" * 64,
        )

    def settle_case(self, days_ago):
        case = ResidenceVerificationCase.objects.create(
            user=self.user, status=ResidenceVerificationCase.Status.APPROVED
        )
        ResidenceVerificationCase.objects.filter(pk=case.pk).update(
            updated_at=timezone.now() - timedelta(days=days_ago)
        )
        return case

    def run_purge(self, apply=True, days=30):
        out = StringIO()
        args = ["purge_approved_id_images", "--days", str(days)]
        if apply:
            args.append("--apply")
        call_command(*args, stdout=out)
        return out.getvalue()

    def test_recently_approved_ids_are_kept(self):
        self.settle_case(days_ago=2)
        self.run_purge()
        self.proof.refresh_from_db()
        self.assertTrue(self.proof.file)

    def test_old_approved_ids_are_deleted(self):
        self.settle_case(days_ago=90)
        self.run_purge()
        self.proof.refresh_from_db()
        self.assertFalse(self.proof.file)

    def test_dry_run_changes_nothing(self):
        self.settle_case(days_ago=90)
        self.run_purge(apply=False)
        self.proof.refresh_from_db()
        self.assertTrue(self.proof.file)

    def test_duplicate_detection_survives_the_deletion(self):
        """The guarantee that was explicitly asked for."""
        self.settle_case(days_ago=90)
        self.run_purge()
        self.proof.refresh_from_db()

        self.assertFalse(self.proof.file)
        self.assertEqual(self.proof.sha256_hash, "a" * 64)
        self.assertEqual(self.proof.phash, "b" * 16)
        self.assertEqual(self.proof.phash_blocks, ["c" * 16])

        self.assertTrue(
            ResidenceProof.objects.filter(sha256_hash="a" * 64).exists(),
            "a re-uploaded identical image must still be seen as a duplicate",
        )

    def test_id_reuse_claim_survives_the_deletion(self):
        self.settle_case(days_ago=90)
        self.run_purge()

        self.claim.refresh_from_db()
        self.assertEqual(self.claim.value_hash, "d" * 64)
        self.assertTrue(
            IdentityIdentifierClaim.objects.filter(
                document_type_code="barangay_id",
                field_code="id_number",
                value_hash="d" * 64,
            ).exists(),
            "a second account claiming the same ID number must still be blocked",
        )

    def test_verification_record_survives_the_deletion(self):
        case = self.settle_case(days_ago=90)
        self.run_purge()
        case.refresh_from_db()
        self.assertEqual(case.status, ResidenceVerificationCase.Status.APPROVED)


class StorageContractTests(TestCase):
    def test_private_storage_never_exposes_a_url(self):
        with self.assertRaises(ValueError):
            PrivateMediaStorage().url("raw/anything.jpg")

    def test_public_storage_does_expose_a_url(self):
        self.assertTrue(PublicMediaStorage().url("previews/anything.jpg"))
