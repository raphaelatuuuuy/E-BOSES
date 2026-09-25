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
import re
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from . import templates
from .gateway import queue_sms
from .models import InboundSmsMessage, OutboundSmsMessage, SmsPurpose
from .normalize import SenderMatch, hash_number, match_sender, normalize_ph_mobile, surname_for
from .parsing import ParsedCommand, looks_like_otp, parse_command, parse_emergency_sms
from apps.emergencies.temporal import NON_CURRENT

logger = logging.getLogger(__name__)

ROLE_RESIDENT = "resident"
ROLE_RESPONDER = "responder"
ROLE_OFFICIAL = "official"
ROLE_UNKNOWN = "unknown"
PENDING_RECOVERY_LOCK_SECONDS = 120

# Commands a resident may use. Anything else from a resident number is answered
# with the guide rather than executed.
RESIDENT_COMMANDS = {"HELP", "STATUS", "SAFE", "CANCEL", "GUIDE"}
CHAT_ENVELOPE_PATTERN = re.compile(
    r"^\s*E-BOSES\s+CHAT\s+E-\s*(\d+)\s*:\s*(.*?)\s*$",
    re.IGNORECASE | re.DOTALL,
)


class Reply:
    """What to send back, and why. `None` body means nothing is sent."""

    __slots__ = ("body", "purpose", "alert", "recipient")

    def __init__(self, body: str | None, *, purpose=SmsPurpose.COMMAND_REPLY, alert=None, recipient=None):
        self.body = body
        self.purpose = purpose
        self.alert = alert
        self.recipient = recipient


def parse_chat_envelope(body: str | None) -> tuple[int, str] | None:
    """Extract a gateway-only chat message and its emergency reference.

    A phone that has no data cannot create the database chat row itself. It
    sends this small envelope to the shared gateway number; the webhook then
    authenticates the sender against the referenced alert before appending it.
    """
    match = CHAT_ENVELOPE_PATTERN.match(body or "")
    if not match:
        return None
    return int(match.group(1)), match.group(2).strip()


def resolve_role(user) -> str:
    if not user:
        return ROLE_UNKNOWN
    role = getattr(user, "role", "")
    if getattr(user, "is_superuser", False):
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
        inbound.was_redelivered = True
        stale_after = max(15, int(getattr(settings, "SMS_INBOUND_PENDING_RECOVERY_SECONDS", 60)))
        stale = inbound.outcome == InboundSmsMessage.Outcome.PENDING and (
            inbound.server_received_at <= timezone.now() - timedelta(seconds=stale_after)
        )
        lock_key = f"sms-inbound:processing:{inbound.pk}"
        if not stale or not cache.add(lock_key, "1", PENDING_RECOVERY_LOCK_SECONDS):
            # A normal gateway retry. Do not act twice; the original reply
            # already went out, or another worker is still processing it.
            logger.info("Duplicate inbound SMS ignored (inbound #%s).", inbound.pk)
            return inbound
        inbound.refresh_from_db()
        if inbound.outcome != InboundSmsMessage.Outcome.PENDING:
            return inbound
        logger.warning("Recovering stale pending inbound SMS #%s.", inbound.pk)

    gateway = normalize_ph_mobile(getattr(settings, "SMS_GATEWAY_NUMBER", ""))
    if gateway and sender == gateway:
        echo_cutoff = timezone.now() - timedelta(hours=1)
        outbound = OutboundSmsMessage.objects.filter(
            created_at__gte=echo_cutoff,
            body=payload.body,
        )
        resident_intake_check = outbound.filter(
            purpose=SmsPurpose.EMERGENCY,
            idempotency_key__startswith="resident-intake-check:",
            destination_hash=hash_number(sender),
            status__in=[OutboundSmsMessage.Status.SENDING, OutboundSmsMessage.Status.SENT, OutboundSmsMessage.Status.DELIVERED],
        ).exists()
        if outbound.exists() and not resident_intake_check:
            inbound.outcome = InboundSmsMessage.Outcome.REJECTED
            inbound.detail = "Self-addressed outbound SMS echo discarded without a reply."
            inbound.save(update_fields=["outcome", "detail"])
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
        if inbound.alert_id:
            from .notify import notify_reporter_ack
            notify_reporter_ack(inbound.alert, assigned=False)
        return inbound

    inbound.save(
        update_fields=[
            "matched_user",
            "sender_match_status",
            "outcome",
            "command_keyword",
            "alert",
            "chat_message",
            "detail",
        ]
    )
    if reply and reply.body:
        _send(inbound, sender, reply)
    return inbound


