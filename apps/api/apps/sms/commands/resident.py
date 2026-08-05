"""Resident SMS commands: STATUS, SAFE, CANCEL, GUIDE.

`HELP` is handled in `router` because it creates an emergency and must not be
reachable only through this module's permission checks.

Neither SAFE nor CANCEL closes an incident. A resident texting "safe" is
reporting, not deciding: responders still confirm on scene, and an official
still approves a cancellation. Treating either as a resolution would let a
mis-sent text stand down a real response.
"""

from __future__ import annotations

from apps.emergencies.models import EmergencyAlert

from .. import templates
from ..models import InboundSmsMessage
from ..normalize import SenderMatch

# Friendly wording for each raw status. Residents never see enum values.
STATUS_TEXT = {
    EmergencyAlert.Status.SUBMITTED: "Received, finding a responder",
    EmergencyAlert.Status.ROUTED: "Responder assigned",
    EmergencyAlert.Status.ACKNOWLEDGED: "Responder confirmed",
    EmergencyAlert.Status.EN_ROUTE: "Responder on the way",
    EmergencyAlert.Status.NEARBY: "Responder is near you",
    EmergencyAlert.Status.ARRIVED: "Responder at the scene",
    EmergencyAlert.Status.RESIDENT_SAFE: "You reported you are safe",
    EmergencyAlert.Status.RESOLVED: "Resolved",
    EmergencyAlert.Status.FALSE_ALARM: "Closed as false alarm",
    EmergencyAlert.Status.INVALID: "Closed",
    EmergencyAlert.Status.CANCELLED: "Cancelled",
}


def status_text(alert) -> str:
    return STATUS_TEXT.get(alert.status, "Being reviewed")


def responder_text(alert) -> str:
    """Who is coming, named the way a resident can use.

    First name plus last initial: enough for the resident to recognise whoever
    knocks, without publishing a responder's full identity over SMS.
    """
    assignment = (
        alert.assignments.filter(
            status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
        )
        .select_related("responder", "responder__resident_profile")
        .order_by("assigned_at", "id")
        .first()
    )
    if not assignment:
        return ""
    try:
        from apps.emergencies.views import privacy_safe_user_name, responder_display_unit

        name = privacy_safe_user_name(assignment.responder)
        unit = responder_display_unit(assignment.responder)
        return f"{name} ({unit})" if unit else name
    except Exception:
        return "assigned responder"


def status_body(alert) -> str:
    return templates.status_reply(
        alert,
        status_text=status_text(alert),
        responder_text=responder_text(alert),
    )


def latest_alert_for(match: SenderMatch, inbound):
    """The report this sender is asking about.

    Prefers an open incident. Falls back to the most recent closed one within
    the last day so "STATUS" right after a resolution still answers usefully
    instead of claiming the resident never reported anything.
    """
    from datetime import timedelta

    from django.utils import timezone

    from apps.emergencies.sms_intake import (
        active_alert_for,
        find_intake_reporter,
        is_anonymous_intake,
    )
    from apps.emergencies.views import ACTIVE_STATUSES

    reporter = match.user if match.is_registered else find_intake_reporter(inbound.sender_number, match)
    if not reporter:
        return None

    active = active_alert_for(reporter, inbound.sender_number)
    if active:
        return active

    recent = EmergencyAlert.objects.filter(reporter=reporter).exclude(status__in=ACTIVE_STATUSES)
    if is_anonymous_intake(reporter):
        recent = recent.filter(reporter_contact_number=inbound.sender_number)
    return (
        recent.filter(created_at__gte=timezone.now() - timedelta(days=1))
        .order_by("-created_at", "-id")
        .first()
    )


def handle(inbound, command, match: SenderMatch):
    from ..router import Reply

    if command.keyword == "GUIDE":
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        return Reply(templates.guide_resident())

    alert = latest_alert_for(match, inbound)
    if not alert:
        inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED
        inbound.detail = f"{command.keyword} with no report to act on."
        return Reply(templates.no_active_report())

    inbound.alert = alert
    inbound.outcome = InboundSmsMessage.Outcome.COMMAND_HANDLED

    if command.keyword == "STATUS":
        inbound.detail = f"Status sent for {templates.reference(alert)}."
        return Reply(status_body(alert), alert=alert)

    if command.keyword == "SAFE":
        return _handle_safe(inbound, alert)

    if command.keyword == "CANCEL":
        return _handle_cancel(inbound, alert, command)

    inbound.outcome = InboundSmsMessage.Outcome.UNRECOGNISED
    return Reply(templates.unknown_command(command.raw_first_token))


def _handle_safe(inbound, alert):
    from ..router import Reply

    from apps.emergencies.sms_intake import mark_resident_safe

    if alert.status not in _open_statuses():
        inbound.detail = "SAFE received for a closed report."
        return Reply(templates.no_active_report())

    mark_resident_safe(alert)
    _notify_responders(alert, "The reporter texted SAFE. Still confirm on scene before standing down.")
    inbound.detail = f"Resident reported safe on {templates.reference(alert)}."
    return Reply(templates.safe_ack(alert), alert=alert)


def _handle_cancel(inbound, alert, command):
    from ..router import Reply

    from apps.emergencies.sms_intake import request_resident_cancellation

    if alert.status not in _open_statuses():
        inbound.detail = "CANCEL received for a closed report."
        return Reply(templates.no_active_report())

    reason = (command.rest or "").strip()[:200]
    # Recorded as a request, not applied: an official confirms, because a
    # cancelled emergency stops a response that may still be needed.
    request_resident_cancellation(alert, reason=reason)
    _notify_officials(alert, f"Resident asked to cancel. {reason}".strip())
    inbound.detail = f"Cancellation requested on {templates.reference(alert)}."
    return Reply(templates.cancel_ack(alert), alert=alert)


def _open_statuses():
    from apps.emergencies.views import ACTIVE_STATUSES

    return ACTIVE_STATUSES


def _notify_responders(alert, body: str) -> None:
    from apps.notifications.services import create_emergency_notification

    assignments = alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder")
    for assignment in assignments:
        try:
            create_emergency_notification(
                alert=alert,
                recipient=assignment.responder,
                type="emergency_updated",
                title="Reporter says they are safe",
                body=body,
            )
        except Exception:
            continue


def _notify_officials(alert, body: str) -> None:
    from django.contrib.auth import get_user_model

    from apps.notifications.services import create_emergency_notification

    User = get_user_model()
    officials = User.objects.filter(
        role=User.Role.BARANGAY_OFFICIAL,
        status=User.Status.VERIFIED,
    )[:20]
    for official in officials:
        try:
            create_emergency_notification(
                alert=alert,
                recipient=official,
                type="emergency_updated",
                title="Cancellation requested by SMS",
                body=body,
            )
        except Exception:
            continue
