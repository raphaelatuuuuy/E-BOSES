import base64
import hashlib
import hmac
import json
import time
from datetime import timedelta
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import ServiceHealthDay, ServiceHealthState, ServiceIncident
from apps.service_status import (
    DEGRADED,
    DOWN,
    NOT_CONFIGURED,
    OPERATIONAL,
    PROBES,
    UNKNOWN,
    _availability,
    _email,
    _group_history,
    _record,
    _sms,
    _update_states,
    collect,
)


def result(status_value, key="worker"):
    label, description, _probe = PROBES[key]
    return {
        "key": key,
        "label": label,
        "description": description,
        "status": status_value,
        "message": "Health check failed." if status_value != OPERATIONAL else "",
        "latency_ms": 25,
        "detail": "test",
    }


class ServiceHealthSamplingTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_one_sample_is_recorded_per_five_minute_bucket(self):
        current = timezone.now()
        now = current.replace(minute=current.minute - current.minute % 5, second=0, microsecond=0)
        _record({"worker": result(OPERATIONAL)}, now)
        _record({"worker": result(DOWN)}, now + timedelta(minutes=1))
        row = ServiceHealthDay.objects.get(module_key="worker")
        self.assertEqual(row.checks_total, 1)
        self.assertEqual(row.operational_checks, 1)

        _record({"worker": result(DOWN)}, now + timedelta(minutes=5))
        row.refresh_from_db()
        self.assertEqual(row.checks_total, 2)
        self.assertEqual(row.down_checks, 1)

    def test_availability_uses_checks_not_worst_day(self):
        day = timezone.localdate()
        history = {
            "worker": {
                day.isoformat(): {
                    "issues": [],
                    "checks_total": 12,
                    "operational_checks": 10,
                    "degraded_checks": 1,
                    "down_checks": 1,
                    "not_configured_checks": 0,
                    "unknown_checks": 0,
                }
            }
        }
        days = _group_history(("worker",), history)
        availability = _availability(days)
        self.assertEqual(availability["measured_checks"], 12)
        self.assertEqual(availability["percent"], 91.67)

    def test_failures_open_and_recovery_closes_an_incident(self):
        now = timezone.now()
        _update_states({"worker": result(DOWN)}, now)
        self.assertEqual(ServiceHealthState.objects.get(module_key="worker").status, DEGRADED)
        self.assertFalse(ServiceIncident.objects.exists())

        _update_states({"worker": result(DOWN)}, now + timedelta(minutes=5))
        self.assertEqual(ServiceHealthState.objects.get(module_key="worker").status, DOWN)
        self.assertTrue(ServiceIncident.objects.filter(resolved_at__isnull=True).exists())

        _update_states({"worker": result(OPERATIONAL)}, now + timedelta(minutes=10))
        self.assertEqual(ServiceHealthState.objects.get(module_key="worker").status, OPERATIONAL)
        self.assertFalse(ServiceIncident.objects.filter(resolved_at__isnull=True).exists())

    def test_unknown_service_prevents_all_operational_headline(self):
        checked_at = timezone.now()
        for key in PROBES:
            ServiceHealthState.objects.create(
                module_key=key,
                status=UNKNOWN if key == "push" else OPERATIONAL,
                checked_at=checked_at,
            )
        payload = collect(use_cache=False)
        self.assertEqual(payload["headline"], "Some services could not be verified")
        self.assertEqual(payload["counts"]["unknown"], 1)

    def test_headline_lists_each_problem_type(self):
        checked_at = timezone.now()
        for index, key in enumerate(PROBES):
            status_value = DOWN if index == 0 else DEGRADED if index == 1 else UNKNOWN if index < 5 else OPERATIONAL
            ServiceHealthState.objects.create(
                module_key=key,
                status=status_value,
                checked_at=checked_at,
            )
        payload = collect(use_cache=False)
        self.assertEqual(payload["headline"], "Some services need attention")


