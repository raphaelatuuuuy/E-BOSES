"""Dry-run of the whole inbound SMS pipeline for the admin test workspace.

Mirrors `apps.sms.router._dispatch` step for step — OTP firewall, command
tokeniser, emergency parser, resident commands, routing, AI assist, and the
exact reply text the resident would receive — without saving an alert, an
assignment, a notification, or an outbound SMS. The only row written is the
same `LlmDecisionLog` simulation entry the other test tabs produce.

The simulated sender is either the signed-in account ("registered") or an
unrecognised number ("unknown"), so officials can feel both sides of the
verification rules: known senders are greeted by name and get the richer
acknowledgment; unknown numbers get the registration nudge.
"""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasRolePermission
from apps.capabilities import CONFIGURE_CLASSIFICATION, HasCapability

logger = logging.getLogger(__name__)

UNKNOWN_SENDER_NUMBER = "+639170000000"


class SmsSimulationView(APIView):
    """Text-only rehearsal of the SMS hotline. Nothing here is filed."""

    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION

    def post(self, request):
        message = str(request.data.get("message", ""))[:5000]
        sender_mode = "registered" if str(request.data.get("sender", "")) == "registered" else "unknown"

        payload = simulate_sms(message=message, sender_mode=sender_mode, user=request.user)
        self._log_decision(request, message, sender_mode, payload)
        return Response(payload)

    def _log_decision(self, request, message: str, sender_mode: str, payload: dict) -> None:
        from apps.concerns.models import LlmDecisionLog

        routing = payload.get("routing") or {}
        department = routing.get("department") or {}
        assigned_department = None
        if department.get("id"):
            from apps.concerns.models import Department

            assigned_department = Department.objects.filter(pk=department["id"]).first()
        LlmDecisionLog.objects.create(
            run_kind=LlmDecisionLog.RunKind.SIMULATION,
            domain=LlmDecisionLog.Domain.EMERGENCY,
            performed_by=request.user,
            model_version=(payload.get("ai_assist") or {}).get("model") or "",
            input_snapshot={"message": message, "sender": sender_mode},
            output_snapshot=payload,
            resident_message="",
            recommended_action="",
            assigned_department=assigned_department,
            routing_reason=routing.get("routing_reason", ""),
        )


def simulate_sms(*, message: str, sender_mode: str, user) -> dict:
    """Run one inbound message through the real pipeline, dry."""
    from . import templates
    from .normalize import SenderMatch, match_sender, mask_ph_mobile
    from .parsing import looks_like_otp, parse_command, parse_emergency_sms

    body = (message or "").strip()
    registered_mode = sender_mode == "registered"
    match, number = _simulated_sender(registered_mode, user)

    result = {
        "branch": "",
        "branch_reason": "",
        "sender": {
            "status": match.status,
            "label": match.label,
            "masked_number": mask_ph_mobile(number),
            "resident_name": _display_name(match),
        },
        "command": None,
        "parsed": None,
        "location": None,
        "duplicate": None,
        "routing": None,
        "ai_assist": None,
        "reply": None,
    }

    if not body:
        result["branch"] = "empty"
        result["branch_reason"] = "Nothing was sent, so nothing was processed."
        return result

    if looks_like_otp(body):
        result["branch"] = "otp_dropped"
        result["branch_reason"] = (
            "The firewall saw a verification-code-shaped text, redacted it, and dropped it"
            " before anything else could read it."
        )
        return result

    command = parse_command(body)
    result["command"] = {
        "keyword": command.keyword,
        "reference": command.reference,
        "argument": command.argument,
        "rest": command.rest,
        "recognised": command.recognised,
    }

    if command.keyword == "HELP":
        parsed = _help_branch(body, command, result)
        if parsed is None:
            return _reply(
                result,
                templates.help_needs_category(),
                branch="help_needs_category",
                reason="HELP arrived without a usable category word.",
            )
        return _emergency_path(result, parsed, match, number, user, via_help=True)

    parsed = parse_emergency_sms(body, sender_is_known=match.is_registered)
    result["parsed"] = _parsed_dump(parsed)
    if parsed.is_emergency and not command.recognised:
        return _emergency_path(result, parsed, match, number, user, via_help=False)

    if command.keyword == "GUIDE":
        return _reply(
            result,
            templates.guide_resident(),
            branch="guide",
            reason="A resident asking for GUIDE gets the command list.",
        )

    if command.keyword in {"STATUS", "SAFE", "CANCEL"}:
        return _resident_command(result, command, match, number, user)

    if command.recognised:
        return _reply(
            result,
            templates.not_authorised(command.keyword),
            branch="not_authorised",
            reason=f"{command.keyword} belongs to responder or official handsets,"
            " so a resident number is refused.",
        )

    return _reply(
        result,
        templates.unknown_command(body),
        branch="unknown",
        reason="No command keyword and no emergency signal — never silence.",
    )


