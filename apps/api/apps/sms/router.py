"""Decide what an inbound SMS means and what to text back.

One rule governs everything here: **a message is never met with silence.**
A resident who mistypes a command, texts from an unregistered number, or writes
something nobody anticipated still gets a reply that tells them how to ask for
help. Silence on an emergency number is the worst possible failure mode.

Role is resolved from the sender's number, so the same keyword can mean
different things to a resident and a responder (`STATUS` is "how is my report
going" for one and "what am I assigned to" for the other).
"""

from __future__ import annotations

import logging

from django.db import transaction

from . import templates
from .gateway import queue_sms
from .models import InboundSmsMessage, SmsPurpose
from .normalize import SenderMatch, match_sender, normalize_ph_mobile, surname_for
from .parsing import ParsedCommand, looks_like_otp, parse_command, parse_emergency_sms

logger = logging.getLogger(__name__)

ROLE_RESIDENT = "resident"
ROLE_RESPONDER = "responder"
ROLE_OFFICIAL = "official"
ROLE_UNKNOWN = "unknown"

# Commands a resident may use. Anything else from a resident number is answered
# with the guide rather than executed.
RESIDENT_COMMANDS = {"HELP", "STATUS", "SAFE", "CANCEL", "GUIDE"}


class Reply:
    """What to send back, and why. `None` body means nothing is sent."""

    __slots__ = ("body", "purpose", "alert", "recipient")

    def __init__(self, body: str | None, *, purpose=SmsPurpose.COMMAND_REPLY, alert=None, recipient=None):
        self.body = body
        self.purpose = purpose
        self.alert = alert
        self.recipient = recipient


def resolve_role(user) -> str:
    if not user:
        return ROLE_UNKNOWN
    role = getattr(user, "role", "")
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return ROLE_OFFICIAL
    if role == "barangay_official":
        return ROLE_OFFICIAL
    if role == "first_responder":
        return ROLE_RESPONDER
    return ROLE_RESIDENT


def handle_inbound(payload) -> InboundSmsMessage:
    """Store, classify, act, reply. Returns the persisted inbound row.

    Every branch sets `outcome` so the operations log can answer "what did the
    gateway do with that message" without re-parsing anything.
    """
    sender = normalize_ph_mobile(payload.sender) or (payload.sender or "").strip()

    inbound, created = InboundSmsMessage.objects.get_or_create(
        dedupe_key=payload.dedupe_key(),
        defaults={
            "sender_number": sender[:24],
            "body": payload.body,
            "gateway_message_id": payload.gateway_message_id,
            "gateway_received_at": payload.gateway_timestamp,
            "raw_payload": payload.raw,
        },
    )
    # Transient marker for the view. Not a stored field: the row keeps the
    # outcome of the original delivery so the operations log stays truthful.
    inbound.was_redelivered = False
    if not created:
        # A gateway retry. Do not act twice; the original reply already went out.
        logger.info("Duplicate inbound SMS ignored (inbound #%s).", inbound.pk)
        inbound.was_redelivered = True
        return inbound

    # An OTP from a bank, an e-wallet, or E-Boses itself must never be stored in
    # full, echoed, or forwarded. Drop it before anything else looks at it.
    if looks_like_otp(payload.body):
        inbound.body = "[redacted: message looked like a verification code]"
        inbound.outcome = InboundSmsMessage.Outcome.DROPPED_OTP
        inbound.detail = "Verification-code-shaped message discarded without forwarding."
        inbound.save(update_fields=["body", "outcome", "detail"])
        return inbound

    match = match_sender(sender)
    inbound.matched_user = match.user
    inbound.sender_match_status = match.status
    role = resolve_role(match.user)

    try:
        reply = _dispatch(inbound, payload, match, role)
    except Exception:
        logger.exception("SMS handling failed for inbound #%s.", inbound.pk)
        inbound.outcome = InboundSmsMessage.Outcome.ERROR
        inbound.detail = "Handler raised; resident was asked to call instead."
        inbound.save(update_fields=["outcome", "detail", "matched_user", "sender_match_status"])
        _send(inbound, sender, Reply(templates.unknown_command(payload.body)))
        return inbound

    inbound.save(
        update_fields=[
            "matched_user",
            "sender_match_status",
            "outcome",
            "command_keyword",
            "alert",
            "detail",
        ]
    )
    if reply and reply.body:
        _send(inbound, sender, reply)
    return inbound


