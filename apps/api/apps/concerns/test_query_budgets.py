"""Query-count regression guards for the hot list endpoints.

These budgets lock in the prefetch work: any future change that reintroduces
a per-row query (a stray .filter() on a prefetched relation inside a
serializer is the usual suspect) fails here with a clear number instead of
silently crawling at scale.
"""

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ResidentProfile
from apps.concerns.models import (
    Announcement,
    Concern,
    Department,
    Designation,
    Position,
)
from apps.emergencies.models import EmergencyAlert
from apps.concerns.test_helpers import active_test_community


class QueryBudgetTests(TestCase):
    maxDiff = None

    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.community = active_test_community()
        cls.resident = User.objects.create_user(
            email="query-budget-resident@example.com",
            phone_number="+639180003001",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=cls.resident,
            first_name="Query",
            last_name="Resident",
            date_of_birth="1990-01-01",
            address="Budget Street",
            barangay="Marikina Heights",
            community=cls.community,
        )
        cls.official = User.objects.create_user(
            email="query-budget-official@example.com",
            phone_number="+639180003002",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=cls.official,
            first_name="Query",
            last_name="Official",
            date_of_birth="1980-01-01",
            address="Budget Street",
            barangay="Marikina Heights",
            community=cls.community,
        )
        Designation.objects.create(
            user=cls.official,
            department=Department.objects.get(code="sangguniang-barangay", community=cls.community),
            position=Position.objects.get(code="barangay-captain"),
        )
        cls.responder = User.objects.create_user(
            email="query-budget-responder@example.com",
            phone_number="+639180003003",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.BHW,
            is_on_duty=True,
        )
        ResidentProfile.objects.create(
            user=cls.responder,
            first_name="Query",
            last_name="Responder",
            date_of_birth="1985-01-01",
            address="Budget Street",
            barangay="Marikina Heights",
            community=cls.community,
        )

        statuses = [
            Concern.Status.SUBMITTED,
            Concern.Status.IN_PROGRESS,
            Concern.Status.RESOLVED,
        ]
        cls.concerns = Concern.objects.bulk_create(
            Concern(
                reporter=cls.resident,
                community=cls.community,
                title=f"Budget concern {i}",
                description="Query budget filler report.",
                category=Concern.Category.INFRASTRUCTURE if i % 2 else Concern.Category.ENVIRONMENT,
                status=statuses[i % len(statuses)],
                validation_status=Concern.ValidationStatus.ACCEPTED,
                visibility=Concern.Visibility.COMMUNITY,
                address=f"Budget Street {i}",
            )
            for i in range(10)
        )
        alert_statuses = [
            EmergencyAlert.Status.SUBMITTED,
            EmergencyAlert.Status.RESOLVED,
            EmergencyAlert.Status.CANCELLED,
        ]
        cls.alerts = EmergencyAlert.objects.bulk_create(
            EmergencyAlert(
                reporter=cls.resident,
                community=cls.community,
                type=EmergencyAlert.Type.MEDICAL if i % 2 else EmergencyAlert.Type.FIRE,
                latitude="14.6510000",
                longitude="121.1150000",
                address=f"Budget alert {i}",
                status=alert_statuses[i % len(alert_statuses)],
            )
            for i in range(10)
        )
        cls.announcements = Announcement.objects.bulk_create(
            Announcement(
                community=cls.community,
                title=f"Budget announcement {i}",
                body="Body",
                audience=Announcement.Audience.ALL,
                is_published=True,
                # The publish fan-out is one-time work per announcement; the
                # budget guards the steady-state feed readers hit every day.
                notification_sent_at=timezone.now(),
            )
            for i in range(3)
        )

    def _query_count(self, client, path):
        with CaptureQueriesContext(connection) as context:
            response = client.get(path)
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        return response, len(context.captured_queries)

    def test_resident_concern_list_stays_within_query_budget(self):
        client = APIClient()
        client.force_authenticate(self.resident)
        response, queries = self._query_count(client, "/api/concerns/mine/")
        self.assertLessEqual(queries, 25, f"/concerns/mine/ issued {queries} queries")
        self.assertIn("results", response.data)

    def test_official_concern_queue_stays_within_query_budget(self):
        client = APIClient()
        client.force_authenticate(self.official)
        _, queries = self._query_count(client, "/api/concerns/manage/")
        self.assertLessEqual(queries, 25, f"/concerns/manage/ issued {queries} queries")

    def test_emergency_history_stays_within_query_budget(self):
        client = APIClient()
        client.force_authenticate(self.resident)
        response, queries = self._query_count(client, "/api/emergencies/mine/")
        self.assertLessEqual(queries, 15, f"/emergencies/mine/ issued {queries} queries")
        self.assertIn("results", response.data)

    def test_emergency_dispatch_queue_stays_within_query_budget(self):
        client = APIClient()
        client.force_authenticate(self.official)
        _, queries = self._query_count(client, "/api/emergencies/queue/")
        self.assertLessEqual(queries, 15, f"/emergencies/queue/ issued {queries} queries")

    def test_announcement_feed_stays_within_query_budget(self):
        client = APIClient()
        client.force_authenticate(self.resident)
        response, queries = self._query_count(client, "/api/announcements/")
        self.assertLessEqual(queries, 10, f"/announcements/ issued {queries} queries")
        self.assertIn("results", response.data)

    def test_active_responders_stays_within_query_budget(self):
        client = APIClient()
        client.force_authenticate(self.resident)
        _, queries = self._query_count(client, "/api/responders/active/")
        self.assertLessEqual(queries, 8, f"/responders/active/ issued {queries} queries")
