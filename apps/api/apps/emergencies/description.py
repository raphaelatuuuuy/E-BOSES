"""Short, factual incident descriptions for the shared staff queue."""

import json
import logging
import re

from django.conf import settings

logger = logging.getLogger(__name__)

LEGACY_LABEL_PATTERN = re.compile(r"\b(?:detail|injuries|people affected)\s*:", re.IGNORECASE)
SMS_CONTROL_PATTERN = re.compile(
    r"E[- ]?BOSES\s+STATUS|\bReply\s+(?:SAFE|CANCEL)\b|\bLOC\s*:", re.IGNORECASE
)

TITLE_MAX_LENGTH = 80


def _incident_location(alert) -> str:
    """The best street-level place name stored on the alert, or ""."""
    return next(
        (
            str(value).strip()
            for value in (
                getattr(alert, "canonical_street", ""),
                getattr(alert, "resolved_location", ""),
                getattr(alert, "address", ""),
                getattr(alert, "reported_area", ""),
            )
            if str(value or "").strip() and not re.search(r"pinned|location unavailable|location pending", str(value), re.I)
        ),
        "",
    )


def emergency_type_label(alert) -> str:
    """The human label for the alert's emergency type ("Fire", "Child Protection")."""
    code = str(getattr(alert, "type", "") or "").strip().lower()
    if code:
        from .models import EmergencyAlert

        for value, label in EmergencyAlert.Type.choices:
            if value == code:
                return label
    return "Emergency"


def incident_title(alert) -> str:
    """The deterministic headline for an incident row, without any model."""
    type_label = emergency_type_label(alert)
    location = _incident_location(alert)
    if type_label == "Emergency":
        # No type known (or invalid): the location alone reads better than a
        # generic "Emergency around …" label.
        return f"Emergency report around {location}" if location else "Emergency report"
    if location and location.casefold() not in type_label.casefold():
        return f"{type_label} around {location}"
    return f"{type_label} emergency"


def _clean_title(candidate) -> str:
    return " ".join(str(candidate or "").strip().strip('"').strip().split())


def _ask_title_model(alert) -> str:
    """One Gemma call for an incident headline; raises when it cannot help."""
    from ollama import Client

    if not getattr(settings, "OLLAMA_API_KEY", ""):
        raise RuntimeError("OLLAMA_API_KEY is not configured.")
    payload = {
        "emergency_type": emergency_type_label(alert),
        "location": _incident_location(alert),
        "resident_note": incident_note(alert)[:500],
        "triage": alert.triage or {},
    }
    prompt = (
        "You write the one-line headline shown at the top of a barangay emergency "
        "report card in Marikina, Philippines. State the emergency type and the "
        "place, using only facts from the payload.\n\n"
        "Rules:\n"
        '1. Reply with JSON only: {"title": "..."}.\n'
        "2. The title is at most 8 words, plain text, no quotes, no emojis.\n"
        "3. Never invent facts, names or places that are not in the payload.\n"
        "4. Never copy status or instruction boilerplate (E-BOSES STATUS, Reply "
        "SAFE/CANCEL, LOC:).\n\n"
        f"Payload:\n{json.dumps(payload, ensure_ascii=False)}"
    )
    client = Client(
        host=getattr(settings, "OLLAMA_HOST", "https://ollama.com"),
        headers={"Authorization": f"Bearer {getattr(settings, 'OLLAMA_API_KEY', '')}"},
        timeout=float(getattr(settings, "OLLAMA_TITLE_TIMEOUT_SECONDS", 15)),
    )
    response = client.chat(
        getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b"),
        messages=[
            {"role": "system", "content": "Return valid JSON only. No Markdown. No prose."},
            {"role": "user", "content": prompt},
        ],
        format="json",
        options={"temperature": 0},
        stream=False,
    )
    if isinstance(response, dict):
        content = str((response.get("message") or {}).get("content") or "")
    else:
        message = getattr(response, "message", None)
        content = str(
            (message.get("content") or "") if isinstance(message, dict) else (getattr(message, "content", "") or "")
        )
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end >= start:
        text = text[start : end + 1]
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Emergency title model returned a non-object response.")
    return str(data.get("title") or "")


