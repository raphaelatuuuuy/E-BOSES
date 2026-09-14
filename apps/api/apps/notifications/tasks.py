from celery import shared_task


@shared_task(time_limit=120, soft_time_limit=90)
def generate_notification_copy_task(notification_id, force=False):
    """Persist compact model copy before a notification is delivered."""
    from .models import Notification
    from .notification_copy import refresh_notification_copy

    notification = Notification.objects.select_related(
        "recipient",
        "recipient__resident_profile",
        "concern",
        "concern__community",
        "concern__assigned_department",
        "emergency",
        "emergency__community",
        "community",
        "department",
    ).filter(pk=notification_id).first()
    if not notification:
        return {"notification_id": notification_id, "skipped": True}
    refresh_notification_copy(notification, force=force)
    return {"notification_id": notification_id, "skipped": False}


@shared_task(time_limit=600, soft_time_limit=540)
def generate_notification_copies_batch_task(notification_ids, force=False, use_model=True):
    """Generate one copy per distinct notification event in a fan-out."""
    from .models import Notification
    from .notification_copy import COPY_VERSION, notification_copy_key, refresh_notification_copy

    notifications = Notification.objects.select_related(
        "recipient",
        "recipient__resident_profile",
        "concern",
        "concern__community",
        "concern__assigned_department",
        "emergency",
        "emergency__community",
        "community",
        "department",
    ).filter(pk__in=notification_ids)
    generated = {}
    updated = 0
    for notification in notifications:
        metadata = notification.metadata if isinstance(notification.metadata, dict) else {}
        key = notification_copy_key(notification)
        if key in generated:
            header, description = generated[key]
            notification.metadata = {
                **metadata,
                "llm_header": header,
                "llm_description": description,
                "llm_copy_version": COPY_VERSION,
                "llm_copy_source": "model",
            }
            notification.save(update_fields=["metadata"])
        else:
            generated[key] = refresh_notification_copy(
                notification,
                force=force,
                use_model=use_model,
            )
        updated += 1
    return {"requested": len(notification_ids), "updated": updated, "unique_events": len(generated)}


@shared_task(time_limit=120, soft_time_limit=90)
def deliver_notification_task(notification_id):
    """Deliver one notification: WebSocket broadcast + browser push fan-out.

    pywebpush blocks up to 15 s per subscription and witness alerts can target
    dozens of residents, so this runs in a worker instead of inside the request
    that created the notification.
    """
    from .models import Notification
    from .services import broadcast_notification

    notification = Notification.objects.select_related("recipient", "emergency", "concern").filter(
        pk=notification_id
    ).first()
    if not notification:
        return {"notification_id": notification_id, "skipped": True, "skip_reason": "not_found"}
    push_result = broadcast_notification(notification)
    return {
        "notification_id": notification_id,
        "push_status": (push_result or {}).get("status"),
    }


@shared_task(time_limit=600, soft_time_limit=540)
def deliver_notifications_batch_task(notification_ids):
    """Deliver a fan-out (e.g. one announcement to every resident) as ONE task.

    Enqueueing a separate task per recipient turned an announcement publish
    into hundreds of broker messages and hundreds of request-thread inserts.
    """
    delivered = 0
    for notification_id in notification_ids:
        try:
            deliver_notification_task.run(notification_id)
            delivered += 1
        except Exception:
            continue
    return {"requested": len(notification_ids), "delivered": delivered}
