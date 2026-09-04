"""Every outbound SMS body, in one place.

Three constraints shape everything here:

* **GSM-7 only.** A single curly quote, em-dash or bullet flips the message to
  UCS-2 and cuts the per-segment budget from 153 characters to 67. The test
  suite asserts every template in this module stays inside the GSM-7 alphabet,
  so write ASCII quotes and hyphens.
* **Plain language.** The reader may be frightened, in the dark, on a feature
  phone. Short lines, no jargon, no enum values, no ticket syntax to memorise.
* **Nothing sensitive.** No full phone numbers, no coordinates, no user ids, no
  government ids. OTP codes appear only in `otp_message` and are never stored.

Reference codes are ``E-<alert id>``. Residents may reply with or without the
``E-`` prefix; `parsing.parse_reference` accepts both.
"""

from __future__ import annotations

import re

from django.utils import timezone

from .normalize import mask_ph_mobile_sms

BRAND = "E-BOSES"

# Category words the resident can text, with the everyday phrasing that helps
# someone pick the right one under stress. Used as fallback when the barangay
# has no active emergency types configured yet.
CATEGORY_MENU = (
    ("FIRE", "fire, smoke"),
    ("MEDICAL", "injury, collapse"),
    ("FLOOD", "rising water"),
    ("CRIME", "theft, fight, safety"),
    ("VIOLENCE", "violence at home"),
    ("CHILD", "child in danger"),
    ("ANIMAL", "loose animal"),
    ("DISASTER", "quake, storm"),
    ("OTHER", "anything else"),
)

# The word residents type for each configured category code.
PREFERRED_KEYWORDS = {
    "fire": "FIRE",
    "medical": "MEDICAL",
    "flood": "FLOOD",
    "crime": "CRIME",
    "domestic_violence": "VIOLENCE",
    "child_protection": "CHILD",
    "dangerous_animal": "ANIMAL",
    "disaster": "DISASTER",
    "drug_related": "DRUG",
    "other": "OTHER",
}

_FALLBACK_HINTS = {word.lower(): hint for word, hint in CATEGORY_MENU}


def _gsm(text: str) -> str:
    return (text or "").replace("—", "-").replace("–", "-").replace("’", "'").strip()


def configured_category_menu() -> list[tuple[str, str]]:
    """(keyword, hint) pairs from the barangay's active emergency types.

    Read at send time so officials who add or retire a category change what
    residents are told on the very next GUIDE reply. Falls back to the static
    menu when nothing is configured or the database is unreachable.
    """
    try:
        from apps.emergencies.models import EmergencyCategory

        rows = EmergencyCategory.objects.filter(is_active=True).order_by("sort_order", "label")
        menu = []
        for row in rows:
            keyword = PREFERRED_KEYWORDS.get(row.code)
            if not keyword:
                keyword = re.sub(r"[^A-Z]", "", row.code.upper()) or row.code.upper()
            hint = _gsm(row.subtext) or _gsm(row.label) or _FALLBACK_HINTS.get(keyword.lower(), "")
            menu.append((keyword, hint or "emergency help"))
        if menu:
            return menu
    except Exception:
        pass
    return [tuple(pair) for pair in CATEGORY_MENU]


def _category_examples() -> str:
    keywords = [word for word, _ in configured_category_menu()]
    return ", ".join(keywords)


def reference(alert) -> str:
    return f"E-{getattr(alert, 'pk', alert)}"


def clock(value=None) -> str:
    """``2:14 PM`` in barangay local time."""
    moment = timezone.localtime(value or timezone.now())
    return moment.strftime("%I:%M %p").lstrip("0")


def _greeting(surname: str) -> str:
    return f"Good day, {surname}!" if surname else "Good day!"


def _place(alert) -> str:
    """Best readable location we have, in the order officials would trust it."""
    for candidate in (
        getattr(alert, "resolved_location", ""),
        getattr(alert, "reported_area", ""),
        getattr(alert, "address", ""),
        getattr(alert, "barangay", ""),
    ):
        if (candidate or "").strip():
            return candidate.strip()
    return "location still being confirmed"


def _category(alert) -> str:
    from .parsing import category_label

    return category_label(getattr(alert, "type", "")) or "Emergency"


# ---------------------------------------------------------------------------
# Resident
# ---------------------------------------------------------------------------

