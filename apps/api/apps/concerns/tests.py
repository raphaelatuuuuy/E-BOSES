from io import BytesIO
from io import StringIO
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

from apps.accounts.models import AccountRequest, AuditLog, ResidenceProof
from apps.accounts.services import sha256_file
from apps.emergencies.models import EmergencyAlert, EmergencyResponderAssignment
from apps.notifications.models import Notification
from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.image_detector import ImageDetectionResult
from apps.concerns.ai.text_classifier import TextClassificationResult

from .models import Announcement, BarangayEvent, Concern, ConcernAiAssessment, ConcernAppeal, ConcernAssignment, ConcernClarification, ConcernComment, ConcernMedia, ConcernOfficialRemark, ConcernStatusEvent, ConcernVote, ContentFlag

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
                "latitude": "14.6500000",
                "longitude": "121.1100000",
                "location_source": "manual_pin",
                "location_accuracy": 12.5,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        concern = Concern.objects.get(pk=response.data["id"])
        self.assertEqual(concern.reporter, self.resident)
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)
        self.assertEqual(str(concern.latitude), "14.6500000")
        self.assertEqual(str(concern.longitude), "121.1100000")
        self.assertEqual(concern.location_source, "manual_pin")
        self.assertEqual(concern.location_accuracy, 12.5)
        self.assertEqual(concern.status_events.count(), 1)
        self.assertEqual(concern.status_events.get().status, Concern.Status.SUBMITTED)
        self.assertEqual(concern.ai_assessment.status, ConcernAiAssessment.Status.PENDING)
        self.assertEqual(response.data["ai_assessment"]["status"], ConcernAiAssessment.Status.PENDING)
        self.assertRegex(response.data["tracking_id"], r"^RPT-\d{4}-\d{6}$")
        self.assertEqual(response.data["validation_status"], "pending_review")

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

    @override_settings(EBOSES_YOLO_MODEL_PATH="", EBOSES_NLP_MODEL_PATH="")
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
        self.assertEqual(concern.ai_assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertIn("Concern", output.getvalue())
        self.assertIn("official review", concern.ai_assessment.recommendation)

    @override_settings(EBOSES_YOLO_MODEL_PATH="configured.pt", EBOSES_NLP_MODEL_PATH="configured-nlp")
    def test_ai_pipeline_stores_completed_assessment(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Broken drainage",
            description="Baradong kanal sa gilid ng kalsada.",
            category=Concern.Category.INFRASTRUCTURE,
        )
        with patch("apps.concerns.ai.pipeline.YoloImageDetector") as detector, patch("apps.concerns.ai.pipeline.RobertaTagalogClassifier") as classifier:
            detector.return_value.detect.return_value = ImageDetectionResult(
                objects=[{"label": "drainage", "confidence": 0.91}],
                confidence=0.91,
                model_version="fake-yolo",
            )
            classifier.return_value.classify.return_value = TextClassificationResult(
                label="valid_infrastructure",
                confidence=0.88,
                category=Concern.Category.INFRASTRUCTURE,
                severity="medium",
                model_version="fake-roberta",
            )

            assessment = process_concern_ai(concern.id)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        self.assertEqual(assessment.nlp_validity, "valid_infrastructure")
        self.assertTrue(assessment.category_match)
        self.assertIn("fake-yolo", assessment.model_version)

    @override_settings(EBOSES_YOLO_MODEL_PATH="configured.pt", EBOSES_NLP_MODEL_PATH="configured-nlp")
    def test_ai_pipeline_records_failure_without_breaking_review(self):
        concern = Concern.objects.create(reporter=self.resident, title="AI failure", category=Concern.Category.OTHERS)
        with patch("apps.concerns.ai.pipeline.YoloImageDetector") as detector:
            detector.return_value.detect.side_effect = RuntimeError("model crashed")

            assessment = process_concern_ai(concern.id)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.FAILED)
        self.assertEqual(assessment.recommendation, "Manual review required.")

    def test_duplicate_concern_media_is_rejected_without_creating_report(self):
        response = self.client.post(
            "/api/concerns/",
            {
                "title": "Duplicate evidence",
                "description": "The same file was attached twice.",
                "category": "infrastructure",
                "visibility": "community",
                "address": "Bayan-Bayanan St.",
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
        )
        Concern.objects.create(
            reporter=self.other,
            title="Streetlight repair",
            description="Lamp post is dark.",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
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
        )
        supported = Concern.objects.create(
            reporter=self.other,
            title="Supported concern",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
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
            is_on_duty=True,
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
            update_text="Submitted for barangay review.",
        )
        self.client.force_authenticate(official)

        response = self.client.post(
            f"/api/concerns/{concern.pk}/status/",
            {
                "status": Concern.Status.IN_PROGRESS,
                "note": "Assigned to maintenance team.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["validation_status"], "accepted")
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.IN_PROGRESS)
        self.assertEqual(concern.update_text, "Assigned to maintenance team.")
        event = concern.status_events.latest("id")
        self.assertEqual(event.status, Concern.Status.IN_PROGRESS)
        self.assertEqual(event.note, "Assigned to maintenance team.")
        self.assertEqual(event.actor, official)

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

    def test_resident_account_request_and_sos_setting_are_persisted(self):
        self.client.force_authenticate(self.resident)

        settings_response = self.client.patch("/api/auth/settings/", {"sos_placement": "compact"}, format="json")
        request_response = self.client.post("/api/auth/account-requests/", {"type": "data_export", "note": "Need my copy."}, format="json")
        list_response = self.client.get("/api/auth/account-requests/")

        self.assertEqual(settings_response.status_code, status.HTTP_200_OK)
        self.assertEqual(settings_response.data["sos_placement"], "compact")
        self.assertEqual(request_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(list_response.data[0]["type"], "data_export")
        self.assertEqual(AccountRequest.objects.get(user=self.resident).status, AccountRequest.Status.SUBMITTED)

    def test_content_flag_can_be_submitted_and_listed_by_official_only(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Public concern",
            visibility=Concern.Visibility.COMMUNITY,
            status=Concern.Status.UNDER_REVIEW,
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
        Concern.objects.create(reporter=self.resident, title="Pending", status=Concern.Status.SUBMITTED)
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
        self.assertEqual(resident_response.data["unread_notifications"], 1)
        self.assertEqual(resident_response.data["open_account_requests"], 1)
        self.assertEqual(official_denied.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(official_response.data["pending_reviews"], 1)
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
        concern = Concern.objects.create(reporter=self.resident, title="Needs workflow", status=Concern.Status.SUBMITTED)
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

    def test_resident_can_appeal_and_official_can_review(self):
        concern = Concern.objects.create(reporter=self.resident, title="Rejected report", status=Concern.Status.REJECTED)
        self.client.force_authenticate(self.resident)

        appeal_response = self.client.post(
            f"/api/concerns/{concern.pk}/appeals/",
            {"reason": "I have more context and this is valid."},
            format="json",
        )

        self.assertEqual(appeal_response.status_code, status.HTTP_201_CREATED)
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
        self.assertEqual(concern.status, Concern.Status.UNDER_REVIEW)
        self.assertTrue(Notification.objects.filter(recipient=self.resident, type=Notification.Type.APPEAL_APPROVED).exists())
