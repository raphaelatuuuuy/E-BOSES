"""Compact, resident-facing copy for every notification type.

The generated values live in notification metadata so they can be rendered
without calling the model during an inbox request.  A deterministic fallback
keeps the inbox useful when the assistant is disabled or unavailable.
"""

import json
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

COPY_VERSION = 2
HEADER_KEY = "llm_header"
DESCRIPTION_KEY = "llm_description"
SOURCE_KEY = "llm_copy_source"
MAX_HEADER_WORDS = 7
MAX_HEADER_LENGTH = 72
MAX_DESCRIPTION_WORDS = 30
MAX_DESCRIPTION_LENGTH = 260


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _phrase(value, fallback: str) -> str:
    text = _clean(value)
    text = re.sub(r"[.!?]+$", "", text).strip(" \"'`")
    return text or fallback


def _valid_header(value) -> str:
    text = _clean(value).strip(" \"'`")
    text = re.sub(r"[.!?:;,]+$", "", text).strip()
    if not text or len(text) > MAX_HEADER_LENGTH:
        return ""
    if not 1 <= len(text.split()) <= MAX_HEADER_WORDS:
        return ""
    if re.search(r"\b(?:RPT|SOS)[-_]?\d", text, re.IGNORECASE):
        return ""
    return text


def _valid_description(value) -> str:
    text = _clean(value).strip(" \"'`")
    if not text:
        return ""
    if not text.endswith((".", "!", "?")):
        text = f"{text}."
    if len(text) > MAX_DESCRIPTION_LENGTH or len(text.split()) > MAX_DESCRIPTION_WORDS:
        return ""
    sentence_endings = re.findall(r"[.!?](?=\s|$)", text)
    if len(sentence_endings) != 1:
        return ""
    if re.search(r"\b(?:RPT|SOS)[-_]?\d", text, re.IGNORECASE):
        return ""
    return text


def stored_notification_copy(notification) -> tuple[str, str] | None:
    # A community alert is re-derived from the live alert record instead of a
    # stored sentence: reverse geocoding can hand back the street after the
    # fan-out, and a stored copy would keep reading "the area" long after the
    # street is known.
    if getattr(notification, "type", "") == "witness_alert":
        return None

    metadata = getattr(notification, "metadata", None)
    if not isinstance(metadata, dict):
        return None
    if metadata.get("llm_copy_version") != COPY_VERSION:
        return None
    header = _valid_header(metadata.get(HEADER_KEY))
    description = _valid_description(metadata.get(DESCRIPTION_KEY))
    if not header or not description:
        return None
    return header, description


def _context_for(notification) -> dict:
    # Import lazily because services uses this module while building the
    # serialized display payload.
    from .services import notification_context

    return notification_context(notification)


def _model_source(notification) -> str:
    context = _context_for(notification)
    location = context.get("location") or {}
    community = context.get("community") or {}
    department = context.get("department") or {}
    response = context.get("response") or {}
    lines = [
        f"Notification type: {_clean(getattr(notification, 'type', 'notification'))}",
        f"Recipient role: {_clean(getattr(getattr(notification, 'recipient', None), 'role', ''))}",
        f"Existing title: {_clean(getattr(notification, 'title', ''))}",
        f"Existing message: {_clean(getattr(notification, 'body', ''))}",
        f"Subject: {_clean(context.get('subject'))}",
        f"Status: {_clean(context.get('status'))}",
        f"Community: {_clean(community.get('name'))}",
        f"Location: {_clean(location.get('address') or location.get('barangay'))}",
        f"Assigned unit: {_clean(department.get('name') or department.get('short_name'))}",
        f"Response status: {_clean(response.get('assignment_status'))}",
    ]
    return "\n".join(line for line in lines if line.split(": ", 1)[1])


def notification_copy_key(notification) -> str:
    """Identify equivalent notification content without recipient-specific IDs."""
    context = _context_for(notification)
    location = context.get("location") or {}
    community = context.get("community") or {}
    department = context.get("department") or {}
    return json.dumps(
        {
            "type": getattr(notification, "type", ""),
            "title": getattr(notification, "title", ""),
            "body": getattr(notification, "body", ""),
            "recipient_role": getattr(getattr(notification, "recipient", None), "role", ""),
            "subject": context.get("subject"),
            "status": context.get("status"),
            "community": community.get("name"),
            "location": location.get("address") or location.get("barangay"),
            "department": department.get("name") or department.get("short_name"),
        },
        sort_keys=True,
    )


def _parse_model_response(value) -> tuple[str, str] | None:
    text = _clean(value).strip(" \"'`")
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except (TypeError, ValueError):
            return None
    if not isinstance(data, dict):
        return None
    header = _valid_header(data.get("header") or data.get("title"))
    description = _valid_description(
        data.get("description") or data.get("summary") or data.get("body")
    )
    if not header or not description:
        return None
    return header, description


