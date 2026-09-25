"""Resolve the reporter's current, dialable mobile number.

An alert stores a *snapshot* of the reporter's number at creation time in
``EmergencyAlert.reporter_contact_number``. That snapshot is not the source of
truth: a resident who changes handsets must be reachable at the new number, and
the old value was shown to officials and used as the chat-SMS destination.

The live account number wins; the snapshot is only a fallback, and it is the
*only* source for a resident who reached the barangay by texting the SOS
number, because that alert is filed against the shared anonymous-intake account
which has no real phone number of its own.

Every value leaves this module normalised to ``+639XXXXXXXXX`` or as ``""``, so
callers never have to re-validate a raw string. A number the gateway would
reject (wrong length, non-PH prefix, the ``sms-intake`` placeholder) is treated
as "no number" rather than passed along to fail silently later.
"""

from __future__ import annotations

from apps.sms.normalize import normalize_ph_mobile


def resolve_user_number(user) -> str:
    """Return a user's current dialable PH mobile, or ``""``.

    This is intentionally a backend-only resolver. The number is used as the
    delivery destination for the gateway, never exposed as the SMS number that
    a participant is instructed to text.
    """
    return normalize_ph_mobile(getattr(user, "phone_number", ""))


def resolve_reporter_number(alert) -> str:
    """The reporter's current PH mobile in E.164, or ``""`` when unusable."""
    reporter = getattr(alert, "reporter", None)
    for candidate in (
        getattr(reporter, "phone_number", ""),
        getattr(alert, "reporter_contact_number", ""),
    ):
        number = normalize_ph_mobile(candidate)
        if number:
            return number
    return ""
