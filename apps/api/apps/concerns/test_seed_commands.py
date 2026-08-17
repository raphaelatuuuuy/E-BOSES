"""The seeding and housekeeping commands.

Run without network: --no-images skips the Commons download and --skip-ai skips
the real Gemma pass, so the structural guarantees can be asserted hermetically.
"""

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from apps.emergencies.models import EmergencyAlert, EmergencyStatusEvent

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernAiAssessment,
    ConcernMergeSuggestion,
)


def run(command, *args, **kwargs):
    if command == "seed_demo_data" and "--dataset-id" not in args:
        args = (*args, "--dataset-id", "test-suite", "--password", "Test!Pass123")
    out = StringIO()
    call_command(command, *args, stdout=out, stderr=StringIO(), **kwargs)
    return out.getvalue()


class SeedAnnouncementsTests(TestCase):
    def test_it_creates_announcements_and_events(self):
        run("seed_announcements", "--no-images")
        self.assertTrue(Announcement.objects.exists())
        self.assertTrue(BarangayEvent.objects.exists())

    def test_backdated_announcements_are_marked_as_already_notified(self):
        run("seed_announcements", "--no-images")
        unsent = Announcement.objects.filter(
            is_published=True, notification_sent_at__isnull=True
        )
        self.assertEqual(
            unsent.count(), 0, "a backdated announcement would re-notify every user"
        )

    def test_reseeding_replaces_rather_than_duplicates(self):
        run("seed_announcements", "--no-images")
        first = Announcement.objects.count()
        run("seed_announcements", "--no-images")
        self.assertEqual(Announcement.objects.count(), first)


class SeedDemoDataTests(TestCase):
    def seed(self):
        return run("seed_demo_data", "--no-images", "--skip-ai")

    def test_it_creates_the_cast_and_the_reports(self):
        self.seed()
        User = get_user_model()
        self.assertEqual(User.objects.filter(role=User.Role.RESIDENT).count(), 8)
        self.assertEqual(User.objects.filter(role=User.Role.FIRST_RESPONDER).count(), 3)
        self.assertTrue(Concern.objects.exists())

    def test_every_concern_gets_a_tracking_number(self):
        self.seed()
        self.assertEqual(Concern.objects.filter(tracking_number="").count(), 0)
        self.assertEqual(Concern.objects.filter(tracking_number__isnull=True).count(), 0)

    def test_every_concern_gets_an_assessment_row(self):
        self.seed()
        self.assertEqual(
            Concern.objects.filter(ai_assessment__isnull=True).count(),
            0,
            "the officials' UI spins forever on a concern with no assessment",
        )

    def test_skip_ai_leaves_assessments_pending_rather_than_faking_them(self):
        self.seed()
        statuses = set(ConcernAiAssessment.objects.values_list("status", flat=True))
        self.assertEqual(statuses, {ConcernAiAssessment.Status.PENDING})

    def test_responders_are_on_duty_so_dispatch_has_someone_to_route_to(self):
        self.seed()
        User = get_user_model()
        on_duty = User.objects.filter(
            role=User.Role.FIRST_RESPONDER, is_on_duty=True
        ).count()
        self.assertEqual(on_duty, 3)

    def test_it_also_seeds_emergencies_and_announcements(self):
        self.seed()
        self.assertTrue(EmergencyAlert.objects.exists())
        self.assertTrue(Announcement.objects.exists())

    def test_reseeding_is_idempotent_for_accounts(self):
        self.seed()
        User = get_user_model()
        before = User.objects.count()
        self.seed()
        self.assertEqual(User.objects.count(), before)


class SeedEmergencyLifecycleTests(TestCase):
    def setUp(self):
        run("seed_demo_data", "--no-images", "--skip-ai")

    def test_the_scenarios_cover_open_and_closed_states(self):
        statuses = set(EmergencyAlert.objects.values_list("status", flat=True))
        self.assertIn(EmergencyAlert.Status.RESOLVED, statuses)
        self.assertIn(EmergencyAlert.Status.SUBMITTED, statuses)
        self.assertGreaterEqual(len(statuses), 5)

    def test_every_alert_has_a_status_trail(self):
        for alert in EmergencyAlert.objects.all():
            with self.subTest(alert=alert.pk):
                self.assertTrue(
                    EmergencyStatusEvent.objects.filter(alert=alert).exists(),
                    "an alert with no events renders an empty timeline",
                )

    def test_resolved_alerts_carry_a_resolution_time(self):
        resolved = EmergencyAlert.objects.filter(status=EmergencyAlert.Status.RESOLVED)
        self.assertTrue(resolved.exists())
        for alert in resolved:
            self.assertIsNotNone(alert.resolved_at)


class HousekeepingCommandTests(TestCase):
    def test_merge_scan_runs_and_reports(self):
        run("seed_demo_data", "--no-images", "--skip-ai")
        output = run("merge_duplicate_concerns")
        self.assertIn("suggestions", output)

    def test_merge_scan_finds_a_planted_duplicate(self):
        User = get_user_model()
        reporter = User.objects.create_user(
            email="dupe@example.com",
            phone_number="+639171119999",
            password="pass",
            status=User.Status.VERIFIED,
        )
        for title in ("Pothole here", "Pothole here again"):
            Concern.objects.create(
                reporter=reporter, title=title, report_fingerprint="same-fingerprint"
            )

        run("merge_duplicate_concerns")

        self.assertEqual(ConcernMergeSuggestion.objects.count(), 1)

    def test_rebuild_community_incidents_is_safe_on_an_empty_database(self):
        output = run("rebuild_community_incidents")
        self.assertIn("incidents rebuilt", output)

    def test_purge_missing_media_dry_run_changes_nothing(self):
        run("seed_demo_data", "--no-images", "--skip-ai")
        before = Concern.objects.count()
        run("purge_missing_media")
        self.assertEqual(Concern.objects.count(), before)
