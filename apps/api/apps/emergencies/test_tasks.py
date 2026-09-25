"""Unit tests for Celery tasks and beat schedule entries.

Covers ``periodic_housekeeping_task`` (expired JWT flush + old ping pruning)
and every ``CELERY_BEAT_SCHEDULE`` entry (task names, cadence, queue).
"""

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from .models import EmergencyAlert, EmergencyLocationPing, EmergencyResponderAssignment
from .tasks import periodic_housekeeping_task


def make_user(*, email="task-responder@example.com", role=None):
    User = get_user_model()
    kwargs = {
        "email": email,
        "phone_number": "+639470000099",
        "password": "pass",
        "status": User.Status.VERIFIED,
    }
    if role is not None:
        kwargs["role"] = role
    return User.objects.create_user(**kwargs)


def make_assignment(user):
    alert = EmergencyAlert.objects.create(
        reporter=user,
        type=EmergencyAlert.Type.FIRE,
        latitude="14.6507000",
        longitude="121.1133000",
        address="Champaca Street",
        barangay="Marikina Heights",
    )
    return EmergencyResponderAssignment.objects.create(alert=alert, responder=user)


def make_ping(assignment, *, age_days=0, age_hours=0):
    ping = EmergencyLocationPing.objects.create(
        assignment=assignment,
        responder=assignment.responder,
        latitude="14.6516000",
        longitude="121.1208000",
    )
    EmergencyLocationPing.objects.filter(pk=ping.pk).update(
        created_at=timezone.now() - timedelta(days=age_days, hours=age_hours)
    )
    ping.refresh_from_db()
    return ping


def make_token(user, *, expires_in_days):
    return OutstandingToken.objects.create(
        user=user,
        jti=f"jti-{user.pk}-{expires_in_days}",
        token=f"token-{user.pk}-{expires_in_days}",
        expires_at=timezone.now() + timedelta(days=expires_in_days),
    )


class PeriodicHousekeepingTaskTests(TestCase):
    """periodic_housekeeping_task flushes tokens and prunes pings."""

    def test_flushes_expired_tokens_but_keeps_valid_ones(self):
        user = make_user()
        expired = make_token(user, expires_in_days=-1)
        valid = make_token(user, expires_in_days=1)

        result = periodic_housekeeping_task.run()

        self.assertEqual(result["expired_tokens_flushed"], True)
        self.assertFalse(OutstandingToken.objects.filter(pk=expired.pk).exists())
        self.assertTrue(OutstandingToken.objects.filter(pk=valid.pk).exists())

    def test_prunes_pings_older_than_retention_window(self):
        user = make_user()
        assignment = make_assignment(user)
        old = make_ping(assignment, age_days=31)
        recent = make_ping(assignment, age_days=1)

        result = periodic_housekeeping_task.run()

        self.assertEqual(result["pings_removed"], 1)
        self.assertFalse(EmergencyLocationPing.objects.filter(pk=old.pk).exists())
        self.assertTrue(EmergencyLocationPing.objects.filter(pk=recent.pk).exists())

    @override_settings(LOCATION_PING_RETENTION_DAYS=0)
    def test_retention_is_clamped_to_at_least_one_day(self):
        """A 0/negative env value must never wipe tracking data wholesale."""
        user = make_user()
        assignment = make_assignment(user)
        # A few hours old: safely inside a clamped-to-1-day window, but older
        # than an unclamped 0-day cutoff, so the test is deterministic rather
        # than relying on microsecond ordering between creation and the task.
        recent = make_ping(assignment, age_hours=4)

        result = periodic_housekeeping_task.run()

        # With an unclamped 0-day window the 4-hour-old ping would be deleted;
        # the clamp to 1 day keeps it.
        self.assertEqual(result["pings_removed"], 0)
        self.assertTrue(EmergencyLocationPing.objects.filter(pk=recent.pk).exists())

    def test_returns_counts_when_nothing_is_due(self):
        user = make_user()
        assignment = make_assignment(user)
        make_ping(assignment, age_days=1)

        result = periodic_housekeeping_task.run()

        self.assertEqual(
            result,
            {"expired_tokens_flushed": True, "pings_removed": 0, "audit_logs_removed": 0},
        )


class BeatScheduleTests(TestCase):
    """CELERY_BEAT_SCHEDULE registers every expected entry on its proper queue."""

    EXPECTED_ENTRIES = {
        "ocr-health-canary",
        "ocr-recovery",
        "ocr-stuck-case-rescue",
        "purge-approved-id-images",
        "purge-ocr-test-runs",
        "recover-missing-emergency-previews",
        "recover-stuck-inbound-sms",
        "emergency-assignment-escalation",
        "refresh-map-service-pois",
        "periodic-housekeeping",
        "service-health-sample",
        "service-health-worker-heartbeat",
        "complete-unblocked-deletions",
        "retry-pending-concern-jobs",
        "enforce-retention-limits",
    }

    # Retention deletes files in bulk; it belongs on the heavy worker so a
    # long sweep never delays SOS-path deliveries.
    HEAVY_QUEUE_ENTRIES = {"enforce-retention-limits"}

    def test_every_expected_entry_is_present(self):
        self.assertSetEqual(set(settings.CELERY_BEAT_SCHEDULE), self.EXPECTED_ENTRIES)

    def test_every_entry_runs_on_its_designated_queue(self):
        for name, entry in settings.CELERY_BEAT_SCHEDULE.items():
            expected_queue = "heavy" if name in self.HEAVY_QUEUE_ENTRIES else "eboses"
            self.assertEqual(
                entry["options"]["queue"],
                expected_queue,
                f"{name} must run on the {expected_queue} queue",
            )

    def test_ocr_canary_and_recovery_run_every_five_minutes(self):
        for name in ("ocr-health-canary", "ocr-recovery"):
            self.assertEqual(settings.CELERY_BEAT_SCHEDULE[name]["schedule"], 300.0)

    def test_escalation_tick_is_15_seconds(self):
        self.assertEqual(
            settings.CELERY_BEAT_SCHEDULE["emergency-assignment-escalation"]["schedule"],
            15.0,
        )

    def test_housekeeping_and_poi_refresh_are_daily(self):
        for name in ("periodic-housekeeping", "refresh-map-service-pois"):
            self.assertEqual(settings.CELERY_BEAT_SCHEDULE[name]["schedule"], 24 * 60 * 60.0)

    def test_scheduled_task_names_point_at_the_declared_task_objects(self):
        from config.celery import app

        # Replicate the worker boot sequence: import_default_modules() pulls in
        # every INSTALLED_APPS tasks.py module (and the explicitly registered
        # ocr_tasks module), then finalize() merges @shared_task entries into
        # app.tasks. A bare app.finalize() leaves the registry empty because the
        # task modules were never imported in this process.
        app.loader.import_default_modules()
        app.finalize()

        for name, entry in settings.CELERY_BEAT_SCHEDULE.items():
            task = app.tasks.get(entry["task"])
            self.assertIsNotNone(
                task,
                f"{name} schedules {entry['task']!r} but it is not registered",
            )
            self.assertEqual(task.name, entry["task"])
