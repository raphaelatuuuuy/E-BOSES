"""IP-intel gating: the full scenario matrix from scripts/test_ip_intel_scenarios.py."""

from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from .ip_intel import evaluate, get_client_ip

IP_INTEL_SETTINGS = {
    "IP_INTEL_URL": "http://intel.test/check",
    "IP_INTEL_TIMEOUT_SECONDS": 1.0,
    "IP_INTEL_TRUSTED_PROXIES": ["127.0.0.1"],
}


def ip_info(asn, org, country="PH", type_="isp", is_vpn=False, is_proxy=False):
    return {
        "ip": "0.0.0.0",
        "asn": asn,
        "org": org,
        "isp": org,
        "country": country,
        "country_code": country,
        "type": type_,
        "is_vpn": is_vpn,
        "is_proxy": is_proxy,
    }


def payload(info=None, **overrides):
    body = {"verdict": "clean", "score": 0.0, "is_vpn": False, "confidence": 0.9, "signals": []}
    body.update(overrides)
    if info is not None:
        body["ip_info"] = info
    return body


class EvaluateMatrixTests(SimpleTestCase):
    def test_allowlisted_carriers_pass_regardless_of_verdict(self):
        for asn, org, extra in [
            ("AS9299", "PLDT", {}),
            ("AS4775", "Globe Telecom", {}),
            ("AS139831", "DITO", {}),
            ("AS14593", "SpaceX Starlink", {"verdict": "suspicious", "is_vpn": True}),
            ("AS9299", "PLDT", {"ip_info": ip_info("AS9299", "PLDT", type_="datacenter")}),
        ]:
            allowed, reason, meta = evaluate(payload(ip_info(asn, org), **extra))
            self.assertTrue(allowed, asn)
            self.assertIsNone(reason)
            self.assertEqual(meta["verdict"], "allowlisted")

    def test_clean_unrecognized_networks_pass(self):
        allowed, reason, meta = evaluate(payload(ip_info("AS64111", "ABC Corporation PH")))
        self.assertTrue(allowed)
        self.assertIsNone(reason)
        allowed, reason, _ = evaluate(payload(ip_info("AS99999", "Roaming carrier", type_="cellular")))
        self.assertTrue(allowed)
        self.assertIsNone(reason)

    def test_blocked_scenarios_carry_the_expected_reason(self):
        cases = [
            (payload(ip_info("AS15169", "Google", country="US")), "outside_philippines"),
            (payload(ip_info("AS2121", "Some VPN Co", is_vpn=True), verdict="vpn_detected", is_vpn=True), "vpn_or_proxy"),
            (payload(ip_info("AS7629", "VITRO, Inc.", type_="datacenter")), "datacenter_or_hosting"),
            (payload(ip_info("AS64111", "Some Network", type_="business")), "unknown_isp"),
            (payload(ip_info("AS64111", "Unknown PH ISP"), verdict="suspicious", score=0.55), "suspicious_network"),
            (payload(ip_info("AS64111", "Proxy Co", is_proxy=True), verdict="suspicious"), "vpn_or_proxy"),
        ]
        for body, expected_reason in cases:
            allowed, reason, _ = evaluate(body)
            self.assertFalse(allowed, expected_reason)
            self.assertEqual(reason, expected_reason)


