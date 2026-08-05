"""Parse inbound SMS: emergency sentences and short commands.

Two things arrive on the gateway number and both are handled here:

1. A natural-language emergency written by the E-Boses app while the phone had
   no data ("I need immediate help. This is a Fire emergency near Champaca
   Street, Marikina Heights. Please send assistance.\\nLOC:14.65,121.11"), or
   typed by hand by someone who never opened the app.
2. A short command (``GUIDE``, ``HELP FIRE Champaca``, ``STATUS``, ``ACCEPT E-2401``).

The old parser required the literal marker ``EBOSES-SOS`` and ``Key: Value``
lines. Anyone who retyped the message, or whose keyboard autocapitalised it,
was rejected outright. Nothing here requires a prefix.

**Message text is data, never instruction.** Nothing parsed out of an SMS is
interpolated into a shell command, a SQL string, or a model prompt; the parser
only ever returns values that the caller places into ORM fields.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

# Internal codes are the existing `EmergencyCategory.code` values. `crime` keeps
# its code and gains the "Crime or Public Safety" label rather than being
# renamed, because live alerts already reference it.
CATEGORY_LABELS: dict[str, str] = {
    "fire": "Fire",
    "medical": "Medical Emergency",
    "flood": "Flood",
    "crime": "Crime or Public Safety",
    "domestic_violence": "Domestic Violence",
    "child_protection": "Child Protection",
    "dangerous_animal": "Dangerous Animal",
    "disaster": "Disaster",
    "drug_related": "Drug-Related Incident",
    "other": "Other Emergency",
}

# Everything a resident might reasonably type, including the Filipino words a
# barangay actually hears. Keys are compared after `_squash` (lowercase,
# non-alphanumerics collapsed to single spaces).
CATEGORY_ALIASES: dict[str, str] = {
    "fire": "fire",
    "sunog": "fire",
    "apoy": "fire",
    "burning": "fire",
    "smoke": "fire",
    "medical": "medical",
    "medical emergency": "medical",
    "medic": "medical",
    "injury": "medical",
    "injured": "medical",
    "sakit": "medical",
    "ambulance": "medical",
    "flood": "flood",
    "baha": "flood",
    "flooding": "flood",
    "crime": "crime",
    "public safety": "crime",
    "publicsafety": "crime",
    "crime or public safety": "crime",
    "safety": "crime",
    "theft": "crime",
    "nakaw": "crime",
    "holdup": "crime",
    "away": "crime",
    "violence": "domestic_violence",
    "domestic": "domestic_violence",
    "domestic violence": "domestic_violence",
    "vawc": "domestic_violence",
    "child": "child_protection",
    "child protection": "child_protection",
    "bata": "child_protection",
    "animal": "dangerous_animal",
    "dangerous animal": "dangerous_animal",
    "aso": "dangerous_animal",
    "dog": "dangerous_animal",
    "snake": "dangerous_animal",
    "disaster": "disaster",
    "earthquake": "disaster",
    "lindol": "disaster",
    "landslide": "disaster",
    "storm": "disaster",
    "bagyo": "disaster",
    "drug": "drug_related",
    "drug related": "drug_related",
    "other": "other",
    "other emergency": "other",
    "iba": "other",
}

# Longest first so "domestic violence" wins over "domestic", and "public
# safety" is not shadowed by "safety".
_ALIAS_KEYS_BY_LENGTH = sorted(CATEGORY_ALIASES, key=len, reverse=True)

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

LOC_PATTERN = re.compile(
    r"\bLOC\s*[:=]\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)",
    re.IGNORECASE,
)

# "near Champaca Street, Marikina Heights." — stops at the sentence end so the
# trailing "Please send assistance." never leaks into the stored area.
NEAR_PATTERN = re.compile(
    r"\bnear\s+(?:the\s+)?(.+?)(?=\s*(?:\.|$|\n))",
    re.IGNORECASE,
)

# Any one of these is enough to treat a message as an emergency even when no
# category word is recognised, so a garbled cry for help is never dropped.
URGENCY_PHRASES = (
    "need immediate help",
    "need help",
    "please send assistance",
    "send assistance",
    "send help",
    "emergency",
    "tulong",
    "saklolo",
    "help me",
    "sos",
)

# Deliberately broad. A false positive costs one dropped junk message; a false
# negative could echo somebody's banking code back over SMS.
OTP_SHAPED_PATTERN = re.compile(
    r"\b(?:otp|one[\s-]?time\s+(?:password|pin|code)|verification\s+code|registration\s+code)\b"
    r"|\bcode\s*(?:is|:)?\s*\d{4,8}\b"
    r"|\b\d{4,8}\s+is\s+your\b",
    re.IGNORECASE,
)


def _squash(value: str) -> str:
    """Lowercase, normalise unicode punctuation, collapse separators to spaces."""
    text = unicodedata.normalize("NFKD", value or "")
    text = text.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_body(value: str | None) -> str:
    """Trim and collapse whitespace while keeping line breaks meaningful."""
    text = unicodedata.normalize("NFKC", value or "")
    text = text.replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def looks_like_otp(body: str | None) -> bool:
    """True when a message looks like a verification code from another service.

    The gateway SIM receives OTPs from banks, e-wallets and E-Boses itself.
    None of them may ever be forwarded, echoed, or stored in full.
    """
    return bool(OTP_SHAPED_PATTERN.search(body or ""))


# ---------------------------------------------------------------------------
# Coordinates
# ---------------------------------------------------------------------------

COORDINATE_OK = "ok"
COORDINATE_INVALID = "invalid"
COORDINATE_ABSENT = "absent"


def parse_coordinates(body: str) -> tuple[Decimal | None, Decimal | None, str]:
    """Extract and validate the optional ``LOC:`` footer.

    Out-of-range values return `COORDINATE_INVALID` with both coordinates None.
    They are never clamped and never replaced with a barangay centroid — a
    wrong pin sends responders to the wrong street, which is worse than no pin.
    """
    match = LOC_PATTERN.search(body or "")
    if not match:
        return None, None, COORDINATE_ABSENT
    try:
        latitude = Decimal(match.group(1))
        longitude = Decimal(match.group(2))
    except (InvalidOperation, TypeError):
        return None, None, COORDINATE_INVALID
    if not (Decimal("-90") <= latitude <= Decimal("90")):
        return None, None, COORDINATE_INVALID
    if not (Decimal("-180") <= longitude <= Decimal("180")):
        return None, None, COORDINATE_INVALID
    # 0,0 is Null Island — always a broken GPS read, never a Marikina address.
    if latitude == 0 and longitude == 0:
        return None, None, COORDINATE_INVALID
    return latitude, longitude, COORDINATE_OK


def strip_loc_footer(body: str) -> str:
    return LOC_PATTERN.sub("", body or "").strip()


# ---------------------------------------------------------------------------
# Category
# ---------------------------------------------------------------------------

# "This is a Fire emergency", "This is a Crime or Public Safety emergency".
CATEGORY_CLAUSE_PATTERN = re.compile(
    r"\bthis\s+is\s+an?\s+(.+?)\s+emergency\b",
    re.IGNORECASE | re.DOTALL,
)


def _scan_aliases(text: str) -> tuple[str, str]:
    squashed = _squash(text)
    if not squashed:
        return "", ""
    padded = f" {squashed} "
    best_alias = ""
    best_position = len(padded)
    for alias in _ALIAS_KEYS_BY_LENGTH:
        position = padded.find(f" {alias} ")
        if position == -1:
            continue
        # Earliest match wins; longest alias breaks a tie because
        # _ALIAS_KEYS_BY_LENGTH is already ordered longest-first.
        if position < best_position:
            best_position = position
            best_alias = alias
    if not best_alias:
        return "", ""
    return CATEGORY_ALIASES[best_alias], best_alias


def resolve_category(text: str) -> tuple[str, str]:
    """Return ``(code, matched_alias)``.

    The explicit "This is a X emergency" clause is authoritative. Scanning the
    whole message is only a fallback, because incident detail routinely
    contains words that are also category aliases - "someone is injured" in a
    fire report must not reroute it to the health unit.
    """
    clause = CATEGORY_CLAUSE_PATTERN.search(text or "")
    if clause:
        code, alias = _scan_aliases(clause.group(1))
        if code:
            return code, alias
    return _scan_aliases(text)


def category_label(code: str) -> str:
    """Human label for a code, preferring the barangay's configured label."""
    if not code:
        return ""
    try:
        from apps.emergencies.models import EmergencyCategory

        row = EmergencyCategory.objects.filter(code=code).only("label").first()
        if row and row.label:
            return row.label
    except Exception:
        # Parsing must work before migrations run and inside pure-unit tests.
        pass
    return CATEGORY_LABELS.get(code, code.replace("_", " ").title())


