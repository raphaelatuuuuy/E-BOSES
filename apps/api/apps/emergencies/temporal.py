import re
import unicodedata


TIMINGS = {"ongoing", "ended", "historical", "planned", "hypothetical", "unclear"}
NON_CURRENT = {"ended", "historical", "planned", "hypothetical"}

_CURRENT_DANGER = (
    r"\b(still|currently|ongoing|right now|happening now|in progress)\b",
    r"\b(still burning|still trapped|person trapped|people trapped|danger remains|smoke remains|still missing)\b",
    r"\b(smoke is coming out now|smoke is visible now|flames are visible|needs help now|bleeding now|not breathing|unconscious now)\b",
    r"\b(ngayon|kasalukuyan|patuloy|nangyayari pa|nasusunog pa|may naipit pa|hindi pa tapos|delikado pa)\b",
    r"\b(karon|padayon|nagpadayon|subong|padayon pa|adda pay|agtultuloy)\b",
)
_ENDED = (
    r"\b(is over|already over|has ended|already ended|was extinguished|already extinguished|put out|resolved|no longer burning|out now)\b",
    r"\b(tapos na|natapos na|naapula na|wala na ang sunog|ligtas na|umalis na|naresolba na)\b",
    r"\b(human na|napalong na|nahuman na|nalutas na)\b",
)
_HISTORICAL = (
    r"\b(yesterday|earlier today|last night|last week|last month|days ago|weeks ago|previously|used to)\b",
    r"\b(happened|occurred|was burning|had a fire|caught fire)\b",
    r"\b(kahapon|kanina|kagabi|noong nakaraan|nakaraang linggo|dati|nangyari)\b",
    r"\b(kagab-i|gahapon|kaniadto| idi kalman| idi rabii)\b",
)
_PLANNED = (
    r"\b(tomorrow|later today|next week|next month|scheduled|will happen|planning to)\b",
    r"\b(bukas|mamaya|sa susunod na linggo|nakaiskedyul|gaganapin)\b",
)
_HYPOTHETICAL = (
    r"\b(fire drill|emergency drill|training exercise|test message|sample report|what if|hypothetical|in the news|news report)\b",
    r"\b(drill lamang|pagsasanay|halimbawa lang|test lang|kunwari|balita tungkol)\b",
)


def _text(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).lower()
    return re.sub(r"\s+", " ", value).strip()


def _matches(text: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pattern, text) for pattern in patterns)


def infer_incident_timing(value: str) -> tuple[str, str]:
    text = _text(value)
    if not text:
        return "unclear", "The report does not say when the incident happened."
    if _matches(text, _CURRENT_DANGER):
        return "ongoing", "The report says danger is still present."
    if _matches(text, _ENDED):
        return "ended", "The report says the incident has ended."
    if _matches(text, _HYPOTHETICAL):
        return "hypothetical", "The text describes a drill, test, example, or news item."
    if _matches(text, _PLANNED):
        return "planned", "The report describes a future event."
    if _matches(text, _HISTORICAL):
        return "historical", "The report describes a past incident."
    return "unclear", "The report does not clearly say if the danger is happening now."


def normalise_incident_timing(value: str) -> str:
    timing = _text(value).replace(" ", "_")
    aliases = {
        "current": "ongoing",
        "active": "ongoing",
        "recent_past": "ended",
        "ended_recently": "ended",
        "past": "historical",
        "future": "planned",
    }
    timing = aliases.get(timing, timing)
    return timing if timing in TIMINGS else "unclear"