class ResendHealthWebhookTests(TestCase):
    @override_settings(
        EMAIL_OTP_PROVIDER="resend",
        RESEND_API_KEY="test",
        RESEND_API_URL="https://api.resend.com/emails",
    )
    @patch("httpx.get")
    def test_recent_delivered_email_is_operational(self, get):
        response = Mock(raise_for_status=Mock())
        response.json.return_value = {
            "data": [{"last_event": "delivered", "created_at": timezone.now().isoformat()}]
        }
        get.return_value = response
        status_value, _detail = _email()
        self.assertEqual(status_value, OPERATIONAL)

    @override_settings(RESEND_WEBHOOK_SECRET="whsec_dGVzdC1zZWNyZXQ=")
    def test_delivered_event_records_operational_evidence(self):
        body = json.dumps({"type": "email.delivered"}, separators=(",", ":"))
        event_id = "msg_test"
        timestamp = str(int(timezone.now().timestamp()))
        signed = f"{event_id}.{timestamp}.{body}".encode()
        signature = base64.b64encode(
            hmac.new(b"test-secret", signed, hashlib.sha256).digest()
        ).decode()
        response = APIClient().post(
            "/api/config/resend-health/",
            data=body,
            content_type="application/json",
            HTTP_SVIX_ID=event_id,
            HTTP_SVIX_TIMESTAMP=timestamp,
            HTTP_SVIX_SIGNATURE=f"v1,{signature}",
        )
        self.assertEqual(response.status_code, 204)
        self.assertIsNotNone(cache.get("service-status:email-delivered"))


class SmsHealthTests(TestCase):
    def setUp(self):
        cache.clear()

    @override_settings(
        OUTBOUND_SMS_DRIVER="android_sms_gateway",
        OUTBOUND_SMS_URL="https://api.sms-gate.app/3rdparty/v1/messages",
        OUTBOUND_SMS_USERNAME="test",
        OUTBOUND_SMS_PASSWORD="test",
        SMS_INBOUND_WEBHOOK_TOKEN="test",
    )
    @patch("httpx.get")
    def test_cloud_api_without_device_ping_is_unknown(self, get):
        get.return_value = Mock(
            raise_for_status=Mock(),
            json=Mock(return_value=[{"event": "sms:received"}]),
        )
        status_value, _detail = _sms()
        self.assertEqual(status_value, UNKNOWN)
        get.assert_called_once_with(
            "https://api.sms-gate.app/3rdparty/v1/webhooks",
            auth=("test", "test"),
            timeout=10,
        )

    @override_settings(
        OUTBOUND_SMS_DRIVER="android_sms_gateway",
        OUTBOUND_SMS_URL="https://api.sms-gate.app/3rdparty/v1/messages",
        OUTBOUND_SMS_USERNAME="test",
        OUTBOUND_SMS_PASSWORD="test",
        SMS_INBOUND_WEBHOOK_TOKEN="test",
    )
    @patch("httpx.get")
    def test_cloud_api_with_recent_device_ping_is_operational(self, get):
        get.return_value = Mock(
            raise_for_status=Mock(),
            json=Mock(return_value=[{"event": "sms:received"}]),
        )
        cache.set("sms-gateway:last-device-ping", time.time(), 60)
        status_value, _detail = _sms()
        self.assertEqual(status_value, OPERATIONAL)

    @override_settings(
        OUTBOUND_SMS_DRIVER="android_sms_gateway",
        OUTBOUND_SMS_URL="https://api.sms-gate.app/3rdparty/v1/messages",
        OUTBOUND_SMS_USERNAME="test",
        OUTBOUND_SMS_PASSWORD="test",
    )
    @patch("httpx.get")
    def test_cloud_without_inbound_webhook_needs_setup(self, get):
        get.return_value = Mock(raise_for_status=Mock(), json=Mock(return_value=[]))
        status_value, _detail = _sms()
        self.assertEqual(status_value, NOT_CONFIGURED)


class HealthSplitTests(TestCase):
    """live/ready split: liveness never touches external services."""

    def test_live_returns_ok(self):
        response = self.client.get("/api/health/live/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_ready_reports_database(self):
        response = self.client.get("/api/health/ready/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "ok")
