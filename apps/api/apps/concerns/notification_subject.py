"""Short, specific subjects used in resident report notifications.

The model is asked for this value, but notification rendering must never depend
on a successful model call.  The normaliser rejects vague or overlong answers,
and the fallback uses concrete words from the report before falling back to the
selected category.
"""

import re


GENERIC_SUBJECT_WORDS = {
    "barangay",
    "community",
    "concern",
    "emergency",
    "issue",
    "problem",
    "report",
    "reported",
    "request",
    "safety",
    "update",
    "general",
    "important",
    "other",
    "public",
    "response",
    "unknown",
    "urgent",
    "status",
}

SUBJECT_FALLBACKS = (
    (("pothole", "road hole", "asphalt hole"), "Roadside Pothole"),
    (("drainage", "drain", "canal", "barado", "baradong", "flooded", "flooding", "baha", "standing water"), "Blocked Drainage"),
    (("garbage", "trash", "rubbish", "waste", "litter", "basura", "kalat", "tambak"), "Accumulated Garbage"),
    (("streetlight", "street light", "lamp post", "lamp", "ilaw"), "Broken Streetlight"),
    (("powerline", "power line", "electrical wire", "fallen wire", "cable", "kable", "kuryente"), "Fallen Powerline"),
    (("fallen tree", "fallen branch", "tree", "branch", "puno", "sanga"), "Fallen Tree"),
    (("stray dog", "stray dogs", "dog", "dogs", "stray cat", "cat", "animal", "askal", "aso", "pusa"), "Stray Animals"),
    (("water leak", "leak", "burst pipe", "water pipe", "tulo", "tumutulo", "tubo"), "Water Leak"),
    (("smoke", "burning", "fire", "sunog", "usok"), "Fire Hazard"),
    (("traffic", "congestion", "road obstruction", "trapiko"), "Traffic Obstruction"),
    (("illegal parking", "parked vehicle", "parking"), "Illegal Parking"),
    (("noise", "loud music", "loud noise", "ingay"), "Noise Complaint"),
    (("cracked road", "broken road", "road damage"), "Road Damage"),
    (("construction", "construction debris"), "Construction Hazard"),
    (("sewage", "sewer overflow"), "Sewage Overflow"),
    (("fallen sign", "damaged sign"), "Damaged Sign"),
    (("landslide", "mudslide", "mud"), "Landslide Risk"),
)

CATEGORY_FALLBACKS = {
    "infrastructure": "Infrastructure Issue",
    "environment": "Environmental Issue",
    "public_safety": "Public Safety",
    "vehicle": "Vehicle Issue",
    "others": "Community Issue",
}

STOP_WORDS = {
    "a",
    "an",
    "and",
    "at",
    "for",
    "in",
    "is",
    "near",
    "of",
    "on",
    "the",
    "to",
    "with",
}


def _tokens(value) -> list[str]:
    return re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?", str(value or ""))


def _title_case(words: list[str]) -> str:
    return " ".join(word[:1].upper() + word[1:].lower() for word in words)


def normalise_notification_subject(value) -> str:
    """Return a valid one-to-three-word subject, or ``""``.

    This is intentionally strict because the value is placed directly into a
    notification heading/body.  Punctuation, model explanations, locations,
    and generic-only answers are not useful subjects.
    """
    words = _tokens(value)
    if not 1 <= len(words) <= 3:
        return ""
    lowered = [word.lower() for word in words]
    if any(word in GENERIC_SUBJECT_WORDS for word in lowered):
        return ""
    return _title_case(words)


def _keyword_fallback(text: str) -> str:
    lowered = text.lower()
    for phrases, subject in SUBJECT_FALLBACKS:
        if any(re.search(rf"\b{re.escape(phrase)}\b", lowered) for phrase in phrases):
            return subject
    return ""


def build_notification_subject(candidate, *, title: str = "", description: str = "", category: str = "") -> str:
    """Choose a specific subject from Gemma output, then safe local fallbacks."""
    subject = normalise_notification_subject(candidate)
    if subject:
        return subject

    source = f"{title or ''} {description or ''}".strip()
    subject = _keyword_fallback(source)
    if subject:
        return subject

    title_words = [
        word
        for word in _tokens(title)
        if word.lower() not in STOP_WORDS and word.lower() not in GENERIC_SUBJECT_WORDS
    ]
    subject = normalise_notification_subject(_title_case(title_words[:3]))
    if subject:
        return subject

    return CATEGORY_FALLBACKS.get(str(category or "").lower(), "Community Issue")
