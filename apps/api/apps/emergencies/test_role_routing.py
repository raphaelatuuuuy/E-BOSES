from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.concerns.test_helpers import grant_position
from apps.concerns.units import sync_responder_designation

from .models import (
    EmergencyCategory,
    EmergencyAlert,
    EmergencyAssignmentLog,
    EmergencyResponderAssignment,
    EmergencyTypeRoleMap,
    ResponderShift,
)
from .serializers import emergency_category_is_covered
from .views import preferred_departments_for


TEST_CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    },
}


@override_settings(CHANNEL_LAYERS=TEST_CHANNEL_LAYERS, OSM_ROUTE_URL="")
class RoleBasedResponderRoutingTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="feat6-resident@example.com",
            phone_number="+639610000001",
            password="pass",
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Maria",
            last_name="Santos",
            date_of_birth="1995-01-01",
            address="Blk 5 Lot 2",
            barangay="Marikina Heights",
        )
        self.official = User.objects.create_user(
            email="feat6-official@example.com",
            phone_number="+639610000002",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        designation = grant_position(self.official, department_code="bhw")
        self.community = designation.department.community
        ResidentProfile.objects.filter(user=self.resident).update(community=self.community)
        self.bhw = self.responder("feat6-bhw@example.com", "+639610000003", User.ResponderUnit.BHW)
        self.tanod = self.responder("feat6-tanod@example.com", "+639610000004", User.ResponderUnit.TANOD)
        self.backup_bhw = self.responder("feat6-backup@example.com", "+639610000005", User.ResponderUnit.BHW)

    def responder(self, email, phone, unit):
        User = get_user_model()
        user = User.objects.create_user(
            email=email,
            phone_number=phone,
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            responder_unit=unit,
            status=User.Status.VERIFIED,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=user,
            first_name=email.split("-", 1)[-1].split("@", 1)[0].title(),
            last_name="Responder",
            date_of_birth="1990-01-01",
            address="Responder Base",
            barangay="Marikina Heights",
            community=self.community,
        )
        sync_responder_designation(user)
        ResponderShift.objects.create(
            responder=user,
            responder_unit=unit,
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=10),
            start_latitude="14.6516000",
            start_longitude="121.1208000",
        )
        return user

    def alert(self, type=EmergencyAlert.Type.MEDICAL, status=EmergencyAlert.Status.SUBMITTED):
        return EmergencyAlert.objects.create(
            reporter=self.resident,
            type=type,
            note="Emergency near the covered court.",
            status=status,
            community=self.community,
            barangay="Marikina Heights",
            latitude="14.6515000",
            longitude="121.1207000",
            address="Covered court",
        )

    def test_admin_configures_role_map_and_auto_route_uses_shift_eligible_responder(self):
        self.client.force_authenticate(self.official)
        created = self.client.post(
            "/api/emergencies/role-maps/",
            {
                "emergency_type": EmergencyAlert.Type.MEDICAL,
                "responder_unit": get_user_model().ResponderUnit.TANOD,
                "priority": 50,
            },
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.bhw.is_on_duty = False
        self.bhw.save(update_fields=["is_on_duty", "updated_at"])

        self.client.force_authenticate(self.resident)
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.MEDICAL,
                "note": "Medical emergency configured to tanod for this drill.",
                "latitude": "14.6507000",
                "longitude": "121.1133000",
                "address": "Covered court",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get(pk=response.data["id"])
        # Dispatch assigns one responder per unit that answers the type, and
        # medical now has a seeded default route as well as this new one.
        assignment = alert.assignments.get(responder=self.tanod)
        self.assertEqual(assignment.source, EmergencyResponderAssignment.Source.AUTO)
        self.assertEqual(assignment.role_map_id, created.data["id"])
        self.assertTrue(EmergencyAssignmentLog.objects.filter(alert=alert, action="auto_assigned", responder=self.tanod).exists())

    def test_declared_unit_is_recognized_without_a_role_map(self):
        """Unit configuration alone must expose and route its emergency types."""
        department = self.tanod.designations.filter(is_active=True).first().department
        for other in department.__class__.objects.filter(community=self.community):
            other.emergency_types = [
                value for value in (other.emergency_types or [])
                if value != EmergencyAlert.Type.CRIME
            ]
            other.save(update_fields=["emergency_types", "updated_at"])
        department.responds_to_emergencies = True
        department.emergency_types = [EmergencyAlert.Type.CRIME]
        department.save(update_fields=["responds_to_emergencies", "emergency_types", "updated_at"])
        EmergencyTypeRoleMap.objects.filter(
            community=self.community,
            emergency_type=EmergencyAlert.Type.CRIME,
        ).delete()
        EmergencyCategory.objects.update_or_create(
            community=self.community,
            code=EmergencyAlert.Type.CRIME,
            defaults={"label": "Crime", "is_active": True, "visible_to_residents": True},
        )

        self.assertTrue(emergency_category_is_covered(EmergencyAlert.Type.CRIME, self.community))
        self.assertEqual(
            preferred_departments_for(EmergencyAlert.Type.CRIME, self.community),
            [department],
        )

    def test_inactive_declared_unit_does_not_cover_an_emergency_type(self):
        department = self.tanod.designations.filter(is_active=True).first().department
        for other in department.__class__.objects.filter(community=self.community):
            other.emergency_types = [
                value for value in (other.emergency_types or [])
                if value != EmergencyAlert.Type.CRIME
            ]
            other.save(update_fields=["emergency_types", "updated_at"])
        department.responds_to_emergencies = True
        department.emergency_types = [EmergencyAlert.Type.CRIME]
        department.is_active = False
        department.save(update_fields=["responds_to_emergencies", "emergency_types", "is_active", "updated_at"])
        EmergencyTypeRoleMap.objects.filter(
            community=self.community,
            emergency_type=EmergencyAlert.Type.CRIME,
        ).delete()

        self.assertFalse(emergency_category_is_covered(EmergencyAlert.Type.CRIME, self.community))
        self.assertEqual(preferred_departments_for(EmergencyAlert.Type.CRIME, self.community), [])

    def test_manual_assignment_and_status_changes_are_logged_and_rbac_guarded(self):
        alert = self.alert()
        self.client.force_authenticate(self.official)
        assigned = self.client.post(
            f"/api/emergencies/{alert.pk}/assign/",
            {"responder_ids": [self.bhw.pk]},
            format="json",
        )
        self.assertEqual(assigned.status_code, status.HTTP_200_OK)
        assignment = alert.assignments.get(responder=self.bhw)
        self.assertTrue(EmergencyAssignmentLog.objects.filter(alert=alert, assignment=assignment, action="manual_assigned", actor=self.official).exists())

        self.client.force_authenticate(self.tanod)
        forbidden = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{assignment.pk}/status/",
            {"status": EmergencyResponderAssignment.Status.ASSISTING, "note": "Trying to act on another responder dispatch."},
            format="json",
        )
        self.assertEqual(forbidden.status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(self.bhw)
        assisting = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{assignment.pk}/status/",
            {"status": EmergencyResponderAssignment.Status.ASSISTING, "note": "Providing first aid support."},
            format="json",
        )
        self.assertEqual(assisting.status_code, status.HTTP_200_OK)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, EmergencyResponderAssignment.Status.ASSISTING)
        self.assertTrue(EmergencyAssignmentLog.objects.filter(alert=alert, assignment=assignment, action="status_changed", new_status="assisting").exists())

    def test_escalation_adds_supporting_responder_and_decline_keeps_history(self):
        alert = self.alert(status=EmergencyAlert.Status.ROUTED)
        old_assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.bhw,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
        )
        EmergencyResponderAssignment.objects.filter(pk=old_assignment.pk).update(
            assigned_at=timezone.now() - timedelta(minutes=30)
        )
        old_assignment.refresh_from_db()

        self.client.force_authenticate(self.official)
        # The automatic timeout sweep was removed: an unacknowledged dispatch
        # stays with its responder instead of being handed to someone else.
        escalated = self.client.post("/api/emergencies/escalate-overdue/", {"minutes": 5}, format="json")
        self.assertEqual(escalated.status_code, status.HTTP_200_OK)
        self.assertEqual(escalated.data, [])
        old_assignment.refresh_from_db()
        self.assertEqual(old_assignment.status, EmergencyResponderAssignment.Status.ASSIGNED)
        self.assertEqual(alert.assignments.filter(status=EmergencyResponderAssignment.Status.ASSIGNED).count(), 1)

        self.client.force_authenticate(self.bhw)
        declined = self.client.post(
            f"/api/emergencies/{alert.pk}/assignments/{old_assignment.pk}/status/",
            {"status": EmergencyResponderAssignment.Status.DECLINED, "note": "Responder unavailable for safety reason."},
            format="json",
        )
        self.assertEqual(declined.status_code, status.HTTP_200_OK)
        old_assignment.refresh_from_db()
        self.assertEqual(old_assignment.status, EmergencyResponderAssignment.Status.DECLINED)
        self.assertTrue(EmergencyAssignmentLog.objects.filter(alert=alert, assignment=old_assignment, action="status_changed", new_status="declined").exists())
        self.assertFalse(alert.escalations.filter(previous_assignment=old_assignment).exists())

    @override_settings(SMS_EMERGENCY_WEBHOOK_TOKEN="sms-secret")
    def test_sms_forwarder_webhook_creates_and_routes_alert(self):
        """The readable message format, end to end through the legacy URL.

        The old assertion drove the EBOSES-SOS / User ID / Latitude / Timestamp
        body that the redesign removed. What matters now is that a plain
        sentence a resident could have typed themselves still creates a routed
        alert, and that a repeat does not create a second one.
        """
        message = (
            "I need immediate help. This is a Medical Emergency near the covered "
            "court in Marikina Heights. Please send assistance.\n"
            "LOC:14.6507000,121.1133000"
        )
        response = self.client.post(
            "/api/emergencies/sms-inbound/",
            {"from": self.resident.phone_number, "msg": message},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN="sms-secret",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        alert = EmergencyAlert.objects.get(pk=response.data["emergency_id"])
        self.assertEqual(alert.type, EmergencyAlert.Type.MEDICAL)
        self.assertEqual(alert.location_source, "sms_gps")
        self.assertEqual(alert.status, EmergencyAlert.Status.ROUTED)
        self.assertTrue(alert.assignments.filter(responder=self.bhw).exists())
        self.assertIn("covered court", alert.reported_area)
        # Wording now comes from apps.emergencies.vocabulary so the SMS reply,
        # the timeline heading and the note all say the same thing.
        intake = alert.status_events.get(event_key="received_sms")
        self.assertEqual(intake.label, "Emergency received")

        repeated = self.client.post(
            "/api/emergencies/sms-inbound/",
            {"from": self.resident.phone_number, "msg": message + " again"},
            format="json",
            HTTP_X_SMS_WEBHOOK_TOKEN="sms-secret",
        )
        self.assertEqual(repeated.status_code, status.HTTP_200_OK)
        self.assertTrue(repeated.data["duplicate"])
        self.assertEqual(EmergencyAlert.objects.filter(reporter=self.resident).count(), 1)

    def test_duplicate_dispatch_rule_is_refused_with_a_readable_message(self):
        """A default routing table ships with the app, so this WILL happen."""
        self.client.force_authenticate(self.official)
        payload = {
            "emergency_type": EmergencyAlert.Type.MEDICAL,
            "responder_unit": get_user_model().ResponderUnit.BHW,
            "priority": 100,
        }
        first = self.client.post("/api/emergencies/role-maps/", payload, format="json")
        self.assertIn(first.status_code, {status.HTTP_201_CREATED, status.HTTP_409_CONFLICT})

        second = self.client.post("/api/emergencies/role-maps/", payload, format="json")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("already routes", second.data["detail"])

    def test_assignment_serializer_exposes_route_and_history(self):
        alert = self.alert(status=EmergencyAlert.Status.ROUTED)
        EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=self.bhw,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
        )
        self.client.force_authenticate(self.resident)

        response = self.client.get(f"/api/emergencies/{alert.pk}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("route", response.data["assignments"][0])
        self.assertIn("location_history", response.data["assignments"][0])
