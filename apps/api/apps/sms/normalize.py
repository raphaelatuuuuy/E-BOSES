"""Philippine mobile number normalisation, masking and account matching.

Residents write their number four different ways depending on which form they
last filled in (``09171234567``, ``639171234567``, ``+639171234567``,
``0917 123 4567``). The gateway reports whichever form the handset sent. Before
this module, `user_for_sms_payload` compared the raw string and a
space/dash-stripped variant only, so a resident registered as ``+639171234567``
who texted from a handset reporting ``09171234567`` was treated as a stranger.

Matching a number is a *verification signal*, never proof of identity: SIMs are
shared, handed down and spoofed. Callers get a `SenderMatch` that says how much
weight the match deserves and must not use it as an authentication decision.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

# PH mobile numbers are 10 digits after the country code and always start with 9.
PH_MOBILE_LOCAL_PATTERN = re.compile(r"^9\d{9}$")
PH_MOBILE_E164_PATTERN = re.compile(r"^\+639\d{9}$")


def digits_only(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def normalize_ph_mobile(value: str | None) -> str:
    """Return ``+639XXXXXXXXX`` for any recognised PH mobile spelling, else "".

    Accepts ``09XXXXXXXXX``, ``639XXXXXXXXX``, ``+639XXXXXXXXX``, ``9XXXXXXXXX``
    and any of those with spaces, dashes, dots or parentheses mixed in.
    Returns an empty string for anything that is not a PH mobile number so
    callers can branch on falsiness rather than catching an exception.
    """
    digits = digits_only(value)
    if not digits:
        return ""

    # Strip the "00" international access prefix, leaving the country code.
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("639"):
        local = digits[2:]
    elif digits.startswith("09"):
        local = digits[1:]
    elif digits.startswith("9"):
        local = digits
    else:
        return ""

    if not PH_MOBILE_LOCAL_PATTERN.match(local):
        return ""
    return f"+63{local}"


def is_ph_mobile(value: str | None) -> bool:
    return bool(normalize_ph_mobile(value))


def mask_ph_mobile(value: str | None) -> str:
    """``+639171234821`` -> ``+63 9•• ••• 4821``.

    The last four digits stay visible because that is what a responder reads
    back to a resident to confirm they are calling the right person; everything
    that would let a bystander dial the number is hidden.
    """
    normalized = normalize_ph_mobile(value)
    if not normalized:
        digits = digits_only(value)
        if len(digits) < 4:
            return "Number not available"
        return f"•••• {digits[-4:]}"
    return f"+63 9•• ••• {normalized[-4:]}"


def mask_ph_mobile_sms(value: str | None) -> str:
    """Masked number for use *inside an SMS body*.

    Identical to `mask_ph_mobile` but spelled with ASCII 'x'. The bullet
    character is not in the GSM-7 alphabet, so a single masked number written
    the dashboard way would flip an entire message to UCS-2 and halve the
    per-segment budget from 153 characters to 67.
    """
    normalized = normalize_ph_mobile(value)
    if not normalized:
        digits = digits_only(value)
        if len(digits) < 4:
            return "number not available"
        return f"xxxx {digits[-4:]}"
    return f"+63 9xx xxx {normalized[-4:]}"


def last_four(value: str | None) -> str:
    digits = digits_only(value)
    return digits[-4:] if len(digits) >= 4 else ""


def hash_number(value: str | None) -> str:
    """Stable hash of the normalised number, for logging and dedupe keys.

    Falls back to the raw digits when the number is not a PH mobile so that a
    foreign or short-code sender still gets a consistent key.
    """
    normalized = normalize_ph_mobile(value) or digits_only(value)
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def phone_variants(value: str | None) -> list[str]:
    """Every spelling of a number that might be sitting in `User.phone_number`.

    Accounts were created across several form versions, so the column is not
    guaranteed to hold the E.164 form. Querying `phone_number__in=variants`
    catches the legacy rows without a schema migration or a full table scan.
    """
    normalized = normalize_ph_mobile(value)
    if not normalized:
        raw = (value or "").strip()
        return [raw] if raw else []
    local = normalized[3:]  # 9XXXXXXXXX
    return [
        normalized,           # +639XXXXXXXXX
        f"63{local}",         # 639XXXXXXXXX
        f"0{local}",          # 09XXXXXXXXX
        local,                # 9XXXXXXXXX
    ]


@dataclass(frozen=True)
class SenderMatch:
    """Outcome of resolving an SMS sender to an E-Boses account.

    `status` is one of:
      ``registered``  exactly one verified account holds this number
      ``unverified``  no account holds it — treat the sender as anonymous
      ``needs_review``  more than one account holds it, which should not happen
                        and means someone needs to look at the duplicate
    """

    status: str
    user: object | None = None
    candidates: tuple = ()

    REGISTERED = "registered"
    UNVERIFIED = "unverified"
    NEEDS_REVIEW = "needs_review"

    @property
    def is_registered(self) -> bool:
        return self.status == self.REGISTERED

    @property
    def label(self) -> str:
        return {
            self.REGISTERED: "Registered mobile number",
            self.UNVERIFIED: "Mobile number not verified",
            self.NEEDS_REVIEW: "Account match requires review",
        }.get(self.status, "Mobile number not verified")


def match_sender(number: str | None, *, verified_only: bool = True) -> SenderMatch:
    """Resolve a sender number to a single account, or say why it could not."""
    from django.contrib.auth import get_user_model

    variants = phone_variants(number)
    if not variants:
        return SenderMatch(SenderMatch.UNVERIFIED)

    User = get_user_model()
    queryset = User.objects.filter(phone_number__in=variants)
    if verified_only:
        queryset = queryset.filter(status=User.Status.VERIFIED)
    candidates = list(queryset.select_related("resident_profile")[:5])

    if len(candidates) == 1:
        return SenderMatch(SenderMatch.REGISTERED, candidates[0], tuple(candidates))
    if len(candidates) > 1:
        return SenderMatch(SenderMatch.NEEDS_REVIEW, None, tuple(candidates))
    return SenderMatch(SenderMatch.UNVERIFIED)


def surname_for(user) -> str:
    """Surname used to greet a resident by name in an SMS reply.

    Returns "" when there is no profile or no last name so callers fall back to
    a plain greeting instead of texting "Good day, None!".
    """
    profile = getattr(user, "resident_profile", None)
    if not profile:
        return ""
    return (getattr(profile, "last_name", "") or "").strip()