# ---------------------------------------------------------------------------
# Triage clauses
# ---------------------------------------------------------------------------

# The exact sentences the SOS wizard renders on the device (see
# apps/web/src/features/dashboard/components/sos-fallback.ts). Both sides are
# pinned by the golden-fixture test so they cannot drift apart.
TRIAGE_PHRASES: dict[str, dict[str, str]] = {
    "people_affected": {
        "1 person affected": "one",
        "2-5 people affected": "few",
        "6 or more people affected": "many",
        "number of people affected is unknown": "unknown",
    },
    "injuries": {
        "someone is injured": "yes",
        "no one is injured": "no",
        "injuries are unknown": "unknown",
    },
    "detail": {
        "fire is still spreading": "spreading",
        "fire is not spreading": "contained",
        "person is conscious and breathing": "conscious",
        "person is not conscious or not breathing": "unconscious",
        "water is ankle deep": "ankle",
        "water is knee deep": "knee",
        "water is waist deep or higher": "waist",
        "the person is still there": "present",
        "the person has left": "gone",
        "someone is in immediate danger": "immediate_danger",
        "no one is in immediate danger": "no_immediate_danger",
        "the animal is still loose": "loose",
        "the animal is contained": "contained",
        "people are trapped": "trapped",
        "no one is trapped": "not_trapped",
    },
}