def recover_stuck_inbound_messages(*, limit: int = 100) -> dict[str, int]:
    """Recover recent PENDING rows and expire unsafe, very old ones.

    Recent rows are replayed through the same idempotent router. Rows older
    than the configured maximum are not replayed because doing so could create
    a stale emergency and send a delayed reply hours or days later.
    """
    from .payload import InboundPayload

    now = timezone.now()
    stale_seconds = max(15, int(getattr(settings, "SMS_INBOUND_PENDING_RECOVERY_SECONDS", 60)))
    max_age_hours = max(1, int(getattr(settings, "SMS_INBOUND_PENDING_MAX_AGE_HOURS", 24)))
    stale_cutoff = now - timedelta(seconds=stale_seconds)
    expiry_cutoff = now - timedelta(hours=max_age_hours)

    expired = InboundSmsMessage.objects.filter(
        outcome=InboundSmsMessage.Outcome.PENDING,
        server_received_at__lt=expiry_cutoff,
    ).update(
        outcome=InboundSmsMessage.Outcome.ERROR,
        detail="Pending inbound expired before safe recovery; no delayed reply was sent.",
    )

    rows = list(
        InboundSmsMessage.objects.filter(
            outcome=InboundSmsMessage.Outcome.PENDING,
            server_received_at__gte=expiry_cutoff,
            server_received_at__lte=stale_cutoff,
        ).order_by("server_received_at", "id")[: max(1, limit)]
    )
    recovered = 0
    for row in rows:
        payload = InboundPayload(
            body=row.body,
            sender=row.sender_number,
            gateway_timestamp=row.gateway_received_at,
            gateway_message_id=row.gateway_message_id,
            raw=row.raw_payload,
            event="sms:received",
        )
        handled = handle_inbound(payload)
        if handled.outcome != InboundSmsMessage.Outcome.PENDING:
            recovered += 1
    return {"recovered": recovered, "expired": expired, "remaining": len(rows) - recovered}


def _dispatch(inbound, payload, match: SenderMatch, role: str) -> Reply | None:
    chat = parse_chat_envelope(payload.body)
    if chat is not None:
        reference, body = chat
        alert = _chat_alert_for_sender(reference, inbound.sender_number, match, role)
        if not body:
            inbound.outcome = InboundSmsMessage.Outcome.REJECTED
            inbound.detail = "Gateway chat message was empty."
            return Reply(None)
        if not alert or not _append_to_active_chat(
            inbound, match, body, alert=alert, role=role
        ):
            inbound.outcome = InboundSmsMessage.Outcome.REJECTED
            inbound.detail = "Gateway chat reference is not assigned to this sender."
        return Reply(None)

    command = parse_command(payload.body)
    inbound.command_keyword = command.keyword

    # An explicit HELP is an emergency regardless of role: an off-duty responder
    # whose own house is on fire is a resident in that moment.
    if command.keyword == "HELP":
        return _handle_help(inbound, payload, match, command)

    if role == ROLE_RESPONDER and command.keyword in {"ENROUTE", "ONSCENE", "RESOLVED"}:
        return _handle_responder_progress(inbound, match.user, command)

    if role == ROLE_RESPONDER and command.recognised:
        inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
        inbound.detail = "SMS commands are retired; progress is recorded in the app."
        return Reply(None)

    # A message that reads as an emergency but is not a command at all — this
    # is what the SOS wizard's offline SMS looks like.
    parsed = parse_emergency_sms(payload.body, sender_is_known=match.is_registered)
    if parsed.incident_timing in NON_CURRENT and not command.recognised:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = "Past or ended incident detected; emergency dispatch was not started."
        return Reply(None)
    if parsed.is_emergency and not command.recognised:
        return _create_emergency(inbound, parsed, payload, match)

    if role == ROLE_RESPONDER and not command.recognised:
        assignment = _single_active_assignment_for_responder(match.user)
        if assignment:
            if _append_to_active_chat(
                inbound,
                match,
                payload.body,
                alert=assignment.alert,
                role=ROLE_RESPONDER,
            ):
                return Reply(None)
        inbound.outcome = InboundSmsMessage.Outcome.REJECTED
        inbound.detail = (
            "Responder SMS could not be linked; use the emergency chat or include its reference."
        )
        return Reply(None)

    if role in {ROLE_RESIDENT, ROLE_UNKNOWN} and not command.recognised:
        if _append_to_active_chat(inbound, match, payload.body):
            return Reply(None)

    inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
    inbound.detail = "No emergency signal recognised; SMS commands are managed in the app."
    return Reply(None)


def _chat_alert_for_sender(reference: int, sender_number: str, match: SenderMatch, role: str):
    """Return the referenced active alert only when the sender belongs to it."""
    from apps.emergencies.models import EmergencyAlert
    from apps.emergencies.responder_actions import open_assignment_for
    from apps.emergencies.sms_intake import is_anonymous_intake
    from apps.emergencies.views import ACTIVE_STATUSES

    alert = EmergencyAlert.objects.filter(pk=reference, status__in=ACTIVE_STATUSES).first()
    if not alert:
        return None

    if role == ROLE_RESPONDER:
        return alert if match.user and open_assignment_for(alert, match.user) else None
    if role == ROLE_RESIDENT:
        return alert if match.user and alert.reporter_id == match.user.pk else None

    # Unknown senders can only continue the anonymous alert that belongs to
    # their own phone; an alert from another number must not be writable by
    # guessing its numeric reference.
    if is_anonymous_intake(alert.reporter):
        from .normalize import normalize_ph_mobile

        if normalize_ph_mobile(alert.reporter_contact_number) == normalize_ph_mobile(sender_number):
            return alert
    return None