# ---------------------------------------------------------------------------
# Branches
# ---------------------------------------------------------------------------


def _simulated_sender(registered_mode: bool, user):
    from .normalize import SenderMatch, match_sender

    if registered_mode:
        number = getattr(user, "phone_number", "") or ""
        return match_sender(number), number
    return SenderMatch(SenderMatch.UNVERIFIED), UNKNOWN_SENDER_NUMBER


def _help_branch(body: str, command, result: dict):
    """Mirror router._handle_help: rebuild the parser view around HELP."""
    from .parsing import parse_emergency_sms, resolve_category
    from .router import _area_after_category

    remainder = command.rest or command.argument
    code, _alias = resolve_category(remainder)
    if not code:
        return None
    parsed = parse_emergency_sms(body, sender_is_known=True)
    parsed.is_emergency = True
    parsed.category_code = code
    parsed.category_needs_confirmation = False
    if "category" in parsed.unresolved_fields:
        parsed.unresolved_fields.remove("category")
    if not parsed.reported_area:
        parsed.reported_area = _area_after_category(remainder, code)
        if parsed.reported_area and "location" in parsed.unresolved_fields:
            parsed.unresolved_fields.remove("location")
    result["parsed"] = _parsed_dump(parsed)
    return parsed


def _emergency_path(result, parsed, match, number, user, *, via_help: bool) -> dict:
    from . import templates
    from .gateway import count_segments, is_gsm7
    from .parsing import category_label

    from apps.emergencies.location_services import classify_location_confidence
    from apps.emergencies.models import EmergencyAlert
    from apps.emergencies.sms_intake import active_alert_for, resolve_category_code

    code = resolve_category_code(parsed.category_code)
    profile = getattr(user, "resident_profile", None) if match.is_registered else None
    barangay = (getattr(profile, "barangay", "") or "Marikina Heights") if profile else "Marikina Heights"

    alert = EmergencyAlert(
        type=code,
        note=parsed.note,
        latitude=parsed.latitude,
        longitude=parsed.longitude,
        location_source="sms",
        reported_area=parsed.reported_area,
        reporter_contact_number=number,
        triage=parsed.triage or {},
        category_needs_confirmation=parsed.category_needs_confirmation,
        unresolved_fields=list(parsed.unresolved_fields or []),
        barangay=barangay,
    )
    try:
        alert.location_confidence = classify_location_confidence(alert)
    except Exception:
        logger.debug("Location confidence unavailable in SMS simulation.", exc_info=True)
        alert.location_confidence = EmergencyAlert.LocationConfidence.UNKNOWN

    confidence_labels = {
        EmergencyAlert.LocationConfidence.CONFIRMED: "Inside the barangay boundary",
        EmergencyAlert.LocationConfidence.REPORTED: "Reported area only — not yet confirmed against the boundary",
        EmergencyAlert.LocationConfidence.UNKNOWN: "Not enough location information yet",
        EmergencyAlert.LocationConfidence.OUTSIDE_AREA: "Outside the barangay service area",
    }
    result["location"] = {
        "confidence": alert.location_confidence,
        "label": confidence_labels.get(alert.location_confidence, alert.location_confidence),
    }

    if match.is_registered and getattr(user, "pk", None):
        existing = active_alert_for(user, number)
        if existing:
            from apps.sms.commands.resident import status_body

            result["duplicate"] = {
                "would_suppress": True,
                "reference": f"E-{existing.pk}",
                "detail": f"This account already has an active emergency ({existing.pk}),"
                " so the text becomes a follow-up instead of a new alert.",
            }
            return _reply(
                result,
                status_body(existing),
                branch="duplicate",
                reason=f"One active emergency per sender — E-{existing.pk} is still open.",
                alert_like=existing,
            )

    result["routing"] = _routing_section(alert, code)
    result["ai_assist"] = _ai_assist_section(parsed, alert)

    if not match.is_registered:
        reply_text = templates.emergency_ack_unregistered(alert)
    elif alert.location_confidence == EmergencyAlert.LocationConfidence.OUTSIDE_AREA:
        reply_text = templates.outside_service_area(alert)
    else:
        responder = result["routing"].get("responder") or {}
        reply_text = templates.emergency_ack(
            alert,
            surname=_surname(match),
            unit_name=responder.get("unit_name", ""),
            assigned=bool(responder.get("found")),
        )

    result["branch"] = "emergency_help" if via_help else "emergency"
    result["branch_reason"] = (
        "HELP names a category, so it skips every other check and goes straight to dispatch."
        if via_help
        else "The reader found an emergency signal (category word, urgency phrase, or LOC footer),"
        " so the alert would be saved and routed before anything slow runs."
    )
    result["reply"] = {
        "text": reply_text,
        "characters": len(reply_text),
        "segments": count_segments(reply_text),
        "gsm7": is_gsm7(reply_text),
        "category_label": category_label(code),
    }
    return result


