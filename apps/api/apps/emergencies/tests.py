from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase


class EmergencyWorkflowTests(APITestCase):
    def test_alert_assignment_acknowledgement_and_status_update(self):
        User = get_user_model()
        resident = User.objects.create_user(email="resident-emergency@example.com", phone_number="+639122222221", password="Str0ng!Pass123", status=User.Status.VERIFIED)
        responder = User.objects.create_user(email="responder@example.com", phone_number="+639122222222", password="Str0ng!Pass123", role=User.Role.FIRST_RESPONDER, status=User.Status.VERIFIED)
        self.client.force_authenticate(resident)
        create = self.client.post("/api/emergencies/alerts/", {"barangay": "Marikina Heights", "alert_type": "medical", "description": "Need first aid", "latitude": "14.5892345", "longitude": "121.0203456"}, format="json")
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        alert_id = create.data["id"]

        self.client.force_authenticate(responder)
        assign = self.client.post(f"/api/emergencies/alerts/{alert_id}/assign/")
        self.assertEqual(assign.status_code, status.HTTP_200_OK)
        acknowledge = self.client.post(f"/api/emergencies/alerts/{alert_id}/acknowledge/")
        self.assertEqual(acknowledge.status_code, status.HTTP_200_OK)
        resolved = self.client.post(f"/api/emergencies/alerts/{alert_id}/status/", {"status": "resolved", "note": "Patient assisted"}, format="json")
        self.assertEqual(resolved.status_code, status.HTTP_200_OK)
        self.assertEqual(resolved.data["status"], "resolved")