def parse_triage(body: str) -> dict[str, str]:
    """Pull the wizard's triage clauses back out of the rendered sentence."""
    squashed = _squash(body)
    found: dict[str, str] = {}
    for slot, phrases in TRIAGE_PHRASES.items():
        for phrase, value in phrases.items():
            if _squash(phrase) in squashed:
                found[slot] = value
                break
    return found


def triage_summary(triage: dict[str, str]) -> str:
    """Plain sentence for officials — no codes, no enum values."""
    if not triage:
        return ""
    parts = []
    people = {
        "one": "1 person affected",
        "few": "2-5 people affected",
        "many": "6 or more people affected",
        "unknown": "number affected unknown",
    }.get(triage.get("people_affected", ""), "")
    if people:
        parts.append(people)
    injuries = {
        "yes": "someone is injured",
        "no": "no reported injuries",
        "unknown": "injuries unknown",
    }.get(triage.get("injuries", ""), "")
    if injuries:
        parts.append(injuries)
    detail = {
        "spreading": "fire still spreading",
        "contained": "fire contained",
        "conscious": "person conscious and breathing",
        "unconscious": "person unconscious or not breathing",
        "ankle": "ankle-deep water",
        "knee": "knee-deep water",
        "waist": "waist-deep water or higher",
        "present": "subject still at the scene",
        "gone": "subject has left",
        "immediate_danger": "someone in immediate danger",
        "no_immediate_danger": "no immediate danger reported",
        "loose": "animal still loose",
        "trapped": "people trapped",
        "not_trapped": "no one trapped",
    }.get(triage.get("detail", ""), "")
    if detail:
        parts.append(detail)
    if not parts:
        return ""
    return parts[0][0].upper() + parts[0][1:] + ("; " + "; ".join(parts[1:]) if len(parts) > 1 else "") + "."


# ---------------------------------------------------------------------------
# Emergency message
# ---------------------------------------------------------------------------

@dataclass
class ParsedEmergency:
    """Everything the ingestion view needs, plus what it could not work out.

    `unresolved_fields` drives the "needs review" flags in the dashboard. A
    message that parses badly still produces a usable object — the emergency is
    saved and routed on whatever is known, never discarded.
    """

    is_emergency: bool = False
    category_code: str = ""
    category_label: str = ""
    category_matched_alias: str = ""
    category_needs_confirmation: bool = False
    reported_area: str = ""
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    coordinate_status: str = COORDINATE_ABSENT
    triage: dict = field(default_factory=dict)
    note: str = ""
    urgency_signal: bool = False
    unresolved_fields: list = field(default_factory=list)

    @property
    def has_coordinates(self) -> bool:
        return self.latitude is not None and self.longitude is not None


def parse_emergency_sms(body: str | None, *, sender_is_known: bool = False) -> ParsedEmergency:
    """Read a free-text emergency message.

    `sender_is_known` lowers the bar for treating a vague message as an
    emergency: a registered resident texting the dedicated emergency number is
    almost certainly not making small talk.
    """
    text = normalize_body(body)
    if not text:
        return ParsedEmergency()

    squashed = _squash(text)
    urgency = any(_squash(phrase) in squashed for phrase in URGENCY_PHRASES)

    latitude, longitude, coordinate_status = parse_coordinates(text)
    prose = strip_loc_footer(text)

    code, alias = resolve_category(prose)
    parsed = ParsedEmergency(
        category_code=code,
        category_label=category_label(code) if code else "",
        category_matched_alias=alias,
        latitude=latitude,
        longitude=longitude,
        coordinate_status=coordinate_status,
        triage=parse_triage(prose),
        urgency_signal=urgency,
    )

    near = NEAR_PATTERN.search(prose)
    if near:
        area = near.group(1).strip(" .,;")
        # Guard against "near" swallowing the closing sentence on a message
        # written without punctuation.
        area = re.split(r"\s+please\s+send\b", area, flags=re.IGNORECASE)[0].strip(" .,;")
        parsed.reported_area = area[:255]

    # A message counts as an emergency when it names a category, sounds urgent,
    # or carries a coordinate footer — the app only ever emits that footer for
    # an SOS. A known sender needs only one weak signal.
    parsed.is_emergency = bool(
        code
        or urgency
        or coordinate_status == COORDINATE_OK
        or (sender_is_known and coordinate_status == COORDINATE_INVALID)
    )

    if not parsed.is_emergency:
        return parsed

    if not code:
        # Route it rather than drop it: "Other Emergency" reaches the general
        # review team, and the responder confirms the real category on scene.
        parsed.category_code = "other"
        parsed.category_label = category_label("other")
        parsed.category_needs_confirmation = True
        parsed.unresolved_fields.append("category")

    if coordinate_status == COORDINATE_INVALID:
        parsed.unresolved_fields.append("coordinates")
    if not parsed.reported_area and coordinate_status != COORDINATE_OK:
        parsed.unresolved_fields.append("location")

    # Keep whatever the resident actually wrote beyond the template sentence so
    # a responder can read it verbatim.
    parsed.note = _extract_note(prose)
    return parsed


