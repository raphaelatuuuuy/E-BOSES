import html
import logging

import httpx
from django.conf import settings
from django.db import transaction


logger = logging.getLogger(__name__)

MESSAGES = {
    "welcome": (
        "Your E-Boses account is ready",
        "Your residence check is approved. You can now report concerns, follow updates, and use emergency tools.",
    ),
    "verification_rejected": (
        "Action needed for your E-Boses account",
        "Your residence check was not approved. Open E-Boses to review the decision and the next available step.",
    ),
    "password_changed": (
        "Your E-Boses password was changed",
        "Your password was changed. If this was not you, contact barangay support immediately.",
    ),
    "email_changed": (
        "Your E-Boses email was changed",
        "This email address is now linked to your E-Boses account. If this was not you, contact barangay support immediately.",
    ),
    "account_reactivated": (
        "Your E-Boses account is active again",
        "Your account was reactivated. You can sign in and use E-Boses again.",
    ),
}


def _html_email(title, message):
    return (
        '<div style="font-family:Segoe UI,Arial,sans-serif;color:#1c1c1c;max-width:520px;margin:auto;padding:32px 24px">'
        f'<h1 style="font-size:24px;line-height:1.3;margin:0 0 16px">{html.escape(title)}</h1>'
        f'<p style="font-size:16px;line-height:1.6;margin:0 0 24px">{html.escape(message)}</p>'
        '<p style="font-size:13px;color:#6b6b6b;margin:0">E-Boses community network</p>'
        "</div>"
    )


def send_account_email(user, event):
    if settings.ACCOUNT_EMAIL_PROVIDER != "resend" or not settings.RESEND_API_KEY:
        return False
    if event not in MESSAGES or not user.email:
        return False
    subject, message = MESSAGES[event]
    sender = f"{settings.RESEND_FROM_NAME} <{settings.RESEND_FROM_EMAIL}>"
    payload = {
        "from": sender,
        "to": [user.email],
        "subject": subject,
        "text": message,
        "html": _html_email(subject, message),
    }
    if settings.RESEND_REPLY_TO:
        payload["reply_to"] = [settings.RESEND_REPLY_TO]
    try:
        response = httpx.post(
            settings.RESEND_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            timeout=settings.RESEND_DELIVERY_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return True
    except httpx.HTTPError as exc:
        logger.warning("Account email delivery failed for event %s: %s", event, type(exc).__name__)
        return False


def send_account_email_after_commit(user, event):
    transaction.on_commit(lambda: send_account_email(user, event))
