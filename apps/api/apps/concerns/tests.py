from io import BytesIO
from io import BytesIO, StringIO
from pathlib import Path
import uuid
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from datetime import timedelta
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AccountRequest, AuditLog, ResidenceProof, ResidentProfile
from apps.accounts.services import sha256_file
from apps.emergencies.models import EmergencyAlert, EmergencyResponderAssignment
from apps.notifications.models import Notification
from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.text_classifier import TextClassificationResult
from apps.concerns.ai_fixtures import gemma_result
from apps.geo_services import classify_location

from .models import Announcement, BarangayEvent, Concern, ConcernAiAssessment, ConcernAppeal, ConcernAssignment, ConcernChatAttachment, ConcernClassificationConfiguration, ConcernClarification, ConcernComment, ConcernMedia, ConcernOfficialRemark, ConcernResolutionEvidence, ConcernStatusEvent, ConcernVote, ContentFlag

def png_bytes():
    output = BytesIO()
    image = Image.new("RGB", (320, 240), color=(245, 245, 245))
    image.paste((35, 65, 95), (0, 0, 160, 240))
    image.save(output, format="PNG")
    return output.getvalue()


def png_upload(name="evidence.png", content=None):
    return SimpleUploadedFile(name, content or png_bytes(), content_type="image/png")


class PrivateMediaAccessTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(email="owner@example.com", phone_number="+639100000001", password="pass", status=User.Status.VERIFIED)
        self.other = User.objects.create_user(email="other@example.com", phone_number="+639100000002", password="pass", status=User.Status.VERIFIED)
        self.staff = User.objects.create_user(
            email="staff@example.com",
            phone_number="+639100000003",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
            status=User.Status.VERIFIED,
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
        self.concern = Concern.objects.create(
            reporter=self.owner,
            title="Broken streetlight",
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        media_file = png_upload("evidence.png")
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

    def test_only_authorized_user_can_access_safe_residence_proof_preview(self):
        unauthenticated = self.client.get(f"/api/auth/media/residence-proofs/{self.proof.pk}/preview/")
        self.assertEqual(unauthenticated.status_code, status.HTTP_401_UNAUTHORIZED)

        self.client.force_authenticate(self.owner)
        response = self.client.get(f"/api/auth/media/residence-proofs/{self.proof.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertTrue(b"".join(response.streaming_content).startswith(b"\xff\xd8"))

    def test_staff_can_access_raw_concern_media_and_access_is_audited(self):
        self.client.force_authenticate(self.staff)
        response = self.client.get(f"/api/concerns/media/{self.media.pk}/raw/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(b"".join(response.streaming_content), png_bytes())
        self.assertTrue(
            AuditLog.objects.filter(
                action="media.raw_accessed",
                actor=self.staff,
                target_user=self.owner,
                metadata__media_type="concern_media",
                metadata__object_id=self.media.pk,
            ).exists()
        )

    def test_public_can_access_a_privacy_cleared_community_image_preview(self):
        # A privacy run cleared this image, which is the only thing that ever
        # sets `public_visible`. Without it the preview is not served publicly.
        self.media.privacy_state = ConcernMedia.PrivacyState.PROTECTED
        self.media.public_visible = True
        self.media.save(update_fields=["privacy_state", "public_visible"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        preview = b"".join(response.streaming_content)
        self.assertTrue(preview.startswith(b"\xff\xd8"))
        # Never the original bytes, whatever else happens.
        self.assertNotEqual(preview, png_bytes())

    def test_public_cannot_access_a_preview_no_privacy_run_has_cleared(self):
        """Fail closed.

        Previously any image on an accepted community concern was served to
        anyone, because the concern's own visibility was the only gate. A photo
        whose privacy processing failed, or never ran at all, was published
        exactly like one that had been checked.
        """
        self.media.privacy_state = ConcernMedia.PrivacyState.FAILED_RESTRICTED
        self.media.public_visible = False
        self.media.save(update_fields=["privacy_state", "public_visible"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_official_can_still_view_a_restricted_preview(self):
        self.media.privacy_state = ConcernMedia.PrivacyState.SENSITIVE_REVIEW_REQUIRED
        self.media.public_visible = False
        self.media.save(update_fields=["privacy_state", "public_visible"])
        self.client.force_authenticate(self.staff)

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_public_cannot_access_private_concern_media_preview(self):
        self.concern.visibility = Concern.Visibility.PRIVATE
        self.concern.save(update_fields=["visibility"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_non_image_preview_does_not_leak_uploaded_filename(self):
        self.media.file = SimpleUploadedFile("secret-evidence.pdf", b"not image data", content_type="application/pdf")
        self.media.mime_type = "application/pdf"
        self.media.privacy_state = ConcernMedia.PrivacyState.PROTECTED
        self.media.public_visible = True
        self.media.save(update_fields=["file", "mime_type", "privacy_state", "public_visible"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")
        body = b"".join(response.streaming_content)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertTrue(body.startswith(b"\xff\xd8"))
        self.assertNotIn(b"secret-evidence.pdf", body)
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
        with patch("apps.concerns.tasks.process_concern_ai_task.delay") as enqueue:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    "/api/concerns/",
                    {
                        "title": "Broken streetlight",
                        "description": "Madilim sa kanto at delikado para sa mga dumadaan.",
                        "category": "infrastructure",
                        "visibility": "community",
                        "address": "Bayan-Bayanan St.",
                        "latitude": "14.6515000",
                        "longitude": "121.1207000",
                        "location_source": "manual_pin",
                        "location_accuracy": 12.5,
                        "media": png_upload("streetlight.png"),
                    },
                    format="multipart",
                )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        concern = Concern.objects.get(pk=response.data["id"])
        self.assertEqual(concern.reporter, self.resident)
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)
        self.assertEqual(str(concern.latitude), "14.6515000")
        self.assertEqual(str(concern.longitude), "121.1207000")
        self.assertEqual(concern.location_source, "manual_pin")
        self.assertEqual(concern.location_accuracy, 12.5)
        self.assertEqual(concern.status_events.count(), 1)
        self.assertEqual(concern.status_events.get().status, Concern.Status.SUBMITTED)
        self.assertEqual(concern.ai_assessment.status, ConcernAiAssessment.Status.PENDING)
        self.assertEqual(response.data["ai_assessment"]["status"], ConcernAiAssessment.Status.PENDING)
        self.assertRegex(response.data["tracking_id"], r"^RPT-\d{4}-\d{6}$")
        self.assertEqual(response.data["validation_status"], "pending")
        enqueue.assert_called_once_with(concern.pk)

    def test_unverified_account_cannot_access_resident_dashboard_apis(self):
        pending = get_user_model().objects.create_user(
            email="pending-dashboard@example.com",
            phone_number="+639100000109",
            password="pass",
            status=get_user_model().Status.PENDING_VERIFICATION,
        )
        self.client.force_authenticate(pending)

        response = self.client.get("/api/concerns/summary/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_report_creation_is_idempotent_and_uuid_detail_is_stable(self):
        client_request_id = uuid.uuid4()

        def payload():
            return {
                "client_request_id": str(client_request_id),
                "title": "Idempotent drainage report",
                "description": "Standing water is blocking the pedestrian lane after rain.",
                "category": "infrastructure",
                "visibility": "community",
                "address": "Marikina Heights",
                "latitude": "14.6515000",
                "longitude": "121.1207000",
                "location_source": "manual_pin",
                "media": png_upload("drainage.png"),
            }

        first = self.client.post("/api/concerns/", payload(), format="multipart")
        second = self.client.post("/api/concerns/", payload(), format="multipart")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data["public_id"], second.data["public_id"])
        self.assertEqual(Concern.objects.filter(reporter=self.resident, client_request_id=client_request_id).count(), 1)

        detail = self.client.get(f"/api/concerns/{first.data['public_id']}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["tracking_id"], first.data["tracking_id"])

    def test_feed_reporter_does_not_expose_private_identity_or_location_fields(self):
        ResidentProfile.objects.create(
            user=self.other,
            first_name="Private",
            last_name="Resident",
            date_of_birth="1990-01-01",
            address="123 Exact Home Street, Marikina Heights",
            barangay="Marikina Heights",
        )
        concern = Concern.objects.create(
            reporter=self.other,
            title="Privacy-safe community report",
            description="A community report that should use a privacy-safe public actor.",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            address="123 Exact Home Street",
            barangay="Marikina Heights",
            latitude="14.6515000",
            longitude="121.1207000",
        )
        media_file = png_upload("public-evidence.png")
        ConcernMedia.objects.create(
            concern=concern,
            file=media_file,
            original_filename="public-evidence.png",
            mime_type="image/png",
            file_size=media_file.size,
        )

        response = self.client.get("/api/concerns/feed/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_item = next(item for item in response.data if item["id"] == concern.pk)
        reporter = public_item["reporter"]
        for private_field in ("email", "phone_number", "date_of_birth", "gender", "current_latitude", "current_longitude"):
            self.assertNotIn(private_field, reporter)
        self.assertEqual(reporter["street"], "")
        self.assertEqual(public_item["address"], "Marikina Heights")
        self.assertIsNone(public_item["latitude"])
        self.assertIsNone(public_item["longitude"])
        self.assertTrue(public_item["media"][0]["preview_url"])
        self.assertEqual(public_item["media"][0]["raw_url"], "")

        public_detail = self.client.get(f"/api/concerns/{concern.public_id}/")
        self.assertEqual(public_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(public_detail.data["address"], "Marikina Heights")
        self.assertIsNone(public_detail.data["latitude"])
        self.assertEqual(public_detail.data["reporter"]["street"], "")
        self.assertEqual(public_detail.data["media"][0]["raw_url"], "")

        self.client.force_authenticate(self.other)
        owner_detail = self.client.get(f"/api/concerns/{concern.public_id}/")
        self.assertEqual(owner_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(owner_detail.data["address"], "123 Exact Home Street")
        self.assertEqual(owner_detail.data["latitude"], "14.6515000")
        self.assertTrue(owner_detail.data["media"][0]["raw_url"])

    def test_non_resident_roles_cannot_create_report(self):
        User = get_user_model()
        for role in [User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER]:
            user = User.objects.create_user(
                email=f"{role}-cannot-create-concern@example.com",
                phone_number=f"+63910{len(role):07d}",
                password="pass",
                role=role,
                status=User.Status.VERIFIED,
            )
            self.client.force_authenticate(user)
            response = self.client.post(
                "/api/concerns/",
                {
                    "title": "Should not create",
                    "description": "Staff direct API attempt.",
                    "category": "infrastructure",
                    "visibility": "community",
                },
                format="json",
            )

            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.assertFalse(Concern.objects.filter(title="Should not create").exists())

    @override_settings(OLLAMA_API_KEY="")
    def test_ai_command_marks_pending_assessment_not_configured(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="AI pending",
            description="Basura sa kanto.",
            category=Concern.Category.ENVIRONMENT,
        )
        ConcernAiAssessment.objects.create(concern=concern, status=ConcernAiAssessment.Status.PENDING)

        output = StringIO()
        call_command("process_concern_ai", "--pending", stdout=output)

        concern.ai_assessment.refresh_from_db()
        self.assertEqual(concern.ai_assessment.status, ConcernAiAssessment.Status.NOT_CONFIGURED)
        self.assertIn("Concern", output.getvalue())
        self.assertIn("routing", concern.ai_assessment.recommendation.lower())

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_concern_ai_task_runs_base_text_assessment_without_external_model(self):
        from apps.concerns.tasks import process_concern_ai_task

        concern = Concern.objects.create(
            reporter=self.resident,
            title="Tambak na basura sa kanto",
            description="Maraming garbage at basura malapit sa covered court.",
            category=Concern.Category.ENVIRONMENT,
        )
        ConcernAiAssessment.objects.create(concern=concern, status=ConcernAiAssessment.Status.PENDING)

        fake_result = TextClassificationResult(
            label="related_environment",
            confidence=0.88,
            category=Concern.Category.ENVIRONMENT,
            severity="medium",
            model_version="gemma4:cloud",
            details={"relevance": "VALID"},
        )
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = fake_result
            task_result = process_concern_ai_task.apply(args=[concern.pk]).get()

        concern.ai_assessment.refresh_from_db()
        self.assertEqual(task_result["concern_id"], concern.pk)
        self.assertEqual(concern.ai_assessment.nlp_validity, "related_environment")
        self.assertEqual(concern.ai_assessment.raw_result["review"]["model_version"], "gemma4:cloud")
        self.assertEqual(concern.ai_assessment.status, ConcernAiAssessment.Status.COMPLETED)

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ai_pipeline_stores_completed_assessment(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Broken drainage",
            description="Baradong kanal sa gilid ng kalsada.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        fake_result = TextClassificationResult(
            label="related_infrastructure",
            confidence=0.9,
            category=Concern.Category.INFRASTRUCTURE,
            severity="medium",
            model_version="gemma4:cloud",
            details={"relevance": "VALID"},
        )
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = fake_result

            assessment = process_concern_ai(concern.id)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertEqual(assessment.nlp_validity, "related_infrastructure")
        self.assertTrue(assessment.category_match)
        self.assertEqual(assessment.model_version, "gemma:gemma4:cloud")

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ai_pipeline_completes_a_text_only_report(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Tambak na basura",
            description="Maraming garbage at basura sa tabi ng kalsada.",
            category=Concern.Category.ENVIRONMENT,
        )

        fake_result = TextClassificationResult(
            label="related_environment",
            confidence=0.87,
            category=Concern.Category.ENVIRONMENT,
            severity="medium",
            model_version="gemma4:cloud",
            details={"relevance": "VALID"},
        )
        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = fake_result
            assessment = process_concern_ai(concern.id)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertEqual(assessment.nlp_validity, "related_environment")
        # No photo, so "the image review failed" must not be claimed either.
        self.assertIsNone(assessment.image_review_succeeded)
        self.assertEqual(assessment.evidence_relationship, "image_unavailable")

    @override_settings(OLLAMA_API_KEY="")
    def test_ai_pipeline_without_an_api_key_is_not_configured_not_failed(self):
        """No key is "switched off", not "broken" — and the report still stands."""
        concern = Concern.objects.create(
            reporter=self.resident,
            title="AI unavailable",
            description="May malaking lubak sa kalsada malapit sa barangay hall.",
            category=Concern.Category.OTHERS,
        )

        assessment = process_concern_ai(concern.id)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.NOT_CONFIGURED)
        self.assertEqual(assessment.recommended_action, "accept")
        concern.refresh_from_db()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    def test_duplicate_concern_media_is_rejected_without_creating_report(self):
        response = self.client.post(
            "/api/concerns/",
            {
                "title": "Duplicate evidence",
                "description": "The same file was attached twice.",
                "category": "infrastructure",
                "visibility": "community",
                "address": "Bayan-Bayanan St.",
                "latitude": "14.6515000",
                "longitude": "121.1207000",
                "location_source": "manual_pin",
                "media": [
                    png_upload("first.png"),
                    png_upload("second.png"),
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("duplicate media upload detected", response.data["media"][0])
        self.assertFalse(Concern.objects.filter(title="Duplicate evidence").exists())

    def test_concern_media_hash_is_stored(self):
        response = self.client.post(
            "/api/concerns/",
            {
                "title": "Media hash",
                "description": "Evidence should be fingerprinted.",
                "category": "infrastructure",
                "visibility": "community",
                "address": "Bayan-Bayanan St.",
                "latitude": "14.6515000",
                "longitude": "121.1207000",
                "location_source": "manual_pin",
                "media": png_upload("hash.png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        media = Concern.objects.get(pk=response.data["id"]).media.get()
        self.assertEqual(len(media.sha256_hash), 64)

    def test_report_location_outside_barangay_boundary_is_rejected(self):
        response = self.client.post(
            "/api/concerns/",
            {
                "title": "Outside boundary",
                "description": "Location is outside the barangay.",
                "category": "infrastructure",
                "visibility": "community",
                "address": "Outside Marikina Heights",
                "latitude": "14.9000000",
                "longitude": "121.5000000",
                "location_source": "manual_pin",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Location must be inside Barangay Marikina Heights", str(response.data))
        self.assertFalse(Concern.objects.filter(title="Outside boundary").exists())

    def test_location_outside_active_polygon_uses_real_boundary_distance(self):
        boundary = {
            "type": "Polygon",
            "coordinates": [[
                [121.1000, 14.6400],
                [121.1300, 14.6400],
                [121.1300, 14.6600],
                [121.1000, 14.6600],
                [121.1000, 14.6400],
            ]],
        }
        with patch("apps.geo_services.get_active_boundary_geometry", return_value=boundary):
            result = classify_location(14.6605, 121.1150)

        self.assertEqual(result["status"], "edge")
        self.assertTrue(result["accepted"])
        self.assertGreater(result["distance_meters"], 0)
        self.assertLess(result["distance_meters"], 280)

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
            status=Concern.Status.UNDER_REVIEW,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        feed_response = self.client.get("/api/concerns/feed/")
        self.assertEqual(feed_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["title"] for item in feed_response.data], ["Public concern"])

        self.client.force_authenticate(self.other)
        detail_response = self.client.get(f"/api/concerns/{private.pk}/")
        self.assertEqual(detail_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_feed_only_shows_validated_community_concerns_and_masks_location(self):
        pending = Concern.objects.create(
            reporter=self.other,
            title="Pending community concern",
            status=Concern.Status.SUBMITTED,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.PENDING,
            address="Exact House 123",
            latitude="14.6500000",
            longitude="121.1100000",
            location_source="manual_pin",
            location_accuracy=5,
            barangay="Marikina Heights",
        )
        accepted = Concern.objects.create(
            reporter=self.other,
            title="Validated community concern",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            address="Exact House 456",
            latitude="14.6600000",
            longitude="121.1200000",
            location_source="manual_pin",
            location_accuracy=3,
            barangay="Marikina Heights",
        )

        response = self.client.get("/api/concerns/feed/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [accepted.pk])
        self.assertNotIn(pending.pk, [item["id"] for item in response.data])
        self.assertEqual(response.data[0]["address"], "Marikina Heights")
        self.assertIsNone(response.data[0]["latitude"])
        self.assertIsNone(response.data[0]["longitude"])
        self.assertEqual(response.data[0]["location_source"], "")
        self.assertIsNone(response.data[0]["location_accuracy"])

    def test_feed_search_filters_validated_concerns(self):
        Concern.objects.create(
            reporter=self.other,
            title="Clogged drainage",
            description="Water is building up after rain.",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        Concern.objects.create(
            reporter=self.other,
            title="Streetlight repair",
            description="Lamp post is dark.",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        response = self.client.get("/api/concerns/feed/?search=drainage")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["title"] for item in response.data], ["Clogged drainage"])

    def test_feed_orders_by_priority_score(self):
        quiet = Concern.objects.create(
            reporter=self.other,
            title="Quiet concern",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        supported = Concern.objects.create(
            reporter=self.other,
            title="Supported concern",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        ConcernVote.objects.create(concern=supported, user=self.resident, value=1)
        ConcernComment.objects.create(concern=supported, author=self.resident, body="I saw this too.")

        response = self.client.get("/api/concerns/feed/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [supported.pk, quiet.pk])
        self.assertGreater(response.data[0]["priority_score"], response.data[1]["priority_score"])

    def test_upvote_is_persistent_and_unique_per_user(self):
        concern = Concern.objects.create(
            reporter=self.other,
            title="Community concern",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
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
            validation_status=Concern.ValidationStatus.ACCEPTED,
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

    def test_comment_mentions_and_replies_notify_each_participant_once(self):
        User = get_user_model()
        mentioned = User.objects.create_user(
            email="mentioned-neighbor@example.com",
            phone_number="+639100000119",
            password="pass",
            status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=self.other,
            title="Community mention workflow",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        comment_response = self.client.post(
            f"/api/concerns/{concern.pk}/comments/",
            {"body": f"@[Neighbor](u:{mentioned.pk}) please check this area."},
            format="json",
        )

        self.assertEqual(comment_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            Notification.objects.filter(
                recipient=mentioned,
                concern=concern,
                type=Notification.Type.CONCERN_MENTION,
            ).count(),
            1,
        )
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.other,
                concern=concern,
                type=Notification.Type.CONCERN_COMMENT,
            ).count(),
            1,
        )

        self.client.force_authenticate(self.other)
        reply_response = self.client.post(
            f"/api/concerns/{concern.pk}/comments/",
            {"body": "Thanks, I will add an update.", "parent": comment_response.data["id"]},
            format="json",
        )

        self.assertEqual(reply_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.resident,
                concern=concern,
                type=Notification.Type.CONCERN_COMMENT,
            ).count(),
            1,
        )

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
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
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
        self.assertNotIn("current_latitude", responders.data[0])
        official = User.objects.create_user(
            email="responder-location-official@example.com",
            phone_number="+639100000116",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(official)
        official_response = self.client.get("/api/responders/active/")
        self.assertEqual(official_response.data[0]["current_latitude"], "14.6516000")
        self.assertEqual(official_response.data[0]["current_longitude"], "121.1208000")

    def test_barangay_official_can_update_report_status_and_timeline(self):
        User = get_user_model()
        official = User.objects.create_user(
            email="official-status@example.com",
            phone_number="+639100000105",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Needs status update",
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            update_text="Submitted for barangay review.",
        )
        self.client.force_authenticate(official)

        assigned_response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.ASSIGNED,
                "note": "Assigned to maintenance team.",
            },
            format="json",
        )
        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.IN_PROGRESS,
                "note": "Maintenance work has started.",
                "status_version": assigned_response.data["status_version"],
            },
            format="json",
        )

        self.assertEqual(assigned_response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["validation_status"], "accepted")
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.IN_PROGRESS)
        self.assertEqual(concern.update_text, "Maintenance work has started.")
        event = concern.status_events.latest("id")
        self.assertEqual(event.status, Concern.Status.IN_PROGRESS)
        self.assertEqual(event.note, "Maintenance work has started.")
        self.assertEqual(event.actor, official)

    def test_status_update_creates_exactly_one_notification_for_reporter(self):
        User = get_user_model()
        official = User.objects.create_user(
            email="official-status-dedupe@example.com",
            phone_number="+639100000106",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Needs a single notification",
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            update_text="Submitted for barangay review.",
        )
        self.client.force_authenticate(official)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.UNDER_REVIEW,
                "note": "Official review has started.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(concern.status_events.count(), 1)
        self.assertEqual(
            Notification.objects.filter(
                recipient=self.resident,
                concern=concern,
                type=Notification.Type.UNDER_REVIEW,
            ).count(),
            1,
        )

    def test_barangay_official_can_move_submitted_report_to_under_review(self):
        User = get_user_model()
        official = User.objects.create_user(
            email='official-under-review@example.com',
            phone_number='+639100000117',
            password='pass',
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=self.resident,
            title='Needs official review',
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        self.client.force_authenticate(official)

        response = self.client.post(
            f'/api/concerns/{concern.pk}/status/',
            {'status': Concern.Status.UNDER_REVIEW, 'note': 'Official review has started.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.UNDER_REVIEW)
        self.assertEqual(concern.update_text, 'Official review has started.')

    def test_pending_validation_cannot_move_to_operational_status(self):
        User = get_user_model()
        official = User.objects.create_user(
            email="official-pending-status@example.com",
            phone_number="+639100000115",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Still validating",
            validation_status=Concern.ValidationStatus.PENDING,
        )
        self.client.force_authenticate(official)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {"status": Concern.Status.ASSIGNED, "note": "Assign now."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)

    def test_barangay_official_can_view_report_management_queue(self):
        User = get_user_model()
        official = User.objects.create_user(
            email="official-queue@example.com",
            phone_number="+639100000106",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        first = Concern.objects.create(
            reporter=self.resident,
            title="Queue drainage",
            category=Concern.Category.INFRASTRUCTURE,
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        Concern.objects.create(
            reporter=self.resident,
            title="Queue garbage",
            category=Concern.Category.ENVIRONMENT,
            status=Concern.Status.RESOLVED,
        )
        self.client.force_authenticate(official)

        response = self.client.get("/api/concerns/manage/?status=active&q=drainage")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [first.pk])

    def test_resident_cannot_view_report_management_queue(self):
        response = self.client.get("/api/concerns/manage/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_resident_cannot_update_report_status(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Resident cannot update status",
            status=Concern.Status.SUBMITTED,
        )

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.RESOLVED,
                "note": "Trying to self-resolve.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)

class PhaseOneFoundationAPITests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="phase1-resident@example.com",
            phone_number="+639100000201",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="phase1-official@example.com",
            phone_number="+639100000202",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.responder = User.objects.create_user(
            email="phase1-responder@example.com",
            phone_number="+639100000203",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.TANOD,
            is_on_duty=True,
        )

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ai_pipeline_sends_the_stored_photo_to_gemma_and_records_what_it_saw(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Broken traffic light",
            description="The traffic light is not working on the main road.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        media = png_upload("traffic-light.png")
        ConcernMedia.objects.create(
            concern=concern,
            file=media,
            original_filename=media.name,
            mime_type="image/png",
            file_size=media.size,
        )

        def analyze(*, title, description, selected_category, image):
            # The photo must reach Gemma normalised, not as raw upload bytes.
            self.assertIsNotNone(image)
            self.assertEqual(image.mime_type, "image/jpeg")
            return gemma_result(
                category=Concern.Category.INFRASTRUCTURE,
                detected_objects=["traffic light", "road"],
                evidence_relationship="supports_report",
                image_review_succeeded=True,
            )

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.side_effect = analyze
            assessment = process_concern_ai(concern.pk)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertEqual(assessment.detected_objects, ["traffic light", "road"])
        self.assertTrue(assessment.image_review_succeeded)
        self.assertEqual(assessment.evidence_relationship, "supports_report")

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_text_only_report_records_no_photo_rather_than_a_failed_one(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Broken streetlight",
            description="The streetlight is broken and the road is dark at night.",
            category=Concern.Category.INFRASTRUCTURE,
        )

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.INFRASTRUCTURE,
            )
            assessment = process_concern_ai(concern.pk)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertIsNone(assessment.image_review_succeeded)
        self.assertEqual(assessment.evidence_relationship, "image_unavailable")
        self.assertEqual(assessment.raw_result["photo"]["image_uploaded"], False)
        self.assertFalse(assessment.raw_result["photo"]["sam3_triggered"])

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ai_pipeline_flags_similar_nearby_report_using_published_threshold(self):
        existing = Concern.objects.create(
            reporter=self.resident,
            title="Garbage beside Sampaguita covered court",
            description="Maraming nakatambak na basura sa Sampaguita Street beside the covered court.",
            category=Concern.Category.ENVIRONMENT,
            barangay="Marikina Heights",
            latitude="14.6500000",
            longitude="121.1100000",
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Garbage beside Sampaguita covered court",
            description="Maraming nakatambak na basura sa Sampaguita Street beside the covered court.",
            category=Concern.Category.ENVIRONMENT,
            barangay="Marikina Heights",
            latitude="14.6503000",
            longitude="121.1102000",
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        config = ConcernClassificationConfiguration.current()
        config.duplicate_detection_enabled = True
        config.duplicate_threshold = 0.85
        config.save(update_fields=["duplicate_detection_enabled", "duplicate_threshold"])

        assessment = process_concern_ai(concern.pk)

        duplicate = assessment.raw_result["duplicate"]
        self.assertTrue(duplicate["possible_duplicate"])
        self.assertEqual(duplicate["matched_concern_id"], existing.pk)
        self.assertGreaterEqual(duplicate["similarity"], 0.85)
        self.assertLess(duplicate["distance_meters"], 100)
        self.assertIn("Possible duplicate", assessment.recommendation)

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_duplicate_match_identity_is_visible_to_official_but_hidden_from_resident(self):
        matched = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drainage on Rainbow Street",
            description="The drainage on Rainbow Street is blocked and overflowing.",
            category=Concern.Category.INFRASTRUCTURE,
            latitude="14.6500000",
            longitude="121.1100000",
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drainage on Rainbow Street",
            description="The drainage on Rainbow Street is blocked and overflowing.",
            category=Concern.Category.INFRASTRUCTURE,
            latitude="14.6501000",
            longitude="121.1101000",
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        process_concern_ai(concern.pk)

        self.client.force_authenticate(self.resident)
        resident_response = self.client.get(f"/api/concerns/{concern.pk}/")
        self.client.force_authenticate(self.official)
        official_response = self.client.get(f"/api/concerns/{concern.pk}/")

        self.assertEqual(resident_response.status_code, status.HTTP_200_OK)
        self.assertTrue(resident_response.data["ai_assessment"]["possible_duplicate"])
        self.assertIsNone(resident_response.data["ai_assessment"]["duplicate_match"])
        self.assertEqual(official_response.status_code, status.HTTP_200_OK)
        self.assertEqual(official_response.data["ai_assessment"]["duplicate_match"]["id"], matched.pk)
        self.assertEqual(
            official_response.data["ai_assessment"]["duplicate_match"]["tracking_id"],
            matched.tracking_id,
        )

    def test_manual_ai_review_endpoint_is_removed(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="AI review target",
            description="A report that requires an official AI decision.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        self.client.force_authenticate(self.official)
        response = self.client.post(
            f"/api/concerns/{concern.pk}/ai-review/",
            {"decision": "related", "reason": "This endpoint no longer exists."},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ai_pipeline_category_mismatch_is_applied_automatically(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drainage report",
            description="Maraming basura at trash sa kanal, tambak na garbage malapit sa amin.",
            category=Concern.Category.INFRASTRUCTURE,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.SUBMITTED,
        )

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.ENVIRONMENT,
                selected_category_match=False,
                recommended_action="accept",
            )
            assessment = process_concern_ai(concern.pk)

        self.assertFalse(assessment.category_match)
        self.assertTrue(assessment.flagged)
        reason_codes = {entry["reason"] for entry in assessment.flag_reasons}
        self.assertIn("category_mismatch", reason_codes)
        mismatch_entry = next(entry for entry in assessment.flag_reasons if entry["reason"] == "category_mismatch")
        self.assertEqual(mismatch_entry["configured_action"], ConcernClassificationConfiguration.current().mismatch_action)

        concern.refresh_from_db()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)
        self.assertEqual(concern.category, Concern.Category.ENVIRONMENT)
        self.assertEqual(concern.validation_summary, "Automated validation passed.")

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ai_pipeline_clean_run_is_not_flagged(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Baradong kanal sa kalsada",
            description="May baradong kanal at lubak sa aming kalsada, kailangan pong ayusin agad.",
            category=Concern.Category.INFRASTRUCTURE,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.INFRASTRUCTURE,
            )
            assessment = process_concern_ai(concern.pk)

        self.assertTrue(assessment.category_match)
        self.assertFalse(assessment.flagged)
        self.assertEqual(assessment.flag_reasons, [])
        concern.refresh_from_db()
        self.assertEqual(concern.validation_summary, "Automated validation passed.")
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_flagged_completion_does_not_create_ai_review_notifications(self):
        from apps.concerns.tasks import process_concern_ai_task

        concern = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drainage report",
            description="Maraming basura at trash sa kanal, tambak na garbage malapit sa amin.",
            category=Concern.Category.INFRASTRUCTURE,
        )

        with self.captureOnCommitCallbacks(execute=True):
            process_concern_ai_task.apply(args=[concern.pk]).get()

        concern.ai_assessment.refresh_from_db()
        self.assertTrue(concern.ai_assessment.flagged)
        notifications = Notification.objects.filter(
            type="concern_ai_flagged",
            recipient=self.official,
            concern=concern,
        )
        self.assertEqual(notifications.count(), 0)

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_managed_concern_list_ignores_removed_ai_filter(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drainage report",
            description="Maraming basura at trash sa kanal, tambak na garbage malapit sa amin.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        process_concern_ai(concern.pk)
        concern.ai_assessment.refresh_from_db()
        self.assertTrue(concern.ai_assessment.flagged)

        self.client.force_authenticate(self.official)
        response = self.client.get("/api/concerns/manage/?ai=flagged")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(concern.pk, [item["id"] for item in response.data])

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_ai_assessment_is_read_only_for_officials(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drainage report",
            description="Maraming basura at trash sa kanal, tambak na garbage malapit sa amin.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        process_concern_ai(concern.pk)
        concern.ai_assessment.refresh_from_db()
        self.assertTrue(concern.ai_assessment.flagged)
        original_reasons = concern.ai_assessment.flag_reasons

        self.client.force_authenticate(self.official)
        response = self.client.post(f"/api/concerns/{concern.pk}/ai-review/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        concern.ai_assessment.refresh_from_db()
        self.assertEqual(concern.ai_assessment.flag_reasons, original_reasons)

    def test_resident_account_request_and_sos_setting_are_persisted(self):
        self.client.force_authenticate(self.resident)

        settings_response = self.client.patch("/api/auth/settings/", {"sos_placement": "compact"}, format="json")
        request_response = self.client.post("/api/auth/account-requests/", {"type": "data_export", "note": "Need my copy."}, format="json")
        list_response = self.client.get("/api/auth/account-requests/")

        self.assertEqual(settings_response.status_code, status.HTTP_200_OK)
        self.assertEqual(settings_response.data["sos_placement"], "compact")
        self.assertEqual(request_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(list_response.data[0]["type"], "data_export")
        # A self-service data export completes immediately (no official needed);
        # deletions still go to a human reviewer.
        account_request = AccountRequest.objects.get(user=self.resident)
        self.assertEqual(account_request.status, AccountRequest.Status.COMPLETED)
        self.assertEqual(account_request.staff_note, "Completed automatically: resident self-service export.")

    def test_content_flag_can_be_submitted_and_listed_by_official_only(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Public concern",
            visibility=Concern.Visibility.COMMUNITY,
            status=Concern.Status.UNDER_REVIEW,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.resident)

        create_response = self.client.post(f"/api/concerns/{concern.pk}/flags/", {"reason": "false_info", "note": "Looks fake."}, format="json")
        resident_list_response = self.client.get("/api/concerns/flags/")
        self.client.force_authenticate(self.official)
        official_list_response = self.client.get("/api/concerns/flags/")

        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ContentFlag.objects.get(concern=concern).reason, ContentFlag.Reason.FALSE_INFO)
        self.assertEqual(resident_list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(official_list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(official_list_response.data[0]["reason"], ContentFlag.Reason.FALSE_INFO)

    def test_role_dashboard_summaries_return_real_counts(self):
        Concern.objects.create(
            reporter=self.resident,
            title="Pending",
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        Concern.objects.create(reporter=self.resident, title="Appeal", status=Concern.Status.APPEALED)
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type=EmergencyAlert.Type.CRIME,
            latitude="14.6500000",
            longitude="121.1100000",
            status=EmergencyAlert.Status.ROUTED,
        )
        EmergencyResponderAssignment.objects.create(alert=alert, responder=self.responder)
        Notification.objects.create(recipient=self.resident, type=Notification.Type.SUBMITTED, title="Report update")
        AccountRequest.objects.create(user=self.resident, type=AccountRequest.Type.DELETION)

        self.client.force_authenticate(self.resident)
        resident_response = self.client.get("/api/dashboard/resident/summary/")
        official_denied = self.client.get("/api/dashboard/official/summary/")
        self.client.force_authenticate(self.official)
        official_response = self.client.get("/api/dashboard/official/summary/")
        self.client.force_authenticate(self.responder)
        responder_response = self.client.get("/api/dashboard/responder/summary/")

        self.assertEqual(resident_response.status_code, status.HTTP_200_OK)
        self.assertEqual(resident_response.data["reports_active"], 2)
        self.assertEqual(resident_response.data["active_emergencies"], 1)
        self.assertEqual(resident_response.data["barangay_active_emergencies"], 1)
        self.assertTrue(resident_response.data["has_ongoing_emergencies"])
        self.assertEqual(resident_response.data["unread_notifications"], 1)
        self.assertEqual(resident_response.data["open_account_requests"], 1)
        self.assertEqual(official_denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(official_response.data["new_concerns"], 1)
        self.assertEqual(official_response.data["active_emergencies"], 1)
        self.assertEqual(official_response.data["responders_on_duty"], 1)
        self.assertEqual(responder_response.data["assigned_active_emergencies"], 1)
        self.assertEqual(responder_response.data["is_on_duty"], True)

    def test_official_can_manage_announcements_and_events(self):
        self.client.force_authenticate(self.resident)
        denied = self.client.post("/api/announcements/manage/", {"title": "Nope", "body": "Denied"}, format="json")
        self.client.force_authenticate(self.official)

        announcement_response = self.client.post(
            "/api/announcements/manage/",
            {"title": "Cleanup Drive", "body": "Join the barangay cleanup.", "is_published": True},
            format="json",
        )
        event_response = self.client.post(
            "/api/barangay-events/manage/",
            {
                "title": "Health Check",
                "detail": "BP and glucose checks.",
                "starts_at": timezone.now().isoformat(),
                "is_published": True,
            },
            format="json",
        )
        public_response = self.client.get("/api/announcements/")

        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(announcement_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(event_response.status_code, status.HTTP_201_CREATED)
        self.assertIsNotNone(announcement_response.data["published_at"])
        self.assertEqual(public_response.data[0]["title"], "Cleanup Drive")
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.resident,
                type=Notification.Type.ANNOUNCEMENT,
                title="Cleanup Drive",
            ).exists()
        )

    def test_official_can_assign_request_clarification_and_add_remark(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Needs workflow",
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.official)

        assign_response = self.client.post(
            f"/api/concerns/{concern.pk}/assign/",
            {"assignee_id": self.responder.pk, "office": "Tanod Desk", "note": "Assigned for field validation."},
            format="json",
        )
        clarify_response = self.client.post(
            f"/api/concerns/{concern.pk}/clarifications/",
            {"request_text": "Please add nearest landmark."},
            format="json",
        )
        remark_response = self.client.post(
            f"/api/concerns/{concern.pk}/remarks/",
            {"body": "Resident-visible note.", "visible_to_resident": True},
            format="json",
        )

        self.assertEqual(assign_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(clarify_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(remark_response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(ConcernAssignment.objects.filter(concern=concern, assignee=self.responder).exists())
        self.assertTrue(ConcernClarification.objects.filter(concern=concern, status=ConcernClarification.Status.OPEN).exists())
        self.assertTrue(ConcernOfficialRemark.objects.filter(concern=concern, visible_to_resident=True).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.resident, type=Notification.Type.CLARIFICATION_REQUESTED).exists())

        self.client.force_authenticate(self.resident)
        clarification = ConcernClarification.objects.get(concern=concern)
        reply_response = self.client.post(
            f"/api/concerns/{concern.pk}/clarifications/{clarification.pk}/reply/",
            {"response_text": "Near the chapel."},
            format="json",
        )

        self.assertEqual(reply_response.status_code, status.HTTP_200_OK)
        clarification.refresh_from_db()
        self.assertEqual(clarification.status, ConcernClarification.Status.ANSWERED)
        self.assertTrue(Notification.objects.filter(recipient=self.official, type=Notification.Type.CLARIFICATION_REPLIED).exists())

    def test_assigned_responder_can_list_open_chat_and_view_private_concern_media(self):
        User = get_user_model()
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Private field inspection",
            description="A private concern assigned for responder field inspection.",
            visibility=Concern.Visibility.PRIVATE,
            status=Concern.Status.ASSIGNED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        assignment = ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            assigned_by=self.official,
            note="Inspect the reported location.",
        )
        upload = png_upload("private-assignment.png")
        media = ConcernMedia.objects.create(
            concern=concern,
            file=upload,
            original_filename=upload.name,
            mime_type="image/png",
            file_size=upload.size,
        )
        self.client.force_authenticate(self.responder)

        assigned = self.client.get("/api/concerns/assigned/")
        detail = self.client.get(f"/api/concerns/{concern.pk}/")
        chat = self.client.post(
            f"/api/concerns/{concern.pk}/chat/",
            {"body": "I am checking the reported location now."},
            format="json",
        )
        evidence = self.client.get(f"/api/concerns/media/{media.pk}/raw/")

        self.assertEqual(assigned.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in assigned.data], [concern.pk])
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(chat.status_code, status.HTTP_201_CREATED)
        self.assertEqual(evidence.status_code, status.HTTP_200_OK)

        unrelated = User.objects.create_user(
            email="unassigned-responder@example.com",
            phone_number="+639100000205",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(unrelated)
        denied_detail = self.client.get(f"/api/concerns/{concern.pk}/")
        denied_chat = self.client.post(
            f"/api/concerns/{concern.pk}/chat/",
            {"body": "I should not enter this thread."},
            format="json",
        )
        self.assertEqual(denied_detail.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(denied_chat.status_code, status.HTTP_403_FORBIDDEN)

        assignment.status = ConcernAssignment.Status.CANCELLED
        assignment.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.responder)
        removed = self.client.get("/api/concerns/assigned/")
        self.assertEqual(removed.status_code, status.HTTP_200_OK)
        self.assertEqual(removed.data, [])

    def test_official_reassignment_revokes_old_responder_and_activates_new_responder(self):
        User = get_user_model()
        second_responder = User.objects.create_user(
            email="phase1-second-responder@example.com",
            phone_number="+639100000206",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Reassign field concern",
            description="This accepted concern needs a different field responder.",
            visibility=Concern.Visibility.PRIVATE,
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.official)

        first = self.client.post(
            f"/api/concerns/{concern.pk}/assign/",
            {
                "assignee_id": self.responder.pk,
                "office": "Field Team A",
                "note": "Initial field inspection assignment.",
            },
            format="json",
        )
        second = self.client.post(
            f"/api/concerns/{concern.pk}/assign/",
            {
                "assignee_id": second_responder.pk,
                "office": "Field Team B",
                "note": "Reassigned because Team B is available nearby.",
            },
            format="json",
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        first_assignment = ConcernAssignment.objects.get(pk=first.data["id"])
        second_assignment = ConcernAssignment.objects.get(pk=second.data["id"])
        self.assertEqual(first_assignment.status, ConcernAssignment.Status.CANCELLED)
        self.assertEqual(second_assignment.status, ConcernAssignment.Status.ACTIVE)
        self.assertEqual(
            ConcernAssignment.objects.filter(
                concern=concern,
                status=ConcernAssignment.Status.ACTIVE,
            ).count(),
            1,
        )

        self.client.force_authenticate(self.responder)
        old_access = self.client.get(f"/api/concerns/{concern.pk}/")
        self.assertEqual(old_access.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(second_responder)
        new_access = self.client.get(f"/api/concerns/{concern.pk}/")
        assigned_list = self.client.get("/api/concerns/assigned/")
        self.assertEqual(new_access.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in assigned_list.data], [concern.pk])
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.responder,
                concern=concern,
                title="Concern assignment changed",
            ).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                recipient=second_responder,
                concern=concern,
                title="Concern report assigned",
            ).exists()
        )

    def test_resolution_requires_evidence_persists_it_and_protects_access(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Blocked drainage resolved",
            description="The drainage beside the road was blocked by accumulated waste.",
            visibility=Concern.Visibility.PRIVATE,
            status=Concern.Status.IN_PROGRESS,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        assignment = ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            assigned_by=self.official,
            note="Complete the drainage clearing.",
        )
        self.client.force_authenticate(self.official)

        missing_evidence = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.RESOLVED,
                "note": "Drainage clearing was completed today.",
                "status_version": concern.status_version,
            },
            format="json",
        )
        self.assertEqual(missing_evidence.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("resolution_evidence", missing_evidence.data)

        resolved = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.RESOLVED,
                "note": "Drainage clearing was completed today.",
                "status_version": concern.status_version,
                "resolution_evidence": png_upload("completed-drainage.png"),
            },
            format="multipart",
        )

        self.assertEqual(resolved.status_code, status.HTTP_200_OK)
        self.assertEqual(resolved.data["status"], Concern.Status.RESOLVED)
        self.assertEqual(len(resolved.data["resolution_evidence"]), 1)
        evidence = ConcernResolutionEvidence.objects.get(concern=concern)
        self.assertEqual(evidence.uploaded_by, self.official)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, ConcernAssignment.Status.COMPLETED)
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.resident,
                concern=concern,
                type=Notification.Type.RESOLVED,
            ).exists()
        )

        self.client.force_authenticate(self.resident)
        owner_access = self.client.get(f"/api/concerns/resolution-evidence/{evidence.pk}/raw/")
        self.assertEqual(owner_access.status_code, status.HTTP_200_OK)

        intruder = get_user_model().objects.create_user(
            email="phase1-intruder@example.com",
            phone_number="+639100000204",
            password="pass",
            status=get_user_model().Status.VERIFIED,
        )
        self.client.force_authenticate(intruder)
        denied = self.client.get(f"/api/concerns/resolution-evidence/{evidence.pk}/raw/")
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.responder)
        responder_access_after_completion = self.client.get(f"/api/concerns/{concern.pk}/")
        self.assertEqual(responder_access_after_completion.status_code, status.HTTP_403_FORBIDDEN)

    def test_resident_can_appeal_and_official_can_review(self):
        concern = Concern.objects.create(reporter=self.resident, title="Rejected report", status=Concern.Status.REJECTED)
        self.client.force_authenticate(self.resident)

        appeal_response = self.client.post(
            f"/api/concerns/{concern.pk}/appeals/",
            {"reason": "I have more context and this is valid."},
            format="json",
        )

        self.assertEqual(appeal_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(appeal_response.data["concern_tracking_id"], concern.tracking_id)
        self.assertRegex(appeal_response.data["concern_tracking_id"], r"^RPT-\d{4}-\d{6}$")
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.APPEALED)
        appeal = ConcernAppeal.objects.get(concern=concern)
        self.assertEqual(appeal.status, ConcernAppeal.Status.SUBMITTED)
        self.assertTrue(Notification.objects.filter(recipient=self.official, type=Notification.Type.APPEAL_SUBMITTED).exists())

        self.client.force_authenticate(self.official)
        list_response = self.client.get("/api/concerns/appeals/?status=submitted")
        review_response = self.client.post(
            f"/api/concerns/appeals/{appeal.pk}/review/",
            {"status": ConcernAppeal.Status.APPROVED, "decision_note": "Reopened for review."},
            format="json",
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data[0]["id"], appeal.pk)
        self.assertEqual(review_response.status_code, status.HTTP_200_OK)
        concern.refresh_from_db()
        appeal.refresh_from_db()
        self.assertEqual(appeal.status, ConcernAppeal.Status.APPROVED)
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)
        self.assertTrue(Notification.objects.filter(recipient=self.resident, type=Notification.Type.APPEAL_APPROVED).exists())
        # Approving an appeal reopens the concern to `submitted`, but the reporter should
        # receive exactly one `appeal_approved` notification for this action -- not a second,
        # generic status-change notification. (That post_save signal was removed in Task 0.5;
        # notifications are now created explicitly per action.)
        resident_notifications = Notification.objects.filter(recipient=self.resident, concern=concern)
        self.assertEqual(resident_notifications.count(), 1)
        self.assertEqual(resident_notifications.get().type, Notification.Type.APPEAL_APPROVED)


class ConcernChatAttachmentAPITests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="chat-resident@example.com",
            phone_number="+639100000701",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.official = User.objects.create_user(
            email="chat-official@example.com",
            phone_number="+639100000702",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
            is_staff=True,
        )
        self.other = User.objects.create_user(
            email="chat-other@example.com",
            phone_number="+639100000703",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.concern = Concern.objects.create(
            reporter=self.resident,
            title="Chat attachment report",
            description="Follow-up evidence belongs in the private report chat.",
            status=Concern.Status.UNDER_REVIEW,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

    def test_resident_can_send_image_attachment_and_read_protected_media(self):
        self.client.force_authenticate(self.resident)
        response = self.client.post(
            f"/api/concerns/{self.concern.pk}/chat/",
            {"body": "Here is a clearer photo.", "media": png_upload("follow-up.png")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["attachment"]["kind"], "image")
        self.assertIn(response.data["attachment"]["authenticity_status"], {"clear", "flagged"})
        attachment = ConcernChatAttachment.objects.get(message_id=response.data["id"])
        media_response = self.client.get(f"/api/concerns/chat-media/{attachment.pk}/")
        self.assertEqual(media_response.status_code, status.HTTP_200_OK)
        self.assertEqual(media_response["Content-Type"], "image/png")

    def test_resident_video_attachment_uses_sampled_authenticity_result(self):
        video_upload = SimpleUploadedFile(
            "follow-up.mp4",
            b"\x00\x00\x00\x18ftypisom" + b"\x00" * 32,
            content_type="video/mp4",
        )
        sampled_result = {
            "status": "clear",
            "detail": "No obvious edit detected in 3 sampled video frames.",
            "sampled_frames": 3,
        }
        self.client.force_authenticate(self.resident)

        with patch(
            "apps.accounts.services.analyze_video_authenticity",
            create=True,
            return_value=sampled_result,
        ):
            response = self.client.post(
                f"/api/concerns/{self.concern.pk}/chat/",
                {"body": "Short incident clip.", "media": video_upload},
                format="multipart",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["attachment"]["kind"], "video")
        self.assertEqual(response.data["attachment"]["authenticity_status"], "clear")
        self.assertEqual(
            response.data["attachment"]["authenticity_detail"],
            sampled_result["detail"],
        )

    def test_unrelated_resident_cannot_read_chat_attachment(self):
        self.client.force_authenticate(self.resident)
        created = self.client.post(
            f"/api/concerns/{self.concern.pk}/chat/",
            {"media": png_upload("private.png")},
            format="multipart",
        )
        attachment = ConcernChatAttachment.objects.get(message_id=created.data["id"])

        self.client.force_authenticate(self.other)
        response = self.client.get(f"/api/concerns/chat-media/{attachment.pk}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class AssignedResponderStatusProgressionAPITests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="progress-resident@example.com",
            phone_number="+639100000801",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.responder = User.objects.create_user(
            email="progress-responder@example.com",
            phone_number="+639100000802",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        self.other_responder = User.objects.create_user(
            email="progress-other-responder@example.com",
            phone_number="+639100000803",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )

    def test_assigned_responder_can_move_assigned_to_in_progress(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Assigned pothole",
            status=Concern.Status.ASSIGNED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            status=ConcernAssignment.Status.ACTIVE,
        )
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {"status": Concern.Status.IN_PROGRESS, "note": "Responder is now on site."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.IN_PROGRESS)

    def test_assigned_responder_resolve_requires_evidence_then_succeeds_with_it(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Assigned drainage",
            status=Concern.Status.IN_PROGRESS,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            status=ConcernAssignment.Status.ACTIVE,
        )
        self.client.force_authenticate(self.responder)

        missing_evidence = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.RESOLVED,
                "note": "Drainage clearing was completed today.",
                "status_version": concern.status_version,
            },
            format="json",
        )
        self.assertEqual(missing_evidence.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("resolution_evidence", missing_evidence.data)

        resolved = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.RESOLVED,
                "note": "Drainage clearing was completed today.",
                "status_version": concern.status_version,
                "resolution_evidence": png_upload("completed-drainage.png"),
            },
            format="multipart",
        )

        self.assertEqual(resolved.status_code, status.HTTP_200_OK)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.RESOLVED)

    def test_assigned_responder_cannot_reject(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Assigned noise complaint",
            status=Concern.Status.ASSIGNED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            status=ConcernAssignment.Status.ACTIVE,
        )
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {"status": Concern.Status.REJECTED, "note": "This is not a valid complaint."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.ASSIGNED)

    def test_non_assigned_responder_cannot_progress_someone_elses_concern(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Assigned to a different responder",
            status=Concern.Status.ASSIGNED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            status=ConcernAssignment.Status.ACTIVE,
        )
        self.client.force_authenticate(self.other_responder)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {"status": Concern.Status.IN_PROGRESS, "note": "Trying to take over this job."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.ASSIGNED)

    def test_responder_with_cancelled_assignment_cannot_progress(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Reassigned pothole",
            status=Concern.Status.ASSIGNED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            status=ConcernAssignment.Status.CANCELLED,
        )
        self.client.force_authenticate(self.responder)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {"status": Concern.Status.IN_PROGRESS, "note": "No longer my assignment."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.ASSIGNED)
