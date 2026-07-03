from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from .models import ConcernCategory, ConcernReport, ConcernVote


class ConcernWorkflowTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="resident-concern@example.com", phone_number="+639111111111", password="Str0ng!Pass123", status=get_user_model().Status.VERIFIED)
        self.category = ConcernCategory.objects.create(name="Infrastructure")
        self.client.force_authenticate(self.user)

    def test_resident_can_create_list_and_support_concern(self):
        response = self.client.post("/api/concerns/reports/", {"barangay": "Marikina Heights", "category": self.category.id, "description": "Sira ang tulay sa barangay hall", "latitude": "14.5892345", "longitude": "121.0203456", "severity_score": 4}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        report_id = response.data["id"]
        self.assertTrue(response.data["tracking_number"].startswith("RPT-"))

        mine = self.client.get("/api/concerns/reports/mine/")
        self.assertEqual(mine.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mine.data.get("results", mine.data)), 1)

        vote = self.client.post(f"/api/concerns/reports/{report_id}/support/")
        self.assertEqual(vote.status_code, status.HTTP_201_CREATED)
        self.assertEqual(vote.data["vote_count"], 1)
        self.assertEqual(ConcernVote.objects.count(), 1)

    def test_barangay_official_can_update_status(self):
        official = get_user_model().objects.create_user(email="official-concern@example.com", phone_number="+639111111112", password="Str0ng!Pass123", role=get_user_model().Role.BARANGAY_OFFICIAL, status=get_user_model().Status.VERIFIED)
        report = ConcernReport.objects.create(resident=self.user, barangay="Marikina Heights", category=self.category, description="Broken drainage near school", latitude="14.5892345", longitude="121.0203456")
        self.client.force_authenticate(official)
        response = self.client.post(f"/api/concerns/reports/{report.id}/status/", {"status": "in_progress", "resolution_note": "Assigned to engineering"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        report.refresh_from_db()
        self.assertEqual(report.status, "in_progress")
        self.assertEqual(report.status_history.count(), 1)