def emergency_ack(alert, *, surname: str = "", unit_name: str = "", assigned: bool = True) -> str:
    """First reply after an emergency SMS is accepted and routed."""
    lines = [
        f"{_greeting(surname)} This is {BRAND} Emergency.",
        "",
        f"We received your {_category(alert).upper()} emergency near {_place(alert)}.",
        f"Reference: {reference(alert)}",
        "",
    ]
    if assigned and unit_name:
        lines.append(f"{unit_name} has been alerted and a responder is on the way.")
    elif assigned:
        lines.append("A responder has been alerted and is on the way.")
    else:
        lines.append("Your report was sent to the barangay officer on duty for immediate assignment.")
    lines += [
        "",
        "Reply STATUS for updates.",
        "Reply CANCEL if this was a mistake.",
    ]
    return "\n".join(lines)


def emergency_ack_unregistered(alert) -> str:
    return "\n".join([
        f"Good day! This is {BRAND} Emergency.",
        "",
        f"We received your {_category(alert).upper()} emergency near {_place(alert)}.",
        f"Reference: {reference(alert)}",
        "",
        "Help is being arranged now.",
        "",
        "Note: this number is not yet registered with E-Boses,",
        "so we could not confirm who is reporting.",
        "Please register at the barangay hall so responders",
        "can reach you faster next time.",
        "",
        "Reply STATUS for updates.",
    ])


def guide_resident() -> str:
    """Kept under four segments on purpose.

    The full-width layout with long hints ran to 642 characters (5 segments).
    Trimming the hints and dropping the column padding gets the same
    information across at a fraction of the send cost, on a number that may be
    texting this to a whole barangay.
    """
    lines = [
        f"{BRAND} GUIDE",
        "",
        "WHAT TO SEND:",
        "HELP <TYPE> - ask for help",
        "STATUS - check your report",
        "SAFE - tell us you are safe",
        "CANCEL - cancel your request",
        "GUIDE - show this list",
        "",
        "TYPES:",
    ]
    lines += [f"{word} - {hint}" for word, hint in configured_category_menu()]
    lines += [
        "",
        "EXAMPLE:",
        "HELP FIRE Champaca Street",
    ]
    return "\n".join(lines)


def unknown_command(raw_text: str = "") -> str:
    """Reply when nothing in the message could be understood.

    Never echoes the received text back — a mistyped banking OTP or a private
    note must not be repeated over SMS. Always offers the emergency path first
    in case this really is an emergency.
    """
    keywords = [word for word, _ in configured_category_menu()]
    example = keywords[0] if keywords else "FIRE"
    others = ", ".join(keywords[1:]) or "MEDICAL, CRIME"
    return "\n".join([
        f"{BRAND}: Sorry, we did not understand your message.",
        "",
        "It looks like the command or the spelling is not correct.",
        "Send GUIDE and we will text you the full list of",
        "commands and categories.",
        "",
        "If this is an emergency right now, send:",
        f"HELP {example}   (or {others})",
    ])


def help_needs_category() -> str:
    return "\n".join([
        f"{BRAND}: We got your request but not the type of emergency.",
        "",
        "Please send HELP and the category, for example:",
        "HELP FIRE Champaca Street",
        "",
        _category_examples(),
        "",
        "Send GUIDE for the full list.",
    ])


def status_reply(alert, *, status_text: str, responder_text: str = "") -> str:
    lines = [
        f"{BRAND} STATUS - {reference(alert)}",
        f"{_category(alert)} emergency",
        _place(alert),
        "",
        f"Status: {status_text}",
    ]
    if responder_text:
        lines.append(f"Responder: {responder_text}")
    lines += [
        f"Received: {clock(getattr(alert, 'created_at', None))}",
        "",
        "Reply SAFE if you are now safe.",
        "Reply CANCEL to request cancellation.",
    ]
    return "\n".join(lines)


def no_active_report() -> str:
    keywords = [word for word, _ in configured_category_menu()]
    example = keywords[0] if keywords else "FIRE"
    others = ", ".join(keywords[1:]) or "MEDICAL, CRIME"
    return "\n".join([
        f"{BRAND}: You have no active emergency report with us right now.",
        "",
        "If you need help, send:",
        f"HELP {example}   (or {others})",
        "",
        "Send GUIDE to see all commands.",
    ])


def safe_ack(alert) -> str:
    return "\n".join([
        f"{BRAND}: Salamat! We recorded that you are safe.",
        f"Reference: {reference(alert)}",
        "",
        "The responder team has been informed and will still",
        "check on you to confirm.",
        "",
        "Reply STATUS anytime.",
    ])


def cancel_ack(alert) -> str:
    return "\n".join([
        f"{BRAND}: We received your cancellation request.",
        f"Reference: {reference(alert)}",
        "",
        "A barangay official will confirm before closing it.",
        "Responders may still check on you for safety.",
        "",
        "Reply STATUS for updates.",
    ])


