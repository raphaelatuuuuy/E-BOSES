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
    location = next(
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
        people_text = {"few": "2–5 people", "many": "6 or more people", "one": "one person"}.get(people, people)
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
