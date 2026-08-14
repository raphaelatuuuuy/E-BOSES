"""Outbound SMS triggered by emergency events.

Every call is best-effort and swallows its own errors: a gateway problem must
never roll back an assignment or block dispatch.
"""

from __future__ import annotations

import logging

from . import templates
from .gateway import queue_sms
from .models import SmsPurpose

logger = logging.getLogger(__name__)

PRIORITY_BY_TYPE = {
    "fire": "CRITICAL",
    "medical": "CRITICAL",
    "flood": "HIGH",
    "disaster": "CRITICAL",
    "crime": "HIGH",
    "domestic_violence": "CRITICAL",
    "child_protection": "CRITICAL",
    "dangerous_animal": "NORMAL",
    "drug_related": "HIGH",
    "other": "NORMAL",
}


def priority_for(alert) -> str:
    base = PRIORITY_BY_TYPE.get(getattr(alert, "type", ""), "HIGH")
    triage = getattr(alert, "triage", None) or {}
    if triage.get("injuries") == "yes" or triage.get("detail") in {"trapped", "unconscious", "immediate_danger"}:
        return "CRITICAL"
    if triage.get("people_affected") == "many" and base == "NORMAL":
        return "HIGH"
    return base


def _summary(alert) -> str:
    from .parsing import triage_summary

    parts = [triage_summary(getattr(alert, "triage", None) or {})]
    note = (getattr(alert, "note", "") or "").strip()
    if note:
        parts.append(note[:100])
    return " ".join(part for part in parts if part).strip()


def notify_responder_assigned(alert, responder) -> None:
    number = getattr(responder, "phone_number", "")
    if not number:
        return
    try:
        queue_sms(
            number,
            templates.responder_dispatch(
                alert,
                priority=priority_for(alert),
                summary=_summary(alert),
                contact=alert.reporter_contact_number or getattr(alert.reporter, "phone_number", ""),
            ),
            purpose=SmsPurpose.DISPATCH,
            idempotency_key=f"dispatch:{alert.pk}:{responder.pk}",
            alert=alert,
            recipient=responder,
        )
    except Exception:
        logger.warning("Dispatch SMS failed for alert %s.", alert.pk, exc_info=True)


def notify_officials_no_responder(alert, unit_name="") -> None:
    from django.contrib.auth import get_user_model

    User = get_user_model()
    officials = User.objects.filter(
        role=User.Role.BARANGAY_OFFICIAL,
        status=User.Status.VERIFIED,
    ).exclude(phone_number="")[:10]
    body = templates.official_no_responder(alert, unit_name=unit_name)
    for official in officials:
        try:
            queue_sms(
                official.phone_number,
                body,
                purpose=SmsPurpose.OFFICIAL_ALERT,
                idempotency_key=f"noresponder:{alert.pk}:{official.pk}",
                alert=alert,
                recipient=official,
            )
        except Exception:
            continue


def notify_reporter(alert, body: str, *, key: str) -> None:
    number = (alert.reporter_contact_number or "").strip() or getattr(alert.reporter, "phone_number", "")
    if not number:
        return
    try:
        queue_sms(
            number,
            body,
            purpose=SmsPurpose.EMERGENCY_ACK,
            idempotency_key=f"{key}:{alert.pk}",
            alert=alert,
            recipient=alert.reporter,
        )
    except Exception:
        logger.warning("Reporter SMS failed for alert %s.", alert.pk, exc_info=True)


def notify_reporter_ack(alert, *, unit_name="", assigned=True) -> None:
    """First reply to the resident, whatever channel the emergency came from.

    Previously only reachable from the inbound-SMS router, so a resident who
    pressed SOS in the app was never told their alert had landed.
    """
    surname = ""
    profile = getattr(getattr(alert, "reporter", None), "resident_profile", None)
    if profile:
        surname = profile.last_name or ""
    notify_reporter(
        alert,
        templates.emergency_ack(
            alert, surname=surname, unit_name=unit_name, assigned=assigned
        ),
        key="ack",
    )


def notify_reporter_resolved(alert) -> None:
    notify_reporter(alert, templates.resident_resolved_notice(alert), key="resolved")


def notify_reporter_backup(alert) -> None:
    notify_reporter(alert, templates.resident_backup_notice(alert), key="backup")


def notify_responder_reassigned(alert, responder, *, reason="") -> None:
    number = getattr(responder, "phone_number", "")
    if not number:
        return
    try:
        queue_sms(
            number,
            templates.reassigned_notice(alert, reason=reason),
            purpose=SmsPurpose.DISPATCH,
            idempotency_key=f"reassign:{alert.pk}:{responder.pk}",
            alert=alert,
            recipient=responder,
        )
    except Exception:
        logger.warning("Reassignment SMS failed for alert %s.", alert.pk, exc_info=True)


def notify_responder_backup_assigned(alert, responder, *, backup_type="", urgency="", reason="") -> None:
    number = getattr(responder, "phone_number", "")
    if not number:
        return
    try:
        queue_sms(
            number,
            templates.backup_assigned_notice(
                alert, backup_type=backup_type, urgency=urgency, reason=reason
            ),
            purpose=SmsPurpose.DISPATCH,
            idempotency_key=f"backup:{alert.pk}:{responder.pk}",
            alert=alert,
            recipient=responder,
        )
    except Exception:
        logger.warning("Backup SMS failed for alert %s.", alert.pk, exc_info=True)


def notify_officials_new_emergency(alert, *, unit_name="", responder_name="") -> None:
    from django.contrib.auth import get_user_model

    User = get_user_model()
    officials = User.objects.filter(
        role=User.Role.BARANGAY_OFFICIAL,
        status=User.Status.VERIFIED,
    ).exclude(phone_number="")[:10]
    body = templates.official_new_emergency(
        alert, unit_name=unit_name, responder_name=responder_name
    )
    for official in officials:
        try:
            queue_sms(
                official.phone_number,
                body,
                purpose=SmsPurpose.OFFICIAL_ALERT,
                idempotency_key=f"newalert:{alert.pk}:{official.pk}",
                alert=alert,
                recipient=official,
            )
        except Exception:
            continue


def notify_off_duty(alert, hotlines=None) -> None:
    notify_reporter(alert, templates.off_duty_notice(alert, hotlines), key="offduty")
