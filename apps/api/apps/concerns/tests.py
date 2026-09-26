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
from apps.emergencies.models import Community, EmergencyAlert, EmergencyResponderAssignment, MapGeometry
from apps.notifications.models import Notification
from apps.concerns.ai import process_concern_ai
from apps.concerns.ai.gemma_analyzer import payload_from_result
from apps.concerns.ai.text_classifier import TextClassificationResult
from apps.concerns.ai_fixtures import gemma_result
from apps.geo_services import classify_location

from .models import Announcement, BarangayEvent, Concern, ConcernAiAssessment, ConcernAppeal, ConcernAssignment, ConcernCategory, ConcernChatAttachment, ConcernClassificationConfiguration, ConcernClarification, ConcernComment, ConcernMedia, ConcernOfficialRemark, ConcernResolutionEvidence, ConcernStatusEvent, ConcernVote, ContentFlag, Department, Designation, Position, PublicCommentAttachment
from .serializers import PublicUserSerializer
from .severity import priority_score, severity_label
from .test_helpers import ensure_test_profile, grant_position

def png_bytes():
    output = BytesIO()
    image = Image.new("RGB", (320, 240), color=(245, 245, 245))
    image.paste((35, 65, 95), (0, 0, 160, 240))
    image.save(output, format="PNG")
    return output.getvalue()


def png_upload(name="evidence.png", content=None):
    return SimpleUploadedFile(name, content or png_bytes(), content_type="image/png")


def grant_captain(user):
    captain = grant_position(user)
    grant_position(user, position_code="staff", department_code="social-services")
    return captain


