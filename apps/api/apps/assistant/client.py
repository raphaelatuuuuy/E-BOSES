import logging

import httpx
from django.conf import settings


logger = logging.getLogger(__name__)


class AssistantNotConfigured(Exception):
    pass


class AssistantUnavailable(Exception):
    pass


def is_configured():
    return bool(
        getattr(settings, "ASSISTANT_ENABLED", False)
        and getattr(settings, "ASSISTANT_API_KEY", "")
        and getattr(settings, "ASSISTANT_BASE_URL", "")
        and getattr(settings, "ASSISTANT_MODEL", "")
    )


def _endpoint():
    base = settings.ASSISTANT_BASE_URL.rstrip("/")
    return f"{base}/chat/completions"


def complete(messages):
    if not is_configured():
        raise AssistantNotConfigured("Assistant model is not configured.")

    payload = {
        "model": settings.ASSISTANT_MODEL,
        "messages": messages,
        "max_tokens": settings.ASSISTANT_MAX_TOKENS,
        "temperature": 0.2,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {settings.ASSISTANT_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        response = httpx.post(
            _endpoint(),
            json=payload,
            headers=headers,
            timeout=settings.ASSISTANT_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        logger.warning("assistant request failed: %s", exc.__class__.__name__)
        raise AssistantUnavailable("Assistant service is unreachable.") from exc

    if response.status_code >= 400:
        logger.warning("assistant returned HTTP %s", response.status_code)
        raise AssistantUnavailable(f"Assistant service returned {response.status_code}.")

    try:
        data = response.json()
        text = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        logger.warning("assistant returned an unreadable payload")
        raise AssistantUnavailable("Assistant service returned an unreadable reply.") from exc

    text = (text or "").strip()
    if not text:
        raise AssistantUnavailable("Assistant service returned an empty reply.")
    return text
