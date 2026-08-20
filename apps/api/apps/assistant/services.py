import re
from dataclasses import dataclass, field

from django.conf import settings
from django.core.cache import cache

from . import knowledge
from .client import AssistantNotConfigured, AssistantUnavailable, complete, is_configured


SOURCE_RULES = "rules"
SOURCE_MODEL = "model"
SOURCE_FALLBACK = "fallback"

BUDGET_PREFIX = "assistant:budget:"

MAX_MESSAGE_LENGTH = 600
MAX_HISTORY_TURNS = 4

FALLBACK_REPLY = (
    "I can help with accounts, reporting a concern, emergencies and tracking a report. "
    "Choose one of the topics below, or contact the barangay office if your question is "
    "about something else.\n"
    "\n"
    "For an emergency happening right now, call 161."
)

SYSTEM_PROMPT = (
    "You are the E-Boses Assistant, the chat helper for a barangay reporting and "
    "emergency response app in the Philippines. "
    "E-Boses is used by residents, "
    "barangay officials and first responders.\n"
    "\n"
    "Rules you must follow:\n"
    "- Answer only about E-Boses and barangay services. If asked anything else, say you "
    "can only help with E-Boses and offer a related topic.\n"
    "- Reply in plain text. Never use markdown, asterisks, headings or links.\n"
    "- Use short paragraphs. For instructions, use numbered lines like '1. ' on their own line.\n"
    "- Keep the whole reply under 120 words.\n"
    "- Never invent features, prices, office hours or phone numbers. The only numbers you "
    "may give are 161 for local rescue services and 911.\n"
    "- If someone describes an emergency in progress, tell them to use the emergency button "
    "or call 161 before anything else.\n"
    "- Never ask for a password, a one-time code or an ID number.\n"
    "\n"
    "Use the reference material below as the source of truth.\n"
    "\n"
    f"{knowledge.knowledge_digest()}"
)


@dataclass
class Answer:
    reply: str
    suggestions: list = field(default_factory=list)
    source: str = SOURCE_FALLBACK


class AssistantBudgetExceeded(Exception):
    pass


def _budget_limit():
    return getattr(settings, "ASSISTANT_SESSION_BUDGET", 8)


def _budget_window():
    return getattr(settings, "ASSISTANT_SESSION_BUDGET_WINDOW_SECONDS", 600)


def consume_budget(session_id):
    if not session_id:
        return
    key = f"{BUDGET_PREFIX}{session_id}"
    try:
        added = cache.add(key, 1, _budget_window())
        if added:
            return
        used = cache.incr(key)
    except ValueError:
        cache.set(key, 1, _budget_window())
        return
    except Exception:
        return
    if used > _budget_limit():
        raise AssistantBudgetExceeded(
            "You have asked a lot of questions in a short time. "
            "Please wait a few minutes, or choose a topic below."
        )


def strip_markdown(text):
    cleaned = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    cleaned = re.sub(r"`([^`]*)`", r"\1", cleaned)
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", cleaned)
    cleaned = re.sub(r"^\s*[-+]\s+", "- ", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _model_messages(message, history):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in history[-MAX_HISTORY_TURNS:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content[:MAX_MESSAGE_LENGTH]})
    messages.append({"role": "user", "content": message[:MAX_MESSAGE_LENGTH]})
    return messages


def _fallback_answer():
    return Answer(
        reply=FALLBACK_REPLY,
        suggestions=knowledge.opening_topics(),
        source=SOURCE_FALLBACK,
    )


def answer(message="", topic_id="", history=None, session_id=""):
    history = history or []
    message = (message or "").strip()
    topic_id = (topic_id or "").strip()

    if topic_id:
        matched = knowledge.answer_for_topic(topic_id)
        if matched is not None:
            reply, suggestions = matched
            return Answer(reply=reply, suggestions=suggestions, source=SOURCE_RULES)

    if not message:
        return _fallback_answer()

    keyword_topic = knowledge.match_keywords(message)
    if keyword_topic is not None and not is_configured():
        matched = knowledge.answer_for_topic(keyword_topic)
        if matched is not None:
            reply, suggestions = matched
            return Answer(reply=reply, suggestions=suggestions, source=SOURCE_RULES)

    if not is_configured():
        return _fallback_answer()

    consume_budget(session_id)

    try:
        raw = complete(_model_messages(message, history))
    except (AssistantNotConfigured, AssistantUnavailable):
        if keyword_topic is not None:
            matched = knowledge.answer_for_topic(keyword_topic)
            if matched is not None:
                reply, suggestions = matched
                return Answer(reply=reply, suggestions=suggestions, source=SOURCE_RULES)
        return _fallback_answer()

    reply = strip_markdown(raw)
    if not reply:
        return _fallback_answer()

    if keyword_topic is not None:
        entry = knowledge.ANSWERS.get(keyword_topic, {})
        suggestions = knowledge.chips_for(entry.get("suggestions", []))
    else:
        suggestions = knowledge.opening_topics()

    return Answer(reply=reply, suggestions=suggestions, source=SOURCE_MODEL)