def off_duty_notice(alert, hotlines: list | None = None) -> str:
    """Sent when an emergency arrives outside barangay duty hours.

    The emergency is still created and still escalated - this text tells the
    resident to also call, because a phone call reaches a rescue unit faster
    than an off-hours dispatch.
    """
    lines = [
        f"{BRAND}: Your {_category(alert).upper()} emergency was received at",
        f"{clock(getattr(alert, 'created_at', None))} ({reference(alert)}) and sent to the officer on call.",
        "",
        "Barangay responders are off duty at this hour, so",
        "please also call for the fastest help:",
    ]
    for entry in hotlines or DEFAULT_HOTLINES:
        label = str(entry.get("label", "")).strip()
        number = str(entry.get("number", "")).strip()
        if label and number:
            lines.append(f"{label} {number}")
    return "\n".join(lines)


DEFAULT_HOTLINES = [
    {"label": "Marikina Rescue", "number": "161"},
    {"label": "Emergency", "number": "911"},
]


def outside_service_area(alert) -> str:
    return "\n".join([
        f"{BRAND}: We received your emergency ({reference(alert)}) but the",
        "location appears to be outside all active E-Boses community boundaries.",
        "",
        "It has been passed to the coordination desk for referral.",
        "For the fastest help please also call 161 or 911.",
        "",
        "Reply STATUS for updates.",
    ])


# ---------------------------------------------------------------------------
# Responder
# ---------------------------------------------------------------------------

def responder_dispatch(alert, *, priority: str = "HIGH", summary: str = "", contact: str = "") -> str:
    lines = [
        f"{BRAND} DISPATCH - {priority.upper()}",
        f"{_category(alert).upper()} emergency",
        _place(alert),
        f"{reference(alert)} - received {clock(getattr(alert, 'created_at', None))}",
    ]
    if summary:
        lines += ["", summary]
    if contact:
        lines += ["", f"Reporter: {mask_ph_mobile_sms(contact)}"]
    lines += [
        "",
        f"Reply ACCEPT {reference(alert)} to confirm.",
        f"Reply DECLINE {reference(alert)} <reason> if you cannot go.",
        f"Reply BACKUP {reference(alert)} <reason> if you need support.",
    ]
    return "\n".join(lines)


def guide_responder() -> str:
    return "\n".join([
        f"{BRAND} RESPONDER GUIDE",
        "",
        "ACCEPT <ref> - you are responding",
        "DECLINE <ref> <why> - you cannot go",
        "ONSCENE <ref> - you arrived",
        "BACKUP <ref> <why> - need support",
        "RESOLVED <ref> <note> - finished",
        "STATUS - your assignment",
        "ONDUTY / OFFDUTY - duty status",
        "GUIDE - show this list",
        "",
        "EXAMPLE:",
        "ACCEPT E-2401",
        "DECLINE E-2401 on another call",
        "",
        "DECLINE, BACKUP and RESOLVED need a reason.",
    ])


def responder_accept_ack(alert) -> str:
    return "\n".join([
        f"{BRAND}: Confirmed. You are marked EN ROUTE for {reference(alert)}.",
        f"{_category(alert)} - {_place(alert)}",
        "",
        f"Reply ONSCENE {reference(alert)} when you arrive.",
        f"Reply BACKUP {reference(alert)} <reason> if you need support.",
    ])


def responder_decline_ack(alert, *, reassigned: bool) -> str:
    tail = (
        "Another responder has been assigned."
        if reassigned
        else "No other responder was free, so this was escalated to an official."
    )
    return "\n".join([
        f"{BRAND}: You have been removed from {reference(alert)}.",
        tail,
        "",
        "Thank you for telling us quickly.",
    ])


def past_incident() -> str:
    return (
        f"{BRAND}: This sounds like a past incident, so emergency dispatch was not started. "
        "If danger is still present, reply HELP and the emergency type. Otherwise, submit it as a concern in E-Boses."
    )


def responder_onscene_ack(alert) -> str:
    return "\n".join([
        f"{BRAND}: Recorded. You are AT THE SCENE for {reference(alert)}.",
        "",
        f"Reply RESOLVED {reference(alert)} <note> when the incident is finished.",
        f"Reply BACKUP {reference(alert)} <reason> if you still need support.",
    ])


def responder_backup_ack(alert, *, assigned_name: str = "") -> str:
    tail = (
        f"{assigned_name} has been assigned to support you."
        if assigned_name
        else "No free responder was found, so an official was alerted to arrange support."
    )
    return "\n".join([
        f"{BRAND}: Backup request received for {reference(alert)}.",
        tail,
    ])


