"""Outbound SMS delivery.

Follows the provider-registry idiom already used for OTP delivery in
`apps.accounts.services.get_otp_provider`, so this codebase has one way of
swapping a delivery backend rather than two.

Drivers:

``console``        development — logs a redacted line, never leaves the machine
``sms_forwarder``  the configured SMS Forwarder handset
``http_generic``   any JSON-over-HTTP gateway, shaped entirely from settings
``disabled``       refuses to send; used to prove a failure path in tests

SMS Forwarder builds differ in the field names they expect
(``phone_numbers``/``msg_content`` vs ``to``/``message``), so the request body
comes from ``OUTBOUND_SMS_PAYLOAD_TEMPLATE``. Correcting a mismatch is a `.env`
edit, not a code change.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from urllib.parse import quote

import httpx
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import OutboundSmsMessage, SmsPurpose
from .normalize import last_four, normalize_ph_mobile

logger = logging.getLogger(__name__)

# Must match OutboundSmsMessage.idempotency_key. SQLite ignores varchar limits
# and Postgres does not, so this is asserted by a test rather than trusted.
IDEMPOTENCY_KEY_MAX_LENGTH = 128


class SmsDeliveryError(Exception):
    """Delivery failed in a way that may succeed on retry."""


class SmsConfigurationError(Exception):
    """The gateway is not configured; retrying will not help."""


# ---------------------------------------------------------------------------
# Message sizing
# ---------------------------------------------------------------------------

GSM7_BASIC = set(
    "@£$¥èéùìòÇ\nØø\rÅå_ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
    "ΔΦΓΛΩΠΨΣΘΞ"
)
# These fit in GSM-7 but occupy two septets each.
GSM7_EXTENDED = set("^{}\\[~]|€")


def is_gsm7(body: str) -> bool:
    return all(char in GSM7_BASIC or char in GSM7_EXTENDED for char in body or "")


def septet_length(body: str) -> int:
    return sum(2 if char in GSM7_EXTENDED else 1 for char in body or "")


def count_segments(body: str) -> int:
    """Billable segments for `body`.

    A single smart quote or em-dash forces the whole message to UCS-2 and more
    than halves the per-segment budget, so templates are tested against this.
    """
    if not body:
        return 0
    if is_gsm7(body):
        length = septet_length(body)
        return 1 if length <= 160 else -(-length // 153)
    length = len(body)
    return 1 if length <= 70 else -(-length // 67)


def non_gsm7_characters(body: str) -> list[str]:
    """Characters that would push a template to UCS-2 — used by the tests."""
    seen: dict[str, None] = {}
    for char in body or "":
        if char not in GSM7_BASIC and char not in GSM7_EXTENDED:
            seen.setdefault(char, None)
    return list(seen)


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------

class BaseSmsDriver:
    name = "base"

    def send(self, destination: str, body: str, timeout: float | None = None) -> None:
        raise NotImplementedError


class ConsoleSmsDriver(BaseSmsDriver):
    """Development driver. Prints the body but never the full destination."""

    name = "console"

    def send(self, destination: str, body: str, timeout: float | None = None) -> None:
        is_test = getattr(settings, "IS_TEST_RUN", False)
        if not (settings.DEBUG or getattr(settings, "IS_LOCAL_DEVELOPMENT", False) or is_test):
            raise SmsConfigurationError("The console SMS driver is only allowed in local development.")
        if not is_test:
            print(f"\n--- SMS to ••••{last_four(destination)} ---\n{body}\n--- end ---\n", flush=True)


class DisabledSmsDriver(BaseSmsDriver):
    name = "disabled"

    def send(self, destination: str, body: str, timeout: float | None = None) -> None:
        raise SmsConfigurationError("No outbound SMS gateway is configured.")


class HttpJsonSmsDriver(BaseSmsDriver):
    """Calls a gateway URL, shaped entirely from settings.

    Supports both conventions Android SMS gateways use:

    * ``OUTBOUND_SMS_METHOD=POST`` sends the JSON body from
      ``OUTBOUND_SMS_PAYLOAD_TEMPLATE``.
    * ``OUTBOUND_SMS_METHOD=GET`` substitutes ``{to}`` / ``{body}`` straight
      into ``OUTBOUND_SMS_URL``, e.g.
      ``http://192.168.1.20:8080/send?phone={to}&text={body}``.
    """

    name = "http_generic"
    default_template = '{"to": "{to}", "message": "{body}"}'

    def _template(self) -> str:
        return getattr(settings, "OUTBOUND_SMS_PAYLOAD_TEMPLATE", "") or self.default_template

    def _method(self) -> str:
        return (getattr(settings, "OUTBOUND_SMS_METHOD", "POST") or "POST").strip().upper()

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        header_name = getattr(settings, "OUTBOUND_SMS_AUTH_HEADER", "") or ""
        secret = getattr(settings, "OUTBOUND_SMS_SECRET", "") or ""
        if header_name and secret:
            headers[header_name] = secret
        extra = getattr(settings, "OUTBOUND_SMS_EXTRA_HEADERS", "") or ""
        if extra:
            try:
                headers.update(json.loads(extra))
            except (TypeError, ValueError) as exc:
                raise SmsConfigurationError("OUTBOUND_SMS_EXTRA_HEADERS is not valid JSON.") from exc
        return headers

    def build_payload(self, destination: str, body: str) -> dict:
        """Substitute into the parsed template so quoting can never break.

        Placeholders are replaced *after* the template is parsed as JSON, so a
        message body containing quotes, backslashes or newlines cannot produce
        a malformed request.
        """
        try:
            template = json.loads(self._template())
        except (TypeError, ValueError) as exc:
            raise SmsConfigurationError("OUTBOUND_SMS_PAYLOAD_TEMPLATE is not valid JSON.") from exc

        values = {
            "{to}": destination,
            "{body}": body,
            "{sim_slot}": int(getattr(settings, "OUTBOUND_SMS_SIM_SLOT", 2) or 2),
            "{timestamp}": int(time.time() * 1000),
            "{from}": getattr(settings, "SMS_GATEWAY_NUMBER", "") or "",
        }

        def substitute(node):
            if isinstance(node, dict):
                return {key: substitute(value) for key, value in node.items()}
            if isinstance(node, list):
                return [substitute(item) for item in node]
            if isinstance(node, str):
                if node in values:
                    return values[node]
                result = node
                for token, value in values.items():
                    if token in result:
                        result = result.replace(token, str(value))
                return result
            return node

        return substitute(template)

    def _sign(self, payload: dict) -> dict:
        """Attach an HMAC signature when the gateway is configured to want one."""
        key = getattr(settings, "OUTBOUND_SMS_SIGN_KEY", "") or ""
        if not key:
            return payload
        timestamp = payload.get("timestamp") or int(time.time() * 1000)
        message = json.dumps(payload.get("data", payload), separators=(",", ":"), sort_keys=True)
        digest = hmac.new(
            key.encode("utf-8"),
            f"{message}{timestamp}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return {**payload, "timestamp": timestamp, "sign": base64.b64encode(digest).decode("ascii")}

    def build_url(self, destination: str, body: str) -> str:
        """Substitute placeholders into the URL for GET-style gateways."""
        url = getattr(settings, "OUTBOUND_SMS_URL", "") or ""
        replacements = {
            "{to}": destination,
            "{body}": body,
            "{msg}": body,
            "{sim_slot}": str(getattr(settings, "OUTBOUND_SMS_SIM_SLOT", 2) or 2),
            "{from}": getattr(settings, "SMS_GATEWAY_NUMBER", "") or "",
        }
        for token, value in replacements.items():
            if token in url:
                url = url.replace(token, quote(str(value), safe=""))
        return url

    def send(self, destination: str, body: str, timeout: float | None = None) -> None:
        base_url = getattr(settings, "OUTBOUND_SMS_URL", "") or ""
        if not base_url:
            raise SmsConfigurationError("OUTBOUND_SMS_URL is required to send SMS.")
        timeout = float(timeout or getattr(settings, "OUTBOUND_SMS_TIMEOUT_SECONDS", 15))
        try:
            if self._method() == "GET":
                response = httpx.get(
                    self.build_url(destination, body),
                    headers=self._headers(),
                    timeout=timeout,
                )
            else:
                response = httpx.post(
                    base_url,
                    json=self._sign(self.build_payload(destination, body)),
                    headers=self._headers(),
                    timeout=timeout,
                )
        except httpx.HTTPError as exc:
            raise SmsDeliveryError(f"Gateway unreachable: {type(exc).__name__}") from exc
        if response.status_code >= 400:
            # The response body may echo the destination or the message; keep
            # only the status code so nothing sensitive reaches the log.
            raise SmsDeliveryError(f"Gateway rejected the request (HTTP {response.status_code}).")
        if 300 <= response.status_code < 400:
            # A redirect is not a delivery. Posting to the cloud API's bare host
            # returns 301, and httpx does not follow redirects for POST, so
            # treating 3xx as success silently dropped every message.
            raise SmsDeliveryError(
                f"Gateway redirected the request (HTTP {response.status_code}); "
                "check OUTBOUND_SMS_URL points at the send endpoint."
            )
        return self.parse_receipt(response)

    def parse_receipt(self, response):
        try:
            data = response.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        return {
            "provider_message_id": str(data.get("id") or "")[:64],
            "provider_state": str(data.get("state") or "")[:24],
        }


class SmsForwarderDriver(HttpJsonSmsDriver):
    """SMS Forwarder on the configured barangay handset.

    Defaults to the remote-control payload that SMS Forwarder's send API
    expects. If your build names the fields differently, set
    ``OUTBOUND_SMS_PAYLOAD_TEMPLATE`` — no code change is needed.
    """

    name = "sms_forwarder"
    default_template = (
        '{"data": {"sim_slot": "{sim_slot}", "phone_numbers": "{to}", '
        '"msg_content": "{body}"}, "timestamp": "{timestamp}"}'
    )


class AndroidSmsGatewayDriver(HttpJsonSmsDriver):
    """capcom6/android-sms-gateway, in either Cloud or Local server mode.

    Send API is ``POST /3rdparty/v1/message`` on the cloud host and ``POST
    /message`` on the handset's local server, with HTTP Basic auth using the
    username and password from the app's Home screen and a `phoneNumbers`
    array rather than a single string.

    Configure OUTBOUND_SMS_URL as the *host* (https://api.sms-gate.app, or
    http://<device-lan-ip>:8080); the endpoint path is appended here. Posting
    to the bare cloud host returns 301, which is why the path matters.
    """

    name = "android_sms_gateway"
    default_template = (
        '{"textMessage":{"text":"{body}"},"phoneNumbers":["{to}"],'
        '"simNumber":"{sim_slot}","withDeliveryReport":true}'
    )
    cloud_path = "/3rdparty/v1/message"
    local_path = "/message"

    def endpoint(self) -> str:
        base = (getattr(settings, "OUTBOUND_SMS_URL", "") or "").rstrip("/")
        if not base:
            raise SmsConfigurationError("OUTBOUND_SMS_URL is required to send SMS.")
        if any(base.endswith(path) for path in (self.cloud_path, self.local_path)):
            return base
        path = self.local_path if "sms-gate.app" not in base else self.cloud_path
        return f"{base}{path}"

    def send(self, destination: str, body: str, timeout: float | None = None):
        timeout = float(timeout or getattr(settings, "OUTBOUND_SMS_TIMEOUT_SECONDS", 15))
        try:
            response = httpx.post(
                self.endpoint(),
                json=self._sign(self.build_payload(destination, body)),
                headers=self._headers(),
                timeout=timeout,
            )
        except httpx.HTTPError as exc:
            raise SmsDeliveryError(f"Gateway unreachable: {type(exc).__name__}") from exc
        if response.status_code >= 400:
            raise SmsDeliveryError(f"Gateway rejected the request (HTTP {response.status_code}).")
        if 300 <= response.status_code < 400:
            raise SmsDeliveryError(
                f"Gateway redirected the request (HTTP {response.status_code}); "
                "check OUTBOUND_SMS_URL points at the gateway host."
            )
        return self.parse_receipt(response)

    def _headers(self) -> dict[str, str]:
        headers = super()._headers()
        username = getattr(settings, "OUTBOUND_SMS_USERNAME", "") or ""
        password = getattr(settings, "OUTBOUND_SMS_PASSWORD", "") or ""
        if username and "Authorization" not in headers:
            credentials = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
            headers["Authorization"] = f"Basic {credentials}"
        return headers


DRIVERS: dict[str, type[BaseSmsDriver]] = {
    "console": ConsoleSmsDriver,
    "sms_forwarder": SmsForwarderDriver,
    "android_sms_gateway": AndroidSmsGatewayDriver,
    "http_generic": HttpJsonSmsDriver,
    "disabled": DisabledSmsDriver,
}


def get_driver() -> BaseSmsDriver:
    name = getattr(settings, "OUTBOUND_SMS_DRIVER", "disabled") or "disabled"
    try:
        return DRIVERS[name]()
    except KeyError as exc:
        raise ImproperlyConfigured(f"Unknown OUTBOUND_SMS_DRIVER: {name}") from exc


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def queue_sms(
    destination: str,
    body: str,
    *,
    purpose: str = SmsPurpose.SYSTEM,
    idempotency_key: str | None = None,
    alert=None,
    recipient=None,
    in_reply_to=None,
) -> OutboundSmsMessage | None:
    """Record an outbound message and hand it to the sender.

    Returns the existing row when `idempotency_key` has already been used, so
    a duplicate inbound SMS or a Celery retry can call this freely without
    texting anyone twice. Returns None when there is no usable destination.

    Sending happens after the surrounding transaction commits — an alert that
    rolls back must not leave a resident holding a confirmation text for an
    emergency that does not exist.
    """
    number = normalize_ph_mobile(destination)
    if not number:
        logger.warning("Refusing to queue SMS: destination is not a PH mobile number.")
        return None
    if not (body or "").strip():
        return None

    key = idempotency_key or uuid.uuid4().hex
    if len(key) > IDEMPOTENCY_KEY_MAX_LENGTH:
        # Collapse to a fixed-width digest rather than truncating, which would
        # make two different long keys collide and silently drop a message.
        key = hashlib.sha256(key.encode("utf-8")).hexdigest()
    message = OutboundSmsMessage(
        purpose=purpose,
        # An OTP body is never persisted: the code must not be readable from
        # the database or an admin screen.
        body="" if purpose == SmsPurpose.OTP else body,
        segments=count_segments(body),
        idempotency_key=key,
        alert=alert,
        recipient=recipient,
        in_reply_to=in_reply_to,
        driver=getattr(settings, "OUTBOUND_SMS_DRIVER", "disabled"),
    )
    message.set_destination(number)

    try:
        with transaction.atomic():
            message.save()
    except IntegrityError:
        existing = OutboundSmsMessage.objects.filter(idempotency_key=key).first()
        if existing:
            return existing
        raise

    transaction.on_commit(lambda: _dispatch(message.pk, number, body))
    return message


def _dispatch(message_id: int, destination: str, body: str) -> None:
    """Send through Celery when a broker is reachable.

    Delivery args cannot be reconstructed later (destinations are stored
    hashed, OTP bodies are never persisted). Emergency-critical messages fall
    back to an inline bounded attempt when the broker is unavailable; other
    messages are marked failed instead of remaining invisibly queued forever.
    """
    from .tasks import send_outbound_sms_task

    try:
        send_outbound_sms_task.delay(message_id, destination, body)
    except Exception as exc:
        message = OutboundSmsMessage.objects.filter(pk=message_id).only("purpose").first()
        critical = bool(message and message.purpose in {
            SmsPurpose.EMERGENCY,
            SmsPurpose.EMERGENCY_ACK,
            SmsPurpose.DISPATCH,
            SmsPurpose.OFFICIAL_ALERT,
        })
        if critical or getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
            logger.warning("Celery unavailable for SMS #%s; using bounded inline delivery.", message_id)
            try:
                deliver(
                    message_id,
                    destination,
                    body,
                    timeout=min(10.0, float(getattr(settings, "OUTBOUND_SMS_TIMEOUT_SECONDS", 15))),
                )
            except SmsDeliveryError:
                pass
            return
        OutboundSmsMessage.objects.filter(pk=message_id).update(
            status=OutboundSmsMessage.Status.FAILED,
            last_error=f"Celery broker unavailable ({exc.__class__.__name__})."[:255],
        )
        logger.error("Celery broker unavailable; SMS #%s marked FAILED.", message_id)


def deliver(message_id: int, destination: str, body: str, timeout: float | None = None) -> str:
    """Perform one delivery attempt and record the outcome."""
    message = OutboundSmsMessage.objects.filter(pk=message_id).first()
    if not message:
        return OutboundSmsMessage.Status.FAILED
    if message.status in {OutboundSmsMessage.Status.SENT, OutboundSmsMessage.Status.DELIVERED}:
        return message.status

    driver = get_driver()
    message.status = OutboundSmsMessage.Status.SENDING
    message.attempts += 1
    message.driver = driver.name
    message.save(update_fields=["status", "attempts", "driver"])

    try:
        receipt = driver.send(destination, body, timeout=timeout)
    except SmsConfigurationError as exc:
        message.status = OutboundSmsMessage.Status.SKIPPED
        message.last_error = str(exc)[:255]
        message.save(update_fields=["status", "last_error"])
        logger.warning("SMS #%s skipped: %s", message_id, exc)
        return message.status
    except Exception as exc:
        message.status = OutboundSmsMessage.Status.FAILED
        message.last_error = f"{type(exc).__name__}: {exc}"[:255]
        message.save(update_fields=["status", "last_error"])
        # Never log the body or the destination — an OTP or a resident's
        # number must not reach the log file.
        logger.warning("SMS #%s failed on attempt %s: %s", message_id, message.attempts, type(exc).__name__)
        raise SmsDeliveryError(str(exc)) from exc

    message.status = OutboundSmsMessage.Status.SENT
    message.sent_at = timezone.now()
    message.last_error = ""
    updated = ["status", "sent_at", "last_error"]
    if isinstance(receipt, dict):
        message.provider_message_id = receipt.get("provider_message_id", "")
        message.provider_state = receipt.get("provider_state", "")
        updated += ["provider_message_id", "provider_state"]
    message.save(update_fields=updated)
    return message.status


def reconcile_delivery_event(payload) -> bool:
    """Apply an authenticated SMSGate delivery webhook to its outbound row."""
    event = (getattr(payload, "event", "") or "").strip().lower()
    if event not in {"sms:sent", "sms:delivered", "sms:failed"}:
        return False
    provider_id = (getattr(payload, "gateway_message_id", "") or "").strip()
    if not provider_id:
        return False
    message = OutboundSmsMessage.objects.filter(provider_message_id=provider_id[:64]).first()
    if not message:
        logger.warning("Delivery event %s did not match an outbound SMS provider id.", event)
        return False

    now = timezone.now()
    raw = getattr(payload, "raw", {}) or {}
    lowered = {str(key).lower(): value for key, value in raw.items()}
    provider_state = str(lowered.get("state") or lowered.get("status") or event.split(":", 1)[1])[:24]

    if event == "sms:delivered":
        message.status = OutboundSmsMessage.Status.DELIVERED
        message.sent_at = message.sent_at or now
        message.delivered_at = now
        message.last_error = ""
        message.provider_state = provider_state
        message.save(update_fields=["status", "sent_at", "delivered_at", "last_error", "provider_state"])
        return True
    if message.status == OutboundSmsMessage.Status.DELIVERED:
        # Webhooks can arrive out of order. Delivery is terminal and must not be
        # regressed by a late sent/failed event.
        return True
    if event == "sms:failed":
        message.status = OutboundSmsMessage.Status.FAILED
        message.last_error = "Gateway reported that the SMS could not be delivered."
        message.provider_state = provider_state
        message.save(update_fields=["status", "last_error", "provider_state"])
        return True

    message.status = OutboundSmsMessage.Status.SENT
    message.sent_at = message.sent_at or now
    message.last_error = ""
    message.provider_state = provider_state
    message.save(update_fields=["status", "sent_at", "last_error", "provider_state"])
    return True


def send_sms(destination: str, body: str, **kwargs) -> OutboundSmsMessage | None:
    """Alias kept for readability at call sites."""
    return queue_sms(destination, body, **kwargs)


def send_ephemeral_sms(destination: str, body: str) -> None:
    """Send an Auth OTP without storing the code or destination."""
    number = normalize_ph_mobile(destination)
    if not number or not (body or "").strip():
        raise SmsDeliveryError("The SMS destination or body is invalid.")
    try:
        get_driver().send(number, body)
    except SmsConfigurationError:
        raise
    except Exception as exc:
        logger.warning("Ephemeral SMS delivery failed: %s", type(exc).__name__)
        raise SmsDeliveryError("The SMS provider rejected the message.") from exc


def gateway_is_available() -> bool:
    driver = getattr(settings, "OUTBOUND_SMS_DRIVER", "disabled") or "disabled"
    if driver == "disabled":
        return False
    if driver in {"sms_forwarder", "http_generic"}:
        return bool(getattr(settings, "OUTBOUND_SMS_URL", ""))
    if driver == "android_sms_gateway":
        return bool(
            getattr(settings, "OUTBOUND_SMS_URL", "")
            and getattr(settings, "OUTBOUND_SMS_USERNAME", "")
            and getattr(settings, "OUTBOUND_SMS_PASSWORD", "")
        )
    return True
