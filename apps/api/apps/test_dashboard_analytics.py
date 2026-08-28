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

from apps.concerns.models import Concern, ConcernStatusEvent
from apps.concerns.test_helpers import active_test_community, ensure_test_profile, grant_position
from apps.emergencies.models import Community

URL = "/api/dashboard/official/analytics/"


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
        grant_position(cls.official)

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
