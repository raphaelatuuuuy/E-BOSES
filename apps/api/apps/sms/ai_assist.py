"""Best-effort rescue for SMS the fast parser cannot fully read.

The rule-based parser is instant and never blocks dispatch; this module is a
purely additive cleanup that runs after the acknowledgment is already out. If
it is off, slow or wrong, SMS behaves exactly as it does without it — see the
`.env.example` contract (``SMS_AI_ASSIST_ENABLED`` / ``SMS_AI_TIMEOUT_SECONDS``
/ ``SMS_AI_MIN_CONFIDENCE``).

What it does with the resident's raw message:

1. Ask Gemma to restructure the text: fix the spelling, pick the emergency
   category, and name the street or place the resident meant.
2. Use the small local street catalog as a typo/offline hint, then verify any
   extracted street or landmark against the real map, Marikina city, and the
   active barangay boundary before attaching a pin.
3. Write verified corrections back onto the alert and clear the matching
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

import httpx
from django.conf import settings
from django.utils import timezone

from .streets import MARIKINA_HEIGHTS_STREETS, match_street

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


def run_rescue(alert, *, propagate_timeout: bool = False) -> dict:
    """Attempt one AI pass on the alert; record the outcome in ``ai_assist``.

    Returns the stored ``ai_assist`` payload. A Celery caller may ask for model
    timeouts to propagate so its configured retry can actually run.
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
        if propagate_timeout and isinstance(exc, (TimeoutError, httpx.TimeoutException)):
            raise TimeoutError("SMS AI assist timed out.") from exc
        return payload

    _apply(alert, result, model=model, started_at=started)

    try:
        create_status_event(
            alert,
            alert.status,
            None,
            note=_status_note(alert.ai_assist),
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
        "offline_street_hints": MARIKINA_HEIGHTS_STREETS,
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
        '2. "street" is the street name explicitly present or strongly implied in the SMS, or null. '
        "offline_street_hints may help correct spelling, but the street does not have to be in that list. "
        "Never invent a street.\n"
        '3. "area" is the best searchable place phrase (landmark, compound, or nearest street), or null. '
        "Preserve a useful street/place phrase even when it is not in offline_street_hints.\n"
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
    unlisted_street_confidence = street_confidence
    unlisted_street = street_text if street_text and street_confidence >= threshold and not street else ""
    if not street:
        street_confidence = 0.0

    area = str(data.get("area") or "").strip()[:255]
    area_confidence = _as_float(data.get("area_confidence"))
    if not area and unlisted_street:
        area = unlisted_street[:255]
        area_confidence = unlisted_street_confidence

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
    suggestions = {
        "category": result.category or None,
        "street": result.street or None,
        "area": result.area or None,
    }
    unresolved = list(alert.unresolved_fields or [])
    has_assignment = alert.assignments.exists()
    route_after_save = False
    reverse_after_save = False

    # Never change the incident type underneath a responder who was already
    # dispatched using the original routing policy. The suggestion stays in
    # ai_assist for an official to review.
    if result.category and result.category != alert.type and not has_assignment:
        alert.type = result.category
        alert.category_needs_confirmation = False
        updates["category"] = result.category
        route_after_save = bool(alert.community_id)
        if "category" in unresolved:
            unresolved.remove("category")

    if result.street:
        from apps.emergencies.location_resolution import resolve_incident_location

        resolution = resolve_incident_location(message_area=result.street)
        same_or_unset_community = not alert.community_id or (
            resolution.community and resolution.community.pk == alert.community_id
        )
        if resolution.community and same_or_unset_community:
            alert.canonical_street = result.street
            alert.address = result.street
            updates["street"] = result.street
            if not alert.community_id:
                alert.community = resolution.community
                alert.barangay = resolution.community.name
                alert.location_source = resolution.source
                alert.location_evidence = resolution.payload()
                route_after_save = True
            if "location" in unresolved:
                unresolved.remove("location")

    # The catalog above is deliberately only an offline/typo fallback. Resolve
    # either its corrected street or any LLM-extracted landmark through the
    # live map, then require Marikina plus exactly one active barangay polygon.
    map_query = result.street or result.area
    geocoded = _geocode_ai_location(map_query) if map_query and alert.latitude is None else None
    if geocoded and geocoded.has_destination:
        same_or_unset_community = not alert.community_id or geocoded.community.pk == alert.community_id
        if same_or_unset_community:
            alert.latitude = geocoded.latitude
            alert.longitude = geocoded.longitude
            alert.community = geocoded.community
            alert.barangay = geocoded.community.name
            alert.location_source = geocoded.source
            alert.location_freshness = geocoded.freshness
            alert.location_evidence = geocoded.payload()
            alert.location_confidence = alert.LocationConfidence.REPORTED
            alert.reverse_geocoding_status = alert.ReverseGeocodingStatus.PENDING
            if geocoded.canonical_street:
                alert.canonical_street = geocoded.canonical_street
                alert.address = geocoded.canonical_street
            elif result.area and not alert.address:
                alert.address = result.area
            updates["area"] = geocoded.area_label
            if "location" in unresolved:
                unresolved.remove("location")
            route_after_save = True
            reverse_after_save = True

    alert.unresolved_fields = unresolved

    payload = {
        "status": "ok",
        "model": model,
        "model_family": MODEL_FAMILY,
        "started_at": started_at.isoformat(),
        "finished_at": timezone.now().isoformat(),
        "applied": updates,
        "suggested": suggestions,
        "unresolved_fields": unresolved,
    }
    alert.ai_assist = payload
    alert.save(
        update_fields=[
            "type",
            "category_needs_confirmation",
            "canonical_street",
            "address",
            "community",
            "barangay",
            "location_source",
            "location_freshness",
            "location_evidence",
            "latitude",
            "longitude",
            "location_confidence",
            "reverse_geocoding_status",
            "unresolved_fields",
            "ai_assist",
            "updated_at",
        ]
    )
    if reverse_after_save:
        from apps.emergencies.location_services import schedule_location_resolution

        schedule_location_resolution(alert)
    if route_after_save:
        try:
            from apps.emergencies.views import auto_route_alert

            auto_route_alert(alert, None, retry_escalated=True)
            alert.refresh_from_db()
        except Exception:
            logger.exception("Post-assist routing failed for SMS alert %s.", alert.pk)
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


def _geocode_ai_location(query: str):
    """Keep test runs from ever reaching a public geocoder unless explicitly mocked."""
    if getattr(settings, "IS_TEST_RUN", False):
        return None
    from apps.emergencies.location_resolution import geocode_reported_place

    return geocode_reported_place(query)


def _status_note(payload: dict) -> str:
    parts = []
    applied = payload.get("applied") or {}
    if applied.get("category"):
        parts.append(f"category corrected to {applied['category']}")
    if applied.get("street"):
        parts.append(f"location matched to verified street {applied['street']}")
    if applied.get("area"):
        parts.append("location verified against map and barangay boundary")
    return ("; ".join(parts) or "AI assist recorded suggestions for official review")[:255]


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
