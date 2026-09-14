"""Tests for the official overview's analytics endpoint.

The endpoint exists because the page it feeds used to count rows from
`/api/concerns/manage/`, which DRF pages at twenty. `test_window_is_not_capped_
by_page_size` is the regression guard for that bug; the rest lock in the
scoping and the two derived statistics that have no column behind them.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.concerns.models import Concern, ConcernAiAssessment, ConcernStatusEvent
from apps.concerns.test_helpers import active_test_community, ensure_test_profile, grant_position
from apps.emergencies.models import Community

URL = "/api/dashboard/official/analytics/"
RESIDENT_URL = "/api/dashboard/resident/summary/"


class OfficialAnalyticsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.community = active_test_community()

        cls.official = User.objects.create_user(
            email="analytics-official@example.com",
            phone_number="+639180007001",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(cls.official, first_name="Analytics", last_name="Official")
        cls.designation = grant_position(cls.official)
        cls.unit = cls.designation.department

        cls.resident = User.objects.create_user(
            email="analytics-resident@example.com",
            phone_number="+639180007002",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(cls.resident, first_name="Analytics", last_name="Resident")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.official)

    def file(self, *, community=None, days_ago=0, status=Concern.Status.SUBMITTED, **extra):
        extra.setdefault("validation_status", Concern.ValidationStatus.ACCEPTED)
        concern = Concern.objects.create(
            reporter=self.resident,
            community=community or self.community,
            title=f"Concern {days_ago}",
            category=Concern.Category.INFRASTRUCTURE,
            status=status,
            **extra,
        )
        if days_ago:
            # `created_at` is auto_now_add, so it can only be moved afterwards.
            moment = timezone.now() - timedelta(days=days_ago)
            Concern.objects.filter(pk=concern.pk).update(created_at=moment)
            concern.refresh_from_db()
        return concern

    def resolve(self, concern, *, hours_after=0):
        event = ConcernStatusEvent.objects.create(concern=concern, status=Concern.Status.RESOLVED)
        moment = concern.created_at + timedelta(hours=hours_after)
        ConcernStatusEvent.objects.filter(pk=event.pk).update(created_at=moment)
        Concern.objects.filter(pk=concern.pk).update(status=Concern.Status.RESOLVED)
        return event

    def get(self):
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_resident_is_denied(self):
        self.client.force_authenticate(self.resident)
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_series_is_thirty_zero_filled_days(self):
        self.file()
        self.file()
        self.file(days_ago=9)

        payload = self.get()
        series = payload["series"]

        self.assertEqual(len(series), 30)
        self.assertEqual(series[-1]["filed"], 2)
        self.assertEqual(series[-10]["filed"], 1)
        self.assertEqual(sum(point["filed"] for point in series), 3)
        # Every other day still has an entry, which is what lets the chart draw
        # a track on a quiet day.
        self.assertTrue(all("filed" in point and "closed" in point for point in series))

    def test_window_is_not_capped_by_page_size(self):
        """The bug this endpoint exists to fix: DRF pages the queue at 20."""
        for _ in range(25):
            self.file()

        payload = self.get()

        self.assertEqual(payload["totals"]["filed_window"], 25)
        self.assertEqual(payload["totals"]["new_today"], 25)
        self.assertEqual(payload["series"][-1]["filed"], 25)

    def test_other_community_is_excluded(self):
        other = Community.objects.create(
            name="Elsewhere",
            code="elsewhere",
            status=Community.Status.ACTIVE,
            center_latitude=14.0,
            center_longitude=121.0,
        )
        self.file()
        self.file(community=other)
        self.file(community=other)

        payload = self.get()

        self.assertEqual(payload["totals"]["filed_window"], 1)
        self.assertEqual(payload["totals"]["open"], 1)
        self.assertEqual(len(payload["attention"]), 1)

    def test_unit_summary_and_recent_reports_are_unit_scoped(self):
        self.file(assigned_department=self.unit)
        self.file()

        payload = self.get()

        self.assertEqual(payload["unit"]["id"], self.unit.pk)
        self.assertEqual(payload["unit_totals"], {"total": 1, "active": 1, "resolved": 0})
        self.assertEqual(payload["community_totals"]["total"], 2)
        self.assertEqual(len(payload["recent_reports"]), 1)

    def test_critical_target_prefers_selected_unit(self):
        unit_critical = self.file(
            status=Concern.Status.IN_PROGRESS,
            assigned_department=self.unit,
        )
        ConcernAiAssessment.objects.create(
            concern=unit_critical,
            status=ConcernAiAssessment.Status.COMPLETED,
            severity_estimate="low",
            urgent_attention=True,
        )
        self.file(status=Concern.Status.IN_PROGRESS)

        payload = self.get()

        self.assertEqual(payload["critical_report"]["id"], unit_critical.pk)

    def test_median_resolution_comes_from_status_events(self):
        self.resolve(self.file(days_ago=1), hours_after=2)
        self.resolve(self.file(days_ago=1), hours_after=6)
        # An unresolved concern must not pull the median toward zero.
        self.file()

        payload = self.get()

        self.assertEqual(payload["resolution"]["median_days"], round(4 / 24, 1))
        self.assertEqual(payload["resolution"]["resolved"], 2)
        self.assertEqual(payload["resolution"]["settled"], 2)
        self.assertEqual(payload["resolution"]["rate_percent"], 100)

    def test_median_is_null_when_nothing_is_resolved(self):
        self.file()

        payload = self.get()

        self.assertIsNone(payload["resolution"]["median_days"])
        self.assertEqual(payload["resolution"]["settled"], 0)
        self.assertEqual(payload["resolution"]["rate_percent"], 0)

    def test_reresolved_concern_counts_once_per_day(self):
        concern = self.file(days_ago=1)
        self.resolve(concern, hours_after=2)
        self.resolve(concern, hours_after=3)

        payload = self.get()

        self.assertEqual(payload["totals"]["closed_window"], 1)
        self.assertEqual(payload["resolution"]["settled"], 1)

    def test_archived_duplicates_and_unvalidated_are_excluded(self):
        keeper = self.file()
        primary = self.file()
        self.file(archived_at=timezone.now())
        self.file(duplicate_of=primary)
        self.file(validation_status=Concern.ValidationStatus.PENDING)

        payload = self.get()

        self.assertEqual(payload["totals"]["filed_window"], 2)
        self.assertEqual(payload["totals"]["open"], 2)
        self.assertEqual({row["id"] for row in payload["attention"]}, {keeper.pk, primary.pk})

    def test_attention_is_oldest_first_and_capped_at_five(self):
        for days_ago in range(8):
            self.file(days_ago=days_ago)

        rows = self.get()["attention"]

        self.assertEqual(len(rows), 5)
        self.assertEqual(rows, sorted(rows, key=lambda row: row["created_at"]))

    def test_empty_barangay_returns_zeros(self):
        payload = self.get()

        self.assertEqual(payload["totals"]["open"], 0)
        self.assertEqual(payload["totals"]["filed_window"], 0)
        self.assertEqual(payload["share"], {"open": 0, "working": 0, "closed": 0})
        self.assertEqual(len(payload["series"]), 30)
        self.assertEqual(payload["attention"], [])


class ResponderDashboardSummaryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.community = active_test_community()
        cls.resident = User.objects.create_user(
            email="responder-dashboard-resident@example.com",
            phone_number="+639180007005",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(cls.resident, first_name="Dashboard", last_name="Resident")
        cls.responder = User.objects.create_user(
            email="responder-dashboard@example.com",
            phone_number="+639180007006",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BDRRMO,
        )
        ensure_test_profile(cls.responder, first_name="Jose", last_name="Garcia")
        cls.designation = grant_position(
            cls.responder,
            position_code="staff",
            department_code="bdrrmo",
        )
        cls.unit = cls.designation.department

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.responder)

    def file(self, *, assigned_department=None, status=Concern.Status.SUBMITTED):
        return Concern.objects.create(
            reporter=self.resident,
            community=self.community,
            assigned_department=assigned_department,
            title="Responder dashboard concern",
            category=Concern.Category.INFRASTRUCTURE,
            status=status,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

    def test_summary_uses_current_unit_for_dropdown_and_report_counts(self):
        unit_report = self.file(assigned_department=self.unit)
        self.file()

        response = self.client.get("/api/dashboard/responder/summary/?period=week")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["assigned_unit"]["id"], self.unit.pk)
        self.assertEqual(response.data["unit"]["id"], self.unit.pk)
        self.assertEqual(response.data["unit_totals"], {"total": 1, "active": 1, "resolved": 0})
        self.assertEqual(response.data["community_totals"]["total"], 2)
        self.assertEqual(response.data["recent_reports"][0]["id"], unit_report.pk)

        unit_reports = self.client.get("/api/concerns/assigned/?scope=unit")

        self.assertEqual(unit_reports.status_code, 200, unit_reports.data)
        self.assertEqual([item["id"] for item in unit_reports.data["results"]], [unit_report.pk])


class ResidentOverviewSummaryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.community = active_test_community()
        cls.resident = User.objects.create_user(
            email="overview-resident@example.com",
            phone_number="+639180007003",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        ensure_test_profile(cls.resident, first_name="Overview", last_name="Resident")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.resident)

    def file(self, *, days_ago=0, status=Concern.Status.SUBMITTED, **extra):
        extra.setdefault("validation_status", Concern.ValidationStatus.ACCEPTED)
        concern = Concern.objects.create(
            reporter=self.resident,
            community=self.community,
            title=f"Overview concern {days_ago}",
            category=Concern.Category.INFRASTRUCTURE,
            status=status,
            **extra,
        )
        if days_ago:
            moment = timezone.now() - timedelta(days=days_ago)
            Concern.objects.filter(pk=concern.pk).update(created_at=moment)
            concern.refresh_from_db()
        return concern

    def resolve(self, concern, *, hours_after=0):
        event = ConcernStatusEvent.objects.create(concern=concern, status=Concern.Status.RESOLVED)
        moment = concern.created_at + timedelta(hours=hours_after)
        ConcernStatusEvent.objects.filter(pk=event.pk).update(created_at=moment)
        Concern.objects.filter(pk=concern.pk).update(status=Concern.Status.RESOLVED)
        return event

    def get(self):
        response = self.client.get(RESIDENT_URL)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_community_counts_exclude_pending_and_archived(self):
        self.file()
        self.file(status=Concern.Status.IN_PROGRESS)
        resolved = self.file()
        self.resolve(resolved)
        self.file(validation_status=Concern.ValidationStatus.PENDING)
        self.file(archived_at=timezone.now())

        payload = self.get()

        self.assertEqual(payload["community_total"], 3)
        self.assertEqual(payload["community_active"], 2)
        self.assertEqual(payload["community_in_progress"], 1)
        self.assertEqual(payload["community_resolved"], 1)

    def test_week_days_are_seven_zero_filled_entries(self):
        self.file()
        self.file(days_ago=3)
        self.resolve(self.file(days_ago=1))

        payload = self.get()
        days = payload["week_days"]

        self.assertEqual(len(days), 7)
        self.assertTrue(
            all(
                set(point) == {"date", "submitted", "resolved", "critical"}
                for point in days
            )
        )
        self.assertEqual(sum(point["submitted"] for point in days), 3)
        self.assertEqual(sum(point["resolved"] for point in days), 1)
        self.assertEqual(payload["week_total"], 3)

    def test_report_overview_is_resident_scoped_and_period_aware(self):
        self.file()
        critical = self.file()
        ConcernAiAssessment.objects.create(
            concern=critical,
            status=ConcernAiAssessment.Status.COMPLETED,
            severity_estimate="low",
            urgent_attention=True,
        )

        User = get_user_model()
        other = User.objects.create_user(
            email="overview-other-resident@example.com",
            phone_number="+639180007004",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        Concern.objects.create(
            reporter=other,
            community=self.community,
            title="Another resident's report",
            category=Concern.Category.INFRASTRUCTURE,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )

        payload = self.get()
        overview = payload["report_overview"]
        self.assertEqual(overview["period"], "week")
        self.assertEqual(overview["total"], 2)
        self.assertEqual(overview["critical_total"], 1)
        self.assertEqual(overview["previous_critical_total"], 0)
        self.assertEqual(sum(point["submitted"] for point in overview["days"]), 2)
        self.assertEqual(sum(point["critical"] for point in overview["days"]), 1)

        today_response = self.client.get(f"{RESIDENT_URL}?period=today")
        self.assertEqual(today_response.status_code, 200, today_response.data)
        today_overview = today_response.data["report_overview"]
        self.assertEqual(today_overview["period"], "today")
        self.assertEqual(today_overview["total"], 2)
        self.assertEqual(len(today_overview["days"]), 1)

        month_response = self.client.get(f"{RESIDENT_URL}?period=month")
        self.assertEqual(month_response.status_code, 200, month_response.data)
        self.assertEqual(month_response.data["report_overview"]["period"], "month")
        self.assertEqual(month_response.data["report_overview"]["total"], 2)

    def test_deltas_compare_month_windows(self):
        prev_month_ago = timezone.localdate().day + 5
        self.file()
        self.file()
        old = self.file(days_ago=prev_month_ago)
        self.resolve(old, hours_after=2)

        payload = self.get()

        self.assertEqual(payload["delta_total_pct"], 100.0)
        self.assertEqual(payload["delta_resolved_pct"], -100.0)

    def test_empty_community_returns_zeros_and_null_deltas(self):
        payload = self.get()

        self.assertEqual(payload["community_total"], 0)
        self.assertEqual(payload["week_total"], 0)
        self.assertEqual(len(payload["week_days"]), 7)
        self.assertIsNone(payload["delta_total_pct"])
        self.assertIsNone(payload["delta_resolved_pct"])
