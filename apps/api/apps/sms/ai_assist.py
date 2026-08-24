"""Best-effort rescue for SMS the fast parser cannot fully read.

The rule-based parser is instant and never blocks dispatch; this module is a
purely additive cleanup that runs after the acknowledgment is already out. If
it is off, slow or wrong, SMS behaves exactly as it does without it — see the
`.env.example` contract (``SMS_AI_ASSIST_ENABLED`` / ``SMS_AI_TIMEOUT_SECONDS``
/ ``SMS_AI_MIN_CONFIDENCE``).

What it does with the resident's raw message:

1. Ask Gemma to restructure the text: fix the spelling, pick the emergency
   category, and name the street or place the resident meant.
2. Check the street against the barangay's curated street list — a name the
   model invented is discarded, a real street with a typo is recovered.
3. Write the corrections back onto the alert and clear the matching
   ``unresolved_fields``, so the "needs review" queue only keeps what is
   genuinely unknown.

Nothing here re-routes the alert (dispatch already happened) and nothing here
is allowed to fail loudly: every failure is recorded in ``ai_assist`` and
forgotten.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from django.conf import settings
from django.utils import timezone

from .streets import match_street

logger = logging.getLogger(__name__)

MODEL_FAMILY = "gemma"


class SmsAiAssistNotConfigured(Exception):
    """SMS AI assist is switched off or missing its model key."""


@dataclass
class SmsAssistResult:
    category: str = ""
    category_confidence: float = 0.0
    street: str = ""
    street_confidence: float = 0.0
    area: str = ""
    raw: dict = field(default_factory=dict)


def enabled() -> bool:
    return bool(getattr(settings, "SMS_AI_ASSIST_ENABLED", False)) and bool(
        getattr(settings, "OLLAMA_API_KEY", "")
    )


def min_confidence() -> float:
    return max(0.0, min(1.0, float(getattr(settings, "SMS_AI_MIN_CONFIDENCE", 0.6))))


def should_run(alert) -> bool:
    """True when the alert still has something an AI pass could improve.

    Runs only for SMS-originated alerts that the parser left unresolved, or
    whose reported area is not a known barangay street (a typo the matcher
    cannot fix on its own). Fully resolved messages cost nothing.
    """
    sms_sources = {
        "sms_gps",
        "message_area",
        "recent_account_location",
        "profile_community",
        "home_context",
        "none",
    }
    if not enabled() or getattr(alert, "location_source", "") not in sms_sources:
        return False
    if alert.unresolved_fields or alert.category_needs_confirmation:
        return True
    return not bool(match_street(alert.reported_area))


def run_rescue(alert) -> dict:
    """Attempt one AI pass on the alert; record the outcome in ``ai_assist``.

    Returns the stored ``ai_assist`` payload. Never raises: the caller is the
    Celery task, and a failed rescue must not kill the worker.
    """
    from apps.emergencies.models import EmergencyAlert
    from apps.emergencies.views import create_status_event

    if not enabled():
        raise SmsAiAssistNotConfigured("SMS AI assist is not enabled.")

    body = alert.note or ""
    if not body:
        inbound = alert.inbound_sms_messages.order_by("-server_received_at").first()
        if inbound:
            body = inbound.body
    body = body[:1000]

    model = getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b")
    started = timezone.now()

    try:
        result = _ask_model(body)
    except Exception as exc:
        payload = {
            "status": "failed",
            "model": model,
            "model_family": MODEL_FAMILY,
            "error": exc.__class__.__name__,
            "started_at": started.isoformat(),
        }
        alert.ai_assist = payload
        alert.save(update_fields=["ai_assist", "updated_at"])
        logger.warning("SMS AI assist failed for alert %s: %s", alert.pk, exc.__class__.__name__)
        return payload

    _apply(alert, result, model=model, started_at=started)

    try:
        create_status_event(
            alert,
            alert.status,
            None,
            note=_status_note(result),
            event_key="sms_ai_assist",
        )
    except Exception:
        logger.debug("SMS AI assist status event failed for alert %s.", alert.pk, exc_info=True)

    try:
        from apps.live_map import emergency_payload, route_for_assignment
        from apps.notifications.services import broadcast_live_map_event

        payload = {"emergency": emergency_payload(alert), "route": route_for_assignment(alert)}
        from django.db import transaction

        transaction.on_commit(lambda: broadcast_live_map_event("emergency.updated", payload))
    except Exception:
        logger.debug("SMS AI assist live-map broadcast failed for alert %s.", alert.pk, exc_info=True)

    return alert.ai_assist


def _ask_model(body: str) -> SmsAssistResult:
    """One Gemma call. Returns a result with confidence values, never raises."""
    from ollama import Client

    host = getattr(settings, "OLLAMA_HOST", "https://ollama.com")
    api_key = getattr(settings, "OLLAMA_API_KEY", "")
    model = getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b")
    timeout = float(getattr(settings, "SMS_AI_TIMEOUT_SECONDS", 2.5))
    if not api_key:
        raise SmsAiAssistNotConfigured("OLLAMA_API_KEY is not configured.")

    from apps.emergencies.models import EmergencyCategory

    labels = [
        {"key": category.code, "label": category.label}
        for category in EmergencyCategory.objects.filter(is_active=True).order_by("sort_order", "label")
    ]
    payload = {
        "emergency_types": labels,
        "resident_sms_text": body,
    }
    prompt = (
        "You are the SMS rescue assistant for E-Boses, a barangay emergency system in the "
        "Philippines. A resident texted about an emergency. The fast reader could not fully "
        "understand the message, so you restructure it. The alert was already dispatched — you "
        "only improve the record.\n\n"
        "Return a JSON object with exactly these fields:\n"
        "{\n"
        '  "category": null,\n'
        '  "category_confidence": 0.0,\n'
        '  "street": null,\n'
        '  "street_confidence": 0.0,\n'
        '  "area": null,\n'
        '  "area_confidence": 0.0\n'
        "}\n"
        "Rules:\n"
        '1. "category" must be one of the emergency_type keys, or null when unsure. Filipino '
        'words are fine: "sunog" is fire, "baha" is flood, "nakaw" is crime, "tulong" means help.\n'
        '2. "street" is the street name exactly as the resident spelled it, or null. Keep the '
        "spelling as typed — the system checks it against the official street list itself. Do not "
        "invent a street.\n"
        '3. "area" is the place in plain words (landmark, compound, nearest street), or null.\n'
        "4. confidence is your certainty for each field, 0.0 to 1.0. Leave the field null when "
        "you cannot tell.\n"
        '5. Return valid JSON only. No Markdown, no prose.\n\n'
        f"Payload:\n{json.dumps(payload, ensure_ascii=False)}"
    )

    client = Client(host=host, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout)
    response = client.chat(
        model,
        messages=[
            {"role": "system", "content": "Return valid JSON only. No Markdown. No prose."},
            {"role": "user", "content": prompt},
        ],
        format="json",
        options={"temperature": 0},
        stream=False,
    )
    content = _response_content(response)
    data = json.loads(_json_body(content))
    if not isinstance(data, dict):
        raise ValueError("SMS AI assist returned a non-object response.")

    from apps.emergencies.models import EmergencyCategory

    active = set(EmergencyCategory.objects.filter(is_active=True).values_list("code", flat=True))
    threshold = min_confidence()

    category = str(data.get("category") or "").strip()
    category_confidence = _as_float(data.get("category_confidence"))
    if category not in active or category_confidence < threshold:
        category = ""
        category_confidence = 0.0

    street_text = str(data.get("street") or "").strip()
    street_confidence = _as_float(data.get("street_confidence"))
    street = match_street(street_text) if street_text and street_confidence >= threshold else ""
    if not street:
        street_confidence = 0.0

    area = str(data.get("area") or "").strip()[:255]
    area_confidence = _as_float(data.get("area_confidence"))

    return SmsAssistResult(
        category=category,
        category_confidence=category_confidence,
        street=street,
        street_confidence=street_confidence,
        area=area if area_confidence >= threshold else "",
        raw=data,
    )


def _apply(alert, result: SmsAssistResult, *, model: str, started_at) -> None:
    updates = {"category": None, "street": None, "area": None}
    unresolved = list(alert.unresolved_fields or [])

    if result.category and result.category != alert.type:
        alert.type = result.category
        alert.category_needs_confirmation = False
        updates["category"] = result.category
        if "category" in unresolved:
            unresolved.remove("category")

    if result.street and result.street != alert.canonical_street:
        alert.canonical_street = result.street
        updates["street"] = result.street
        if "location" in unresolved:
            unresolved.remove("location")

    if result.area and result.area != alert.resolved_location:
        alert.resolved_location = result.area
        updates["area"] = result.area
        if "location" in unresolved:
            unresolved.remove("location")

    alert.unresolved_fields = unresolved

    payload = {
        "status": "ok",
        "model": model,
        "model_family": MODEL_FAMILY,
        "started_at": started_at.isoformat(),
        "finished_at": timezone.now().isoformat(),
        "applied": updates,
        "unresolved_fields": unresolved,
    }
    alert.ai_assist = payload
    alert.save(
        update_fields=[
            "type",
            "category_needs_confirmation",
            "canonical_street",
            "resolved_location",
            "unresolved_fields",
            "ai_assist",
            "updated_at",
        ]
    )
    if any(updates.values()):
        try:
            from apps.accounts.services import create_audit_log

            create_audit_log(
                "emergency.sms_ai_assist",
                actor=None,
                target_user=alert.reporter,
                metadata={"alert_id": alert.pk, "applied": updates},
                request_meta={},
            )
        except Exception:
            logger.debug("SMS AI assist audit log failed for alert %s.", alert.pk, exc_info=True)


def _status_note(result: SmsAssistResult) -> str:
    parts = []
    if result.category:
        parts.append(f"category corrected to {result.category}")
    if result.street:
        parts.append(f"location corrected to {result.street}")
    elif result.area:
        parts.append(f"location corrected to {result.area}")
    return "; ".join(parts)[:255]


def _as_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _json_body(content: str) -> str:
    text = str(content or "").strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end >= start:
        return text[start:end + 1]
    return text


def _response_content(response) -> str:
    if isinstance(response, dict):
        return str((response.get("message") or {}).get("content") or "")
    message = getattr(response, "message", None)
    if isinstance(message, dict):
        return str(message.get("content") or "")
    return str(getattr(message, "content", "") or "")
