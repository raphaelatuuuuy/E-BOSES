from datetime import date
import uuid

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import ResidentProfile, User
from apps.concerns.models import Department, Designation, Position

from .models import BackupRequest, Community, EmergencyAlert, EmergencyResponderAssignment, EmergencyTypeRoleMap, MapGeometry
from .views import find_auto_responders, find_auto_responders_by_unit, role_map_for_responder


def community(code, offset):
    boundary = MapGeometry.objects.create(
        kind=MapGeometry.Kind.BOUNDARY,
        name=code,
        locality="Test City",
        osm_type="R",
        osm_id=10_000 + offset,
        geometry={"type": "Polygon", "coordinates": [[[offset, 0], [offset + 1, 0], [offset + 1, 1], [offset, 1], [offset, 0]]]},
        is_active=True,
    )
    return Community.objects.create(
        code=code,
        name=code.title(),
        status=Community.Status.ACTIVE,
        boundary=boundary,
        center_latitude=0.5,
        center_longitude=offset + 0.5,
        bbox_min_latitude=0,
        bbox_max_latitude=1,
        bbox_min_longitude=offset,
        bbox_max_longitude=offset + 1,
    )


class CrossCommunityDispatchTests(TestCase):
    def setUp(self):
        self.owner = community("owner", 0)
        self.foreign = community("foreign", 2)
        self.reporter = self.user("reporter@example.com", User.Role.RESIDENT, self.owner, 0.5, 0.5, False)
        self.alert = EmergencyAlert.objects.create(
            reporter=self.reporter,
            community=self.owner,
            type=EmergencyAlert.Type.FIRE,
            latitude=0.5,
            longitude=0.5,
            barangay=self.owner.name,
        )
        self.owner_department = Department.objects.create(community=self.owner, name="Fire owner", code="fire", responds_to_emergencies=True, emergency_types=[EmergencyAlert.Type.FIRE])
        EmergencyTypeRoleMap.objects.create(community=self.owner, emergency_type=EmergencyAlert.Type.FIRE, department=self.owner_department, responder_unit="bdrrmo")

    def user(self, email, role, home, lat, lng, on_duty=True):
        user = User.objects.create_user(
            email=email,
            password="Str0ng!Passw0rd",
            role=role,
            status=User.Status.VERIFIED,
            phone_number=f"+639{User.objects.count() + 1:09d}",
            is_on_duty=on_duty,
            current_latitude=lat,
            current_longitude=lng,
            location_updated_at=timezone.now(),
        )
        ResidentProfile.objects.create(
            user=user,
            community=home,
            first_name="Test",
            last_name="User",
            date_of_birth=date(1990, 1, 1),
            address="Home",
            barangay=home.name,
        )
        return user

    def responder(self, email, home, code, lat, lng):
        responder = self.user(email, User.Role.FIRST_RESPONDER, home, lat, lng)
        department, _ = Department.objects.get_or_create(community=home, code=code, defaults={"name": f"Fire {home.code}", "responds_to_emergencies": True, "emergency_types": [EmergencyAlert.Type.FIRE]})
        position = Position.objects.create(name=f"Responder {home.code}", code=f"responder-{home.code}", department=department)
        Designation.objects.create(user=responder, department=department, position=position)
        EmergencyTypeRoleMap.objects.get_or_create(community=home, emergency_type=EmergencyAlert.Type.FIRE, department=department, defaults={"responder_unit": "bdrrmo"})
        return responder

    def test_local_responder_wins_even_when_foreign_is_closer(self):
        local = self.responder("local@example.com", self.owner, "fire", 0.9, 0.9)
        self.responder("foreign@example.com", self.foreign, "fire", 0.5001, 0.5001)

        self.assertEqual(find_auto_responders(self.alert, limit=1), [local])

    def test_foreign_matching_responder_is_used_after_local_exhaustion(self):
        foreign = self.responder("foreign@example.com", self.foreign, "fire", 0.6, 0.6)

        self.assertEqual(find_auto_responders_by_unit(self.alert), [foreign])

    def test_foreign_responder_without_type_mapping_is_not_used(self):
        responder = self.responder("foreign@example.com", self.foreign, "fire", 0.6, 0.6)
        EmergencyTypeRoleMap.objects.filter(community=self.foreign).update(is_active=False)

        self.assertNotIn(responder, find_auto_responders(self.alert, limit=5))

    def test_matching_role_map_wins_over_an_unrelated_designation(self):
        unrelated = community("unrelated", 4)
        responder = self.user("multi@example.com", User.Role.FIRST_RESPONDER, self.foreign, 0.6, 0.6)
        unrelated_department = Department.objects.create(community=unrelated, name="Other", code="other")
        position = Position.objects.create(name="Other role", code="other-role", department=unrelated_department)
        Designation.objects.create(user=responder, department=unrelated_department, position=position)
        foreign_department = Department.objects.create(community=self.foreign, name="Fire foreign", code="fire")
        fire_position = Position.objects.create(name="Fire role", code="fire-role", department=foreign_department)
        Designation.objects.create(user=responder, department=foreign_department, position=fire_position)
        expected = EmergencyTypeRoleMap.objects.create(
            community=self.foreign,
            emergency_type=EmergencyAlert.Type.FIRE,
            department=foreign_department,
            responder_unit="bdrrmo",
        )

        self.assertEqual(role_map_for_responder(self.alert, responder), expected)

    def test_backup_api_routes_to_same_unit_in_another_community(self):
        primary = self.responder("primary@example.com", self.owner, "fire", 0.8, 0.8)
        foreign = self.responder("foreign-backup@example.com", self.foreign, "fire", 0.6, 0.6)
        self.alert.status = EmergencyAlert.Status.ROUTED
        self.alert.save(update_fields=["status"])
        EmergencyResponderAssignment.objects.create(alert=self.alert, responder=primary)
        client = APIClient()
        client.force_authenticate(primary)

        response = client.post(
            f"/api/emergencies/{self.alert.pk}/request-backup/",
            {
                "target_department_id": self.owner_department.pk,
                "reason": "A second fire team is needed.",
                "urgency": "immediate",
                "idempotency_key": str(uuid.uuid4()),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        request = BackupRequest.objects.get(alert=self.alert)
        self.assertEqual(request.status, BackupRequest.Status.ASSIGNED)
        self.assertEqual(request.assignment.responder, foreign)
        self.assertEqual(request.assignment.responding_community, self.foreign)
        self.assertTrue(request.assignment.is_cross_community)
        self.assertEqual(request.assignment.role_map.department.code, self.owner_department.code)
