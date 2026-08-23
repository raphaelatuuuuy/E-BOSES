"""Smoke tests for platform-level endpoints: health and the API docs surface."""

from django.test import TestCase
from rest_framework.test import APIClient


class PlatformSurfaceTests(TestCase):
    def test_health_reports_core_status(self):
        response = APIClient().get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["database"], "ok")

    def test_deep_health_includes_dependency_probes(self):
        # Values depend on the machine's configured providers; the contract is
        # that every probe family answers, never raises.
        response = APIClient().get("/api/health/", {"deep": "1"})
        self.assertEqual(response.status_code, 200)
        dependencies = response.json().get("dependencies") or {}
        for key in ("cache", "redis", "email", "ai", "sms_gateway"):
            self.assertIn(key, dependencies)

    def test_openapi_schema_is_served(self):
        response = APIClient().get("/api/schema/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"openapi", response.content[:200])

    def test_openapi_json_has_examples_and_tags(self):
        response = APIClient().get("/api/schema/", {"format": "json"})
        self.assertEqual(response.status_code, 200)
        spec = response.json()
        self.assertIn("E-Boses API", spec["info"]["title"])
        self.assertTrue(spec["paths"])
        login = spec["paths"].get("/api/auth/login/", {}).get("post", {})
        self.assertIn("Log in", login.get("summary", ""))
        self.assertTrue(login.get("requestBody"))

    def test_docs_portal_serves_elements(self):
        response = APIClient().get("/api/docs/")
        self.assertEqual(response.status_code, 200)
        body = str(response.content)
        self.assertIn("elements-api", body)
        self.assertIn("doc.json", body)

    def test_swagger_ui_is_served(self):
        response = APIClient().get("/api/swagger/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"swagger", str(response.content).lower().encode())
