"""Deliver one chat message to everyone watching an emergency.

Two audiences, two channels:

* **the app** - a WebSocket push plus a bell notification for every active
  assignment and the reporter;
* **SMS** - an offline participant through the shared E-Boses gateway number.
  The gateway is the only SMS number a user is asked to text; the server uses a
  participant's registered mobile only as the private delivery destination.

``SMS_CHAT_MIRROR_MODE`` decides when the SMS leg fires. The gateway-only mode
texts every participant whose app is disconnected, and keeps the SMS leg alive
when a resident has already replied by SMS. That is what makes "resident
replies to the gateway number, responder answers, answer arrives as an SMS from
the gateway number" hold even when the resident's app is sitting open in
someone else's hand.
"""

from django.conf import settings
from django.db import transaction
from django.contrib.auth import get_user_model

from apps.notifications.presence import is_user_online
from apps.notifications.services import (
    broadcast_emergency_chat_message,
    create_emergency_notification,
)
from apps.sms import templates as sms_templates
from apps.sms.gateway import fit_sms_segments, queue_sms
from apps.sms.models import OutboundSmsMessage, SmsPurpose

from .models import EmergencyChatMessage


def schedule_chat_message_delivery(message: EmergencyChatMessage) -> None:
    transaction.on_commit(lambda message_id=message.pk: deliver_chat_message(message_id))


def _last_resident_message(alert, *, exclude_id=None):
    queryset = alert.chat_messages.filter(sender_id=alert.reporter_id)
    if exclude_id:
        queryset = queryset.exclude(pk=exclude_id)
    return queryset.order_by("-created_at", "-id").first()


def resident_replied_by_sms(alert, *, exclude_id=None) -> bool:
    """True when the resident's latest message on this alert arrived by SMS.

    The link lives on the inbound row (``InboundSmsMessage.chat_message``), so
    this is a question about provenance, not about wording: the app never has to
    guess whether a line was typed in the app or texted in.
    """
    last = _last_resident_message(alert, exclude_id=exclude_id)
    return bool(last and last.inbound_sms_messages.exists())


def _should_text_recipient(alert, message, recipient) -> bool:
    """Whether this message also goes to one participant by gateway SMS."""
    if not recipient or message.sender_id == recipient.pk:
        return False

    mode = (getattr(settings, "SMS_CHAT_MIRROR_MODE", "gateway_only") or "").strip().lower()
    if mode == "gateway_only":
        if not is_user_online(recipient.pk):
            return True
        return (
            recipient.pk == alert.reporter_id
            and resident_replied_by_sms(alert, exclude_id=message.pk)
        )

    # The older modes intentionally only mirrored the resident. Keep them
    # available for deployments that have not opted into gateway-only chat.
    if recipient.pk != alert.reporter_id:
        return False
    if mode == "always":
        return True
    if not is_user_online(alert.reporter_id):
        return True
    if mode == "resident_used_sms":
        return resident_replied_by_sms(alert, exclude_id=message.pk)
    return False


def should_text_resident(alert, message) -> bool:
    """Backward-compatible resident-specific policy helper."""
    return _should_text_recipient(alert, message, getattr(alert, "reporter", None))


def _is_first_chat_sms(alert) -> bool:
    """Checked before queueing, so the reply hint lands on one message only."""
    return not OutboundSmsMessage.objects.filter(
        alert=alert, purpose=SmsPurpose.CHAT_UPDATE
    ).exists()


def chat_participant_ids(alert, *, exclude_user_id=None) -> set[int]:
    """Everyone who should receive a message on this alert."""
    from .views import ACTIVE_ASSIGNMENT_STATUSES

    ids = set(
        alert.assignments.filter(status__in=ACTIVE_ASSIGNMENT_STATUSES).values_list(
            "responder_id", flat=True
        )
    )
    if alert.reporter_id:
        ids.add(alert.reporter_id)
    if exclude_user_id:
        ids.discard(exclude_user_id)
    return ids


def chat_read_state_map(alert) -> dict[int, object]:
    """One query for every participant's watermark on this alert."""
    from .models import EmergencyChatReadState

    return {
        row.user_id: row for row in EmergencyChatReadState.objects.filter(alert=alert)
    }


def advance_chat_receipt(alert, user, *, through: int, state: str = "delivered"):
    """Record how far `user` has got, and tell the room when it moves.

    The broadcast is what makes the sender's ticks fill in while they are looking
    at the thread, instead of waiting for the next poll.
    """
    from .models import EmergencyChatReadState

    row, _created = EmergencyChatReadState.objects.get_or_create(alert=alert, user=user)
    if not row.advance(through=through, state=state):
        return row

    from apps.notifications.services import broadcast_emergency_chat_receipt

    broadcast_emergency_chat_receipt(alert=alert, user=user, row=row)
    return row


