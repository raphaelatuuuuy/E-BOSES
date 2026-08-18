"""Capability RBAC, unit unification, and the dispatch path that depends on both.

The headline test here is
`test_new_unit_receives_emergency_after_designating_an_on_duty_responder`.
Before the unification, concerns routed through Department while emergencies
routed through the closed `User.responder_unit` enum, so a unit created in the
admin could never receive an SOS. That test is the proof it now can.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.capabilities import (
    ALL_CAPABILITIES,
    CONFIGURE_DISPATCH,
    DISPATCH_EMERGENCIES,
    MANAGE_ROLES,
    MANAGE_UNITS,
    MANAGE_USERS,
    PUBLISH_ANNOUNCEMENTS,
    RESOLVE_CONCERNS,
    capabilities_for,
)
from apps.concerns.models import Department, Designation, Position
from apps.emergencies.models import (
    EmergencyAlert,
    EmergencyTypeRoleMap,
    ResponderShift,
)

User = get_user_model()


class CapabilityResolutionTests(APITestCase):
    def setUp(self):
        self.official = User.objects.create_user(
            email="cap-official@example.com",
            phone_number="+639171110001",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.department = Department.objects.get(code="sangguniang-barangay")

    def test_official_without_designation_has_no_capabilities(self):
        self.assertEqual(capabilities_for(self.official), set())

    def test_designation_switches_official_to_explicit_capabilities(self):
        kagawad = Position.objects.get(code="kagawad")
        Designation.objects.create(
            user=self.official, department=self.department, position=kagawad
        )

        granted = capabilities_for(self.official)
        self.assertIn(RESOLVE_CONCERNS, granted)
        self.assertNotIn(MANAGE_USERS, granted)
        self.assertNotIn(MANAGE_UNITS, granted)

    def test_capabilities_are_the_union_across_designations(self):
        # Small barangays double up roles; someone can be both Secretary and a
        # unit head, and should hold both sets.
        Designation.objects.create(
            user=self.official,
            department=self.department,
            position=Position.objects.get(code="secretary"),
        )
        Designation.objects.create(
            user=self.official,
            department=Department.objects.get(code="bhw"),
            position=Position.objects.get(code="unit-head"),
        )

        granted = capabilities_for(self.official)
        self.assertIn(MANAGE_USERS, granted)             # from Secretary
        self.assertIn(DISPATCH_EMERGENCIES, granted)     # from Unit Head

        # A Unit Head runs live incidents but does not rewrite the routing
        # rules; changing which unit answers which type stays with the Captain.
        self.assertNotIn(CONFIGURE_DISPATCH, granted)

    def test_inactive_designation_grants_nothing(self):
        Designation.objects.create(
            user=self.official,
            department=self.department,
            position=Position.objects.get(code="kagawad"),
            is_active=False,
        )
        self.assertEqual(capabilities_for(self.official), set())

    def test_unverified_official_holds_nothing(self):
        self.official.status = User.Status.PENDING_VERIFICATION
        self.official.save(update_fields=["status"])
        self.assertEqual(capabilities_for(self.official), set())

    def test_resident_holds_nothing(self):
        resident = User.objects.create_user(
            email="cap-resident@example.com",
            phone_number="+639171110002",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        self.assertEqual(capabilities_for(resident), set())


class CapabilityEnforcementTests(APITestCase):
    def setUp(self):
        self.official = User.objects.create_user(
            email="enforce-official@example.com",
            phone_number="+639171110010",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        # Kagawad may resolve concerns and publish, nothing more.
        Designation.objects.create(
            user=self.official,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="kagawad"),
        )
        self.client.force_authenticate(self.official)

    def test_denied_without_capability_and_names_what_is_missing(self):
        response = self.client.get("/api/concerns/admin/departments/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        # The client shows the official what to ask for rather than a dead end.
        self.assertEqual(response.data["required_capability"], MANAGE_UNITS)

    def test_allowed_once_the_capability_is_granted(self):
        captain = Position.objects.get(code="barangay-captain")
        Designation.objects.create(
            user=self.official,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=captain,
        )

        response = self.client.get("/api/concerns/admin/departments/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_roles_and_dispatch_are_separately_gated(self):
        self.assertEqual(
            self.client.get("/api/concerns/admin/positions/").status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get("/api/emergencies/role-maps/").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_me_reports_resolved_capabilities_and_units(self):
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(RESOLVE_CONCERNS, response.data["capabilities"])
        self.assertNotIn(MANAGE_ROLES, response.data["capabilities"])
        self.assertEqual(response.data["units"][0]["code"], "sangguniang-barangay")

    def test_position_changes_are_reflected_in_user_capabilities(self):
        position = Position.objects.create(
            name="Records Clerk",
            code="records-clerk",
            permissions=[MANAGE_USERS],
        )
        Designation.objects.create(
            user=self.official,
            department=Department.objects.get(code="secretary"),
            position=position,
        )
        self.assertIn(MANAGE_USERS, self.client.get("/api/auth/me/").data["capabilities"])

        position.permissions = [PUBLISH_ANNOUNCEMENTS]
        position.save(update_fields=["permissions", "updated_at"])
        capabilities = self.client.get("/api/auth/me/").data["capabilities"]
        self.assertNotIn(MANAGE_USERS, capabilities)
        self.assertIn(PUBLISH_ANNOUNCEMENTS, capabilities)


class RoleConfigurationSafetyTests(APITestCase):
    def setUp(self):
        self.captain = User.objects.create_user(
            email="role-safety-captain@example.com",
            phone_number="+639171110011",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.captain_designation = Designation.objects.create(
            user=self.captain,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.client.force_authenticate(self.captain)

    def test_unknown_permission_is_rejected(self):
        response = self.client.post(
            "/api/concerns/admin/positions/",
            {"name": "Invalid Role", "code": "invalid-role", "permissions": ["unknown"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resident_cannot_receive_a_designation(self):
        resident = User.objects.create_user(
            email="role-safety-resident@example.com",
            phone_number="+639171110012",
            password="pass",
            status=User.Status.VERIFIED,
        )
        response = self.client.post(
            "/api/concerns/admin/designations/",
            {
                "user": resident.pk,
                "department": Department.objects.get(code="bhw").pk,
                "position": Position.objects.get(code="staff").pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_last_role_manager_cannot_be_removed(self):
        response = self.client.delete(
            f"/api/concerns/admin/designations/{self.captain_designation.pk}/"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Designation.objects.filter(pk=self.captain_designation.pk).exists())

    def test_unit_manager_can_create_positions_but_cannot_grant_permissions(self):
        manager = User.objects.create_user(
            email="role-safety-unit-manager@example.com",
            phone_number="+639171110013",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        position = Position.objects.create(
            name="Unit Manager",
            code="unit-manager-test",
            permissions=[MANAGE_UNITS],
        )
        department = Department.objects.get(code="bhw")
        Designation.objects.create(user=manager, department=department, position=position)
        self.client.force_authenticate(manager)

        self.assertEqual(
            self.client.get("/api/concerns/admin/positions/").status_code,
            status.HTTP_200_OK,
        )
        created = self.client.post(
            "/api/concerns/admin/positions/",
            {"name": "BHW Trainee", "code": "bhw-trainee", "department": department.pk},
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        denied = self.client.post(
            "/api/concerns/admin/positions/",
            {
                "name": "BHW Supervisor",
                "code": "bhw-supervisor",
                "department": department.pk,
                "permissions": [MANAGE_USERS],
            },
            format="json",
        )
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)


class UnitMigrationTests(APITestCase):
    """The seeded state the unit unification migrations are supposed to produce."""

    def test_seeded_positions_exist_with_capabilities(self):
        for code in ("barangay-captain", "secretary", "kagawad", "unit-head", "staff"):
            position = Position.objects.get(code=code)
            self.assertTrue(position.permissions, f"{code} has no capabilities")

        self.assertEqual(
            set(Position.objects.get(code="barangay-captain").permissions),
            set(ALL_CAPABILITIES),
        )
        self.assertNotIn("review_verification", ALL_CAPABILITIES)
        self.assertNotIn("handle_privacy", ALL_CAPABILITIES)

    def test_emergency_responding_units_are_seeded(self):
        responding = Department.objects.filter(is_active=True, responds_to_emergencies=True)
        self.assertTrue(responding.exists())
        for department in responding:
            self.assertTrue(
                department.emergency_types,
                f"{department.code} responds to emergencies but answers no type",
            )

    def test_medical_alerts_have_a_responding_unit(self):
        bhw = Department.objects.get(code="bhw")
        self.assertTrue(bhw.responds_to_emergencies)
        self.assertIn(EmergencyAlert.Type.MEDICAL, bhw.emergency_types)


class NewUnitDispatchTests(APITestCase):
    """The unification actually delivering what it promised."""

    def setUp(self):
        self.resident = User.objects.create_user(
            email="dispatch-resident@example.com",
            phone_number="+639171110020",
            password="pass",
            role=User.Role.RESIDENT,
            status=User.Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Rita",
            last_name="Reyes",
            date_of_birth="1990-01-01",
            address="12 Kalachuchi St",
            barangay="Marikina Heights",
        )

    def _on_duty_responder(self, email, phone, department):
        responder = User.objects.create_user(
            email=email,
            phone_number=phone,
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_on_duty=True,
            current_latitude="14.6516000",
            current_longitude="121.1208000",
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=responder,
            first_name="Ruel",
            last_name="Responder",
            date_of_birth="1990-01-01",
            address="Responder Base",
            barangay="Marikina Heights",
        )
        Designation.objects.create(
            user=responder,
            department=department,
            position=Position.objects.get(code="staff"),
        )
        ResponderShift.objects.create(
            responder=responder,
            responder_unit="tanod",
            status=ResponderShift.Status.ACTIVE,
            started_at=timezone.now() - timedelta(minutes=10),
            start_latitude="14.6516000",
            start_longitude="121.1208000",
        )
        return responder

    def test_new_unit_receives_emergency_after_designating_an_on_duty_responder(self):
        # A unit that did not exist when the enum was written. Under the old
        # model this could never be dispatched to, whatever an official
        # configured, because routing read User.responder_unit.
        brigade = Department.objects.create(
            name="Barangay Fire Brigade",
            code="fire-brigade",
            short_name="Fire Brigade",
            responds_to_emergencies=True,
            emergency_types=[EmergencyAlert.Type.FIRE],
        )
        EmergencyTypeRoleMap.objects.create(
            emergency_type=EmergencyAlert.Type.FIRE,
            department=brigade,
            responder_unit="tanod",
            priority=90,
            requires_shift=False,
        )
        responder = self._on_duty_responder(
            "brigade-responder@example.com", "+639171110021", brigade
        )

        self.client.force_authenticate(self.resident)
        response = self.client.post(
            "/api/emergencies/",
            {
                "type": EmergencyAlert.Type.FIRE,
                "note": "Fire near the covered court.",
                "latitude": "14.6507000",
                "longitude": "121.1133000",
                "address": "Covered court",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        alert = EmergencyAlert.objects.get(pk=response.data["id"])
        assignment = alert.assignments.get()
        self.assertEqual(assignment.responder, responder)

    def test_deactivating_a_unit_stops_it_receiving_alerts(self):
        brigade = Department.objects.create(
            name="Temporary Flood Team",
            code="flood-team",
            responds_to_emergencies=True,
            emergency_types=[EmergencyAlert.Type.DISASTER],
        )
        self._on_duty_responder("flood-responder@example.com", "+639171110022", brigade)

        brigade.is_active = False
        brigade.save(update_fields=["is_active"])

        from apps.emergencies.views import preferred_departments_for

        preferred = preferred_departments_for(EmergencyAlert.Type.DISASTER)
        self.assertNotIn(brigade, preferred)