def _routing_section(alert, code: str) -> dict:
    from apps.emergencies.views import (
        find_auto_responders_by_unit,
        preferred_departments_for,
        responder_display_unit,
    )

    preferred = preferred_departments_for(code)
    department = preferred[0] if preferred else None
    candidates = []
    try:
        candidates = find_auto_responders_by_unit(alert)
    except Exception:
        logger.debug("Responder lookup failed in SMS simulation.", exc_info=True)

    reason = (
        "No department is configured to handle this emergency type, so it would be escalated to an official."
        if department is None
        else f"Routed to {department.name} because the configured rule for this emergency type prioritizes it."
    )

    section = {
        "department": _department_label(department),
        "routing_reason": reason,
        "responder": None,
        "escalates": department is None or not candidates,
    }
    if not candidates:
        if department is not None:
            section["routing_reason"] = (
                reason + " No eligible on-duty responder was available, so it would be escalated for manual dispatch."
            )
        return section

    responder = candidates[0]
    preview = _route_preview(responder, alert)
    section["responder"] = {
        "found": True,
        "full_name": _responder_full_name(responder),
        "unit_name": responder_display_unit(responder),
        "distance_meters": preview.get("distance_meters"),
        "eta_seconds": preview.get("eta_seconds"),
    }
    return section


def _department_label(department) -> dict | None:
    if department is None:
        return None
    return {"id": department.pk, "name": department.name, "short_name": department.short_name}


def _route_preview(responder, alert) -> dict:
    try:
        from apps.live_map import route_preview_for_responder

        return route_preview_for_responder(
            responder, latitude=alert.latitude, longitude=alert.longitude
        ) or {}
    except Exception:
        logger.debug("Route preview failed in SMS simulation.", exc_info=True)
        return {}


def _ai_assist_section(parsed, alert) -> dict:
    from django.conf import settings

    from . import ai_assist

    section = {"applicable": False, "reason": "", "ran": False, "model": "", "applied": {}}
    if not ai_assist.enabled():
        section["reason"] = "AI assist is switched off (SMS_AI_ASSIST_ENABLED / OLLAMA_API_KEY)."
        return section
    try:
        if not ai_assist.should_run(alert):
            section["reason"] = "The fast reader resolved this message completely — no model call needed."
            return section
    except Exception:
        section["reason"] = "Could not evaluate the trigger condition."
        return section

    section["applicable"] = True
    section["model"] = getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b")
    gaps = ", ".join(alert.unresolved_fields or ["category"])
    section["reason"] = (
        f"The parser left gaps ({gaps}), so after the acknowledgment is out, Gemma gets one short"
        " pass to fix spelling, pick a category, and name the street."
    )
    body = (parsed.note or "").strip()[:1000]
    if not body:
        section["reason"] += " The note is empty, so there is nothing for the model to read."
        return section
    try:
        assist = ai_assist._ask_model(body)
    except Exception as exc:
        section["error"] = exc.__class__.__name__
        section["reason"] += " The live call failed here; production records the failure and moves on."
        return section

    applied = {}
    if assist.category:
        applied["category"] = {"value": assist.category, "confidence": round(assist.category_confidence, 2)}
    if assist.street:
        applied["street"] = {"value": assist.street, "confidence": round(assist.street_confidence, 2)}
    if assist.area:
        applied["area"] = {"value": assist.area, "confidence": round(ai_assist.min_confidence(), 2)}
    section["ran"] = True
    section["applied"] = applied
    if not applied:
        section["reason"] += " The model answer did not clear the confidence bar, so nothing changed."
    return section