def responder_resolved_ack(alert) -> str:
    return "\n".join([
        f"{BRAND}: Thank you. {reference(alert)} is marked resolved and your",
        "note was saved to the incident record.",
    ])


def responder_needs_reason(keyword: str, alert_reference: str = "E-0000") -> str:
    return "\n".join([
        f"{BRAND}: {keyword} needs a short reason.",
        "",
        "Please send it like this:",
        f"{keyword} {alert_reference} <short reason>",
        "",
        "The reason is recorded in the incident log.",
    ])


def responder_no_assignment() -> str:
    return "\n".join([
        f"{BRAND}: You have no active assignment right now.",
        "",
        "Reply ONDUTY if you are available for dispatch.",
        "Send GUIDE to see all responder commands.",
    ])


def duty_ack(*, on_duty: bool, unit_name: str = "") -> str:
    if on_duty:
        unit = f" as {unit_name}" if unit_name else ""
        return "\n".join([
            f"{BRAND}: You are now ON DUTY{unit}.",
            "You may receive emergency assignments.",
            "",
            "Reply OFFDUTY when your shift ends.",
        ])
    return "\n".join([
        f"{BRAND}: You are now OFF DUTY.",
        "You will not receive new emergency assignments.",
        "",
        "Reply ONDUTY when you are available again.",
    ])


# ---------------------------------------------------------------------------
# Official
# ---------------------------------------------------------------------------

def official_new_emergency(alert, *, unit_name: str = "", responder_name: str = "") -> str:
    lines = [
        f"{BRAND} ALERT - {reference(alert)}",
        f"{_category(alert).upper()} emergency",
        _place(alert),
        f"Received {clock(getattr(alert, 'created_at', None))}",
        "",
    ]
    if responder_name:
        lines.append(f"Auto-assigned: {responder_name}" + (f" ({unit_name})" if unit_name else ""))
    else:
        lines.append("NO RESPONDER ASSIGNED - needs manual dispatch.")
    lines += ["", f"Reply DETAIL {reference(alert)} for more."]
    return "\n".join(lines)


def official_no_responder(alert, *, unit_name: str = "") -> str:
    unit = unit_name or "the responding unit"
    return "\n".join([
        f"{BRAND} ESCALATION - {reference(alert)}",
        f"{_category(alert).upper()} emergency",
        _place(alert),
        "",
        f"No on-duty responder was available in {unit}.",
        "The emergency is still active and needs manual dispatch.",
        "",
        "Open the dispatch console to assign someone now.",
    ])


def official_open_list(alerts) -> str:
    if not alerts:
        return f"{BRAND}: No active emergencies right now."
    lines = [f"{BRAND} ACTIVE ({len(alerts)})", ""]
    for alert in alerts[:8]:
        lines.append(f"{reference(alert)} {_category(alert)} - {_place(alert)[:32]}")
    if len(alerts) > 8:
        lines.append(f"... and {len(alerts) - 8} more")
    lines += ["", "Reply DETAIL <ref> for one incident."]
    return "\n".join(lines)


def official_detail(alert, *, status_text: str, unit_name: str = "", responder_text: str = "", contact: str = "") -> str:
    lines = [
        f"{BRAND} {reference(alert)}",
        f"{_category(alert)} emergency",
        _place(alert),
        "",
        f"Status: {status_text}",
    ]
    if unit_name:
        lines.append(f"Unit: {unit_name}")
    lines.append(f"Responder: {responder_text or 'none assigned'}")
    if contact:
        lines.append(f"Reporter: {mask_ph_mobile_sms(contact)}")
    lines.append(f"Received: {clock(getattr(alert, 'created_at', None))}")
    return "\n".join(lines)


def guide_official() -> str:
    return "\n".join([
        f"{BRAND} OFFICIAL GUIDE",
        "",
        "READ ONLY:",
        "OPEN            - list active emergencies",
        "DETAIL <ref>    - one incident in full",
        "STATUS          - summary of today",
        "ONDUTY          - who is on duty now",
        "GUIDE           - show this list",
        "",
        "NEEDS YOUR PIN:",
        "ESCALATE <ref> <PIN>",
        "CLOSE <ref> <PIN> <note>",
        "",
        "Assignment and reassignment are done in the",
        "dispatch console, not by SMS.",
        "",
        "Your PIN is set in your E-Boses profile.",
        "Never share it and never send it to anyone.",
    ])