_TEMPLATE_SENTENCES = (
    "i need immediate help",
    "please send assistance",
    "this is a",
    "emergency near",
)


def _extract_note(prose: str) -> str:
    """Lines that are not part of the generated template sentence."""
    kept = []
    for line in prose.splitlines():
        squashed = _squash(line)
        if not squashed:
            continue
        if any(marker in squashed for marker in _TEMPLATE_SENTENCES):
            continue
        kept.append(line.strip())
    return "\n".join(kept)[:1000]


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

@dataclass
class ParsedCommand:
    keyword: str = ""
    reference: str = ""
    argument: str = ""
    rest: str = ""
    raw_first_token: str = ""

    @property
    def recognised(self) -> bool:
        return bool(self.keyword)


# Canonical keyword -> the spellings residents and responders actually send.
COMMAND_ALIASES: dict[str, tuple[str, ...]] = {
    "GUIDE": ("guide", "help me", "menu", "commands", "info", "gabay", "paano"),
    "HELP": ("help", "sos", "tulong", "saklolo"),
    "STATUS": ("status", "update", "check"),
    "SAFE": ("safe", "ok", "okay", "ligtas", "safena"),
    "CANCEL": ("cancel", "stop", "false", "mali"),
    "ACCEPT": ("accept", "responding", "otw", "onmyway"),
    "DECLINE": ("decline", "unable", "cannot", "cant"),
    "ONSCENE": ("onscene", "arrived", "onsite"),
    "BACKUP": ("backup", "support", "reinforce"),
    "RESOLVED": ("resolved", "done", "clear", "complete"),
    "ONDUTY": ("onduty", "induty"),
    "OFFDUTY": ("offduty", "outduty"),
    "OPEN": ("open", "active", "list"),
    "DETAIL": ("detail", "details", "info"),
    "ASSIGN": ("assign",),
    "ESCALATE": ("escalate",),
    "CLOSE": ("close",),
}

_COMMAND_BY_ALIAS = {
    alias: keyword
    for keyword, aliases in COMMAND_ALIASES.items()
    for alias in aliases
}

# "E-2401", "e2401", "2401" all refer to alert 2401.
REFERENCE_PATTERN = re.compile(r"^(?:e[\s\-]?)?(\d{1,9})$", re.IGNORECASE)


def parse_reference(token: str) -> str:
    match = REFERENCE_PATTERN.match((token or "").strip())
    return match.group(1) if match else ""


def parse_command(body: str | None) -> ParsedCommand:
    """Tokenise a short command.

    Deliberately forgiving: leading noise is skipped, case is ignored, and the
    common misspellings above all resolve. Anything genuinely unrecognised
    returns `recognised == False` so the router can send the guide prompt
    rather than staying silent.
    """
    text = normalize_body(body)
    if not text:
        return ParsedCommand()

    tokens = re.split(r"\s+", text.replace("\n", " ").strip())
    if not tokens:
        return ParsedCommand()

    first_raw = tokens[0]
    first = _squash(first_raw).replace(" ", "")
    keyword = _COMMAND_BY_ALIAS.get(first, "")

    # "HELP ME" is a request for the guide; "HELP FIRE" is an emergency.
    if keyword == "HELP" and len(tokens) >= 2 and _squash(tokens[1]) in {"me", "please"}:
        keyword = "GUIDE"

    parsed = ParsedCommand(keyword=keyword, raw_first_token=first_raw)
    if not keyword:
        return parsed

    remainder = tokens[1:]
    if remainder:
        reference = parse_reference(remainder[0])
        if reference:
            parsed.reference = reference
            remainder = remainder[1:]
        parsed.argument = remainder[0] if remainder else ""
        parsed.rest = " ".join(remainder).strip()
    return parsed
