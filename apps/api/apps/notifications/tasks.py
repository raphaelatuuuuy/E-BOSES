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
    import logging
    from .models import Notification
    from .services import broadcast_notification

    logger = logging.getLogger(__name__)
    logger.warning("deliver_notification_task START notification_id=%s", notification_id)
    notification = Notification.objects.select_related("recipient", "emergency", "concern").filter(
        pk=notification_id
    ).first()
    if not notification:
        logger.warning("deliver_notification_task SKIP notification_id=%s not_found", notification_id)
        return {"notification_id": notification_id, "skipped": True, "skip_reason": "not_found"}
    logger.warning(
        "deliver_notification_task recipient=%s type=%s emergency=%s",
        notification.recipient_id,
        notification.type,
        notification.emergency_id,
    )
    push_result = broadcast_notification(notification)
    logger.warning(
        "deliver_notification_task DONE notification_id=%s push_status=%s",
        notification_id,
        (push_result or {}).get("status"),
    )
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


@shared_task(time_limit=120, soft_time_limit=90)
def retry_notification_delivery(notification_id):
    """Retry push delivery for a notification that failed or was never delivered."""
    from .models import Notification
    from .services import broadcast_notification

    notification = Notification.objects.filter(pk=notification_id).first()
    if not notification:
        return {"notification_id": notification_id, "skipped": True, "reason": "not_found"}
    push_result = broadcast_notification(notification)
    return {"notification_id": notification_id, "push_status": push_result.get("status")}


@shared_task(time_limit=30, soft_time_limit=20)
def find_stuck_notifications(hours=24, limit=100):
    """Find notifications created but never delivered a push."""
    from django.utils import timezone

    from .models import Notification

    cutoff = timezone.now() - timezone.timedelta(hours=hours)
    stuck = list(
        Notification.objects.filter(
            created_at__lt=cutoff,
            push_status__in=("", "failed"),
        )
        .order_by("-created_at")[:max(1, limit)]
        .values("id", "type", "created_at", "push_status", "recipient_id")
    )
    return {"stuck_count": len(stuck), "notifications": stuck}