def official_duty_roster(names: list) -> str:
    if not names:
        return "\n".join([
            f"{BRAND}: No responders are on duty right now.",
            "Any new emergency will be escalated for manual dispatch.",
        ])
    lines = [f"{BRAND} ON DUTY ({len(names)})", ""]
    lines += [f"- {name}" for name in names[:10]]
    if len(names) > 10:
        lines.append(f"... and {len(names) - 10} more")
    return "\n".join(lines)


def pin_required(keyword: str) -> str:
    return "\n".join([
        f"{BRAND}: {keyword} needs your official PIN.",
        "",
        "Send it like this:",
        f"{keyword} E-2401 <your PIN>",
        "",
        "This is required because a phone number alone is not",
        "enough to authorise a change to an emergency record.",
    ])


def pin_invalid(*, attempts_left: int) -> str:
    if attempts_left <= 0:
        return "\n".join([
            f"{BRAND}: That PIN was not correct and SMS commands are now",
            "locked for this number.",
            "",
            "Use the dashboard, or contact the barangay administrator",
            "to unlock SMS access.",
        ])
    return "\n".join([
        f"{BRAND}: That PIN was not correct.",
        f"Attempts left: {attempts_left}",
        "",
        "Check your PIN in your E-Boses profile and try again.",
    ])


def not_authorised(keyword: str) -> str:
    return "\n".join([
        f"{BRAND}: The command {keyword} is not available for this number.",
        "",
        "If you are a barangay responder or official, make sure",
        "this handset number is the one on your E-Boses account.",
        "",
        "Send GUIDE to see the commands you can use.",
    ])


# ---------------------------------------------------------------------------
# Cross-role notices
# ---------------------------------------------------------------------------

def reassigned_notice(alert, *, reason: str = "") -> str:
    lines = [
        f"{BRAND}: You have been assigned to {reference(alert)}.",
        f"{_category(alert)} - {_place(alert)}",
    ]
    if reason:
        lines += ["", f"Reason: {reason[:80]}"]
    lines += ["", f"Reply ACCEPT {reference(alert)} to confirm."]
    return "\n".join(lines)


def backup_assigned_notice(alert, *, backup_type: str = "", urgency: str = "", reason: str = "") -> str:
    lines = [
        f"{BRAND} BACKUP REQUEST - {reference(alert)}",
        f"{_category(alert).upper()} emergency",
        _place(alert),
    ]
    if backup_type:
        lines.append(f"Needed: {backup_type}")
    if urgency:
        lines.append(f"Urgency: {urgency}")
    if reason:
        lines.append(f"Reason: {reason[:80]}")
    lines += ["", f"Reply ACCEPT {reference(alert)} to confirm."]
    return "\n".join(lines)


def resident_backup_notice(alert) -> str:
    return "\n".join([
        f"{BRAND}: Another responder was added to help with your",
        f"emergency ({reference(alert)}).",
        "",
        "Reply STATUS for updates.",
    ])


def resident_resolved_notice(alert) -> str:
    return "\n".join([
        f"{BRAND}: Your emergency {reference(alert)} is now marked resolved.",
        "",
        "If you still need help, send HELP and the category again,",
        "or call 161 or 911.",
    ])


# ---------------------------------------------------------------------------
# Registration OTP (kept deliberately separate from every emergency flow)
# ---------------------------------------------------------------------------

def otp_message(code: str) -> str:
    """The only template that ever contains a code. Never stored, never logged."""
    return (
        f"E-Boses registration code: {code}. "
        "This code expires in 5 minutes. Do not share it with anyone."
    )


def all_static_templates() -> dict[str, str]:
    """Templates with no arguments, for the GSM-7 and length test sweep."""
    return {
        "guide_resident": guide_resident(),
        "guide_responder": guide_responder(),
        "guide_official": guide_official(),
        "unknown_command": unknown_command("HELPP FIER"),
        "help_needs_category": help_needs_category(),
        "past_incident": past_incident(),
        "no_active_report": no_active_report(),
        "responder_no_assignment": responder_no_assignment(),
        "duty_ack_on": duty_ack(on_duty=True, unit_name="Barangay Tanod"),
        "duty_ack_off": duty_ack(on_duty=False),
        "pin_required": pin_required("CLOSE"),
        "pin_invalid": pin_invalid(attempts_left=2),
        "pin_locked": pin_invalid(attempts_left=0),
        "not_authorised": not_authorised("ASSIGN"),
        "responder_needs_reason": responder_needs_reason("DECLINE"),
        "official_duty_roster_empty": official_duty_roster([]),
        "otp_message": otp_message("482731"),
    }
