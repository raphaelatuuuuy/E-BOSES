"""Backup, transfer, travel and the declined-response path.

The acknowledgement-timeout sweep was removed on purpose: an assignment that
nobody answers stays with its responder instead of being silently handed to
someone else. These tests pin the lifecycle that replaced it.
"""

import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.models import Concern, Department
from apps.concerns.test_helpers import active_test_community, grant_position
from apps.concerns.units import sync_responder_designation

from .models import (
    EmergencyAlert,
    BackupRequest,
    EmergencyResponderAssignment,
    EmergencyTypeRoleMap,
    ResponderShift,
)
from .views import escalate_overdue_assignments, retry_waiting_alerts

TEST_CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


@override_settings(
    CHANNEL_LAYERS=TEST_CHANNEL_LAYERS,
    OSM_ROUTE_URL="",
    OUTBOUND_SMS_DRIVER="disabled",
    CELERY_TASK_ALWAYS_EAGER=True,
)
class DispatchLifecycleTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.community = active_test_community()
        self.resident = self._user("lc-resident@example.com", "+639471000001", "Maria", "Santos")
        self.first = self._responder("lc-first@example.com", "+639471000002", "Juan")
        self.second = self._responder("lc-second@example.com", "+639471000003", "Pedro")
        self.official = self._user(
            "lc-official@example.com",
            "+639471000004",
            "Ana",
            "Official",
            role=User.Role.BARANGAY_OFFICIAL,
            is_staff=True,
        )
        grant_position(self.official, department_code="bdrrmo")

    def _user(self, email, phone, first, last, **extra):
        User = get_user_model()
        user = User.objects.create_user(
            email=email, phone_number=phone, password="pass", status=User.Status.VERIFIED, **extra
        )
        ResidentProfile.objects.create(
            user=user,
            first_name=first,
            last_name=last,
            date_of_birth="1990-01-01",
            address="Somewhere",
            barangay="Marikina Heights",
            community=self.community,
        )
        return user

    def _responder(self, email, phone, first):
        User = get_user_model()
        user = self._user(
            email,
            phone,
            first,
            "Responder",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=User.ResponderUnit.BDRRMO,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResponderShift.objects.create(
            responder=user,
            responder_unit=User.ResponderUnit.BDRRMO,
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=5),
        )
        sync_responder_designation(user)
        return user

    def alert_with_assignment(self, responder=None, assigned_ago_seconds=0):
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="fire",
            note="Smoke on the second floor.",
            latitude="14.6507000",
            longitude="121.1133000",
            address="Champaca Street",
            reported_area="Champaca Street",
            barangay="Marikina Heights",
            community=self.community,
            status=EmergencyAlert.Status.ROUTED,
        )
        assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=responder or self.first,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            source=EmergencyResponderAssignment.Source.AUTO,
        )
        if assigned_ago_seconds:
            EmergencyResponderAssignment.objects.filter(pk=assignment.pk).update(
                assigned_at=timezone.now() - timedelta(seconds=assigned_ago_seconds)
            )
            assignment.refresh_from_db()
        return alert, assignment

    # -- routing configuration -------------------------------------------

    def test_every_routing_rule_carries_its_own_timeout(self):
        # The automatic timeout sweep is gone, but the per-category timeout
        # stays on the routing rule so operations keep one place to read how
        # long a unit is expected to answer.
        alert, _ = self.alert_with_assignment()
        rule = EmergencyTypeRoleMap.objects.filter(emergency_type=alert.type, is_active=True).first()
        self.assertIsNotNone(rule)
        self.assertGreater(rule.acknowledgment_timeout_seconds, 0)

    def test_every_seeded_category_has_a_support_and_escalation_unit(self):
        for rule in EmergencyTypeRoleMap.objects.filter(emergency_type__in=["fire", "medical", "crime", "flood"]):
            self.assertIsNotNone(rule.supporting_department, rule.emergency_type)
            self.assertIsNotNone(rule.escalation_department, rule.emergency_type)
            self.assertGreater(rule.acknowledgment_timeout_seconds, 0)

    # -- acknowledgment timeout ------------------------------------------

    def test_an_acknowledged_assignment_is_left_alone(self):
        alert, assignment = self.alert_with_assignment(assigned_ago_seconds=600)
        assignment.status = EmergencyResponderAssignment.Status.EN_ROUTE
        assignment.acknowledged_at = timezone.now()
        assignment.save(update_fields=["status", "acknowledged_at"])

        self.assertEqual(escalate_overdue_assignments(), [])
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.EN_ROUTE)

    def test_a_fresh_assignment_is_not_escalated_early(self):
        self.alert_with_assignment(assigned_ago_seconds=5)
        self.assertEqual(escalate_overdue_assignments(), [])

    def test_an_overdue_assignment_is_never_reassigned_behind_the_responders_back(self):
        # Replacing the silent responder left residents with an alert nobody
        # was coming to and responders with a queue that changed underneath
        # them, so the sweep now leaves the assignment alone.
        alert, assignment = self.alert_with_assignment(assigned_ago_seconds=600)

        self.assertEqual(escalate_overdue_assignments(), [])

        alert.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertFalse(alert.escalations.exists())
        self.assertFalse(alert.assignment_logs.filter(action="acknowledgment_timeout").exists())

    def test_timeout_with_nobody_left_keeps_the_responder_assigned(self):
        self.second.is_on_duty = False
        self.second.save(update_fields=["is_on_duty"])
        alert, assignment = self.alert_with_assignment(assigned_ago_seconds=600)

        escalate_overdue_assignments()

        alert.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertFalse(alert.escalations.exists())
        self.assertIn(alert.status, __import__("apps.emergencies.views", fromlist=["x"]).ACTIVE_STATUSES)

    def test_waiting_alert_reactivates_an_eligible_timed_out_responder(self):
        self.second.is_on_duty = False
        self.second.save(update_fields=["is_on_duty"])
        alert, assignment = self.alert_with_assignment()
        assignment.status = EmergencyResponderAssignment.Status.ESCALATED
        assignment.save(update_fields=["status"])
        alert.status = EmergencyAlert.Status.ROUTING
        alert.save(update_fields=["status", "updated_at"])

        self.assertEqual(retry_waiting_alerts(), [alert.pk])

        alert.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertTrue(alert.assignment_logs.filter(action="auto_reactivated").exists())

    def test_responder_sees_every_active_incident_assigned_to_their_unit(self):
        alert, _assignment = self.alert_with_assignment(responder=self.first)
        self.client.force_authenticate(self.second)

        response = self.client.get("/api/emergencies/assigned/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.data.get("results", response.data)
        self.assertIn(alert.pk, [row["id"] for row in rows])

    def test_responder_sees_unit_incident_while_waiting_for_an_individual(self):
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            type="fire",
            community=self.community,
            barangay="Marikina Heights",
            status=EmergencyAlert.Status.ROUTING,
        )
        self.client.force_authenticate(self.second)

        response = self.client.get("/api/emergencies/assigned/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.data.get("results", response.data)
        self.assertIn(alert.pk, [row["id"] for row in rows])

    def test_resolving_emergency_resolves_its_critical_concern(self):
        concern = Concern.objects.create(
            reporter=self.resident,
            community=self.community,
            title="Critical flood report",
            description="Water is rising quickly.",
            status=Concern.Status.IN_PROGRESS,
        )
        alert = EmergencyAlert.objects.create(
            reporter=self.resident,
            source_concern=concern,
            type="flood",
            community=self.community,
            barangay="Marikina Heights",
            status=EmergencyAlert.Status.ROUTED,
        )

        alert.status = EmergencyAlert.Status.RESOLVED
        alert.save(update_fields=["status", "updated_at"])

        concern.refresh_from_db()
        self.assertEqual(concern.status, Concern.Status.RESOLVED)

    def test_the_original_assignment_stays_in_the_audit_history(self):
        alert, assignment = self.alert_with_assignment(assigned_ago_seconds=600)
        escalate_overdue_assignments()
        self.assertTrue(alert.assignments.filter(pk=assignment.pk, responder=self.first).exists())
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)

    # -- responder actions over HTTP -------------------------------------

    def test_respond_moves_the_alert_to_en_route(self):
        alert, _ = self.alert_with_assignment()
        self.client.force_authenticate(self.first)

        response = self.client.post(f"/api/emergencies/{alert.pk}/en-route/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.EN_ROUTE)

    def test_assignment_status_rejects_a_stale_alert_version(self):
        alert, assignment = self.alert_with_assignment()
        self.client.force_authenticate(self.first)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{assignment.pk}/status/",
            {
                "status": EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                "note": "I am responding now.",
                "status_version": alert.status_version + 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        assignment.refresh_from_db()
        alert.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertEqual(alert.status_version, 0)

    def test_respond_is_refused_for_an_unassigned_responder(self):
        alert, _ = self.alert_with_assignment()
        self.client.force_authenticate(self.second)
        response = self.client.post(f"/api/emergencies/{alert.pk}/en-route/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unable_requires_a_reason(self):
        alert, assignment = self.alert_with_assignment()
        self.client.force_authenticate(self.first)
        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{assignment.pk}/status/",
            {"status": EmergencyResponderAssignment.Status.DECLINED, "note": ""},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unable_with_a_reason_closes_the_assignment_without_a_replacement(self):
        # Declining used to hand the incident to the next responder
        # automatically. That hid a declined dispatch from the officials who
        # needed to dispatch manually, so a decline now only closes the
        # assignment and the alert returns to the routing queue.
        alert, assignment = self.alert_with_assignment()
        self.client.force_authenticate(self.first)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{assignment.pk}/status/",
            {
                "status": EmergencyResponderAssignment.Status.DECLINED,
                "note": "Already at another incident",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.DECLINED)
        self.assertFalse(
            alert.assignments.exclude(pk=assignment.pk)
            .filter(status__in=["assigned", "acknowledged", "en_route", "arrived"])
            .exists()
        )

    # -- backup ----------------------------------------------------------

    def test_backup_requires_a_valid_type_and_reason(self):
        alert, _ = self.alert_with_assignment()
        self.client.force_authenticate(self.first)

        bad_type = self.client.post(
            f"/api/emergencies/{alert.pk}/request-backup/",
            {"target_department_id": 999999, "reason": "need help", "urgency": "high", "idempotency_key": str(uuid.uuid4())},
            format="json",
        )
        self.assertEqual(bad_type.status_code, status.HTTP_400_BAD_REQUEST)

        no_reason = self.client.post(
            f"/api/emergencies/{alert.pk}/request-backup/",
            {"target_department_id": Department.objects.get(code="bdrrmo", community=self.community).pk, "reason": "", "urgency": "high", "idempotency_key": str(uuid.uuid4())},
            format="json",
        )
        self.assertEqual(no_reason.status_code, status.HTTP_400_BAD_REQUEST)

    def test_backup_assigns_a_support_responder_and_keeps_the_original(self):
        alert, assignment = self.alert_with_assignment()
        self.client.force_authenticate(self.first)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/request-backup/",
            {"target_department_id": Department.objects.get(code="bdrrmo", community=self.community).pk, "reason": "Two casualties inside", "urgency": "immediate", "idempotency_key": str(uuid.uuid4())},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(alert.backup_requests.get().status, BackupRequest.Status.ASSIGNED)
        self.assertTrue(alert.assignments.filter(responder=self.second).exists())
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)

    def test_backup_with_nobody_free_still_records_the_request(self):
        self.second.is_on_duty = False
        self.second.save(update_fields=["is_on_duty"])
        alert, _ = self.alert_with_assignment()
        self.client.force_authenticate(self.first)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/request-backup/",
            {"target_department_id": Department.objects.get(code="bdrrmo", community=self.community).pk, "reason": "Fire is spreading", "urgency": "immediate", "idempotency_key": str(uuid.uuid4())},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert.refresh_from_db()
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertEqual(alert.backup_requests.get().status, BackupRequest.Status.PENDING_MANUAL)

    # -- transfer --------------------------------------------------------

    def test_transfer_requires_an_official(self):
        alert, _ = self.alert_with_assignment()
        self.client.force_authenticate(self.first)
        response = self.client.post(
            f"/api/emergencies/{alert.pk}/transfer/",
            {"department_code": "bpso-tanod", "reason": "Better handled by tanod"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_transfer_requires_a_reason(self):
        alert, _ = self.alert_with_assignment()
        self.client.force_authenticate(self.official)
        response = self.client.post(
            f"/api/emergencies/{alert.pk}/transfer/",
            {"department_code": "bpso-tanod", "reason": "no"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_transfer_moves_the_incident_and_is_audited(self):
        alert, assignment = self.alert_with_assignment()
        self.client.force_authenticate(self.official)

        response = self.client.post(
            f"/api/emergencies/{alert.pk}/transfer/",
            {"department_code": "bpso-tanod", "reason": "Crowd control needed on scene"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.CANCELLED)
        self.assertTrue(alert.assignment_logs.filter(action="transferred", actor=self.official).exists())
        self.assertTrue(alert.escalations.exists())

    def test_transfer_to_an_unknown_unit_is_refused(self):
        alert, _ = self.alert_with_assignment()
        self.client.force_authenticate(self.official)
        response = self.client.post(
            f"/api/emergencies/{alert.pk}/transfer/",
            {"department_code": "does-not-exist", "reason": "Wrong unit assigned"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # -- status vocabulary ------------------------------------------------

    def test_new_statuses_are_all_treated_as_active(self):
        from .views import ACTIVE_STATUSES

        for value in (
            EmergencyAlert.Status.ROUTING,
            EmergencyAlert.Status.AWAITING_ACKNOWLEDGMENT,
            EmergencyAlert.Status.BACKUP_REQUESTED,
            EmergencyAlert.Status.BACKUP_ASSIGNED,
            EmergencyAlert.Status.IN_PROGRESS,
            EmergencyAlert.Status.TRANSFER_REQUIRED,
            EmergencyAlert.Status.ESCALATION_REQUIRED,
        ):
            self.assertIn(value, ACTIVE_STATUSES)

    def test_closed_statuses_are_not_active(self):
        from .views import ACTIVE_STATUSES

        for value in (
            EmergencyAlert.Status.RESOLVED,
            EmergencyAlert.Status.CLOSED,
            EmergencyAlert.Status.CANCELLED,
            EmergencyAlert.Status.FALSE_ALARM,
        ):
            self.assertNotIn(value, ACTIVE_STATUSES)

    def test_every_status_has_a_human_label(self):
        for value, label in EmergencyAlert.Status.choices:
            self.assertNotEqual(value, label)
            self.assertNotIn("_", label)


class DepartmentSeedTests(APITestCase):
    def test_the_units_the_routing_table_references_exist(self):
        for code in ("bpso-tanod", "bhw", "bdrrmo", "bcpc", "vawc-desk"):
            self.assertTrue(Department.objects.filter(code=code).exists(), code)