def generate_title(alert) -> str:
    """The incident headline: one Gemma pass, with the deterministic title as fallback."""
    try:
        raw = _ask_title_model(alert)
    except Exception:
        logger.warning("Emergency title generation failed; using the deterministic title.", exc_info=True)
        raw = ""
    title = _clean_title(raw)
    if (
        len(title) < 4
        or len(title) > TITLE_MAX_LENGTH
        or LEGACY_LABEL_PATTERN.search(title)
        or SMS_CONTROL_PATTERN.search(title)
    ):
        return incident_title(alert)
    return title


def title_for_display(alert) -> str:
    """The headline any UI shows; never echoes machine or legacy boilerplate."""
    stored = str((getattr(alert, "ai_assist", None) or {}).get("title") or "")
    title = _clean_title(stored)
    if (
        title
        and len(title) <= TITLE_MAX_LENGTH + 10
        and not LEGACY_LABEL_PATTERN.search(title)
        and not SMS_CONTROL_PATTERN.search(title)
    ):
        return title
    return incident_title(alert)


def incident_note(alert):
    """Remove transport/status boilerplate without changing the original report."""
    note = (alert.note or "").strip()
    note = re.sub(
        r"E[- ]?BOSES\s+STATUS\s*-\s*E-\d+.*", "", note,
        flags=re.IGNORECASE | re.DOTALL,
    )
    from apps.sms.parsing import strip_loc_footer

    note = strip_loc_footer(note)
    note = re.sub(r"\bReply\s+(?:SAFE|CANCEL)\b[^.]*\.?", "", note, flags=re.IGNORECASE)
    return " ".join(note.split()).strip()


def fallback_description(alert) -> str:
    """Build one natural incident sentence when the model is unavailable."""
    triage = alert.triage or {}
    emergency_type = (alert.type or "emergency").replace("_", " ").strip().lower()
    location = _incident_location(alert)
    detail = str(triage.get("detail") or "").replace("_", " ").strip()
    injuries = str(triage.get("injuries") or triage.get("is_anyone_injured") or "").lower()
    people = str(triage.get("people_affected") or "").replace("_", " ").strip().lower()
    subject = (
        f"a {emergency_type}" if emergency_type in {"fire", "crime", "disaster"} else f"a {emergency_type} emergency"
    )
    if location and location.casefold() not in subject.casefold():
        subject = f"{subject} around {location}"
    natural = []
    if detail and detail.casefold() not in subject.casefold():
        if detail.casefold() == "contained":
            natural.append("that has been contained")
        elif detail in {"ankle", "knee", "waist"}:
            natural.append(f"with {detail}-deep water" + (" or higher" if detail == "waist" else ""))
        else:
            natural.append({
                "spreading": "with the fire still spreading",
                "conscious": "with the person conscious and breathing",
                "unconscious": "with the person unconscious or not breathing",
                "present": "with the person still at the scene",
                "gone": "with the person having left the scene",
                "immediate danger": "with someone in immediate danger",
                "no immediate danger": "with no immediate danger reported",
                "loose": "with the animal still loose",
                "trapped": "with people trapped",
                "not trapped": "with no one trapped",
            }.get(detail, f"that is currently {detail}"))
    if people:
        people_text = {"few": "2-5 people", "many": "6 or more people", "one": "one person"}.get(people, people)
        natural.append("with the number of people affected unknown" if people == "unknown" else f"affecting {people_text}")
    if injuries in {"yes", "true"}:
        natural.append("with reported injuries")
    elif injuries in {"no", "false"}:
        natural.append("with no reported injuries")
    elif injuries == "unknown":
        natural.append("with injuries unknown")
    if natural:
        return f"The resident reported {subject} {', '.join(natural)}."
    return f"The resident reported {subject}."


def description_for_display(alert) -> str:
    """Never leak legacy form labels from stored records back into any UI."""
    return fallback_description(alert)


def generate_description(alert) -> str:
    return fallback_description(alert)
