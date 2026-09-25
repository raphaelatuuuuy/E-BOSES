import logging

from . import templates
from .gateway import queue_sms
from .models import OutboundSmsMessage, SmsPurpose

logger = logging.getLogger(__name__)
PREFIX = "sms-v2"


def priority_for(alert):
    return "CRITICAL" if (alert.triage or {}).get("injuries") == "yes" else "HIGH"


def notify_responder_assigned(alert, responder):
    number = getattr(responder, "phone_number", "")
    if not number:
        return
    profile = getattr(alert.reporter, "resident_profile", None)
    name = " ".join(filter(None, [getattr(profile, "first_name", ""), getattr(profile, "last_name", "")]))
    from apps.emergencies.contacts import resolve_reporter_number

    try:
        assignment = alert.assignments.filter(responder=responder).order_by("-assigned_at", "-id").first()
        queue_sms(
            number,
            templates.responder_dispatch(
                alert,
                recipient_name=getattr(getattr(responder, "resident_profile", None), "first_name", ""),
                unit_name=templates.unit_label(alert),
                reporter_name=name,
                contact=resolve_reporter_number(alert),
            ),
            purpose=SmsPurpose.DISPATCH,
            idempotency_key=f"{PREFIX}:dispatch:{alert.pk}:{responder.pk}:{getattr(assignment, 'pk', 0)}",
            alert=alert,
            recipient=responder,
        )
    except Exception:
        logger.warning("Unit SMS failed for emergency %s.", alert.pk, exc_info=True)


def notify_active_unit(alert):
    from apps.emergencies.views import active_unit_responders

    # Dispatch SMS is an independent safety channel. It must not wait for a
    # reverse-geocoder result, and it must not be skipped because a responder
    # is currently online. Online responders receive the same SMS as offline
    # responders; push/in-app presence is only an additional channel.
    responders = active_unit_responders(alert)
    if not alert.assignments.exists():
        return []
    for responder in responders:
        notify_responder_assigned(alert, responder)
    return responders


def notify_reporter(alert, body, *, key):
    from apps.emergencies.contacts import resolve_reporter_number

    number = resolve_reporter_number(alert)
    if not number or not body:
        return
    try:
        queue_sms(
            number, body,
            purpose=SmsPurpose.EMERGENCY_ACK,
            idempotency_key=f"{PREFIX}:{key}:{alert.pk}",
            alert=alert, recipient=alert.reporter,
        )
    except Exception:
        logger.warning("Resident SMS failed for emergency %s.", alert.pk, exc_info=True)


def notify_reporter_ack(alert, *, unit_name="", assigned=True):
    if alert.status not in {"submitted", "routing", "routed", "awaiting_acknowledgment", "escalation_required", "invalid"}:
        return
    dispatches = OutboundSmsMessage.objects.filter(
        alert=alert, purpose=SmsPurpose.DISPATCH, idempotency_key__startswith=f"{PREFIX}:dispatch:",
    )
    sent = dispatches.filter(status__in=["sent", "delivered"]).exists()
    if sent and alert.assignments.exists():
        notify_reporter(alert, templates.emergency_ack(alert, unit_name=unit_name), key="assigned")
    elif not dispatches.filter(status__in=["queued", "sending"]).exists():
        notify_reporter(alert, templates.pending_response(alert), key="pending")


def notify_reporter_progress(alert, status):
    if status in {"routed", "acknowledged", "in_progress", "backup_assigned"}:
        return
    body = templates.resident_progress(alert, status)
    if body:
        notify_reporter(alert, body, key=status)


def notify_reporter_resolved(alert):
    notify_reporter_progress(alert, "resolved")


def notify_reporter_backup(alert):
    return None


def notify_responder_reassigned(alert, responder, *, reason=""):
    notify_responder_assigned(alert, responder)


def notify_responder_backup_assigned(alert, responder, *, backup_type="", urgency="", reason=""):
    notify_responder_assigned(alert, responder)


def notify_officials_no_responder(alert, unit_name=""):
    return None


def notify_officials_new_emergency(alert, *, unit_name="", responder_name=""):
    return None


def notify_off_duty(alert, hotlines=None):
    notify_reporter_ack(alert, assigned=False)
