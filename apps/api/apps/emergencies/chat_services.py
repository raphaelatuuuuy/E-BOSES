from django.db import transaction
from django.contrib.auth import get_user_model

from apps.notifications.presence import is_user_online
from apps.notifications.services import (
    broadcast_emergency_chat_message,
    create_emergency_notification,
)
from apps.sms.gateway import fit_sms_segments, queue_sms
from apps.sms.models import SmsPurpose

from .models import EmergencyChatMessage


def schedule_chat_message_delivery(message: EmergencyChatMessage) -> None:
    transaction.on_commit(lambda message_id=message.pk: deliver_chat_message(message_id))


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
    recipients = User.objects.filter(
        pk__in=recipient_ids,
        is_active=True,
        status=User.Status.VERIFIED,
    )
    message_preview = message.body[:240] or "New emergency chat attachment"
    for recipient in recipients:
        create_emergency_notification(
            alert=alert,
            recipient=recipient,
            type="chat_message",
            title="New emergency message",
            body=message_preview,
            event_key=f"emergency-chat:{message.pk}:{recipient.pk}",
        )

    if message.sender_id != alert.reporter_id and not is_user_online(alert.reporter_id):
        destination = (alert.reporter_contact_number or getattr(alert.reporter, "phone_number", "")).strip()
        if destination:
            text = fit_sms_segments(f"E-BOSES {alert.tracking_id}: {message.body or 'New emergency chat attachment'}")
            queue_sms(
                destination,
                text,
                purpose=SmsPurpose.CHAT_UPDATE,
                idempotency_key=f"sms-v2:chat:{message.pk}:{alert.reporter_id}",
                alert=alert,
                recipient=alert.reporter,
                chat_message=message,
            )

    broadcast_emergency_chat_message(message)
