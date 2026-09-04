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
    "received_app": ("Emergency received", "Sent from the E-Boses app."),
    "received_sms": ("Emergency received", "Sent by text message."),
    "received_call": ("Emergency received", "Logged by the barangay from a phone call."),

    # Routing
    "routing": ("Finding a responder", "Looking for an available responder in the right unit."),
    "responder_assigned": ("Responder assigned", "A responder was automatically assigned."),
    "responder_reassigned": ("Responder changed", "Another responder took over."),
    "no_responder": ("Finding another responder", "Automatic dispatch is checking available response units."),
    "responder_searching": ("Finding a responder", "Automatic dispatch is checking available response units."),

    # Response
    "responder_confirmed": ("Responder confirmed", "The responder acknowledged the assignment."),
    "responder_en_route": ("Responder on the way", "The responder is travelling to the location."),
    "responder_nearby": ("Responder nearby", "The responder is close to the location."),
    "responder_arrived": ("Responder at the scene", "The responder reached the location."),
    "responder_unable": ("Responder could not go", "The responder reported they could not respond."),
    "acknowledgment_timeout": ("No response in time", "Reassigned because the responder did not confirm."),

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
    "resolved": ("Resolved", "The incident was handled and closed."),
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
    if note:
        body = f"{body} {note}" if body else note
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
