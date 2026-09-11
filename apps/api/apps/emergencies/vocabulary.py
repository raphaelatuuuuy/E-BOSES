"""One set of words for every emergency event.

Before this, the same moment was described three different ways: the SMS said
"Salamat! We recorded that you are safe", the timeline heading said "Emergency
received", and the note said "Resident reported they are safe (by SMS)". A
resident and an official reading the same incident saw different stories.

Everything that describes an emergency event now comes from here - SMS replies,
status-event headings, and the dashboard timeline.
"""

from __future__ import annotations

# key -> (timeline heading, timeline detail)
EVENTS: dict[str, tuple[str, str]] = {
    # Intake
    "received_app": ("Emergency received", "Your emergency has been received."),
    "received_sms": ("Emergency received", "Your emergency has been received."),
    "received_call": ("Emergency received", "Logged by the barangay from a phone call."),

    # Routing
    "routing": ("Finding a response unit", "The system is finding the appropriate response unit."),
    "responder_assigned": ("Assigned unit", "A response unit has been assigned to your emergency."),
    "responder_reassigned": ("Responder changed", "Another responder took over."),
    "no_responder": ("Finding a response unit", "The system is checking available response units."),
    "responder_searching": ("Finding a response unit", "The system is finding the appropriate response unit."),

    # Response
    "responder_confirmed": ("Responder preparing", "The assigned responder is preparing to travel."),
    "responder_en_route": ("Responder en route", "The responder is on the way to your location."),
    "responder_nearby": ("Responder nearby", "The responder is close to the location."),
    "responder_arrived": ("Responder on scene", "The responder has arrived at the scene."),
    "assisting": ("Assisting", "The responder is providing assistance."),
    "responder_unable": ("Unit reassigned", "The emergency was reassigned to another available unit."),
    "acknowledgment_timeout": ("Unit reassigned", "The emergency was reassigned to another available unit."),

    # Support
    "backup_requested": ("Backup requested", "The responder asked for more support."),
    "backup_assigned": ("Backup assigned", "A supporting responder joined the response."),
    "transferred": ("Transferred to another unit", "An official moved this to a different unit."),
    "escalated": ("Escalated", "Raised to an official for a decision."),

    # Resident updates
    "resident_safe": ("Resident reported safe", "The resident says they are safe. A responder will still confirm."),
    "resident_cancel_requested": ("Cancellation requested", "The resident asked to cancel. An official will confirm."),
    "resident_contacted": ("Reporter contacted", "Someone from the barangay reached the reporter."),

    # Closure
    "resolved": ("Resolved", "The emergency has been marked resolved."),
    "false_alarm": ("False alarm", "Confirmed as a false alarm."),
    "cancelled": ("Cancelled", "The request was cancelled."),
    "closed": ("Closed", "The incident record was closed."),
}


def heading(key: str, fallback: str = "") -> str:
    entry = EVENTS.get(key)
    return entry[0] if entry else (fallback or "Update")


def detail(key: str, fallback: str = "") -> str:
    entry = EVENTS.get(key)
    return entry[1] if entry else fallback


def describe(key: str, extra: str = "") -> tuple[str, str]:
    """(heading, detail) with an optional operational note appended."""
    head = heading(key)
    body = detail(key)
    note = (extra or "").strip()
    if key == "responder_assigned" and note.startswith("Assigned to "):
        body = note
    elif key in {"routing", "responder_searching"} and "community" in note.lower():
        body = "The system is confirming the emergency location before assigning a response unit."
    elif not body:
        body = note
    return head, body[:255]


# Fallback when a caller records a genuine status change without naming an
# event. Every entry then still gets a heading that describes what happened.
KEY_BY_STATUS: dict[str, str] = {
    "submitted": "received_app",
    "routing": "routing",
    "routed": "responder_assigned",
    "awaiting_acknowledgment": "routing",
    "acknowledged": "responder_confirmed",
    "en_route": "responder_en_route",
    "nearby": "responder_nearby",
    "arrived": "responder_arrived",
    "in_progress": "assisting",
    "resident_safe": "resident_safe",
    "backup_requested": "backup_requested",
    "backup_assigned": "backup_assigned",
    "transfer_required": "transferred",
    "escalation_required": "escalated",
    "resolved": "resolved",
    "false_alarm": "false_alarm",
    "cancelled": "cancelled",
    "closed": "closed",
}


def key_for_status(status: str) -> str:
    return KEY_BY_STATUS.get(status, "")
