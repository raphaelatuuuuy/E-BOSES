from django.contrib.auth import get_user_model
from django.test import TransactionTestCase

from apps.concerns.ai import process_concern_ai
from apps.concerns.ai_fixtures import gemma_result
from apps.concerns.models import Concern, ConcernClassificationConfiguration, ConcernMedia
from unittest.mock import patch

User = get_user_model()


class ProbeTests(TransactionTestCase):
    def test_probe(self):
        from apps.concerns.test_media_integrity import photo_bytes, integrity_finding

        resident = User.objects.create_user(
            email="probe@example.com", phone_number="+639181119999",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=resident, title="Basura sa kanto",
            description="May malaking tumpok ng basura sa kanto ng Rosal Street.",
            category=Concern.Category.ENVIRONMENT,
        )
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile("evidence.jpg", photo_bytes(), content_type="image/jpeg")
        ConcernMedia.objects.create(
            concern=concern, file=upload, original_filename=upload.name,
            mime_type="image/jpeg", file_size=upload.size, sha256_hash="e" * 64,
        )
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier, patch(
            "apps.concerns.tasks.enqueue_concern_media_privacy"
        ):
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.ENVIRONMENT,
                evidence_relationship="supports_report",
                image_review_succeeded=True,
                media_integrity=[integrity_finding(verdict="suspected_ai", confidence=0.9)],
                media_integrity_overall="suspected_ai",
            )
            assessment = process_concern_ai(concern.pk)
        print("RAW integrity:", assessment.raw_result.get("media_integrity"))
        print("RAW photo:", assessment.raw_result.get("photo"))
        print("status:", assessment.status)
        from apps.concerns.models import LlmDecisionLog
        row = LlmDecisionLog.objects.filter(concern=concern).first()
        print("snapshot:", (row.output_snapshot or {}).get("media_integrity_overall"))
        self.assertTrue(True)