def _dispatch(inbound, payload, match: SenderMatch, role: str) -> Reply | None:
    command = parse_command(payload.body)
    inbound.command_keyword = command.keyword

    # An explicit HELP is an emergency regardless of role: an off-duty responder
    # whose own house is on fire is a resident in that moment.
    if command.keyword == "HELP":
        return _handle_help(inbound, payload, match, command)

    # A message that reads as an emergency but is not a command at all — this
    # is what the SOS wizard's offline SMS looks like.
    parsed = parse_emergency_sms(payload.body, sender_is_known=match.is_registered)
    if parsed.is_emergency and not command.recognised:
        return _create_emergency(inbound, parsed, payload, match)

    if command.keyword == "GUIDE":
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = f"Guide sent for role {role}."
        return _guide_for(role)

    if role in {ROLE_RESPONDER, ROLE_OFFICIAL} and command.recognised:
        from .commands import staff

        return staff.handle(inbound, command, match, role)

    if command.keyword in RESIDENT_COMMANDS:
        from .commands import resident

        return resident.handle(inbound, command, match)

    if command.recognised:
        # A real keyword, but not one this sender is allowed to use.
        inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
        inbound.detail = f"{command.keyword} is not available for role {role}."
        return Reply(templates.not_authorised(command.keyword))

    inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
    inbound.detail = "No command or emergency signal recognised."
    return Reply(templates.unknown_command(payload.body))


def _guide_for(role: str) -> Reply:
    if role == ROLE_RESPONDER:
        return Reply(templates.guide_responder())
    if role == ROLE_OFFICIAL:
        return Reply(templates.guide_official())
    return Reply(templates.guide_resident())


def _handle_help(inbound, payload, match: SenderMatch, command: ParsedCommand) -> Reply:
    """``HELP <CATEGORY> [area]`` — the shortest path to an emergency."""
    from .parsing import resolve_category

    remainder = command.rest or command.argument
    code, _alias = resolve_category(remainder)
    if not code:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = "HELP received without a usable category."
        return Reply(templates.help_needs_category())

    # Rebuild a full emergency message so one parser handles both shapes.
    parsed = parse_emergency_sms(payload.body, sender_is_known=True)
    parsed.is_emergency = True
    parsed.category_code = code
    parsed.category_needs_confirmation = False
    if "category" in parsed.unresolved_fields:
        parsed.unresolved_fields.remove("category")
    if not parsed.reported_area:
        parsed.reported_area = _area_after_category(remainder, code)
        if parsed.reported_area and "location" in parsed.unresolved_fields:
            parsed.unresolved_fields.remove("location")
    return _create_emergency(inbound, parsed, payload, match)


def _area_after_category(remainder: str, code: str) -> str:
    """Whatever the resident typed after the category word is the place.

    ``HELP FIRE Champaca Street`` -> ``Champaca Street``.
    """
    from .parsing import CATEGORY_ALIASES, _squash

    words = (remainder or "").split()
    for index in range(len(words)):
        head = _squash(" ".join(words[: index + 1]))
        if CATEGORY_ALIASES.get(head) == code:
            return " ".join(words[index + 1:]).strip(" .,;")[:255]
    return ""


def _create_emergency(inbound, parsed, payload, match: SenderMatch) -> Reply:
    from apps.emergencies.sms_intake import create_alert_from_sms

    result = create_alert_from_sms(
        parsed,
        sender_number=inbound.sender_number,
        match=match,
        inbound=inbound,
    )
    alert = result.alert
    inbound.alert = alert

    if result.duplicate:
        inbound.outcome = InboundSmsMessage.Outcome.DUPLICATE
        inbound.detail = "Sender already has an active emergency."
        from .commands.resident import status_body

        return Reply(status_body(alert), alert=alert)

    inbound.outcome = InboundSmsMessage.Outcome.EMERGENCY_CREATED
    inbound.detail = f"Created {templates.reference(alert)}."

    if not match.is_registered:
        return Reply(
            templates.emergency_ack_unregistered(alert),
            purpose=SmsPurpose.EMERGENCY_ACK,
            alert=alert,
        )

    from apps.emergencies.models import EmergencyAlert

    if alert.location_confidence == EmergencyAlert.LocationConfidence.OUTSIDE_AREA:
        return Reply(
            templates.outside_service_area(alert),
            purpose=SmsPurpose.EMERGENCY_ACK,
            alert=alert,
        )

    return Reply(
        templates.emergency_ack(
            alert,
            surname=surname_for(match.user),
            unit_name=_unit_name_for(result.responder),
            assigned=bool(result.responder),
        ),
        purpose=SmsPurpose.EMERGENCY_ACK,
        alert=alert,
    )


def _unit_name_for(responder) -> str:
    if not responder:
        return ""
    try:
        from apps.emergencies.views import responder_display_unit

        return responder_display_unit(responder)
    except Exception:
        return ""


def _send(inbound, destination: str, reply: Reply) -> None:
    """Queue the reply, keyed so a retry cannot text the sender twice."""
    queue_sms(
        destination,
        reply.body,
        purpose=reply.purpose,
        idempotency_key=f"reply:{inbound.dedupe_key}",
        alert=reply.alert,
        recipient=reply.recipient or inbound.matched_user,
        in_reply_to=inbound,
    )
