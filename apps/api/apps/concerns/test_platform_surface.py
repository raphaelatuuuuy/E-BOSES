"""Smoke tests for platform-level endpoints: health and the API docs surface."""

import json

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

    def _schema(self):
        response = APIClient().get("/api/schema/", {"format": "json"})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_openapi_schema_is_served(self):
        response = APIClient().get("/api/schema/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"openapi", response.content[:200])

    def test_openapi_json_has_examples_and_tags(self):
        spec = self._schema()
        self.assertIn("E-Boses API", spec["info"]["title"])
        self.assertTrue(spec["paths"])
        login = spec["paths"].get("/api/auth/login/", {}).get("post", {})
        self.assertIn("Log in", login.get("summary", ""))
        self.assertTrue(login.get("requestBody"))

    def test_openapi_documents_shared_error_contract(self):
        spec = self._schema()
        self.assertIn("Error", spec["components"]["schemas"])
        # Authenticated endpoints gain 401/403 with example bodies, and every
        # endpoint gains 500.
        unread = spec["paths"]["/api/notifications/unread-count/"]["get"]
        for code in ("401", "403", "500"):
            self.assertIn(code, unread["responses"])
            media = unread["responses"][code]["content"]["application/json"]
            self.assertIn("examples", media)
        # Public endpoints must not claim 401/403.
        public = spec["paths"]["/api/public/communities/"]["get"]
        self.assertNotIn("401", public["responses"])
        self.assertNotIn("403", public["responses"])
        self.assertIn("500", public["responses"])

    def test_openapi_success_responses_carry_a_body(self):
        spec = self._schema()
        # Hand-rolled views used to render as "No response body" in Swagger UI;
        # the post-processing hook gives them an honest generic payload shape.
        unread = spec["paths"]["/api/notifications/unread-count/"]["get"]
        self.assertTrue(unread["responses"]["200"]["content"])
        # The shared paginated envelope is part of the schema contract; lists
        # already typed with their own envelope (e.g. ConcernListEnvelope)
        # keep their richer shape untouched.
        self.assertIn("PaginatedListEnvelope", spec["components"]["schemas"])
        # 204 responses stay bodyless by design.
        self.assertNotIn(
            "content", spec["paths"]["/api/notifications/{id}/"]["delete"]["responses"]["204"]
        )

    def test_docs_portal_serves_kimi_style_overview(self):
        response = APIClient().get("/api/docs/")
        self.assertEqual(response.status_code, 200)
        body = str(response.content)
        self.assertIn("API Overview", body)
        self.assertIn("Service Address", body)
        self.assertIn("doc.json", body)

    def test_swagger_ui_is_served(self):
        response = APIClient().get("/api/swagger/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"swagger", str(response.content).lower().encode())
