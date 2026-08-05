"""Responder and official SMS commands."""

from __future__ import annotations

import logging

from apps.emergencies.models import EmergencyAlert
from apps.emergencies.responder_actions import (
    ActionError,
    acknowledge,
    active_assignment_for,
    decline,
    mark_on_scene,
    request_backup,
    resolve,
    set_duty,
)

from .. import templates
from ..models import InboundSmsMessage, SmsOperatorPin
from ..normalize import SenderMatch
from .resident import status_text

logger = logging.getLogger(__name__)

RESPONDER_COMMANDS = {
    "ACCEPT", "DECLINE", "ONSCENE", "BACKUP", "RESOLVED", "STATUS", "ONDUTY", "OFFDUTY", "GUIDE",
}
OFFICIAL_READ_COMMANDS = {"STATUS", "OPEN", "DETAIL", "ONDUTY", "GUIDE"}
OFFICIAL_WRITE_COMMANDS = {"ESCALATE", "CLOSE"}
REASON_REQUIRED = {"DECLINE", "BACKUP", "RESOLVED"}


def handle(inbound, command, match: SenderMatch, role: str):
    from ..router import ROLE_OFFICIAL, Reply

    if command.keyword == "GUIDE":
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        return Reply(templates.guide_official() if role == ROLE_OFFICIAL else templates.guide_responder())

    if role == ROLE_OFFICIAL:
        return _handle_official(inbound, command, match)
    return _handle_responder(inbound, command, match)


# ---------------------------------------------------------------------------
# Responder
# ---------------------------------------------------------------------------

def _handle_responder(inbound, command, match: SenderMatch):
    from ..router import Reply

    responder = match.user
    if command.keyword not in RESPONDER_COMMANDS:
        inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
        return Reply(templates.not_authorised(command.keyword))

    if command.keyword in {"ONDUTY", "OFFDUTY"}:
        on_duty = command.keyword == "ONDUTY"
        set_duty(responder, on_duty=on_duty, source="sms")
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = f"Duty set to {'on' if on_duty else 'off'} by SMS."
        return Reply(templates.duty_ack(on_duty=on_duty, unit_name=_unit_name(responder)))

    alert = _resolve_alert(command, responder)
    if not alert:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = f"{command.keyword} with no matching assignment."
        return Reply(templates.responder_no_assignment())

    inbound.alert = alert
    inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED

    if command.keyword == "STATUS":
        return Reply(_responder_status(alert), alert=alert)

    reason = (command.rest or "").strip()
    if command.keyword in REASON_REQUIRED and len(reason) < 3:
        return Reply(templates.responder_needs_reason(command.keyword, templates.reference(alert)))

    try:
        if command.keyword == "ACCEPT":
            acknowledge(alert, responder, note="Acknowledged by SMS.", source="sms")
            inbound.detail = f"Acknowledged {templates.reference(alert)}."
            return Reply(templates.responder_accept_ack(alert), alert=alert)

        if command.keyword == "DECLINE":
            replacement = decline(alert, responder, reason=reason, source="sms")
            inbound.detail = f"Declined {templates.reference(alert)}."
            return Reply(templates.responder_decline_ack(alert, reassigned=bool(replacement)), alert=alert)

        if command.keyword == "ONSCENE":
            mark_on_scene(alert, responder, note=reason, source="sms")
            inbound.detail = f"On scene at {templates.reference(alert)}."
            return Reply(templates.responder_onscene_ack(alert), alert=alert)

        if command.keyword == "BACKUP":
            backup = request_backup(
                alert,
                responder,
                backup_type=_backup_type(reason),
                reason=reason,
                source="sms",
            )
            inbound.detail = f"Backup requested on {templates.reference(alert)}."
            return Reply(
                templates.responder_backup_ack(alert, assigned_name=_short_name(backup)),
                alert=alert,
            )

        if command.keyword == "RESOLVED":
            resolve(alert, responder, note=reason, source="sms")
            inbound.detail = f"Resolved {templates.reference(alert)}."
            return Reply(templates.responder_resolved_ack(alert), alert=alert)
    except ActionError as exc:
        inbound.detail = f"{command.keyword} refused: {exc}"
        return Reply(f"{templates.BRAND}: {exc}", alert=alert)

    inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
    return Reply(templates.unknown_command(command.raw_first_token))


def _resolve_alert(command, responder):
    if command.reference:
        alert = EmergencyAlert.objects.filter(pk=command.reference).first()
        if alert:
            return alert
    assignment = active_assignment_for(responder)
    return assignment.alert if assignment else None


def _responder_status(alert):
    return templates.official_detail(
        alert,
        status_text=status_text(alert),
        unit_name="",
        responder_text="you",
        contact=alert.reporter_contact_number or getattr(alert.reporter, "phone_number", ""),
    )


_BACKUP_KEYWORDS = (
    ("medical", ("medic", "ambulance", "injur", "bhw")),
    ("fire", ("fire", "sunog", "smoke")),
    ("disaster", ("flood", "baha", "rescue", "disaster")),
    ("traffic", ("traffic", "road")),
    ("vawc", ("vawc", "violence", "child")),
    ("tanod", ("tanod", "crowd", "police", "safety")),
)


def _backup_type(reason: str) -> str:
    lowered = (reason or "").lower()
    for code, keywords in _BACKUP_KEYWORDS:
        if any(word in lowered for word in keywords):
            return code
    return "other"


def _unit_name(user) -> str:
    try:
        from apps.emergencies.views import responder_display_unit

        return responder_display_unit(user)
    except Exception:
        return ""