def _single_active_assignment_for_responder(responder):
    """Return the only active assignment, or none when a reference is needed."""
    if not responder:
        return None
    from apps.emergencies.models import EmergencyResponderAssignment
    from apps.emergencies.responder_actions import OPEN_ASSIGNMENT_STATUSES
    from apps.emergencies.views import ACTIVE_STATUSES

    assignments = list(
        EmergencyResponderAssignment.objects.filter(
            responder=responder,
            status__in=OPEN_ASSIGNMENT_STATUSES,
            alert__status__in=ACTIVE_STATUSES,
        )
        .select_related("alert")
        .order_by("-assigned_at", "-id")[:2]
    )
    return assignments[0] if len(assignments) == 1 else None


def _handle_help(inbound, payload, match: SenderMatch, command: ParsedCommand) -> Reply:
    """``HELP <CATEGORY> [area]`` — the shortest path to an emergency."""
    from .parsing import resolve_category

    remainder = command.rest or command.argument
    code, _alias = resolve_category(remainder)
    if not code:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = "HELP received without a usable category."
        return Reply(None)

    # Rebuild a full emergency message so one parser handles both shapes.
    parsed = parse_emergency_sms(payload.body, sender_is_known=True)
    if parsed.incident_timing in NON_CURRENT:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = "HELP described a past or ended incident; emergency dispatch was not started."
        return Reply(None)
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
        inbound.detail = "Sender already has an active emergency; duplicate SOS was not added to chat."
        return Reply(
            templates.ongoing_emergency(),
            purpose=SmsPurpose.EMERGENCY_ACK,
            alert=alert,
            recipient=getattr(match, "user", None),
        )

    inbound.outcome = InboundSmsMessage.Outcome.EMERGENCY_CREATED
    inbound.detail = f"Created {templates.reference(alert)}."
    from .notify import notify_reporter_ack
    transaction.on_commit(lambda: notify_reporter_ack(alert))
    return Reply(None)


def _append_to_active_chat(
    inbound,
    match: SenderMatch,
    body: str,
    *,
    alert=None,
    role: str = ROLE_RESIDENT,
) -> bool:
    from apps.emergencies.sms_intake import active_alert_for, find_intake_reporter

    reporter = find_intake_reporter(inbound.sender_number, match)
    active = alert or active_alert_for(reporter, inbound.sender_number)
    if not active:
        return False
    if role == ROLE_RESPONDER and match.user:
        sender = match.user
        detail = "Responder SMS appended to the active emergency chat."
    else:
        sender = match.user if match.user and resolve_role(match.user) == ROLE_RESIDENT else reporter
        detail = "Resident SMS appended to the active emergency chat."
    message = active.chat_messages.create(sender=sender, body=(body or "").strip()[:2000])
    inbound.alert = active
    # Provenance: this inbound IS this chat line. The responder's thread can then
    # say "received via SMS", and an answer can default to SMS because the
    # resident is demonstrably texting rather than using the app.
    inbound.chat_message = message
    inbound.outcome = InboundSmsMessage.Outcome.CHAT_APPENDED
    inbound.detail = detail
    from apps.emergencies.chat_services import schedule_chat_message_delivery

    schedule_chat_message_delivery(message)
    return True


def _handle_responder_progress(inbound, responder, command: ParsedCommand) -> Reply:
    from apps.emergencies import responder_actions
    from apps.emergencies.models import EmergencyAlert
    from .notify import notify_reporter_progress

    assignment = responder_actions.active_assignment_for(responder)
    if command.reference:
        referenced_alert = EmergencyAlert.objects.filter(pk=int(command.reference)).first()
        assignment = responder_actions.open_assignment_for(referenced_alert, responder) if referenced_alert else None
    if not assignment:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = "No active assigned emergency for this progress update."
        return Reply(None)

    alert = assignment.alert
    try:
        if command.keyword == "ENROUTE":
            responder_actions.mark_en_route(alert, responder, note="Responder is on the way.", source="sms")
            progress = EmergencyAlert.Status.EN_ROUTE
        elif command.keyword == "ONSCENE":
            responder_actions.mark_on_scene(alert, responder, note="Responder arrived at the location.", source="sms")
            progress = EmergencyAlert.Status.ARRIVED
        else:
            responder_actions.resolve(
                alert,
                responder,
                note=command.rest or "Incident resolved by responder.",
                source="sms",
            )
            progress = EmergencyAlert.Status.RESOLVED
    except responder_actions.ActionError as exc:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = str(exc)
        return Reply(None)

    alert.refresh_from_db()
    transaction.on_commit(lambda: notify_reporter_progress(alert, progress))
    inbound.alert = alert
    inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
    inbound.detail = f"Recorded responder progress: {progress}."
    return Reply(None)


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
        # `deliver()` only sends current-format operational replies. Keeping
        # this under the sms-v2 namespace also makes gateway retries safe.
        idempotency_key=f"sms-v2:reply:{inbound.dedupe_key}",
        alert=reply.alert,
        recipient=reply.recipient or inbound.matched_user,
        in_reply_to=inbound,
    )