def _model_copy(notification) -> tuple[str, str] | None:
    if not getattr(settings, "NOTIFICATION_COPY_LLM_ENABLED", True) or not is_configured():
        return None
    try:
        response = complete(
            [
                {
                    "role": "system",
                    "content": (
                        "You write compact resident-facing notification copy for a barangay app. "
                        "Return JSON only with exactly two string fields: header and description. "
                        "The header must be a clear 1-to-7-word label, without report IDs, greetings, "
                        "locations, or metadata. The description must be exactly one brief sentence "
                        "of at most 30 words that captures the action or meaning of the notification. "
                        "Do not repeat the header, add greetings, list extra details, invent facts, "
                        "or use detached wording for a resident's own emergency; when the recipient "
                        "role is resident, refer to it as 'your emergency report' and write from the "
                        "resident's perspective. Do not use markdown. Use the source language when it is clearly Filipino; "
                        "otherwise use plain English."
                    ),
                },
                {"role": "user", "content": _model_source(notification)},
            ]
        )
    except (AssistantNotConfigured, AssistantUnavailable):
        return None
    except Exception:
        logger.warning("notification copy model failed", exc_info=True)
        return None
    return _parse_model_response(response)


def witness_alert_copy(notification) -> tuple[str, str]:
    """The safety sentence every resident near an emergency reads.

    Deterministic on purpose: a community alert must always name the street to
    avoid and always carry the same instruction, so it never goes through the
    model. The street can also arrive *after* the fan-out, because reverse
    geocoding runs post-dispatch, which is why the wording is re-derived from
    the alert record instead of being stored.
    """
    from apps.emergencies.location_services import alert_street_address

    alert = getattr(notification, "emergency", None)
    emergency_type = _phrase((_context_for(notification) or {}).get("subject"), "Emergency")
    street = alert_street_address(alert) if alert is not None else ""
    if not street:
        # Better the barangay than "the area": the resident already knows
        # which area they are in, and the vague phrase reads like the system
        # failed to look.
        street = _phrase(getattr(alert, "barangay", "") if alert is not None else "", "the area")
    recipient = getattr(notification, "recipient", None)
    recipient_name = _clean(getattr(recipient, "first_name", "")) or "resident"
    title = "Community Alert"
    body = f"Good day, {recipient_name}. {emergency_type} emergency near {street}, stay clear and keep safe. Call emergency services if you need to. Thank you."
    return title, body


