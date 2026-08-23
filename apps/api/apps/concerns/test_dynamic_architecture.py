from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import ResidentProfile
from apps.notifications.models import Notification

from .models import (
    ChatMessageRead,
    Concern,
    ConcernAssignment,
    ConcernCategory,
    ConcernFormField,
    ConcernFormValue,
    ConcernTimelineEntry,
    Department,
    DepartmentChatMessage,
    DepartmentChatThread,
    Designation,
    Position,
    RoutingRule,
)


def png_upload(name="evidence.png"):
    output = BytesIO()
    image = Image.new("RGB", (320, 240), color=(245, 245, 245))
    image.paste((90, 70, 55), (0, 0, 180, 240))
    image.save(output, format="PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


class DynamicConcernArchitectureTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            email="dynamic-admin@example.com",
            phone_number="+639180001001",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
            is_staff=True,
        )
        Designation.objects.create(
            user=self.admin,
            department=Department.objects.get(code="sangguniang-barangay"),
            position=Position.objects.get(code="barangay-captain"),
        )
        self.secretary = User.objects.create_user(
            email="dynamic-secretary@example.com",
            phone_number="+639180001002",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.kagawad = User.objects.create_user(
            email="dynamic-kagawad@example.com",
            phone_number="+639180001003",
            password="pass",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        home = Department.objects.get(code="sangguniang-barangay")
        Designation.objects.create(
            user=self.secretary,
            department=home,
            position=Position.objects.get(code="secretary"),
        )
        Designation.objects.create(
            user=self.kagawad,
            department=home,
            position=Position.objects.get(code="kagawad"),
        )
        self.responder = User.objects.create_user(
            email="dynamic-responder@example.com",
            phone_number="+639180001004",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        self.other_responder = User.objects.create_user(
            email="dynamic-other-responder@example.com",
            phone_number="+639180001005",
            password="pass",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
        )
        self.resident = User.objects.create_user(
            email="dynamic-resident@example.com",
            phone_number="+639180001006",
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

    def configure_illegal_dumping(self):
        self.client.force_authenticate(self.admin)
        # A code the seeded roster does not already own: 0025_department_roster
        # seeds "environment-sanitation", so creating it here collides with the
        # unique constraint. The point of this test is that a *new* unit can be
        # configured and routed to, not that this particular code is free.
        department = self.client.post(
            "/api/concerns/admin/departments/",
            {"name": "Illegal Dumping Task Force", "code": "illegal-dumping-task-force"},
            format="json",
        )
        self.assertEqual(department.status_code, status.HTTP_201_CREATED, department.data)
        responder_position = self.client.post(
            "/api/concerns/admin/positions/",
            {"name": "Field Responder", "code": "field-responder", "permissions": ["resolve_concerns"], "department": department.data["id"]},
            format="json",
        )
        self.assertEqual(responder_position.status_code, status.HTTP_201_CREATED)
        designation = self.client.post(
            "/api/concerns/admin/designations/",
            {
                "user": self.responder.pk,
                "department": department.data["id"],
                "position": responder_position.data["id"],
                "title": "Environment Dept Field Responder",
            },
            format="json",
        )
        self.assertEqual(designation.status_code, status.HTTP_201_CREATED)
        category = self.client.post(
            "/api/concerns/admin/categories/",
            {
                "name": "Illegal Dumping",
                "code": "illegal_dumping",
                "description": "Improper waste disposal reports.",
                "department": department.data["id"],
            },
            format="json",
        )
        self.assertEqual(category.status_code, status.HTTP_201_CREATED)
        field_payloads = [
            {"field_key": "description", "label": "Description", "field_type": "text", "is_required": True, "sort_order": 1},
            {
                "field_key": "waste_type",
                "label": "Type of Waste",
                "field_type": "select",
                "is_required": True,
                "sort_order": 2,
                "options": ["Construction", "Household", "Bio"],
            },
            {"field_key": "estimated_volume", "label": "Estimated Volume", "field_type": "text", "is_required": False, "sort_order": 3},
        ]
        for payload in field_payloads:
            created = self.client.post(
                f"/api/concerns/admin/categories/{category.data['id']}/fields/",
                payload,
                format="json",
            )
            self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        routing = self.client.post(
            "/api/concerns/admin/routing-rules/",
            {
                "name": "Illegal dumping to sanitation",
                "category": category.data["id"],
                "department": department.data["id"],
                "priority": 10,
            },
            format="json",
        )
        self.assertEqual(routing.status_code, status.HTTP_201_CREATED)
        return category.data["id"], department.data["id"]

    def test_dynamic_category_routes_report_and_preserves_form_values_and_timeline(self):
        category_id, department_id = self.configure_illegal_dumping()

        self.client.force_authenticate(self.resident)
        created = self.client.post(
            "/api/concerns/",
            {
                "title": "Construction debris blocking sidewalk",
                "description": "Large pile of construction debris blocking the sidewalk.",
                "category_id": category_id,
                "visibility": "community",
                "address": "Blk 5 Lot 2",
                "latitude": "14.6507000",
                "longitude": "121.1133000",
                "location_source": "gps",
                "dynamic_fields": '{"waste_type":"Construction","estimated_volume":"2 sacks"}',
                "media": png_upload("debris_1.png"),
            },
            format="multipart",
        )

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        concern = Concern.objects.get(pk=created.data["id"])
        self.assertEqual(concern.category_ref_id, category_id)
        self.assertEqual(concern.assigned_department_id, department_id)
        self.assertEqual(ConcernFormValue.objects.get(concern=concern, field__field_key="waste_type").value, "Construction")
        self.assertTrue(
            ConcernTimelineEntry.objects.filter(
                concern=concern,
                event_type=ConcernTimelineEntry.EventType.SUBMITTED,
                actor=self.resident,
                visible_to_resident=True,
            ).exists()
        )

        concern.validation_status = Concern.ValidationStatus.ACCEPTED
        concern.save(update_fields=["validation_status", "updated_at"])

        self.client.force_authenticate(self.kagawad)
        assigned = self.client.post(
            f"/api/concerns/{concern.pk}/assign/",
            {
                "assignee_id": self.responder.pk,
                "department_id": department_id,
                "note": "Case assigned to Responder Maria Reyes for field inspection.",
            },
            format="json",
        )
        self.assertEqual(assigned.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ConcernAssignment.objects.get(concern=concern, status=ConcernAssignment.Status.ACTIVE).department_id, department_id)

        self.client.force_authenticate(self.responder)
        mine = self.client.get("/api/concerns/assigned/")
        self.assertEqual(mine.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in mine.data["results"]], [concern.pk])
        self.client.force_authenticate(self.other_responder)
        other = self.client.get("/api/concerns/assigned/")
        self.assertEqual(other.status_code, status.HTTP_200_OK)
        self.assertEqual(other.data["results"], [])

        self.client.force_authenticate(self.responder)
        timeline = self.client.post(
            f"/api/concerns/{concern.pk}/timeline/",
            {
                "event_type": "custom",
                "message": "Schedule of ocular inspection on July 29, 2026 at 8:00 AM",
                "status": Concern.Status.IN_PROGRESS,
                "is_custom": True,
            },
            format="json",
        )
        self.assertEqual(timeline.status_code, status.HTTP_201_CREATED)
        detail = self.client.get(f"/api/concerns/{concern.pk}/")
        self.assertIn("timeline", detail.data)
        self.assertIn(
            "Schedule of ocular inspection",
            " ".join(item["message"] for item in detail.data["timeline"]),
        )
        self.assertEqual(timeline.data["actor"]["full_name"], "dynamic-responder")

    def test_case_chat_supports_reads_typing_notifications_and_department_chat(self):
        category_id, department_id = self.configure_illegal_dumping()
        concern = Concern.objects.create(
            reporter=self.resident,
            title="Existing illegal dumping case",
            description="Construction debris near the sidewalk.",
            category_ref_id=category_id,
            assigned_department_id=department_id,
            status=Concern.Status.ASSIGNED,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        ConcernAssignment.objects.create(
            concern=concern,
            assignee=self.responder,
            assigned_by=self.kagawad,
            department_id=department_id,
            status=ConcernAssignment.Status.ACTIVE,
        )

        self.client.force_authenticate(self.responder)
        message = self.client.post(
            f"/api/concerns/{concern.pk}/chat/",
            {"body": "Good day! I will conduct an ocular inspection on July 29, 2026 at 8:00 AM."},
            format="json",
        )
        self.assertEqual(message.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Notification.objects.filter(recipient=self.resident, type="chat_message", concern=concern).exists())

        self.client.force_authenticate(self.resident)
        read = self.client.post(
            f"/api/concerns/{concern.pk}/chat/read/",
            {"last_read_message_id": message.data["id"]},
            format="json",
        )
        self.assertEqual(read.status_code, status.HTTP_200_OK)
        self.assertTrue(ChatMessageRead.objects.filter(message_id=message.data["id"], user=self.resident).exists())

        typing = self.client.post(
            f"/api/concerns/{concern.pk}/chat/typing/",
            {"is_typing": True},
            format="json",
        )
        self.assertEqual(typing.status_code, status.HTTP_200_OK)
        self.assertEqual(typing.data["is_typing"], True)

        self.client.force_authenticate(self.secretary)
        thread = self.client.post(
            "/api/concerns/department-chat/threads/",
            {"department": department_id, "title": "Environment field coordination"},
            format="json",
        )
        self.assertEqual(thread.status_code, status.HTTP_201_CREATED)
        department_message = self.client.post(
            f"/api/concerns/department-chat/threads/{thread.data['id']}/messages/",
            {"body": "Please prepare hauling coordination for the inspection."},
            format="json",
        )
        self.assertEqual(department_message.status_code, status.HTTP_201_CREATED)
        self.assertEqual(DepartmentChatThread.objects.count(), 1)
        self.assertEqual(DepartmentChatMessage.objects.count(), 1)
        self.assertFalse(DepartmentChatMessage.objects.filter(sender=self.resident).exists())