class PublicUserIdentityTests(APITestCase):
    def test_staff_identity_uses_account_name_and_configured_position(self):
        User = get_user_model()
        official = User.objects.create_user(
            email="official.esc@example.com",
            phone_number="+639100000099",
            password="pass",
            first_name="Elena",
            last_name="Santos",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        designation = grant_position(official)
        official = User.objects.prefetch_related(
            "designations__position", "designations__department"
        ).get(pk=official.pk)

        payload = PublicUserSerializer(official).data

        self.assertEqual(payload["full_name"], "Elena Santos")
        self.assertEqual(payload["initials"], "ES")
        self.assertEqual(payload["position"], designation.position.name)


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
        grant_captain(self.staff)
        ensure_test_profile(self.owner)
        ensure_test_profile(self.other)
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
        self.assertEqual(response["X-EBOSES-Preview-Status"], "pending")
        preview = b"".join(response.streaming_content)
        self.assertTrue(preview.startswith(b"\xff\xd8"))
        # Never the original bytes, whatever else happens.
        self.assertNotEqual(preview, png_bytes())

    def test_no_scan_media_gets_a_real_preview_instead_of_a_placeholder(self):
        self.media.privacy_state = ConcernMedia.PrivacyState.NOT_REQUIRED
        self.media.public_visible = True
        self.media.save(update_fields=["privacy_state", "public_visible"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["X-EBOSES-Preview-Status"], "ready")
        self.media.refresh_from_db()
        self.assertTrue(self.media.preview_file.name)
        body = b"".join(response.streaming_content)
        self.assertTrue(body.startswith(b"\xff\xd8"))
        self.assertNotIn(b"Preview is being prepared", body)

    def test_no_match_media_gets_a_real_public_preview(self):
        self.media.privacy_state = ConcernMedia.PrivacyState.NO_MATCH_FOUND
        self.media.public_visible = True
        self.media.save(update_fields=["privacy_state", "public_visible"])

        response = self.client.get(f"/api/concerns/media/{self.media.pk}/preview/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["X-EBOSES-Preview-Status"], "ready")
        self.media.refresh_from_db()
        self.assertTrue(self.media.preview_file.name)
        body = b"".join(response.streaming_content)
        self.assertTrue(body.startswith(b"\xff\xd8"))
        self.assertNotIn(b"Preview is being prepared", body)

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
        self.community = ensure_test_profile(self.resident).community
        ensure_test_profile(self.other, community=self.community)
        self.client.force_authenticate(self.resident)

    def test_media_check_identifies_duplicate_file_without_previewing_it(self):
        response = self.client.post(
            "/api/concerns/media/check/",
            {
                "forensics_only": "true",
                "media": [
                    png_upload("first.png"),
                    png_upload("duplicate.png"),
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row["index"] for row in response.data["files"]], [0, 1])
        self.assertEqual(response.data["files"][0]["status"], "accepted")
        self.assertEqual(response.data["files"][1]["status"], "rejected")
        self.assertIn("already used in another report", response.data["files"][1]["message"])

    def test_storage_failure_rolls_back_the_whole_report(self):
        """A storage upload error must never leave a media-less concern row.

        The submit view runs inside transaction.atomic: if ConcernMedia file
        storage raises (e.g. object-store BadRequest), the concern, timeline
        and assessment rows roll back together and the user gets an error —
        never a report whose photo silently never existed.
        """
        with patch("apps.concerns.views._validate_concern_before_commit", return_value=None):
            with patch(
                "apps.accounts.storage.FileSystemStorage.save",
                side_effect=OSError("storage unavailable"),
            ):
                with self.captureOnCommitCallbacks(execute=True):
                    with self.assertRaises(OSError):
                        self.client.post(
                            "/api/concerns/",
                            {
                                "title": "Rollback probe report",
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

        self.assertFalse(Concern.objects.filter(title="Rollback probe report").exists())

    def test_resident_can_create_report_with_initial_status_event(self):
        with patch("apps.concerns.views._validate_concern_before_commit", return_value=None):
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
        self.assertEqual(concern.visibility, Concern.Visibility.COMMUNITY)
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

    def test_critical_normal_report_stays_a_concern_without_emergency_companion(self):
        with patch("apps.concerns.views._validate_concern_before_commit", return_value=None):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    "/api/concerns/",
                    {
                        "title": "Car crash near the corner",
                        "description": "A car crash is blocking the road near the corner and needs official attention.",
                        "category": "public_safety",
                        "visibility": "community",
                        "address": "Bayan-Bayanan St.",
                        "latitude": "14.6515000",
                        "longitude": "121.1207000",
                        "location_source": "manual_pin",
                        # Legacy clients may still send these fields. They must
                        # never turn a normal report into an emergency alert.
                        "auto_escalate": "true",
                        "emergency_type": "fire",
                        "media": png_upload("car-crash.png"),
                    },
                    format="multipart",
                )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        concern = Concern.objects.get(pk=response.data["id"])
        self.assertEqual(EmergencyAlert.objects.filter(source_concern=concern).count(), 0)
        self.assertNotIn("escalated_alert", response.data)

        assessment = concern.ai_assessment
        assessment.status = ConcernAiAssessment.Status.COMPLETED
        assessment.severity_estimate = "high"
        assessment.raw_result = {
            "review": {"current_danger": True, "incident_timing": "ongoing"}
        }
        assessment.save(update_fields=["status", "severity_estimate", "raw_result"])
        concern.refresh_from_db()
        self.assertEqual(severity_label(concern), "critical")
        self.assertGreaterEqual(priority_score(concern), 3000)

    def test_category_policy_keeps_report_private_and_cannot_be_overridden(self):
        category = ConcernCategory.objects.create(
            community=self.community,
            name="Private resident concern",
            code="private-resident-concern",
            location_required=False,
            public_feed_allowed=False,
        )

        with patch("apps.concerns.views._validate_concern_before_commit", return_value=None):
            response = self.client.post(
                "/api/concerns/",
                {
                    "title": "A private concern",
                    "description": "This report must remain visible only to its participants.",
                    "category_id": category.id,
                    "visibility": Concern.Visibility.COMMUNITY,
                    "address": "Bayan-Bayanan St.",
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        concern = Concern.objects.get(pk=response.data["id"])
        self.assertEqual(concern.visibility, Concern.Visibility.PRIVATE)

        concern.validation_status = Concern.ValidationStatus.ACCEPTED
        concern.save(update_fields=["validation_status"])
        publish_response = self.client.post(f"/api/concerns/{concern.id}/publish/", {}, format="json")
        self.assertEqual(publish_response.status_code, status.HTTP_409_CONFLICT)
        concern.refresh_from_db()
        self.assertEqual(concern.visibility, Concern.Visibility.PRIVATE)

    def test_resident_report_is_routed_to_the_community_containing_the_pin(self):
        boundary = MapGeometry.objects.create(
            kind=MapGeometry.Kind.BOUNDARY,
            name="Neighbour Community",
            locality="Marikina",
            osm_type="R",
            osm_id=990001,
            geometry={
                "type": "Polygon",
                "coordinates": [[
                    [121.9900, 14.9900],
                    [122.0100, 14.9900],
                    [122.0100, 15.0100],
                    [121.9900, 15.0100],
                    [121.9900, 14.9900],
                ]],
            },
            is_active=True,
        )
        incident_community = Community.objects.create(
            code="neighbour-community",
            name="Neighbour Community",
            status=Community.Status.ACTIVE,
            boundary=boundary,
            center_latitude="15.0000000",
            center_longitude="122.0000000",
            bbox_min_latitude="14.9900000",
            bbox_max_latitude="15.0100000",
            bbox_min_longitude="121.9900000",
            bbox_max_longitude="122.0100000",
        )
        receiving_department = Department.objects.create(
            community=incident_community,
            name="Neighbour Public Works",
            code="public-works",
        )
        incident_category = ConcernCategory.objects.create(
            community=incident_community,
            name="Infrastructure",
            code="infrastructure",
            department=receiving_department,
        )

        with patch("apps.concerns.classification_api.classification_payload") as classify:
            classify.return_value = payload_from_result(
                gemma_result(category="infrastructure"),
                selected_category="infrastructure",
            )
            precheck = self.client.post(
                "/api/concerns/classification/precheck/",
                {
                    "title": "Broken streetlight in another community",
                    "description": "The streetlight beside the covered court has stopped working.",
                    "latitude": "15.0000000",
                    "longitude": "122.0000000",
                },
                format="multipart",
            )

        self.assertEqual(precheck.status_code, status.HTTP_200_OK)
        self.assertTrue(precheck.data["can_submit"])
        self.assertEqual(precheck.data["category"], "infrastructure")

        with patch("apps.concerns.views._validate_concern_before_commit", return_value=None):
            response = self.client.post(
                "/api/concerns/",
                {
                    "title": "Broken streetlight in another community",
                    "description": "The streetlight beside the covered court has stopped working.",
                    "category": "infrastructure",
                    "address": "Covered Court Road, Neighbour Community",
                    "latitude": "15.0000000",
                    "longitude": "122.0000000",
                    "location_source": "manual_pin",
                },
                format="multipart",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        concern = Concern.objects.get(pk=response.data["id"])
        self.assertEqual(concern.reporter_community_id, self.community.pk)
        self.assertEqual(concern.community_id, incident_community.pk)
        self.assertEqual(concern.category_ref_id, incident_category.pk)
        self.assertIsNone(concern.assigned_department_id)
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.PENDING)
        self.assertEqual(concern.barangay, incident_community.name)
        self.assertTrue(response.data["is_cross_community"])
        self.assertEqual(response.data["community"]["id"], str(incident_community.public_id))
        self.assertEqual(response.data["reporter_community"]["id"], str(self.community.public_id))

    def test_foreign_public_detail_allows_cross_community_discussion(self):
        foreign_community = Community.objects.create(
            code="foreign-comments",
            name="Foreign Comments Community",
            status=Community.Status.ACTIVE,
            center_latitude="15.0000000",
            center_longitude="122.0000000",
            bbox_min_latitude="14.9900000",
            bbox_max_latitude="15.0100000",
            bbox_min_longitude="121.9900000",
            bbox_max_longitude="122.0100000",
        )
        concern = Concern.objects.create(
            reporter=self.other,
            community=foreign_community,
            title="Public concern in another community",
            description="Residents should be able to read its discussion.",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.SUBMITTED,
        )
        comment = ConcernComment.objects.create(
            concern=concern,
            author=self.other,
            body="This update is visible across communities.",
        )

        detail = self.client.get(f"/api/concerns/{concern.public_id}/")

        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["access_mode"], "foreign_read_only")
        self.assertTrue(detail.data["can_interact"])
        self.assertEqual(len(detail.data["comments"]), 1)
        self.assertEqual(detail.data["comments"][0]["id"], comment.pk)

        vote = self.client.post(
            f"/api/concerns/{concern.pk}/vote/", {"value": 1}, format="json"
        )
        reply = self.client.post(
            f"/api/concerns/{concern.pk}/comments/",
            {"body": "This cross-community reply is helpful."},
            format="json",
        )
        self.assertEqual(vote.status_code, status.HTTP_200_OK)
        self.assertEqual(reply.status_code, status.HTTP_201_CREATED)

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

        with patch("apps.concerns.views._validate_concern_before_commit", return_value=None):
            first = self.client.post("/api/concerns/", payload(), format="multipart")
            second = self.client.post("/api/concerns/", payload(), format="multipart")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data["public_id"], second.data["public_id"])
        self.assertEqual(Concern.objects.filter(reporter=self.resident, client_request_id=client_request_id).count(), 1)

        detail = self.client.get(f"/api/concerns/{first.data['public_id']}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(detail.data["tracking_id"], first.data["tracking_id"])

    def test_concern_detail_includes_llm_summary_for_feed_post(self):
        concern = Concern.objects.create(
            reporter=self.other,
            title="Sagging wires",
            description="Wires are hanging low over the sidewalk.",
            summary="The report is about dangerous sagging wires obstructing the sidewalk.",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        detail = self.client.get(f"/api/concerns/{concern.public_id}/")

        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(
            detail.data["summary"],
            "The report is about dangerous sagging wires obstructing the sidewalk.",
        )

    def test_feed_reporter_does_not_expose_private_identity_or_location_fields(self):
        ensure_test_profile(
            self.other,
            first_name="Private",
            last_name="Resident",
            date_of_birth="1990-01-01",
            address="123 Exact Home Street, Marikina Heights",
            barangay="Marikina Heights",
            community=self.community,
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
        self.assertEqual(public_item["address"], "Exact Home Street, Marikina Heights")
        self.assertIsNone(public_item["latitude"])
        self.assertIsNone(public_item["longitude"])
        self.assertTrue(public_item["media"][0]["preview_url"])
        self.assertEqual(public_item["media"][0]["raw_url"], "")

        public_detail = self.client.get(f"/api/concerns/{concern.public_id}/")
        self.assertEqual(public_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(public_detail.data["address"], "Exact Home Street, Marikina Heights")
        self.assertIsNone(public_detail.data["latitude"])
        self.assertEqual(public_detail.data["reporter"]["street"], "")
        self.assertEqual(public_detail.data["media"][0]["raw_url"], "")

        self.client.force_authenticate(self.other)
        owner_detail = self.client.get(f"/api/concerns/{concern.public_id}/")
        self.assertEqual(owner_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(owner_detail.data["address"], "123 Exact Home Street")
        self.assertEqual(owner_detail.data["latitude"], "14.6515000")
        self.assertTrue(owner_detail.data["media"][0]["raw_url"])

    def test_feed_serializes_concern_with_ai_assessment(self):
        concern = Concern.objects.create(
            reporter=self.other,
            title="Concern with automated review",
            description="A validated community concern with an automated review result.",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.UNDER_REVIEW,
        )
        ConcernAiAssessment.objects.create(concern=concern)

        response = self.client.get("/api/concerns/feed/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = next(entry for entry in response.data if entry["id"] == concern.pk)
        self.assertEqual(item["ai_assessment"]["status"], ConcernAiAssessment.Status.NOT_CONFIGURED)

    def test_feed_scopes_staff_to_their_unit_while_residents_see_all(self):
        User = get_user_model()
        official = User.objects.create_user(
            email="unit-official@example.com",
            phone_number="+639100000401",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        home_department = grant_position(official).department
        community = home_department.community
        other_department = Department.objects.create(
            community=community,
            name="Other Unit",
            code="other-unit",
        )
        home_category = ConcernCategory.objects.create(
            community=community,
            name="Home Category",
            code="home-category",
            department=home_department,
        )
        base = {
            "reporter": self.other,
            "community": community,
            "visibility": Concern.Visibility.COMMUNITY,
            "validation_status": Concern.ValidationStatus.ACCEPTED,
            "status": Concern.Status.SUBMITTED,
        }
        home_concern = Concern.objects.create(
            **base,
            title="Home unit concern",
            description="Handled by the official home unit.",
            assigned_department=home_department,
        )
        other_concern = Concern.objects.create(
            **base,
            title="Other unit concern",
            description="Handled by another unit.",
            assigned_department=other_department,
        )
        fallback_concern = Concern.objects.create(
            **base,
            title="Untriaged home concern",
            description="Not yet assigned but categorized under the home unit.",
            category_ref=home_category,
        )

        self.client.force_authenticate(official)
        staff_response = self.client.get("/api/concerns/feed/?scope=all")

        self.assertEqual(staff_response.status_code, status.HTTP_200_OK)
        staff_ids = {item["id"] for item in staff_response.data}
        self.assertIn(home_concern.pk, staff_ids)
        self.assertIn(fallback_concern.pk, staff_ids)
        self.assertNotIn(other_concern.pk, staff_ids)

        self.client.force_authenticate(self.resident)
        resident_response = self.client.get("/api/concerns/feed/?scope=all")

        self.assertEqual(resident_response.status_code, status.HTTP_200_OK)
        resident_ids = {item["id"] for item in resident_response.data}
        self.assertTrue(
            {home_concern.pk, other_concern.pk, fallback_concern.pk}
            <= resident_ids
        )

    def test_unit_scope_falls_back_to_legacy_responder_unit(self):
        User = get_user_model()
        responder = User.objects.create_user(
            email="legacy-responder@example.com",
            phone_number="+639100000402",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BDRRMO,
        )
        department = Department.objects.get(
            community=self.community, code="bdrrmo"
        )
        concern = Concern.objects.create(
            reporter=self.other,
            community=self.community,
            title="Legacy unit concern",
            description="Handled by the legacy unit department.",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.SUBMITTED,
            assigned_department=department,
        )

        self.client.force_authenticate(responder)
        response = self.client.get("/api/concerns/assigned/?scope=unit")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(
            concern.pk, [item["id"] for item in response.data["results"]]
        )

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
        self.assertIn("already used in another report", response.data["media"][0])
        self.assertFalse(Concern.objects.filter(title="Duplicate evidence").exists())

    def test_concern_media_hash_is_stored(self):
        with patch("apps.concerns.views._validate_concern_before_commit", return_value=None):
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

    def test_rejected_validation_returns_feedback_and_does_not_store_report(self):
        def reject(concern_id):
            concern = Concern.objects.get(pk=concern_id)
            concern.validation_status = Concern.ValidationStatus.REJECTED
            concern.status = Concern.Status.REJECTED
            concern.validation_summary = "Please pin the exact area where the issue is found."
            concern.save(update_fields=["validation_status", "status", "validation_summary"])

        with patch("apps.concerns.ai.pipeline.process_concern_ai", side_effect=reject):
            response = self.client.post(
                "/api/concerns/",
                {
                    "title": "Wrong location photo",
                    "description": "The photo does not show the issue at the pinned location.",
                    "category": "infrastructure",
                    "visibility": "community",
                    "address": "Bayan-Bayanan St.",
                    "latitude": "14.6515000",
                    "longitude": "121.1207000",
                    "location_source": "manual_pin",
                    "media": png_upload("rejected-validation.png"),
                },
                format="multipart",
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data["description"][0],
            "Please pin the exact area where the issue is found.",
        )
        self.assertFalse(Concern.objects.filter(title="Wrong location photo").exists())
        self.assertFalse(ConcernMedia.objects.filter(original_filename="rejected-validation.png").exists())

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
        self.assertIn("Location is too far from Barangay Marikina Heights", str(response.data))
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
            address="123 Exact House Street",
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
            address="456 Exact House Street",
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
        self.assertEqual(response.data[0]["address"], "Exact House Street, Marikina Heights")
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

    def test_feed_rows_expose_empty_collections_for_dropped_relations(self):
        """Slim rows must stay shape-compatible: clients index comments etc.
        directly, so absent keys crash them. The feed omits the data but must
        still emit explicit empty arrays."""
        Concern.objects.create(
            reporter=self.other,
            title="Shape probe concern",
            status=Concern.Status.UNDER_REVIEW,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        response = self.client.get("/api/concerns/feed/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = next(item for item in response.data if item["title"] == "Shape probe concern")
        for field in (
            "comments", "timeline", "conversation", "clarifications",
            "appeals", "official_remarks", "form_values", "viewers",
            "assignments",
        ):
            self.assertIn(field, row)
            self.assertEqual(row[field], [])

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

    @patch("apps.concerns.comment_media.compare_comment_image_to_concern_pin")
    def test_comment_media_is_checked_only_when_comment_is_sent(self, compare_pin):
        compare_pin.return_value = {"status": "checked", "verdict": "same_area"}
        concern = Concern.objects.create(
            reporter=self.other,
            title="Community concern with added evidence",
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            latitude=14.65,
            longitude=121.11,
        )

        response = self.client.post(
            f"/api/concerns/{concern.pk}/comments/",
            {"body": "Additional view from the street.", "media": png_upload()},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        attachment = PublicCommentAttachment.objects.get(concern_comment_id=response.data["id"])
        self.assertEqual(attachment.street_imagery["verdict"], "same_area")
        self.assertTrue(response.data["attachment"]["preview_url"].endswith("/preview/"))
        compare_pin.assert_called_once()

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
        Announcement.objects.create(community=self.community, title="Published", body="Body", is_published=True, published_at=timezone.now())
        Announcement.objects.create(community=self.community, title="Draft", body="Body", is_published=False)
        BarangayEvent.objects.create(community=self.community, title="Clinic", detail="BP check", starts_at=timezone.now(), is_published=True)
        BarangayEvent.objects.create(community=self.community, title="Draft event", starts_at=timezone.now(), is_published=False)
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
        ensure_test_profile(responder, community=self.community)
        grant_position(responder, position_code="staff", department_code="bhw")
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
        self.assertEqual([item["title"] for item in announcements.data["results"]], ["Published"])
        self.assertEqual([item["title"] for item in events.data], ["Clinic"])
        self.assertEqual([item["id"] for item in responders.data["results"]], [responder.pk])
        self.assertNotIn("current_latitude", responders.data["results"][0])
        official = User.objects.create_user(
            email="responder-location-official@example.com",
            phone_number="+639100000116",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        grant_captain(official)
        self.client.force_authenticate(official)
        official_response = self.client.get("/api/responders/active/")
        self.assertEqual(official_response.data["results"][0]["current_latitude"], "14.6516000")
        self.assertEqual(official_response.data["results"][0]["current_longitude"], "121.1208000")

    def test_barangay_official_can_update_report_status_and_timeline(self):
        User = get_user_model()
        official = User.objects.create_user(
            email="official-status@example.com",
            phone_number="+639100000105",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        grant_captain(official)
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
        grant_captain(official)
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
        grant_captain(official)
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
        grant_captain(official)
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
        grant_captain(official)
        home = Department.objects.get(community=self.community, code="sangguniang-barangay")
        first = Concern.objects.create(
            reporter=self.resident,
            community=self.community,
            assigned_department=home,
            title="Queue drainage",
            category=Concern.Category.INFRASTRUCTURE,
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        Concern.objects.create(
            reporter=self.resident,
            community=self.community,
            assigned_department=home,
            title="Queue garbage",
            category=Concern.Category.ENVIRONMENT,
            status=Concern.Status.RESOLVED,
        )
        self.client.force_authenticate(official)

        response = self.client.get("/api/concerns/manage/?status=active&q=drainage")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data["results"]], [first.pk])

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
        designation = grant_captain(self.official)
        self.community = designation.department.community
        self.department = Department.objects.get(
            community=self.community,
            code="social-services",
        )
        ensure_test_profile(self.resident, community=self.community)
        self.responder = User.objects.create_user(
            email="phase1-responder@example.com",
            phone_number="+639100000203",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.TANOD,
            is_on_duty=True,
        )
        ensure_test_profile(self.responder, community=self.community)
        grant_position(self.responder, position_code="staff", department_code=self.department.code)

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

        def analyze(*, title, description, selected_category, images, image_uploaded):
            # The photo must reach Gemma normalised, not as raw upload bytes.
            self.assertEqual(len(images), 1)
            self.assertEqual(images[0].mime_type, "image/jpeg")
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
    def test_ai_pipeline_uses_the_llm_category_for_routing(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            assigned_department=self.department,
            title="Blocked drainage report",
            description="Maraming basura at trash sa kanal, tambak na garbage malapit sa amin.",
            category=Concern.Category.INFRASTRUCTURE,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.SUBMITTED,
        )

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.ENVIRONMENT,
                recommended_action="accept",
            )
            assessment = process_concern_ai(concern.pk)

        self.assertTrue(assessment.category_match)
        self.assertFalse(assessment.flagged)
        reason_codes = {entry["reason"] for entry in assessment.flag_reasons}
        self.assertNotIn("category_mismatch", reason_codes)

        concern.refresh_from_db()
        self.assertEqual(concern.validation_status, Concern.ValidationStatus.ACCEPTED)
        self.assertEqual(concern.status, Concern.Status.SUBMITTED)
        self.assertEqual(concern.category, Concern.Category.ENVIRONMENT)
        self.assertEqual(concern.validation_summary, "Automated validation passed.")

    @override_settings(OLLAMA_API_KEY="test-key")
    def test_critical_concern_routes_to_category_unit_without_sos_alert(self):
        category = ConcernCategory.objects.filter(
            community=self.community,
            code=Concern.Category.PUBLIC_SAFETY,
            is_active=True,
        ).select_related("department").first()
        self.assertIsNotNone(category)
        routing_rule = category.routing_rules.filter(
            is_active=True,
        ).select_related("department").first()
        expected_department = routing_rule.department if routing_rule else category.department
        self.assertIsNotNone(expected_department)

        concern = Concern.objects.create(
            reporter=self.resident,
            community=self.community,
            title="Car crash blocking the road",
            description="A car crash is blocking the road and needs official attention.",
            category=Concern.Category.INFRASTRUCTURE,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status=Concern.Status.SUBMITTED,
        )

        with patch("apps.concerns.ai.pipeline.GemmaAnalyzer") as classifier:
            classifier.return_value.analyze.return_value = gemma_result(
                category=Concern.Category.PUBLIC_SAFETY,
                severity="high",
                urgent_attention=False,
                recommended_action="accept_with_privacy_review",
                matched_emergency_type="",
                incident_timing="ongoing",
                current_danger=True,
            )
            assessment = process_concern_ai(concern.pk)

        self.assertEqual(assessment.status, ConcernAiAssessment.Status.COMPLETED)
        concern.refresh_from_db()
        self.assertEqual(severity_label(concern), "critical")
        self.assertEqual(concern.assigned_department_id, expected_department.pk)
        self.assertEqual(EmergencyAlert.objects.filter(source_concern=concern).count(), 0)

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
            assigned_department=self.department,
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
        self.assertIn(concern.pk, [item["id"] for item in response.data["results"]])

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

    def test_flag_dismiss_keeps_post_and_notifies_flag_reporter(self):
        from django.contrib.auth import get_user_model
        from apps.notifications.models import Notification

        User = get_user_model()
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Sirang kalsada",
            visibility=Concern.Visibility.COMMUNITY,
            status=Concern.Status.UNDER_REVIEW,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        flagger = User.objects.create_user(
            email="flagger2@example.com",
            phone_number="+639100000205",
            password="pass",
            status=User.Status.VERIFIED,
        )
        flag = ContentFlag.objects.create(
            concern=concern,
            reporter=flagger,
            reason=ContentFlag.Reason.FALSE_INFO,
            note="Misleading photo.",
        )

        self.client.force_authenticate(self.official)
        response = self.client.patch(
            f"/api/concerns/flags/{flag.pk}/review/",
            {"status": ContentFlag.Status.DISMISSED, "staff_note": "Post appears factual."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        flag.refresh_from_db()
        concern.refresh_from_db()
        self.assertEqual(flag.status, ContentFlag.Status.DISMISSED)
        self.assertEqual(concern.status, Concern.Status.UNDER_REVIEW)
        self.assertFalse(Notification.objects.filter(recipient=self.resident, type=Notification.Type.POST_TAKEN_DOWN).exists())
        notification = Notification.objects.get(recipient=flagger, type=Notification.Type.FLAG_DISMISSED)
        self.assertIn("Post appears factual", notification.body)

    def test_flag_take_down_rejects_concern_and_notifies_main_reporter(self):
        from django.contrib.auth import get_user_model
        from apps.concerns.models import ConcernTimelineEntry
        from apps.notifications.models import Notification

        User = get_user_model()
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Sirang kalsada",
            visibility=Concern.Visibility.COMMUNITY,
            status=Concern.Status.UNDER_REVIEW,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        flagger = User.objects.create_user(
            email="flagger@example.com",
            phone_number="+639100000204",
            password="pass",
            status=User.Status.VERIFIED,
        )
        flag = ContentFlag.objects.create(
            concern=concern,
            reporter=flagger,
            reason=ContentFlag.Reason.FALSE_INFO,
            note="Misleading photo.",
        )

        self.client.force_authenticate(self.official)
        response = self.client.patch(
            f"/api/concerns/flags/{flag.pk}/review/",
            {"status": ContentFlag.Status.TAKEN_DOWN, "staff_note": "Unverified claims during an emergency."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        flag.refresh_from_db()
        concern.refresh_from_db()
        self.assertEqual(flag.status, ContentFlag.Status.TAKEN_DOWN)
        self.assertEqual(concern.status, Concern.Status.REJECTED)
        self.assertEqual(concern.rejection_code, "content_violation")
        self.assertTrue(ConcernTimelineEntry.objects.filter(concern=concern, status=Concern.Status.REJECTED).exists())
        # The main reporter is told why (the flag reason) and the flagger is
        # notified that their flag was acted on.
        notification = Notification.objects.get(recipient=self.resident, type=Notification.Type.POST_TAKEN_DOWN)
        self.assertIn("False Information", notification.body)
        self.assertIn("Unverified claims", notification.body)
        flagger_notification = Notification.objects.get(recipient=flagger, type=Notification.Type.POST_TAKEN_DOWN)
        self.assertIn("False Information", flagger_notification.body)

    def test_flag_take_down_blocked_when_post_already_closed(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Already resolved",
            status=Concern.Status.RESOLVED,
        )
        flag = ContentFlag.objects.create(
            concern=concern,
            reporter=self.resident,
            reason=ContentFlag.Reason.FALSE_INFO,
            note="Misleading photo.",
        )

        self.client.force_authenticate(self.official)
        response = self.client.patch(
            f"/api/concerns/flags/{flag.pk}/review/",
            {"status": ContentFlag.Status.TAKEN_DOWN, "staff_note": "Remove it anyway."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        flag.refresh_from_db()
        self.assertEqual(flag.status, ContentFlag.Status.SUBMITTED)

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
        self.assertEqual(public_response.data["results"][0]["title"], "Cleanup Drive")
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
        self.assertEqual([item["id"] for item in assigned.data["results"]], [concern.pk])
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
        self.assertEqual(denied_chat.status_code, status.HTTP_404_NOT_FOUND)

        assignment.status = ConcernAssignment.Status.CANCELLED
        assignment.save(update_fields=["status", "updated_at"])
        self.client.force_authenticate(self.responder)
        removed = self.client.get("/api/concerns/assigned/")
        self.assertEqual(removed.status_code, status.HTTP_200_OK)
        self.assertEqual(removed.data["results"], [])

    def test_official_reassignment_revokes_old_responder_and_activates_new_responder(self):
        User = get_user_model()
        second_responder = User.objects.create_user(
            email="phase1-second-responder@example.com",
            phone_number="+639100000206",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(second_responder, community=self.community)
        grant_position(second_responder, position_code="staff", department_code=self.department.code)
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
        self.assertEqual(old_access.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(second_responder)
        new_access = self.client.get(f"/api/concerns/{concern.pk}/")
        assigned_list = self.client.get("/api/concerns/assigned/")
        self.assertEqual(new_access.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in assigned_list.data["results"]], [concern.pk])
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
        self.assertEqual(responder_access_after_completion.status_code, status.HTTP_200_OK)

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
        grant_captain(self.official)
        ensure_test_profile(self.resident)
        self.other = User.objects.create_user(
            email="chat-other@example.com",
            phone_number="+639100000703",
            password="pass",
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(self.other)
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
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


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
        ensure_test_profile(self.resident)

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

    def test_assigned_responder_can_resolve_directly_with_evidence(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Assigned drainage",
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
            {
                "status": Concern.Status.RESOLVED,
                "note": "Drainage clearing was completed today.",
                "resolution_evidence": png_upload("direct-resolution.png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.RESOLVED)

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

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
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

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.ASSIGNED)
