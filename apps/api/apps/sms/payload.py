"""Read an inbound message out of whatever shape the gateway sent it in.

SMS Forwarder's URL screen lets the operator choose GET or POST and write their
own URL template with ``{msg}`` / ``{time}`` / ``{from}`` placeholders, so the
same barangay handset can deliver a message four different ways depending on
how that screen was filled in. Rather than mandate one, this module accepts:

* ``GET``  with the fields in the query string
* ``POST`` with a JSON body
* ``POST`` with a form-encoded body
* ``POST`` with a bare text body (the whole body is the message)

Field names are matched case-insensitively against the aliases below, so
``msg``, ``message``, ``text``, ``content`` and ``body`` all mean the same
thing.

**Prefer POST.** With GET, the message text lands in the web server's access
log and in any proxy in front of it. Emergency content should not be sitting in
a log file, so `docs/sms-gateway.md` recommends POST and this module supports
GET only so an already-configured handset keeps working.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone as dt_timezone

from django.http import QueryDict
from django.utils import timezone

BODY_KEYS = (
    "msg", "message", "text", "content", "body", "sms", "smsbody",
    # SMSGate cloud incoming/webhook payloads expose the SMS text here.
    "contentpreview", "content_preview",
)
SENDER_KEYS = (
    "from", "sender", "phone", "number", "mobile", "msisdn", "source", "originator",
    # android-sms-gateway
    "phonenumber", "phone_number",
)
TIMESTAMP_KEYS = (
    "time", "timestamp", "received_at", "date", "datetime", "sent_at",
    "receivedat",
)
# Prefer the message's nested messageId over the webhook delivery envelope's
# own id. SMSGate uses both in the same payload and delivery reconciliation
# must match the former to the id returned by the send API.
MESSAGE_ID_KEYS = (
    "messageid", "message_id", "msgid", "msg_id", "smsid", "sms_id",
    "gatewaymessageid", "gateway_message_id", "uuid", "id",
)

# Gateways that wrap the message in an envelope. android-sms-gateway sends
# {"event": "sms:received", "deviceId": ..., "payload": {"message": ...,
# "phoneNumber": ...}}; some SMS Forwarder builds use "data".
ENVELOPE_KEYS = ("payload", "data")

# Only act on received messages. android-sms-gateway can also emit
# sms:sent / sms:delivered / system:ping, and treating our own outgoing
# replies as inbound traffic would create a feedback loop.
INBOUND_EVENTS = {"sms:received", "sms:receive", "received", "sms", ""}


def _first(data: dict, keys) -> str:
    lowered = {str(key).strip().lower(): value for key, value in data.items()}
    for key in keys:
        value = lowered.get(key)
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            value = value[0] if value else ""
        text = str(value).strip()
        if text:
            return text
    return ""


def _flatten(data: dict) -> dict:
    """Flatten one level of envelope so nested fields are reachable.

    android-sms-gateway wraps the message in ``payload``; some SMS Forwarder
    builds use ``data``. Inner keys are applied last so the message's own id
    wins over the webhook delivery id.
    """
    flat = {key: value for key, value in data.items() if not isinstance(value, dict)}
    for key in ENVELOPE_KEYS:
        inner = data.get(key)
        if isinstance(inner, dict):
            flat.update({k: v for k, v in inner.items() if not isinstance(v, dict)})
    return flat


def _merge_sources(request) -> dict:
    """Combine query string, parsed body and raw body into one flat dict."""
    merged: dict = {}

    for key in request.GET.keys():
        merged[key] = request.GET.get(key)

    # DRF has already parsed and consumed the stream by this point, so the
    # parsed data is the reliable source; `request.body` may be unreadable.
    data = getattr(request, "data", None)
    if isinstance(data, QueryDict):
        merged.update({key: data.get(key) for key in data.keys()})
    elif isinstance(data, dict):
        merged.update(_flatten(data))

    if not _first(merged, BODY_KEYS):
        raw = _raw_body(request)
        if raw:
            parsed = _parse_raw(raw)
            if parsed:
                merged.update(parsed)
            else:
                # A gateway that posts the message as plain text with no field
                # names at all. Treat the whole payload as the message.
                merged.setdefault("body", raw)
    return merged


def _raw_body(request) -> str:
    try:
        return request.body.decode(request.encoding or "utf-8", errors="replace").strip()
    except Exception:
        return ""


def _parse_raw(raw: str) -> dict | None:
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        pass
    else:
        if isinstance(data, dict):
            return _flatten(data)
        return None

    if "=" in raw and "\n" not in raw:
        form = QueryDict(raw)
        if any(key in form for key in (*BODY_KEYS, *SENDER_KEYS)):
            return {key: form.get(key, "") for key in form.keys()}
    return None


def _parse_timestamp(value: str):
    """Best-effort parse of the gateway's claimed receive time.

    Returned for the record only. `server_received_at` remains the official
    submission time unless the gateway's metadata has been validated, because
    a handset clock is trivially wrong and trivially forged.
    """
    if not value:
        return None
    text = value.strip()
    if text.isdigit():
        number = int(text)
        # Milliseconds vs seconds.
        if number > 10_000_000_000:
            number //= 1000
        try:
            return datetime.fromtimestamp(number, tz=dt_timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y/%m/%d %H:%M:%S", "%d/%m/%Y %H:%M:%S"):
        try:
            naive = datetime.strptime(text[:19], pattern)
        except ValueError:
            continue
        return timezone.make_aware(naive, timezone.get_default_timezone())
    return None


class InboundPayload:
    __slots__ = ("body", "sender", "gateway_timestamp", "gateway_message_id", "raw", "event")

    def __init__(self, *, body, sender, gateway_timestamp, gateway_message_id, raw, event=""):
        self.body = body
        self.sender = sender
        self.gateway_timestamp = gateway_timestamp
        self.gateway_message_id = gateway_message_id
        self.raw = raw
        self.event = event

    @property
    def is_received_message(self) -> bool:
        return (self.event or "").strip().lower() in INBOUND_EVENTS

    def dedupe_key(self) -> str:
        """Stable key so a gateway retry is recognised, not re-processed.

        When the gateway supplies its own message id that alone identifies the
        message. Otherwise use the gateway's claimed receive time, or the
        canonical payload when no time exists. The key must not depend on the
        server clock: retries can arrive after a minute boundary.
        """
        if self.gateway_message_id:
            seed = f"gw:{self.gateway_message_id}"
        elif self.gateway_timestamp:
            bucket = int(self.gateway_timestamp.timestamp() // 60)
            seed = f"{self.sender}|{self.body}|{bucket}"
        elif self.raw:
            seed = json.dumps(self.raw, sort_keys=True, separators=(",", ":"))
        else:
            seed = f"{self.sender}|{self.body}"
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def extract_inbound(request) -> InboundPayload:
    merged = _merge_sources(request)
    return inbound_payload_from_dict(merged)


def inbound_payload_from_dict(data: dict) -> InboundPayload:
    """Construct an InboundPayload from a flat dict of string key-value pairs.

    Safe for Celery tasks where no request object is available.
    """
    safe_raw = {
        key: value
        for key, value in data.items()
        if "token" not in str(key).lower() and "secret" not in str(key).lower()
    }
    return InboundPayload(
        body=_first(data, BODY_KEYS),
        sender=_first(data, SENDER_KEYS),
        gateway_timestamp=_parse_timestamp(_first(data, TIMESTAMP_KEYS)),
        gateway_message_id=(_first(data, MESSAGE_ID_KEYS) or "")[:120],
        raw=safe_raw,
        event=_first(data, ("event", "type", "event_type")),
    )
