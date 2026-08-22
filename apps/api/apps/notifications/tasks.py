from celery import shared_task


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