def _fallback_copy(notification) -> tuple[str, str]:
    type_value = _clean(getattr(notification, "type", "notification")).lower()
    context = _context_for(notification)
    recipient_role = _clean(getattr(getattr(notification, "recipient", None), "role", ""))
    resident_role = getattr(
        getattr(getattr(notification, "recipient", None), "Role", None),
        "RESIDENT",
        "resident",
    )
    subject = _phrase(context.get("subject"), "this report")
    community = _phrase((context.get("community") or {}).get("name"), "your community")
    location = _phrase(
        (context.get("location") or {}).get("address")
        or (context.get("location") or {}).get("barangay"),
        community,
    )
    unit = _phrase(
        (context.get("department") or {}).get("name")
        or (context.get("department") or {}).get("short_name"),
        "the barangay team",
    )
    title = _phrase(getattr(notification, "title", ""), "Barangay update")

    if type_value == "announcement":
        header = re.sub(
            r"^(?:urgent|important|barangay) announcement\s*[·:-]?\s*",
            "",
            title,
            flags=re.IGNORECASE,
        ).strip() or "Barangay announcement"
        body = _clean(getattr(notification, "body", ""))
        body = re.sub(
            r"^(?:good morning|good afternoon|good evening)(?:,\s*[^.]+)?\.\s*",
            "",
            body,
            flags=re.IGNORECASE,
        )
        description = _valid_description(body) or _valid_description(
            f"This announcement covers {header}."
        )
        return _valid_header(header) or "Barangay announcement", description

    concern_headers = {
        "submitted": "Report received",
        "under_review": "Report under review",
        "assigned": "Report assigned",
        "in_progress": "Work started",
        "resolved": "Report resolved",
        "rejected": "Report decision",
        "clarification_requested": "Clarification needed",
        "clarification_replied": "Clarification received",
        "appeal_submitted": "Appeal submitted",
        "appeal_approved": "Appeal approved",
        "appeal_denied": "Appeal denied",
        "concern_comment": "New report discussion",
        "concern_mention": "You were mentioned",
        "chat_message": "New report message",
        "flag_dismissed": "Report review completed",
        "post_taken_down": "Report content removed",
        "comment_taken_down": "Report comment removed",
    }
    if getattr(notification, "concern_id", None):
        header = concern_headers.get(type_value, "Report update")
        if type_value == "submitted":
            description = f"Your report about {subject} was received in {community} and is ready for review."
        elif type_value == "under_review":
            description = f"Your report about {subject} is being reviewed by the barangay team."
        elif type_value == "assigned":
            description = f"Your report about {subject} was assigned to {unit} for action."
        elif type_value == "in_progress":
            description = f"Work is now underway on your report about {subject}."
        elif type_value == "resolved":
            description = f"Your report about {subject} was marked resolved by {unit}."
        elif type_value == "rejected":
            description = f"Your report about {subject} was not accepted for action in {community}."
        elif type_value == "clarification_requested":
            description = f"The barangay team needs more information about your report on {subject}."
        elif type_value == "clarification_replied":
            description = f"A reply was added to the clarification request for {subject}."
        elif type_value in {"appeal_submitted", "appeal_approved", "appeal_denied"}:
            description = f"The appeal for your report about {subject} has been {type_value.removeprefix('appeal_')}."
        elif type_value == "concern_mention":
            description = f"You were mentioned in the community discussion about {subject}."
        elif type_value in {"concern_comment", "chat_message"}:
            description = f"There is a new message about {subject} in your report discussion."
        else:
            description = f"Your report about {subject} has a new update from the barangay team."
        return header, description

    if getattr(notification, "emergency_id", None):
        emergency_type = _phrase(context.get("subject"), "Emergency")
        status = _phrase(context.get("status"), "updated")
        if type_value == "witness_alert":
            return witness_alert_copy(notification)
        emergency_headers = {
            "emergency_submitted": "Emergency received",
            "emergency_routed": "Emergency dispatched",
            "emergency_acknowledged": "Response acknowledged",
            "emergency_en_route": "Responder en route",
            "emergency_nearby": "Responder nearby",
            "emergency_arrived": "Responder arrived",
            "emergency_resolved": "Emergency resolved",
            "emergency_cancelled": "Emergency cancelled",
            "emergency_escalated": "Emergency escalation",
            "emergency_appeal_submitted": "Emergency review requested",
            "emergency_appeal_approved": "Emergency review approved",
            "emergency_appeal_denied": "Emergency review denied",
            "emergency_updated": "Emergency response update",
        }
        header = emergency_headers.get(type_value, "Emergency update")
        if recipient_role == "first_responder" and type_value in {
            "emergency_routed",
            "emergency_escalated",
        }:
            header = "Dispatch assignment"
        elif recipient_role == "barangay_official" and type_value == "emergency_escalated":
            header = "Manual attention required"
        if recipient_role == resident_role:
            resident_descriptions = {
                "emergency_submitted": f"Your emergency report was received near {location}.",
                "emergency_routed": f"Your emergency report is now being handled near {location} by {unit}.",
                "emergency_acknowledged": f"Your emergency report was acknowledged by {unit} near {location}.",
                "emergency_en_route": f"A responder is on the way to your emergency near {location}.",
                "emergency_nearby": f"A responder is near your emergency location at {location}.",
                "emergency_arrived": f"A responder has arrived near {location} to help with your emergency.",
                "emergency_resolved": f"Your emergency report was resolved near {location}.",
                "emergency_cancelled": "Your emergency report was cancelled.",
                "emergency_escalated": f"Your emergency report needs additional response attention near {location}.",
                "emergency_appeal_submitted": f"Your request to review the emergency report near {location} was received.",
                "emergency_appeal_approved": f"Your request to review the emergency report near {location} was approved.",
                "emergency_appeal_denied": f"Your request to review the emergency report near {location} was denied.",
                "emergency_updated": f"Your emergency report has a new update near {location}.",
            }
            description = resident_descriptions.get(
                type_value,
                f"Your emergency report has a new update near {location}.",
            )
        else:
            description = f"{emergency_type} emergency is {status.lower()} near {location}; {unit} is coordinating the response."
        return header, description

    header = _valid_header(title) or "E-Boses update"
    body = _valid_description(getattr(notification, "body", ""))
    return header, body or f"There is a new update about {header.lower()} in E-Boses."


def generate_notification_copy(notification, *, use_model: bool = True) -> tuple[tuple[str, str], str]:
    # A community alert is safety copy: always the same street and the same
    # instruction, so it never goes through the model.
    if use_model and getattr(notification, "type", "") != "witness_alert":
        generated = _model_copy(notification)
        if generated:
            return generated, "model"
    return _fallback_copy(notification), "fallback"


def refresh_notification_copy(notification, *, force: bool = False, use_model: bool = True):
    if not force:
        existing = stored_notification_copy(notification)
        if existing:
            return existing
    (header, description), source = generate_notification_copy(
        notification,
        use_model=use_model,
    )
    metadata = getattr(notification, "metadata", None)
    metadata = dict(metadata) if isinstance(metadata, dict) else {}
    metadata.update(
        {
            HEADER_KEY: header,
            DESCRIPTION_KEY: description,
            "llm_copy_version": COPY_VERSION,
            SOURCE_KEY: source,
        }
    )
    notification.metadata = metadata
    notification.save(update_fields=["metadata"])
    return header, description
