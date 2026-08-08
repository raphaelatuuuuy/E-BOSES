from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.concerns.models import Department, Designation, Position

User = get_user_model()


"""Create, edit and delete on the Units screen.

Added after the screen shipped without a delete control and the add path
could not be distinguished from a permissions failure.
"""


class UnitCrudTests(APITestCase):
    def setUp(self):
        self.captain = User.objects.create_user(
            email="crud-captain@example.com", phone_number="+639174440001",
            password="pass", role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED, is_staff=True,
        )
        Designation.objects.create(
            user=self.captain,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.client.force_authenticate(self.captain)

    def test_create_minimal_unit(self):
        r = self.client.post(
            "/api/concerns/admin/departments/",
            {"name": "Test Unit", "code": "test-unit", "emergency_types": []},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)

    def test_create_with_full_draft_shape_from_ui(self):
        # Exactly what the Units screen sends for a new unit.
        r = self.client.post(
            "/api/concerns/admin/departments/",
            {"name": "UI Unit", "code": "ui-unit", "emergency_types": [], "short_name": "", "description": ""},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)

    def test_patch_existing_unit_with_echoed_payload(self):
        # The screen PATCHes back the whole row it received, including read-only
        # fields like member_count.
        listing = self.client.get("/api/concerns/admin/departments/")
        row = dict(listing.data[0])
        row["short_name"] = "Edited"
        r = self.client.patch(f"/api/concerns/admin/departments/{row['id']}/", row, format="json")
        self.assertEqual(r.status_code, status.HTTP_200_OK)

    def test_delete_unused_unit(self):
        created = self.client.post(
            "/api/concerns/admin/departments/",
            {"name": "Doomed Unit", "code": "doomed-unit"},
            format="json",
        )
        r = self.client.delete(f"/api/concerns/admin/departments/{created.data['id']}/")
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertTrue(r.data["deleted"])