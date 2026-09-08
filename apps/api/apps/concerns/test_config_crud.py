"""CRUD paths behind the Categories/Routing and Dispatch rules screens.

These endpoints previously only supported list and create, so an official could
add a rule but never repoint or remove one — the screens would have looked
broken in exactly the way the Units screen did.
"""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.models import ConcernCategory, Department, Designation, Position
from apps.emergencies.models import EmergencyAlert, EmergencyTypeRoleMap

User = get_user_model()


class ConfigCrudTests(APITestCase):
    def setUp(self):
        self.captain = User.objects.create_user(
            email="cfgcrud-captain@example.com", phone_number="+639175550001",
            password="pass", role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED, is_staff=True,
        )
        Designation.objects.create(
            user=self.captain,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.client.force_authenticate(self.captain)
        self.bhw = Department.objects.get(code="bhw")
        self.tanod = Department.objects.get(code="bpso-tanod")

    # --- Categories -------------------------------------------------------

    def test_category_create_route_and_delete(self):
        created = self.client.post(
            "/api/concerns/admin/categories/",
            {"name": "Illegal dumping", "code": "illegal-dumping"},
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        category_id = created.data["id"]

        routed = self.client.patch(
            f"/api/concerns/admin/categories/{category_id}/",
            {"department": self.tanod.id},
            format="json",
        )
        self.assertEqual(routed.status_code, status.HTTP_200_OK, routed.data)
        self.assertEqual(routed.data["department"], self.tanod.id)

        # Clearing routing must be possible, or a mis-assignment is permanent.
        cleared = self.client.patch(
            f"/api/concerns/admin/categories/{category_id}/", {"department": None}, format="json"
        )
        self.assertEqual(cleared.status_code, status.HTTP_200_OK, cleared.data)
        self.assertIsNone(cleared.data["department"])

        removed = self.client.delete(f"/api/concerns/admin/categories/{category_id}/")
        self.assertEqual(removed.status_code, status.HTTP_200_OK)
        self.assertTrue(removed.data["deleted"])
        self.assertFalse(ConcernCategory.objects.filter(pk=category_id).exists())

    # --- Dispatch rules ---------------------------------------------------

    def test_dispatch_rule_create_repoint_and_clear(self):
        # MEDICAL→BHW is seeded, so a POST for it would 409; create a fresh
        # (type, unit) pair, then repoint it and clear it.
        created = self.client.post(
            "/api/emergencies/role-maps/",
            {"emergency_type": EmergencyAlert.Type.DISASTER, "department": self.bhw.id, "priority": 100},
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        rule_id = created.data["id"]

        # Repointing must update in place: a second POST for the same type would
        # hit the (emergency_type, department) uniqueness constraint.
        repointed = self.client.patch(
            f"/api/emergencies/role-maps/{rule_id}/",
            {"department": self.tanod.id},
            format="json",
        )
        self.assertEqual(repointed.status_code, status.HTTP_200_OK, repointed.data)
        self.assertEqual(repointed.data["department"], self.tanod.id)

        removed = self.client.delete(f"/api/emergencies/role-maps/{rule_id}/")
        self.assertEqual(removed.status_code, status.HTTP_200_OK)
        self.assertFalse(EmergencyTypeRoleMap.objects.filter(pk=rule_id).exists())

    def test_dispatch_rule_detail_requires_configure_dispatch(self):
        rule = EmergencyTypeRoleMap.objects.create(
            emergency_type=EmergencyAlert.Type.FIRE, department=self.bhw, responder_unit="bhw"
        )
        kagawad = User.objects.create_user(
            email="cfgcrud-kagawad@example.com", phone_number="+639175550002",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )
        Designation.objects.create(
            user=kagawad,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="kagawad"),
        )
        self.client.force_authenticate(kagawad)

        response = self.client.delete(f"/api/emergencies/role-maps/{rule.pk}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["required_capability"], "configure_dispatch")

    def test_sms_number_is_editable_and_served_to_residents(self):
        saved = self.client.patch(
            "/api/emergencies/map-dispatch-policy/",
            {"emergency_sms_number": "09640746068"},
            format="json",
        )
        self.assertEqual(saved.status_code, status.HTTP_200_OK, saved.data)
        self.assertEqual(saved.data["emergency_sms_number"], "09640746068")

        # The SOS screen reads it from here, so a resident sees the change
        # without the app being rebuilt.
        context = self.client.get("/api/locations/map-context/")
        self.assertEqual(context.status_code, status.HTTP_200_OK)
        self.assertEqual(context.data["emergency_sms_number"], "09640746068")


class RoleChangeTests(APITestCase):
    """Changing someone's role from the Users screen.

    Role was previously unchangeable anywhere in the UI: the only account
    endpoint took `status`, and only for residents.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            email="rolechange-admin@example.com", phone_number="+639176660001",
            password="pass", role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED, is_staff=True,
        )
        Designation.objects.create(
            user=self.admin,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.resident = User.objects.create_user(
            email="rolechange-resident@example.com", phone_number="+639176660002",
            password="pass", role=User.Role.RESIDENT, status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(self.admin)

    def test_promote_resident_to_responder_creates_designation(self):
        response = self.client.patch(
            f"/api/auth/staff/{self.resident.pk}/",
            {"role": "first_responder", "responder_unit": "bhw"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.resident.refresh_from_db()
        self.assertEqual(self.resident.role, User.Role.FIRST_RESPONDER)
        # Dispatch finds responders through designations, so the promotion is
        # meaningless without one.
        self.assertTrue(
            Designation.objects.filter(
                user=self.resident, department__code="bhw", is_active=True
            ).exists()
        )

    def test_responder_role_requires_a_unit(self):
        response = self.client.patch(
            f"/api/auth/staff/{self.resident.pk}/", {"role": "first_responder"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("responder_unit", response.data)

    def test_demoting_clears_the_responder_unit(self):
        self.client.patch(
            f"/api/auth/staff/{self.resident.pk}/",
            {"role": "first_responder", "responder_unit": "bhw"},
            format="json",
        )
        self.client.patch(
            f"/api/auth/staff/{self.resident.pk}/", {"role": "resident"}, format="json"
        )
        self.resident.refresh_from_db()
        # A stale unit would keep them in dispatch candidate queries.
        self.assertEqual(self.resident.responder_unit, "")

    def test_status_can_be_changed(self):
        response = self.client.patch(
            f"/api/auth/staff/{self.resident.pk}/", {"status": "suspended"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.resident.refresh_from_db()
        self.assertEqual(self.resident.status, User.Status.SUSPENDED)

    def test_cannot_change_own_role(self):
        response = self.client.patch(
            f"/api/auth/staff/{self.admin.pk}/", {"role": "resident"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_requires_manage_users(self):
        kagawad = User.objects.create_user(
            email="rolechange-kagawad@example.com", phone_number="+639176660003",
            password="pass", role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED,
        )
        Designation.objects.create(
            user=kagawad,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="kagawad"),
        )
        self.client.force_authenticate(kagawad)
        response = self.client.patch(
            f"/api/auth/staff/{self.resident.pk}/", {"status": "suspended"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["required_capability"], "manage_users")
