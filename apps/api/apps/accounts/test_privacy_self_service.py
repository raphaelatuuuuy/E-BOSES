from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.models import Concern

from .models import AccountRequest, ResidenceVerificationCase
from .ocr_tasks import rescue_stuck_verification_cases_task


class PrivacySelfServiceTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="privacy-resident@example.com",
            phone_number="+639100000701",
            password="pass",
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(self.resident)

    def test_data_export_completes_without_an_official(self):
        created = self.client.post(
            "/api/auth/account-requests/", {"type": "data_export"}, format="json"
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        request = AccountRequest.objects.get(pk=created.data["id"])
        self.assertEqual(request.status, AccountRequest.Status.COMPLETED)

    def test_resident_can_download_the_export_immediately(self):
        created = self.client.post(
            "/api/auth/account-requests/", {"type": "data_export"}, format="json"
        )
        response = self.client.get(
            f"/api/auth/account-requests/{created.data['id']}/export/"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("account", response.data)

    @override_settings(SELF_SERVICE_DATA_EXPORT=False)
    def test_export_still_waits_for_an_official_when_self_service_is_off(self):
        created = self.client.post(
            "/api/auth/account-requests/", {"type": "data_export"}, format="json"
        )
        request = AccountRequest.objects.get(pk=created.data["id"])
        self.assertEqual(request.status, AccountRequest.Status.SUBMITTED)

    def test_deletion_waits_out_a_grace_period_rather_than_an_official(self):
        created = self.client.post(
            "/api/auth/account-requests/", {"type": "deletion"}, format="json"
        )
        request = AccountRequest.objects.get(pk=created.data["id"])
        self.assertEqual(request.status, AccountRequest.Status.SUBMITTED)

    def test_resident_can_withdraw_an_open_request(self):
        self.client.post("/api/auth/account-requests/", {"type": "deletion"}, format="json")

        response = self.client.delete(
            "/api/auth/account-requests/", {"type": "deletion"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["withdrawn"], 1)
        self.assertFalse(
            AccountRequest.objects.filter(
                user=self.resident, status=AccountRequest.Status.SUBMITTED
            ).exists()
        )

    def test_withdrawing_nothing_returns_404(self):
        response = self.client.delete("/api/auth/account-requests/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_open_reports_are_reported_as_blocking_deletion(self):
        Concern.objects.create(
            reporter=self.resident, title="Still open", status=Concern.Status.SUBMITTED
        )
        self.client.post("/api/auth/account-requests/", {"type": "deletion"}, format="json")

        listed = self.client.get("/api/auth/account-requests/")

        deletion = next(row for row in listed.data if row["type"] == "deletion")
        self.assertTrue(deletion["blocked"])
        self.assertTrue(deletion["blocked_reasons"])

    def test_deletion_is_not_blocked_once_reports_are_closed(self):
        Concern.objects.create(
            reporter=self.resident, title="Closed", status=Concern.Status.RESOLVED
        )
        self.client.post("/api/auth/account-requests/", {"type": "deletion"}, format="json")

        listed = self.client.get("/api/auth/account-requests/")

        deletion = next(row for row in listed.data if row["type"] == "deletion")
        self.assertFalse(deletion["blocked"])


class StuckVerificationCaseTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="stuck-case@example.com",
            phone_number="+639100000702",
            password="pass",
            status=User.Status.PENDING_VERIFICATION,
        )

    def make_case(self, status_value, age_minutes):
        case = ResidenceVerificationCase.objects.create(
            user=self.resident, status=status_value
        )
        old = timezone.now() - timedelta(minutes=age_minutes)
        ResidenceVerificationCase.objects.filter(pk=case.pk).update(
            updated_at=old, created_at=old
        )
        case.refresh_from_db()
        return case

    def test_a_fresh_case_is_left_alone(self):
        case = self.make_case(ResidenceVerificationCase.Status.PROCESSING, 1)
        result = rescue_stuck_verification_cases_task(stale_minutes=15)
        self.assertEqual(result["examined"], 0)
        case.refresh_from_db()
        self.assertEqual(case.status, ResidenceVerificationCase.Status.PROCESSING)

    def test_a_long_abandoned_case_is_parked_for_a_human(self):
        case = self.make_case(ResidenceVerificationCase.Status.PROCESSING, 500)
        result = rescue_stuck_verification_cases_task(stale_minutes=15)
        self.assertEqual(result["parked"], 1)
        case.refresh_from_db()
        self.assertEqual(case.status, ResidenceVerificationCase.Status.MANUAL_REVIEW)
        self.assertTrue(case.retry_eligible)

    def test_an_official_decision_is_never_overwritten(self):
        case = self.make_case(ResidenceVerificationCase.Status.PROCESSING, 500)
        ResidenceVerificationCase.objects.filter(pk=case.pk).update(
            decision_source=ResidenceVerificationCase.DecisionSource.OFFICIAL
        )
        result = rescue_stuck_verification_cases_task(stale_minutes=15)
        self.assertEqual(result["examined"], 0)


class VerificationSummaryTests(APITestCase):
    def test_summary_reads_as_automatic_when_nothing_needs_a_person(self):
        from apps.config_summary import _verification

        summary = _verification()
        self.assertEqual(summary["status"], "Running automatically")
        self.assertFalse(summary["needs_attention"])

    def test_a_stuck_case_is_surfaced_as_needing_attention(self):
        User = get_user_model()
        user = User.objects.create_user(
            email="summary-stuck@example.com",
            phone_number="+639100000703",
            password="pass",
            status=User.Status.PENDING_VERIFICATION,
        )
        case = ResidenceVerificationCase.objects.create(
            user=user, status=ResidenceVerificationCase.Status.PROCESSING
        )
        old = timezone.now() - timedelta(hours=5)
        ResidenceVerificationCase.objects.filter(pk=case.pk).update(updated_at=old)

        from apps.config_summary import _verification

        summary = _verification()
        self.assertIn("stuck", summary["status"])
        self.assertTrue(summary["needs_attention"])

    def test_a_resident_who_must_re_upload_is_not_official_work(self):
        """Manual review belongs to the resident, not the barangay.

        There is no verification queue screen, so counting these as attention
        pointed officials at a page that does not exist.
        """
        User = get_user_model()
        user = User.objects.create_user(
            email="summary-resubmit@example.com",
            phone_number="+639100000704",
            password="pass",
            status=User.Status.PENDING_VERIFICATION,
        )
        ResidenceVerificationCase.objects.create(
            user=user,
            status=ResidenceVerificationCase.Status.MANUAL_REVIEW,
            retry_eligible=True,
        )

        from apps.config_summary import _verification

        summary = _verification()
        self.assertEqual(summary["status"], "Running automatically")
        self.assertIn("upload", summary["detail"])
        self.assertFalse(summary["needs_attention"])


class SelfServiceDeletionTests(APITestCase):
    """Deletion completes without an official, but never instantly.

    Anonymising cannot be undone, so the grace period is the safety: it is the
    window in which a resident who clicked by mistake can withdraw.
    """

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            email="leaving@example.com",
            phone_number="+639100000801",
            password="pass",
            status=User.Status.VERIFIED,
        )

    def _request(self, age_days=0):
        req = AccountRequest.objects.create(
            user=self.user, type=AccountRequest.Type.DELETION, status=AccountRequest.Status.SUBMITTED
        )
        if age_days:
            AccountRequest.objects.filter(pk=req.pk).update(
                created_at=timezone.now() - timedelta(days=age_days)
            )
        return req

    def test_a_fresh_request_is_left_alone_so_it_can_be_withdrawn(self):
        from apps.accounts.privacy_tasks import complete_unblocked_deletions_task

        req = self._request(age_days=0)
        result = complete_unblocked_deletions_task()
        req.refresh_from_db()
        self.assertEqual(result["completed"], 0)
        self.assertEqual(req.status, AccountRequest.Status.SUBMITTED)

    def test_it_completes_itself_once_the_grace_period_passes(self):
        from apps.accounts.privacy_tasks import complete_unblocked_deletions_task

        req = self._request(age_days=30)
        result = complete_unblocked_deletions_task()
        req.refresh_from_db()
        self.assertEqual(result["completed"], 1)
        self.assertEqual(req.status, AccountRequest.Status.COMPLETED)

    def test_an_open_report_still_blocks_it(self):
        from apps.accounts.privacy_tasks import complete_unblocked_deletions_task

        Concern.objects.create(
            reporter=self.user, title="Open pothole", status=Concern.Status.SUBMITTED
        )
        req = self._request(age_days=30)
        result = complete_unblocked_deletions_task()
        req.refresh_from_db()
        self.assertEqual(result["completed"], 0)
        self.assertEqual(req.status, AccountRequest.Status.SUBMITTED)
        self.assertIn("report", req.staff_note.lower())