@override_settings(**IP_INTEL_SETTINGS)
class IpIntelApiTests(APITestCase):
    def setUp(self):
        # Lookups are cached per IP; without this one test's verdict leaks
        # into the next, because they share a client address.
        cache.clear()
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="ipintel@example.com",
            phone_number="+639170001201",
            password="pass",
            status=User.Status.VERIFIED,
        )

    def mock_lookup(self, body):
        response = Mock()
        response.json.return_value = body
        return response

    def test_blocked_login_returns_403_with_reason(self):
        with patch("apps.accounts.ip_intel.requests.post") as mock_post:
            mock_post.return_value = self.mock_lookup(payload(ip_info("AS15169", "Google", country="US")))
            response = self.client.post(
                "/api/auth/login/",
                {"identifier": "ipintel@example.com", "password": "pass"},
                format="json",
                HTTP_X_FORWARDED_FOR="203.0.113.10",
            )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["code"], "ip_blocked")
        self.assertEqual(response.data["reason"], "outside_philippines")

    def test_allowed_login_records_ip_fields_on_the_user(self):
        with patch("apps.accounts.ip_intel.requests.post") as mock_post:
            mock_post.return_value = self.mock_lookup(
                payload(ip_info("AS9299", "PLDT"), score=0.12)
            )
            response = self.client.post(
                "/api/auth/login/",
                {"identifier": "ipintel@example.com", "password": "pass"},
                format="json",
                HTTP_X_FORWARDED_FOR="203.0.113.10",
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.resident.refresh_from_db()
        self.assertEqual(self.resident.ip_asn, "AS9299")
        self.assertEqual(self.resident.ip_country, "PH")
        self.assertEqual(self.resident.ip_org, "PLDT")
        self.assertEqual(self.resident.ip_verdict, "allowlisted")
        self.assertEqual(self.resident.ip_score, 0.12)

    def test_fail_open_on_timeout_never_blocks(self):
        with patch("apps.accounts.ip_intel.requests.post") as mock_post:
            mock_post.side_effect = __import__("requests").Timeout
            response = self.client.post(
                "/api/auth/login/",
                {"identifier": "ipintel@example.com", "password": "pass"},
                format="json",
                HTTP_X_FORWARDED_FOR="203.0.113.10",
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_fail_open_on_malformed_and_incomplete_responses(self):
        for body in ["this is not json", {"verdict": "clean"}]:
            with patch("apps.accounts.ip_intel.requests.post") as mock_post:
                mock_post.return_value = self.mock_lookup(body)
                response = self.client.post(
                    "/api/auth/login/",
                    {"identifier": "ipintel@example.com", "password": "pass"},
                    format="json",
                    HTTP_X_FORWARDED_FOR="203.0.113.10",
                )
            self.assertEqual(response.status_code, status.HTTP_200_OK, body)

    def test_blocked_concern_and_emergency_creation(self):
        self.client.force_authenticate(self.resident)
        with patch("apps.accounts.ip_intel.requests.post") as mock_post:
            mock_post.return_value = self.mock_lookup(payload(ip_info("AS2121", "Some VPN Co", is_vpn=True), is_vpn=True))
            concern_response = self.client.post(
                "/api/concerns/", {}, format="json", HTTP_X_FORWARDED_FOR="203.0.113.10"
            )
            emergency_response = self.client.post(
                "/api/emergencies/", {}, format="json", HTTP_X_FORWARDED_FOR="203.0.113.10"
            )
        for response in (concern_response, emergency_response):
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(response.data["code"], "ip_blocked")
            self.assertEqual(response.data["reason"], "vpn_or_proxy")

    def test_untrusted_proxy_forwarded_header_is_ignored(self):
        with patch("apps.accounts.ip_intel.requests.post") as mock_post:
            mock_post.return_value = self.mock_lookup(payload(ip_info("AS9299", "PLDT")))
            response = self.client.post(
                "/api/auth/login/",
                {"identifier": "ipintel@example.com", "password": "pass"},
                format="json",
                HTTP_X_FORWARDED_FOR="8.8.8.8",
                REMOTE_ADDR="203.0.113.9",
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(mock_post.call_args.kwargs["json"]["ip"], "203.0.113.9")

    def test_trusted_proxy_forwarded_header_is_honored(self):
        with patch("apps.accounts.ip_intel.requests.post") as mock_post:
            mock_post.return_value = self.mock_lookup(payload(ip_info("AS15169", "Google", country="US")))
            response = self.client.post(
                "/api/auth/login/",
                {"identifier": "ipintel@example.com", "password": "pass"},
                format="json",
                HTTP_X_FORWARDED_FOR="8.8.8.8",
                REMOTE_ADDR="127.0.0.1",
            )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(mock_post.call_args.kwargs["json"]["ip"], "8.8.8.8")


class ClientIpResolutionTests(SimpleTestCase):
    def get_request(self, remote="203.0.113.9", forwarded=""):
        request = type("Request", (), {"META": {"REMOTE_ADDR": remote}})
        if forwarded:
            request.META["HTTP_X_FORWARDED_FOR"] = forwarded
        return request

    @override_settings(**IP_INTEL_SETTINGS)
    def test_forwarded_header_only_wins_behind_a_trusted_proxy(self):
        self.assertEqual(get_client_ip(self.get_request("127.0.0.1", "8.8.8.8, 10.0.0.1")), "8.8.8.8")
        self.assertEqual(get_client_ip(self.get_request("203.0.113.9", "8.8.8.8")), "203.0.113.9")
        self.assertEqual(get_client_ip(self.get_request("203.0.113.9")), "203.0.113.9")