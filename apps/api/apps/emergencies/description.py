"""Short, factual incident descriptions for the shared staff queue."""

import json
import logging
import re

from django.conf import settings

logger = logging.getLogger(__name__)

LEGACY_LABEL_PATTERN = re.compile(r"\b(?:detail|injuries|people affected)\s*:", re.IGNORECASE)


def fallback_description(alert) -> str:
    """Build one natural incident sentence when the model is unavailable."""
    note = (alert.note or "").strip()
    triage = alert.triage or {}
    emergency_type = (alert.type or "emergency").replace("_", " ").strip().lower()
    location = next(
        (
            str(value).strip()
            for value in (
                getattr(alert, "canonical_street", ""),
                getattr(alert, "resolved_location", ""),
                getattr(alert, "address", ""),
                getattr(alert, "reported_area", ""),
            )
            if str(value or "").strip()
        ),
        "",
    )
    detail = str(triage.get("detail") or "").replace("_", " ").strip()
    injuries = str(triage.get("injuries") or triage.get("is_anyone_injured") or "").lower()
    people = str(triage.get("people_affected") or "").replace("_", " ").strip().lower()
    subject = note.rstrip(".") if note else (
        f"a {emergency_type}" if emergency_type in {"fire", "crime", "disaster"} else f"a {emergency_type} emergency"
    )
    if location and location.casefold() not in subject.casefold():
        subject = f"{subject} around {location}"
    natural = []
    if detail and detail.casefold() not in subject.casefold():
        if detail.casefold() == "contained":
            natural.append("that has been contained")
        else:
            natural.append(f"that is currently {detail}")
    if people:
        people_text = {"few": "a few people", "many": "several people", "one": "one person"}.get(people, people)
        natural.append(f"affecting {people_text}")
    if injuries in {"yes", "true"}:
        natural.append("with reported injuries")
    elif injuries in {"no", "false"}:
        natural.append("with no reported injuries")
    if natural:
        return f"The resident reported {subject} {', '.join(natural[:3])}."[:500]
    return f"The resident reported {subject}."[:500]


def description_for_display(alert) -> str:
    """Never leak legacy form labels from stored records back into any UI."""
    stored = str((alert.ai_assist or {}).get("description") or "").strip()
    if stored and not LEGACY_LABEL_PATTERN.search(stored):
        return stored[:320]
    return fallback_description(alert)[:320]


def generate_description(alert) -> str:
    """Ask the configured text model for one factual sentence.

    The alert has already been routed before this function runs. Any model
    failure falls back to the resident text and structured SOS answers.
    """
    fallback = fallback_description(alert)
    api_key = getattr(settings, "OLLAMA_API_KEY", "")
    if not api_key:
        return fallback
    try:
        from ollama import Client

        model = getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b")
        payload = {
            "emergency_type": alert.type,
            "location": next(
                (
                    str(value).strip()
                    for value in (alert.canonical_street, alert.resolved_location, alert.address, alert.reported_area)
                    if str(value or "").strip()
                ),
                "",
            ),
            "resident_note": (alert.note or "")[:1200],
            "sos_answers": alert.triage or {},
        }
        prompt = (
            "Write exactly one brief, straightforward sentence for a responder. "
            "Start with 'The resident reported'. Combine the resident note and every useful SOS answer "
            "as natural prose. Never output form labels such as 'Detail:', 'Injuries:', or "
            "'People affected:'. Translate those values into an incident update a person would say. "
            "Include the supplied location naturally using 'around' when it is available. "
            "Do not include instructions, diagnoses, guesses, or an AI label. "
            "Include only relevant observations visible in attached photos. Return JSON only as "
            '{"description":"..."}. Keep it under 320 characters.\n\n'
            f"{json.dumps(payload, ensure_ascii=False)}"
        )
        client = Client(
            host=getattr(settings, "OLLAMA_HOST", "https://ollama.com"),
            headers={"Authorization": f"Bearer {api_key}"},
            # Description generation runs off the dispatch request, so give a
            # vision-capable model the normal image-analysis window instead of
            # the short SMS parser timeout.
            timeout=float(getattr(settings, "OLLAMA_IMAGE_TIMEOUT_SECONDS", 90)),
        )
        images = []
        for media in list(alert.media.all())[:3]:
            if not (media.mime_type or "").startswith("image/"):
                continue
            try:
                from apps.concerns.ai.image_prep import prepare_image_for_gemma

                with media.file.open("rb") as handle:
                    prepared = prepare_image_for_gemma(
                        handle.read(), filename=media.original_filename, mime_type=media.mime_type
                    )
                if prepared:
                    images.append(prepared.data)
            except Exception:
                logger.info("Could not prepare emergency image for description", exc_info=True)
        user_message = {"role": "user", "content": prompt}
        if images:
            # Ollama's chat API accepts vision inputs on the user message.
            user_message["images"] = images
        request_kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": "Return valid JSON only."},
                user_message,
            ],
            "format": "json",
            "think": False,
            "options": {"temperature": 0},
            "stream": False,
        }
        response = client.chat(
            **request_kwargs,
        )
        message = response.get("message", {}) if isinstance(response, dict) else getattr(response, "message", {})
        content = message.get("content", "") if isinstance(message, dict) else getattr(message, "content", "")
        if content:
            encoded = str(content).strip()
            fenced = re.search(r"\{.*\}", encoded, flags=re.DOTALL)
            payload = json.loads(fenced.group(0) if fenced else encoded)
            description = payload.get("description", "")
        else:
            description = ""
        description = " ".join(str(description).split()).strip()
        if description and not description.lower().startswith("the resident reported"):
            description = f"The resident reported {description.rstrip('.')}"
        if description and not description.endswith("."):
            description = f"{description}."
        if 12 <= len(description) <= 320 and not LEGACY_LABEL_PATTERN.search(description):
            return description
    except Exception:
        logger.info("Incident description generation unavailable", exc_info=True)
    return fallback
