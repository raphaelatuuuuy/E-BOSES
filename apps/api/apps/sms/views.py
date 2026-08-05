"""Inbound SMS webhook.

SMS Forwarder on the barangay handset calls this whenever the gateway number
receives a text. Its URL screen offers GET or POST and a free-form URL template,
so both verbs are accepted here — see `apps.sms.payload` for the field aliases.

The view is deliberately thin and fast: authenticate, hand off, return 200.
A gateway that does not get a prompt 200 retries, and a retry storm on an
emergency number is the last thing anybody needs.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

from django.conf import settings
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import InboundSmsMessage
from .payload import extract_inbound
from .router import handle_inbound

logger = logging.getLogger(__name__)


# Header names different gateways use for the signature and its timestamp.
SIGNATURE_HEADERS = ("X-Signature", "X-Signature-256", "X-Hub-Signature-256", "X-Webhook-Signature")
TIMESTAMP_HEADERS = ("X-Timestamp", "X-Webhook-Timestamp", "X-Request-Timestamp")


def _signature_candidates(raw: bytes, timestamp: str, device_id: str) -> dict[str, bytes]:
    """Every message-construction a gateway might have signed.

    Built from the raw request *bytes*. Decoding to str first would corrupt any
    non-ASCII character in the message - a Filipino "ñ", an emoji - and produce
    a digest that could never match.

    All candidates require the signing key, so accepting whichever matches is no
    weaker than accepting one; it just stops a guess about concatenation order
    from breaking the integration.
    """
    ts = timestamp.encode("utf-8")
    return {
        "body+ts": raw + ts,
        "ts+body": ts + raw,
        "body": raw,
        "ts.body": ts + b"." + raw,
        "device+ts": device_id.encode("utf-8") + ts,
    }


def _signature_is_valid(request) -> bool:
    """Verify an HMAC-signed webhook (android-sms-gateway and similar).

    That app has no custom-header field, so it proves itself by signing the
    request with the Signing Key from its Webhooks screen.
    """
    key = (getattr(settings, "SMS_WEBHOOK_SIGNING_KEY", "") or "").strip()
    if not key:
        return False

    signature = ""
    for header in SIGNATURE_HEADERS:
        signature = (request.headers.get(header) or "").strip()
        if signature:
            break
    if not signature:
        return False
    # Some gateways prefix the algorithm, e.g. "sha256=abc123".
    if "=" in signature:
        signature = signature.split("=", 1)[1].strip()

    timestamp = ""
    for header in TIMESTAMP_HEADERS:
        timestamp = (request.headers.get(header) or "").strip()
        if timestamp:
            break

    try:
        # Raw bytes, not a decoded string: decoding with errors="replace" would
        # alter any non-ASCII character and produce a digest that never matches.
        raw = request.body
    except Exception:
        logger.warning("SMS webhook body was unreadable; cannot verify the signature.")
        return False

    device_id = (request.headers.get("X-Device-Id") or "").strip()
    candidates = _signature_candidates(raw, timestamp, device_id)
    for name, message in candidates.items():
        expected = hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()
        if hmac.compare_digest(signature.lower(), expected.lower()):
            logger.debug("SMS webhook signature verified (%s).", name)
            return True

    # Nothing matched. Log enough to identify the scheme without dumping the
    # message text, which is emergency content.
    logger.warning(
        "SMS webhook signature mismatch. signature=%s… timestamp=%r body_len=%d "
        "signature_headers=%s tried=%s",
        signature[:12],
        timestamp,
        len(raw),
        [h for h in SIGNATURE_HEADERS if request.headers.get(h)],
        list(candidates),
    )
    if getattr(settings, "SMS_WEBHOOK_DEBUG", False):
        # Opt-in only: this prints the raw body, which contains SMS content.
        logger.warning("SMS webhook debug: headers=%s body=%r", dict(request.headers), raw)
        for name, message in candidates.items():
            digest = hmac.new(key.encode("utf-8"), message, hashlib.sha256).hexdigest()
            logger.warning("  candidate %-10s -> %s", name, digest)
    return False


def _token_is_valid(request) -> bool:
    # Both names are read at request time. SMS_EMERGENCY_WEBHOOK_TOKEN is the
    # original setting; a handset already configured against it keeps working
    # without anyone editing .env during the rename.
    accepted = [
        (getattr(settings, "SMS_INBOUND_WEBHOOK_TOKEN", "") or "").strip(),
        (getattr(settings, "SMS_EMERGENCY_WEBHOOK_TOKEN", "") or "").strip(),
    ]
    accepted = [token for token in accepted if token]
    if not accepted:
        # Refuse rather than accept-everything: an unauthenticated emergency
        # intake endpoint is an open invitation to spoof alerts.
        return False
    supplied = (
        request.headers.get("X-SMS-Webhook-Token")
        or request.headers.get("X-Webhook-Token")
        # Some SMS Forwarder builds cannot add headers on GET, so a query
        # parameter is accepted as a fallback. `payload.extract_inbound`
        # strips it before anything is persisted.
        or request.GET.get("token")
        or ""
    ).strip()
    if not supplied:
        return False
    # compare_digest against each accepted token so a match never short-circuits
    # on length or first differing byte.
    return any(hmac.compare_digest(supplied, token) for token in accepted)


class SmsInboundView(APIView):
    """POST (preferred) or GET from the SMS gateway."""

    permission_classes = [AllowAny]
    authentication_classes = []
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def post(self, request):
        return self._handle(request)

    def get(self, request):
        return self._handle(request)

    def _handle(self, request):
        # Either proof is enough: a shared token (SMS Forwarder, curl) or an
        # HMAC signature (android-sms-gateway, which cannot send custom headers).
        if not (_signature_is_valid(request) or _token_is_valid(request)):
            logger.warning("Rejected SMS webhook call: no valid token or signature.")
            return Response(
                {"detail": "Invalid SMS webhook credentials."},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = extract_inbound(request)

        # Gateways also emit sms:sent / sms:delivered / system:ping. Acting on
        # those would feed our own outgoing replies back in as new traffic.
        if not payload.is_received_message:
            return Response(
                {"detail": f"Ignored event '{payload.event}'.", "ignored": True},
                status=status.HTTP_200_OK,
            )

        if not payload.body.strip():
            return Response({"detail": "No message body found."}, status=status.HTTP_400_BAD_REQUEST)
        if not payload.sender.strip():
            return Response({"detail": "No sender number found."}, status=status.HTTP_400_BAD_REQUEST)

        inbound = handle_inbound(payload)

        redelivered = getattr(inbound, "was_redelivered", False)
        body = {
            "id": inbound.pk,
            "outcome": inbound.outcome,
            "duplicate": redelivered or inbound.outcome == InboundSmsMessage.Outcome.DUPLICATE,
        }
        if inbound.alert_id:
            body["emergency_id"] = inbound.alert_id
        # 201 only when this call is what created the emergency. A retry of the
        # same message reports 200 so the gateway can tell the two apart.
        created = inbound.outcome == InboundSmsMessage.Outcome.EMERGENCY_CREATED and not redelivered
        return Response(body, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