def _delivery_tally(message, participant_ids, read_states):
    recipients = {uid for uid in (participant_ids or set()) if uid != message.sender_id}
    read_ids: set[int] = set()
    delivered_ids: set[int] = set()
    for user_id in recipients:
        row = (read_states or {}).get(user_id)
        if row is None:
            continue
        if row.read_through_id >= message.pk:
            read_ids.add(user_id)
        elif row.delivered_through_id >= message.pk:
            delivered_ids.add(user_id)
    return recipients, read_ids, delivered_ids


def delivery_state_for(message, *, participant_ids, read_states, sms_failed: bool = False) -> str:
    """Messenger-style state for one message: sent, delivered, read or failed.

    The *minimum* state across the intended recipients, so a group thread never
    claims "read" while one responder has not opened it. `failed` is only reached
    when nothing got through on the app side and the SMS leg failed too.
    """
    recipients, read_ids, delivered_ids = _delivery_tally(message, participant_ids, read_states)
    if not recipients:
        return "sent"
    if len(read_ids) == len(recipients):
        return "read"
    if len(read_ids) + len(delivered_ids) == len(recipients):
        return "delivered"
    if not read_ids and not delivered_ids and sms_failed:
        return "failed"
    return "sent"


def delivery_counts_for(message, *, participant_ids, read_states) -> tuple[int, int]:
    """``(read_count, recipient_count)`` for "Read by 2 of 3" in a group thread."""
    recipients, read_ids, _delivered = _delivery_tally(message, participant_ids, read_states)
    return len(read_ids), len(recipients)


def chat_message_context(request, alert) -> dict:
    """Serializer context for one thread.

    Built once per request: recipients and watermarks answer delivery state for
    every message in the page, so a 30-message list costs two queries instead of
    two per message.
    """
    return {
        "request": request,
        "chat_participant_ids": chat_participant_ids(alert),
        "chat_read_states": chat_read_state_map(alert),
    }


def deliver_chat_message(message_id: int) -> None:
    from .views import ACTIVE_ASSIGNMENT_STATUSES

    message = (
        EmergencyChatMessage.objects.select_related("alert", "alert__reporter", "sender")
        .get(pk=message_id)
    )
    alert = message.alert
    recipient_ids = set(
        alert.assignments.filter(status__in=ACTIVE_ASSIGNMENT_STATUSES)
        .exclude(responder_id=message.sender_id)
        .values_list("responder_id", flat=True)
    )
    if alert.reporter_id != message.sender_id:
        recipient_ids.add(alert.reporter_id)

    User = get_user_model()
    recipients = list(User.objects.filter(
        pk__in=recipient_ids,
        is_active=True,
        status=User.Status.VERIFIED,
    ))
    # SMS-originated alerts from an unregistered number are owned by the
    # inactive anonymous-intake account. It must not receive app notifications,
    # but it still represents the phone snapshot that gateway SMS replies must
    # reach.
    from .sms_intake import is_anonymous_intake

    if alert.reporter_id in recipient_ids and is_anonymous_intake(alert.reporter):
        recipients.append(alert.reporter)
    message_preview = message.body[:240] or "New emergency chat attachment"
    for recipient in recipients:
        if not recipient.is_active:
            continue
        create_emergency_notification(
            alert=alert,
            recipient=recipient,
            type="chat_message",
            title="New emergency message",
            body=message_preview,
            event_key=f"emergency-chat:{message.pk}:{recipient.pk}",
        )

    from .contacts import resolve_reporter_number, resolve_user_number

    reply_hint_pending = _is_first_chat_sms(alert)
    for recipient in recipients:
        if not _should_text_recipient(alert, message, recipient):
            continue
        destination = (
            resolve_reporter_number(alert)
            if recipient.pk == alert.reporter_id
            else resolve_user_number(recipient)
        )
        if not destination:
            continue
        text = sms_templates.chat_update(
            alert,
            message.body,
            reply_hint=reply_hint_pending
            and bool(getattr(settings, "SMS_CHAT_REPLY_HINT", True)),
            include_reference=bool(getattr(settings, "SMS_CHAT_INCLUDE_REFERENCE", False)),
        )
        queue_sms(
            destination,
            fit_sms_segments(text),
            purpose=SmsPurpose.CHAT_UPDATE,
            idempotency_key=f"sms-v2:chat:{message.pk}:{recipient.pk}",
            alert=alert,
            recipient=recipient,
            chat_message=message,
        )
        reply_hint_pending = False

    broadcast_emergency_chat_message(message)
