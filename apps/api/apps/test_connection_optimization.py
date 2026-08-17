from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory

from apps.throttling import client_ip


class ClientIdentityTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @override_settings(TRUSTED_PROXY_IPS=["127.0.0.1"])
    def test_trusted_proxy_forwarded_client_is_used(self):
        request = self.factory.get("/api/system/status/", HTTP_X_FORWARDED_FOR="10.0.0.8, 127.0.0.1")
        request.META["REMOTE_ADDR"] = "127.0.0.1"
        self.assertEqual(client_ip(request), "10.0.0.8")

    @override_settings(TRUSTED_PROXY_IPS=["127.0.0.1"])
    def test_untrusted_forwarded_client_is_ignored(self):
        request = self.factory.get("/api/system/status/", HTTP_X_FORWARDED_FOR="10.0.0.8")
        request.META["REMOTE_ADDR"] = "192.0.2.4"
        self.assertEqual(client_ip(request), "192.0.2.4")