def _short_name(user) -> str:
    if not user:
        return ""
    try:
        from apps.emergencies.views import privacy_safe_user_name

        return privacy_safe_user_name(user)
    except Exception:
        return "a responder"


# ---------------------------------------------------------------------------
# Official
# ---------------------------------------------------------------------------

def _handle_official(inbound, command, match: SenderMatch):
    from ..router import Reply

    official = match.user
    if command.keyword in OFFICIAL_READ_COMMANDS:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        return _official_read(inbound, command, official)

    if command.keyword not in OFFICIAL_WRITE_COMMANDS:
        inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
        inbound.detail = f"{command.keyword} is not available over SMS."
        return Reply(templates.not_authorised(command.keyword))

    return _official_write(inbound, command, official)


def _official_read(inbound, command, official):
    from ..router import Reply
    from apps.emergencies.views import ACTIVE_STATUSES

    if command.keyword in {"STATUS", "OPEN"}:
        alerts = list(
            EmergencyAlert.objects.filter(status__in=ACTIVE_STATUSES).order_by("-created_at")[:20]
        )
        inbound.detail = f"Listed {len(alerts)} active emergencies."
        return Reply(templates.official_open_list(alerts))

    if command.keyword == "ONDUTY":
        return Reply(templates.official_duty_roster(_on_duty_names()))

    if command.keyword == "DETAIL":
        alert = EmergencyAlert.objects.filter(pk=command.reference).first() if command.reference else None
        if not alert:
            return Reply(templates.no_active_report())
        inbound.alert = alert
        return Reply(
            templates.official_detail(
                alert,
                status_text=status_text(alert),
                unit_name=_primary_unit_name(alert),
                responder_text=_primary_responder_name(alert),
                contact=alert.reporter_contact_number or getattr(alert.reporter, "phone_number", ""),
            ),
            alert=alert,
        )

    return Reply(templates.guide_official())


def _official_write(inbound, command, official):
    """ESCALATE / CLOSE — both require the official's PIN."""
    from ..router import Reply
    from apps.emergencies.models import EmergencyEscalation
    from apps.emergencies.views import create_status_event
    from apps.accounts.services import create_audit_log

    if not command.reference:
        inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
        return Reply(templates.pin_required(command.keyword))

    tokens = (command.rest or "").split()
    supplied_pin = tokens[0] if tokens else ""
    note = " ".join(tokens[1:]).strip()

    record = SmsOperatorPin.objects.filter(user=official).first()
    if not record:
        inbound.outcome = InboundSmsMessage.Outcome.REJECTED
        inbound.detail = f"{command.keyword} refused: no SMS PIN configured."
        return Reply(templates.pin_required(command.keyword))
    if record.is_locked:
        inbound.outcome = InboundSmsMessage.Outcome.REJECTED
        inbound.detail = f"{command.keyword} refused: PIN locked."
        return Reply(templates.pin_invalid(attempts_left=0))
    if not supplied_pin or not record.check_pin(supplied_pin):
        inbound.outcome = InboundSmsMessage.Outcome.REJECTED
        inbound.detail = f"{command.keyword} refused: bad PIN."
        create_audit_log(
            "sms.official_pin_failed",
            actor=official,
            metadata={"command": command.keyword, "attempts_left": record.attempts_left},
        )
        return Reply(templates.pin_invalid(attempts_left=record.attempts_left))

    alert = EmergencyAlert.objects.filter(pk=command.reference).first()
    if not alert:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        return Reply(templates.no_active_report())

    inbound.alert = alert
    inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED

    if command.keyword == "ESCALATE":
        EmergencyEscalation.objects.create(
            alert=alert,
            triggered_by=official,
            reason=note[:255] or "Escalated by official over SMS.",
        )
        create_status_event(alert, alert.status, official, "Escalated by official (SMS).")
        create_audit_log(
            "emergency.escalated",
            actor=official,
            target_user=alert.reporter,
            metadata={"alert_id": alert.pk, "source": "sms"},
        )
        inbound.detail = f"Escalated {templates.reference(alert)}."
        return Reply(
            f"{templates.BRAND}: {templates.reference(alert)} escalated. Officials on call were notified.",
            alert=alert,
        )

    if len(note) < 3:
        return Reply(templates.responder_needs_reason("CLOSE", templates.reference(alert)))

    alert.status = EmergencyAlert.Status.RESOLVED
    alert.status_version += 1
    alert.resolution_report = note[:2000]
    alert.save(update_fields=["status", "status_version", "resolution_report", "updated_at"])
    create_status_event(alert, alert.status, official, note[:255])
    create_audit_log(
        "emergency.closed",
        actor=official,
        target_user=alert.reporter,
        metadata={"alert_id": alert.pk, "source": "sms"},
    )
    inbound.detail = f"Closed {templates.reference(alert)}."
    return Reply(f"{templates.BRAND}: {templates.reference(alert)} is now closed.", alert=alert)


def _on_duty_names():
    from django.contrib.auth import get_user_model

    User = get_user_model()
    responders = User.objects.filter(
        role=User.Role.FIRST_RESPONDER,
        status=User.Status.VERIFIED,
        is_on_duty=True,
    ).select_related("resident_profile")[:20]
    return [f"{_short_name(user)} {_unit_name(user)}".strip() for user in responders]


def _primary_unit_name(alert) -> str:
    assignment = alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder").first()
    return _unit_name(assignment.responder) if assignment else ""


def _primary_responder_name(alert) -> str:
    assignment = alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder", "responder__resident_profile").first()
    return _short_name(assignment.responder) if assignment else ""
