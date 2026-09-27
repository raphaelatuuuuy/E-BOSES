"""The official audit-log view must explain a row without the UI guessing.

These cover the enrichment that lets an expanded row name the report it touched,
name the person who touched it, and show the photos the entry can be checked
against — without ever printing an account's email address.
"""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import AuditLog
from apps.concerns.models import Concern, ConcernMedia, ConcernResolutionEvidence
from apps.concerns.test_helpers import ensure_test_profile, grant_position


class AuditLogViewTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser(
            email="audit-admin@example.com", phone_number="+639180000101", password="pass"
        )
        self.resident = User.objects.create_user(
            email="audit-resident@example.com",
            phone_number="+639180000102",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(self.resident)
        self.client.force_authenticate(self.admin)

    def _concern(self, **overrides):
        defaults = dict(
            reporter=self.resident,
            community=self.resident.resident_profile.community,
            title="Blocked drainage",
            description="Water backs up at the blocked drainage beside our homes.",
            category=Concern.Category.ENVIRONMENT,
        )
        defaults.update(overrides)
        return Concern.objects.create(**defaults)

    def test_concern_row_carries_readable_report_facts(self):
        concern = self._concern()
        AuditLog.objects.create(
            action="concern.status_updated",
            actor=self.admin,
            target_user=self.resident,
            community=concern.community,
            metadata={"concern_id": concern.pk, "message": "Marked as in progress"},
        )

        response = self.client.get("/api/config/audit-log/?category=concerns")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = response.data["entries"][0]
        metadata = entry["metadata"]
        self.assertEqual(metadata["tracking_id"], concern.tracking_id)
        self.assertEqual(metadata["concern_title"], concern.title)
        self.assertEqual(metadata["concern_description"], concern.description)
        self.assertTrue(metadata["concern_status"])
        self.assertTrue(metadata["reporter_name"])
        self.assertEqual(entry["actor"]["label"], "Barangay official")

    def test_concern_row_carries_the_photos_it_can_be_checked_against(self):
        concern = self._concern()
        report_photo = ConcernMedia.objects.create(
            concern=concern,
            file="raw/concern-media/2026/09/report.jpg",
            preview_file="previews/concern-media/2026/09/report.jpg",
            original_filename="report.jpg",
        )
        resolved_photo = ConcernResolutionEvidence.objects.create(
            concern=concern,
            file="raw/concern-resolution-evidence/2026/09/done.jpg",
            preview_file="previews/concern-resolution-evidence/2026/09/done.jpg",
            original_filename="done.jpg",
        )
        AuditLog.objects.create(
            action="concern.status_updated",
            actor=self.admin,
            metadata={"concern_id": concern.pk},
        )

        response = self.client.get("/api/config/audit-log/?category=concerns")

        metadata = response.data["entries"][0]["metadata"]
        self.assertEqual([item["kind"] for item in metadata["media"]], ["report", "resolution"])
        self.assertEqual(
            metadata["media"][0]["url"], f"/api/concerns/media/{report_photo.pk}/preview/"
        )
        self.assertEqual(
            metadata["media"][1]["url"],
            f"/api/concerns/resolution-evidence/{resolved_photo.pk}/preview/",
        )
        self.assertEqual(metadata["preview_url"], metadata["media"][0]["url"])

    def test_deleted_concern_falls_back_to_a_tracking_reference(self):
        AuditLog.objects.create(
            action="concern.status_updated",
            actor=self.admin,
            metadata={"concern_id": 999999},
        )

        response = self.client.get("/api/config/audit-log/?category=concerns")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        metadata = response.data["entries"][0]["metadata"]
        self.assertIn("RPT-", metadata["tracking_id"])
        self.assertNotIn("concern_title", metadata)
        self.assertNotIn("media", metadata)

    def test_an_account_without_a_name_is_never_shown_as_an_email(self):
        AuditLog.objects.create(action="auth.login_success", actor=self.admin)

        response = self.client.get("/api/config/audit-log/?category=access")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        actor = response.data["entries"][0]["actor"]
        self.assertEqual(actor["label"], "Barangay official")
        self.assertNotIn("@", str(actor))

    def test_a_staff_member_is_named_by_name_and_position(self):
        self.admin.first_name = "Ligaya"
        self.admin.last_name = "Mercado"
        self.admin.save(update_fields=["first_name", "last_name"])
        grant_position(self.admin)
        AuditLog.objects.create(action="account.staff_updated", actor=self.admin)

        response = self.client.get("/api/config/audit-log/?category=access")

        actor = response.data["entries"][0]["actor"]
        self.assertEqual(actor["label"], "Ligaya Mercado")
        self.assertEqual(actor["position"], "Barangay Captain")
        self.assertFalse(actor["service"])

    def test_a_nameless_staff_member_falls_back_to_their_position(self):
        grant_position(self.admin)
        AuditLog.objects.create(action="account.staff_updated", actor=self.admin)

        response = self.client.get("/api/config/audit-log/?category=access")

        self.assertEqual(response.data["entries"][0]["actor"]["label"], "Barangay Captain")

    def test_a_service_account_is_named_by_what_it_does(self):
        User = get_user_model()
        service = User.objects.create_user(
            email="sms-intake@eboses.invalid",
            phone_number="+639180000103",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        AuditLog.objects.create(
            action="account.staff_updated",
            actor=self.admin,
            target_user=service,
        )

        response = self.client.get("/api/config/audit-log/?category=access")

        target = response.data["entries"][0]["target"]
        self.assertEqual(target["label"], "SMS intake service")
        self.assertTrue(target["service"])
        self.assertNotIn("sms-intake@eboses.invalid", str(response.data))

    def test_the_tabs_cover_the_whole_log_and_count_their_rows(self):
        actions = [
            "auth.login_success",
            "settings.updated",
            "map_boundary.updated",
            "concern.status_updated",
            "concern.ai_decided",
            "unit.created",
        ]
        for action in actions:
            AuditLog.objects.create(action=action, actor=self.admin)

        response = self.client.get("/api/config/audit-log/")

        counts = {row["key"]: row["count"] for row in response.data["categories"]}
        self.assertEqual(counts["all"], 6)
        self.assertEqual(counts["access"], 2)
        self.assertEqual(counts["content"], 1)
        self.assertEqual(counts["concerns"], 1)
        self.assertEqual(counts["automated"], 1)
        self.assertEqual(counts["other"], 1)

    def test_a_tab_returns_only_its_own_rows(self):
        AuditLog.objects.create(action="concern.ai_decided", actor=self.admin)
        AuditLog.objects.create(action="concern.status_updated", actor=self.admin)
        AuditLog.objects.create(action="unit.created", actor=self.admin)

        automated = self.client.get("/api/config/audit-log/?category=automated")
        other = self.client.get("/api/config/audit-log/?category=other")

        self.assertEqual(
            [entry["action"] for entry in automated.data["entries"]], ["concern.ai_decided"]
        )
        self.assertEqual([entry["action"] for entry in other.data["entries"]], ["unit.created"])

    def test_an_unknown_tab_is_rejected(self):
        response = self.client.get("/api/config/audit-log/?category=signin")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_private_access_narrows_whichever_tab_is_open(self):
        AuditLog.objects.create(action="media.raw_accessed", actor=self.admin)
        AuditLog.objects.create(action="event.created", actor=self.admin)

        response = self.client.get("/api/config/audit-log/?category=content&sensitive=1")

        self.assertEqual(
            [entry["action"] for entry in response.data["entries"]], ["media.raw_accessed"]
        )

    def test_a_report_can_be_found_by_its_tracking_id(self):
        concern = self._concern()
        AuditLog.objects.create(
            action="concern.status_updated",
            actor=self.admin,
            metadata={"concern_id": concern.pk},
        )
        AuditLog.objects.create(action="auth.login_success", actor=self.admin)

        response = self.client.get(f"/api/config/audit-log/?search={concern.tracking_id}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [entry["action"] for entry in response.data["entries"]], ["concern.status_updated"]
        )

    def test_a_person_can_be_filtered_by_account(self):
        AuditLog.objects.create(action="auth.login_success", actor=self.admin)
        AuditLog.objects.create(action="auth.login_success", actor=self.resident)

        response = self.client.get(f"/api/config/audit-log/?actor={self.resident.pk}")

        self.assertEqual(len(response.data["entries"]), 1)
        self.assertEqual(response.data["entries"][0]["actor"]["id"], self.resident.pk)
