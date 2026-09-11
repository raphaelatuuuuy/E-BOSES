"""Responder actions shared by the HTTP API and the SMS command router.

Both channels must produce identical records, notifications and audit trails,
so neither owns the logic.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from apps.accounts.services import create_audit_log
from apps.notifications.services import create_emergency_notification, notify_emergency_status

from .models import EmergencyAlert, EmergencyEscalation, EmergencyResponderAssignment
from .recipients import dispatch_officials

logger = logging.getLogger(__name__)

OPEN_ASSIGNMENT_STATUSES = [
    EmergencyResponderAssignment.Status.ASSIGNED,
    EmergencyResponderAssignment.Status.ACKNOWLEDGED,
    EmergencyResponderAssignment.Status.EN_ROUTE,
    EmergencyResponderAssignment.Status.ARRIVED,
    EmergencyResponderAssignment.Status.ASSISTING,
]

BACKUP_TYPES = {
    "tanod": "Additional Barangay Tanod",
    "medical": "Medical Assistance",
    "fire": "Fire Assistance",
    "disaster": "Disaster Response",
    "traffic": "Traffic Control",
    "vawc": "VAWC or Protection Support",
    "other": "Other Authorized Support",
}

URGENCY_LEVELS = {"immediate": "Immediate", "high": "High", "normal": "Normal"}


class ActionError(Exception):
    """Raised when an action cannot be applied; message is user-facing."""


def open_assignment_for(alert, responder, *, lock=False):
    """Return the responder's current assignment.

    Callers that transition the assignment lock this row so concurrent
    location and progress updates cannot apply the same change twice.
    """
    queryset = alert.assignments.filter(
        responder=responder,
        status__in=OPEN_ASSIGNMENT_STATUSES,
    )
    if lock:
        queryset = queryset.select_for_update()
    return queryset.select_related("alert").first()


def active_assignment_for(responder):
    from .views import ACTIVE_STATUSES

    return (
        EmergencyResponderAssignment.objects.filter(
            responder=responder,
            status__in=OPEN_ASSIGNMENT_STATUSES,
            alert__status__in=ACTIVE_STATUSES,
        )
        .select_related("alert")
        .order_by("-assigned_at", "-id")
        .first()
    )


def _advance_alert(alert, new_status, actor, note):
    from .views import create_status_event

    alert.status = new_status
    alert.status_version += 1
    alert.save(update_fields=["status", "status_version", "updated_at"])
    create_status_event(alert, new_status, actor, note)
    try:
        notify_emergency_status(alert, type=new_status, body=note)
    except Exception:
        logger.warning("Status notification failed for alert %s.", alert.pk, exc_info=True)


@transaction.atomic
def mark_en_route(alert, responder, *, note="", source="api"):
    from .views import log_assignment_action

    assignment = open_assignment_for(alert, responder, lock=True)
    if not assignment:
        raise ActionError("You are not assigned to this emergency.")
    alert = EmergencyAlert.objects.select_for_update().get(pk=alert.pk)
    # The assignment may have changed while the caller was building the
    # request.  Re-read it under the same lock before applying a transition.
    assignment = (
        EmergencyResponderAssignment.objects
        .select_for_update()
        .select_related("alert", "responder")
        .filter(pk=assignment.pk)
        .first()
    )
    if not assignment or assignment.status not in OPEN_ASSIGNMENT_STATUSES:
        raise ActionError("This dispatch is no longer active.")
    if assignment.status in {
        EmergencyResponderAssignment.Status.EN_ROUTE,
        EmergencyResponderAssignment.Status.ARRIVED,
        EmergencyResponderAssignment.Status.ASSISTING,
    }:
        return assignment

    assignment.status = EmergencyResponderAssignment.Status.EN_ROUTE
    assignment.acknowledged_at = assignment.acknowledged_at or timezone.now()
    assignment.status_note = note[:255]
    assignment.save(update_fields=["status", "acknowledged_at", "status_note"])

    log_assignment_action(
        alert=alert,
        assignment=assignment,
        responder=responder,
        actor=responder,
        action="en_route",
        new_status=assignment.status,
        note=note[:255],
        metadata={"source": source},
    )
    _advance_alert(alert, EmergencyAlert.Status.EN_ROUTE, responder, "Responder is on the way.")
    create_audit_log(
        "emergency.en_route",
        actor=responder,
        target_user=alert.reporter,
        metadata={"alert_id": alert.pk, "source": source},
    )
    return assignment


@transaction.atomic
def mark_on_scene(alert, responder, *, note="", source="api"):
    from .views import log_assignment_action

    alert = EmergencyAlert.objects.select_for_update().get(pk=alert.pk)
    assignment = open_assignment_for(alert, responder, lock=True)
    if not assignment:
        raise ActionError("You are not assigned to this emergency.")
    from .views import ACTIVE_STATUSES
    if alert.status not in ACTIVE_STATUSES:
        raise ActionError("This emergency is no longer active.")
    if assignment.status in {EmergencyResponderAssignment.Status.ARRIVED, EmergencyResponderAssignment.Status.ASSISTING}:
        return assignment

    assignment.status = EmergencyResponderAssignment.Status.ARRIVED
    assignment.arrived_at = assignment.arrived_at or timezone.now()
    assignment.save(update_fields=["status", "arrived_at"])
    log_assignment_action(
        alert=alert,
        assignment=assignment,
        responder=responder,
        actor=responder,
        action="arrived",
        new_status=assignment.status,
        note=note[:255],
        metadata={"source": source},
    )
    _advance_alert(alert, EmergencyAlert.Status.ARRIVED, responder, "Responder is at the scene.")
    return assignment


@transaction.atomic
def resolve(alert, responder, *, note, source="api"):
    from .views import log_assignment_action

    note = (note or "").strip()
    if len(note) < 3:
        raise ActionError("A short closing note is required before resolving.")

    assignment = open_assignment_for(alert, responder)
    if assignment:
        assignment.status = EmergencyResponderAssignment.Status.RESOLVED
        assignment.status_note = note[:255]
        assignment.save(update_fields=["status", "status_note"])
        log_assignment_action(
            alert=alert,
            assignment=assignment,
            responder=responder,
            actor=responder,
            action="resolved",
            new_status=assignment.status,
            note=note[:255],
            metadata={"source": source},
        )

    alert.resolved_at = timezone.now()
    alert.resolution_report = note[:2000]
    alert.save(update_fields=["resolved_at", "resolution_report", "updated_at"])
    _advance_alert(alert, EmergencyAlert.Status.RESOLVED, responder, note[:255])
    create_audit_log(
        "emergency.resolved",
        actor=responder,
        target_user=alert.reporter,
        metadata={"alert_id": alert.pk, "source": source},
    )
    return alert


@transaction.atomic
def request_backup(alert, responder, *, backup_type="other", reason="", urgency="high", source="api"):
    from .views import find_backup_responder, log_assignment_action

    reason = (reason or "").strip()
    if len(reason) < 3:
        raise ActionError("Say briefly what support you need.")
    backup_type = backup_type if backup_type in BACKUP_TYPES else "other"
    urgency = urgency if urgency in URGENCY_LEVELS else "high"

    requester_assignment = open_assignment_for(alert, responder)
    backup = find_backup_responder(alert)

    escalation = EmergencyEscalation.objects.create(
        alert=alert,
        previous_assignment=requester_assignment,
        escalated_to=backup,
        triggered_by=responder,
        reason=f"Backup requested. {reason[:150]}".strip(),
    )

    backup_assignment = None
    if backup:
        backup_assignment, _ = EmergencyResponderAssignment.objects.get_or_create(
            alert=alert,
            responder=backup,
            defaults={
                "status": EmergencyResponderAssignment.Status.ASSIGNED,
                "source": EmergencyResponderAssignment.Source.ESCALATION,
            },
        )
        log_assignment_action(
            alert=alert,
            assignment=backup_assignment,
            responder=backup,
            actor=responder,
            action="backup_assigned",
            new_status=backup_assignment.status,
            note=escalation.reason[:255],
            metadata={"backup_type": backup_type, "urgency": urgency, "source": source},
        )
        try:
            create_emergency_notification(
                alert=alert,
                recipient=backup,
                type="emergency_escalated",
                title=f"Backup requested: {BACKUP_TYPES[backup_type]}",
                body=reason[:240],
            )
        except Exception:
            logger.warning("Backup notification failed for alert %s.", alert.pk, exc_info=True)
    else:
        _notify_officials(alert, f"Backup requested but nobody is free: {reason[:150]}")

    create_audit_log(
        "emergency.backup_requested",
        actor=responder,
        target_user=alert.reporter,
        metadata={
            "alert_id": alert.pk,
            "backup_type": backup_type,
            "urgency": urgency,
            "backup_id": getattr(backup, "pk", None),
            "source": source,
        },
    )
    return backup


@transaction.atomic
def set_duty(responder, *, on_duty, source="api"):
    from .models import ResponderShift

    if bool(responder.is_on_duty) == bool(on_duty):
        return responder

    responder.is_on_duty = bool(on_duty)
    responder.save(update_fields=["is_on_duty", "updated_at"])

    if on_duty:
        ResponderShift.objects.get_or_create(
            responder=responder,
            ended_at=None,
            defaults={"status": ResponderShift.Status.ACTIVE, "started_at": timezone.now()},
        )
    else:
        from .views import finish_responder_shift

        shift = ResponderShift.objects.filter(responder=responder, ended_at__isnull=True).first()
        if shift:
            finish_responder_shift(shift)

    create_audit_log(
        "emergency.duty_changed",
        actor=responder,
        target_user=responder,
        metadata={"is_on_duty": bool(on_duty), "source": source},
    )
    return responder


def _notify_officials(alert, body):
    officials = dispatch_officials(alert, limit=20)
    for official in officials:
        try:
            create_emergency_notification(
                alert=alert,
                recipient=official,
                type="emergency_escalated",
                title="Emergency needs attention",
                body=body,
            )
        except Exception:
            continue
