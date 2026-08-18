"""Endpoints behind the Configuration hub, Units, Roles and Users screens."""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.capabilities import MANAGE_USERS
from apps.concerns.models import Department, Designation, Position
from apps.emergencies.models import EmergencyCategory

User = get_user_model()


class ConfigurationHubTests(APITestCase):
    def setUp(self):
        self.captain = User.objects.create_user(
            email="hub-captain@example.com",
            phone_number="+639172220001",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
            is_staff=True,
        )
        Designation.objects.create(
            user=self.captain,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.client.force_authenticate(self.captain)

    def test_summary_returns_every_section_for_a_captain(self):
        response = self.client.get("/api/config/summary/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        sections = response.data["sections"]
        for key in (
            "units",
            "roles",
            "users",
            "categories",
            "classification",
            "dispatch",
            "verification",
            "privacy",
        ):
            self.assertIn(key, sections, f"{key} missing from the hub")
            self.assertIn("needs_attention", sections[key])

    def test_classification_card_avoids_model_jargon(self):
        # The card used to read "Relevance 0.65 · duplicate 0.85". Officials
        # should see what the setting does, not the model's numbers.
        response = self.client.get("/api/config/summary/")
        card = response.data["sections"]["classification"]
        self.assertNotIn("Relevance", card["status"])
        self.assertNotIn("0.", card["status"])
        self.assertIn(card["status"], {"Checking carefully", "Balanced checking", "Letting most through"})
        self.assertIn("review", card["detail"])

    def test_classification_card_warns_when_nothing_is_held(self):
        from apps.concerns.models import ConcernClassificationConfiguration

        config = ConcernClassificationConfiguration.current()
        config.flag_suspicious = False
        config.flag_irrelevant = False
        config.duplicate_detection_enabled = False
        config.save()

        response = self.client.get("/api/config/summary/")
        card = response.data["sections"]["classification"]
        self.assertTrue(card["needs_attention"])

    def test_summary_hides_sections_the_official_cannot_access(self):
        kagawad = User.objects.create_user(
            email="hub-kagawad@example.com",
            phone_number="+639172220002",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        Designation.objects.create(
            user=kagawad,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="kagawad"),
        )
        self.client.force_authenticate(kagawad)

        response = self.client.get("/api/config/summary/")
        sections = response.data["sections"]
        self.assertNotIn("units", sections)
        self.assertNotIn("roles", sections)

    def test_dispatch_card_flags_an_emergency_type_with_no_unit(self):
        # Strip every unit of emergency duty; every type is then uncovered.
        Department.objects.update(responds_to_emergencies=False, emergency_types=[])

        response = self.client.get("/api/config/summary/")
        dispatch = response.data["sections"]["dispatch"]
        self.assertTrue(dispatch["needs_attention"])
        for label in EmergencyCategory.objects.filter(is_active=True).values_list("label", flat=True):
            self.assertIn(label, dispatch["detail"])


class UnitScreenTests(APITestCase):
    def setUp(self):
        self.captain = User.objects.create_user(
            email="units-captain@example.com",
            phone_number="+639172220010",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
            is_staff=True,
        )
        Designation.objects.create(
            user=self.captain,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.client.force_authenticate(self.captain)

    def test_create_unit_with_emergency_duty(self):
        response = self.client.post(
            "/api/concerns/admin/departments/",
            {
                "name": "Barangay Rescue Team",
                "code": "rescue-team",
                "short_name": "Rescue",
                "responds_to_emergencies": True,
                "emergency_types": ["disaster", "fire"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(response.data["responds_to_emergencies"])
        self.assertEqual(response.data["member_count"], 0)

    def test_emergency_unit_must_answer_at_least_one_type(self):
        # Otherwise the unit looks configured but can never be dispatched to.
        response = self.client.post(
            "/api/concerns/admin/departments/",
            {
                "name": "Empty Response Unit",
                "code": "empty-unit",
                "responds_to_emergencies": True,
                "emergency_types": [],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("emergency_types", response.data)

    def test_unknown_emergency_type_is_rejected(self):
        response = self.client.post(
            "/api/concerns/admin/departments/",
            {
                "name": "Typo Unit",
                "code": "typo-unit",
                "responds_to_emergencies": True,
                "emergency_types": ["medcal"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_member_count_reflects_active_designations(self):
        bhw = Department.objects.get(code="bhw")
        responder = User.objects.create_user(
            email="units-responder@example.com",
            phone_number="+639172220011",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        Designation.objects.create(
            user=responder, department=bhw, position=Position.objects.get(code="staff")
        )

        response = self.client.get("/api/concerns/admin/departments/")
        row = next(item for item in response.data if item["code"] == "bhw")
        self.assertEqual(row["member_count"], 1)


class UsersScreenTests(APITestCase):
    def setUp(self):
        self.captain = User.objects.create_user(
            email="users-captain@example.com",
            phone_number="+639172220020",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
            is_staff=True,
        )
        Designation.objects.create(
            user=self.captain,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )

    def test_staff_directory_spans_roles_and_reports_units(self):
        self.client.force_authenticate(self.captain)
        response = self.client.get("/api/auth/staff/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        row = next(item for item in response.data if item["id"] == self.captain.id)
        self.assertEqual(row["units"][0]["code"], "sangguniang-barangay")
        self.assertEqual(row["units"][0]["position_code"], "barangay-captain")

    def test_staff_directory_requires_manage_users(self):
        kagawad = User.objects.create_user(
            email="users-kagawad@example.com",
            phone_number="+639172220021",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        Designation.objects.create(
            user=kagawad,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="kagawad"),
        )
        self.client.force_authenticate(kagawad)

        response = self.client.get("/api/auth/staff/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["required_capability"], MANAGE_USERS)

    def test_assigning_a_designation_changes_what_the_person_can_do(self):
        # The whole point of the Users screen: placement grants capability.
        member = User.objects.create_user(
            email="users-member@example.com",
            phone_number="+639172220022",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.client.force_authenticate(self.captain)
        response = self.client.post(
            "/api/concerns/admin/designations/",
            {
                "user": member.id,
                "department": Department.objects.get(code="bhw").id,
                "position": Position.objects.get(code="staff").id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        self.client.force_authenticate(member)
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.data["capabilities"], ["resolve_concerns"])
        self.assertEqual(me.data["units"][0]["code"], "bhw")
