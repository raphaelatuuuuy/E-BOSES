"""Generate short, resident-facing summaries for barangay announcements."""

import logging
import re

from django.conf import settings

from apps.assistant.client import (
    AssistantNotConfigured,
    AssistantUnavailable,
    complete,
    is_configured,
)


logger = logging.getLogger(__name__)

MAX_SUMMARY_LENGTH = 300
MAX_MODEL_WORDS = 30


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _limit(value: str) -> str:
    cleaned = _clean_text(value)
    if len(cleaned) <= MAX_SUMMARY_LENGTH:
        return cleaned
    clipped = cleaned[: MAX_SUMMARY_LENGTH - 1].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return f"{clipped}."


def fallback_announcement_summary(title: str, body: str) -> str:
    """Return a useful summary when the configured model is unavailable.

    The fallback stays deliberately plain and does not invent a date, place, or
    instruction that is not present in the announcement.
    """
    clean_title = _clean_text(title)
    subject = clean_title.rstrip(".!?") or "a barangay update"
    return _limit(f"This announcement is about {subject}.")


def _model_summary(title: str, body: str) -> str:
    if not getattr(settings, "ANNOUNCEMENT_SUMMARY_LLM_ENABLED", True) or not is_configured():
        return ""
    clean_title = _clean_text(title)
    clean_body = _clean_text(body)
    try:
        response = complete(
            [
                {
                    "role": "system",
                    "content": (
                        "You write short resident-facing summaries for barangay announcements. "
                        "Use only the supplied title and description. Return exactly one straightforward "
                        "sentence, under 30 words, stating what the announcement is about. Summarize the "
                        "broad subject and mention a general benefit only when useful; do not repeat dates, "
                        "times, locations, contact details, required items, or step-by-step instructions. "
                        "Always write the summary in clear, simple English. Return plain text only, with no "
                        "label, markdown, or invented details."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Title: {clean_title}\nDescription: {clean_body}",
                },
            ]
        )
    except (AssistantNotConfigured, AssistantUnavailable):
        return ""
    except Exception:
        logger.warning("announcement summary model failed", exc_info=True)
        return ""

    cleaned = _clean_text(response).strip('"\'`')
    sentence_match = re.match(r"(.+?[.!?])(?:\s|$)", cleaned)
    if sentence_match:
        cleaned = sentence_match.group(1)
    elif cleaned:
        cleaned = f"{cleaned.rstrip('.!?')}."
    if (
        not cleaned
        or len(cleaned.split()) > MAX_MODEL_WORDS
        or cleaned[-1] not in ".!?"
    ):
        return ""
    return _limit(cleaned)


def generate_announcement_summary(title: str, body: str, *, use_model: bool = True) -> str:
    clean_title = _clean_text(title)
    clean_body = _clean_text(body)
    if use_model:
        generated = _model_summary(clean_title, clean_body)
        if generated:
            return generated
    return fallback_announcement_summary(clean_title, clean_body)


def refresh_announcement_summary(announcement, *, force: bool = False, use_model: bool = True):
    current = _clean_text(announcement.llm_summary)
    if current and not force:
        return announcement
    summary = generate_announcement_summary(
        announcement.title,
        announcement.body,
        use_model=use_model,
    )
    if summary and summary != announcement.llm_summary:
        announcement.llm_summary = summary
        announcement.save(update_fields=["llm_summary", "updated_at"])
    return announcement