def _resident_command(result, command, match, number, user) -> dict:
    from . import templates

    keyword = command.keyword
    branch = keyword.lower()
    if not match.is_registered:
        return _reply(
            result,
            templates.no_active_report(),
            branch=branch,
            reason=f"An unrecognised number has no report on file, so {keyword} answers with the no-report text.",
        )

    found = _latest_alert_for_user(user, number)
    if found is None:
        return _reply(
            result,
            templates.no_active_report(),
            branch=branch,
            reason=f"No recent report exists for this account, so {keyword} answers with the no-report text.",
        )

    from apps.sms.commands.resident import status_body

    reference = f"E-{found.pk}"
    if keyword == "STATUS":
        return _reply(
            result,
            status_body(found),
            branch=branch,
            reason=f"STATUS reads back your real open report {reference}.",
            alert_like=found,
        )
    if keyword == "SAFE":
        return _reply(
            result,
            templates.safe_ack(found),
            branch=branch,
            reason=f"SAFE marks your open report {reference} as 'resident safe' — it stays open until a"
            " responder confirms on scene.",
            alert_like=found,
        )
    return _reply(
        result,
        templates.cancel_ack(found),
        branch=branch,
        reason=f"CANCEL records a cancellation request on {reference}; an official confirms before it closes."
        + (" Your reason was attached." if (command.rest or "").strip() else ""),
        alert_like=found,
    )


def _latest_alert_for_user(user, number: str):
    from datetime import timedelta

    from django.utils import timezone

    from apps.emergencies.models import EmergencyAlert
    from apps.emergencies.sms_intake import active_alert_for
    from apps.emergencies.views import ACTIVE_STATUSES

    active = active_alert_for(user, number)
    if active:
        return active
    return (
        EmergencyAlert.objects.filter(reporter=user)
        .exclude(status__in=ACTIVE_STATUSES)
        .filter(created_at__gte=timezone.now() - timedelta(days=1))
        .order_by("-created_at", "-id")
        .first()
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parsed_dump(parsed) -> dict:
    return {
        "is_emergency": parsed.is_emergency,
        "category_code": parsed.category_code,
        "category_label": parsed.category_label,
        "matched_alias": parsed.category_matched_alias,
        "needs_confirmation": parsed.category_needs_confirmation,
        "reported_area": parsed.reported_area,
        "latitude": float(parsed.latitude) if parsed.latitude is not None else None,
        "longitude": float(parsed.longitude) if parsed.longitude is not None else None,
        "coordinate_status": parsed.coordinate_status,
        "triage": parsed.triage,
        "triage_summary": _triage_summary(parsed.triage),
        "note": parsed.note,
        "urgency_signal": parsed.urgency_signal,
        "unresolved_fields": list(parsed.unresolved_fields or []),
    }


def _triage_summary(triage: dict) -> str:
    try:
        from .parsing import triage_summary

        return triage_summary(triage)
    except Exception:
        return ""


def _reply(result: dict, text: str, *, branch: str, reason: str, alert_like=None) -> dict:
    from .gateway import count_segments, is_gsm7

    result["branch"] = branch
    result["branch_reason"] = reason
    result["reply"] = {
        "text": text,
        "characters": len(text),
        "segments": count_segments(text),
        "gsm7": is_gsm7(text),
        "category_label": "",
    }
    if alert_like is not None and not result.get("location"):
        result["location"] = _alert_location(alert_like)
    return result


def _alert_location(alert) -> dict | None:
    confidence = getattr(alert, "location_confidence", "")
    if not confidence:
        return None
    return {"confidence": confidence, "label": str(confidence).replace("_", " ").capitalize()}


def _surname(match) -> str:
    try:
        from .normalize import surname_for

        return surname_for(match.user)
    except Exception:
        return ""


def _display_name(match) -> str:
    user = getattr(match, "user", None)
    profile = getattr(user, "resident_profile", None)
    if profile:
        name = f"{profile.first_name} {profile.last_name}".strip()
        if name:
            return name
    email = getattr(user, "email", "")
    return email.split("@")[0] if email else ""


def _responder_full_name(responder) -> str:
    profile = getattr(responder, "resident_profile", None)
    if profile:
        return f"{profile.first_name} {profile.last_name}".strip()
    return responder.email.split("@")[0]
