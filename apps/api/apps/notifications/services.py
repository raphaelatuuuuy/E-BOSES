"""Domain services for notification creation and delivery orchestration."""

import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import transaction

from apps.concerns.models import Concern


def _notification_title(concern: Concern) -> str:
    return concern.title or "Untitled Report"


def _notification_body(concern: Concern, status: str) -> str:
    status_events = list(concern.status_events.filter(status=status).order_by("-created_at")[:1])
    if status_events and status_events[0].note:
        return status_events[0].note
    return f"Your report status has been updated to {status}."


def _report_updates_enabled(concern: Concern) -> bool:
    settings_obj = getattr(concern.reporter, "resident_settings", None)
    return settings_obj is None or settings_obj.report_updates


def _push_alerts_enabled(user) -> bool:
    settings_obj = getattr(user, "resident_settings", None)
    return settings_obj is None or settings_obj.push_alerts


def _broadcast(group_name: str, event_type: str, payload: dict) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                "type": event_type,
                "payload": payload,
            },
        )
    except Exception:
        # WebSocket delivery is a live enhancement; REST responses and polling fallback must keep working.
        return


def broadcast_notification(notification) -> None:
    from .serializers import NotificationSerializer

    payload = NotificationSerializer(notification).data
    _broadcast(f"user_{notification.recipient_id}", "notification.created", payload)
    send_browser_push(notification, payload)

def notification_url(notification) -> str:
    if notification.emergency_id:
        return "/dashboard/emergencies"
    if notification.concern_id:
        return f"/dashboard/reports/{notification.concern_id}"
    return "/dashboard"

def send_browser_push(notification, payload: dict | None = None) -> None:
    public_key = getattr(settings, "WEB_PUSH_PUBLIC_KEY", "")
    private_key = getattr(settings, "WEB_PUSH_PRIVATE_KEY", "")
    if not public_key or not private_key:
        return
    try:
        from pywebpush import WebPushException, webpush
    except Exception:
        return

    payload = payload or {}
    data = json.dumps({
        "title": notification.title,
        "body": notification.body,
        "url": notification_url(notification),
        "notification": payload,
    })
    claims = {"sub": getattr(settings, "WEB_PUSH_SUBJECT", "mailto:admin@example.com")}
    for subscription in notification.recipient.browser_push_subscriptions.filter(is_active=True):
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=data,
                vapid_private_key=private_key,
                vapid_claims=claims,
            )
        except WebPushException as exc:
            if getattr(exc, "response", None) and exc.response.status_code in {404, 410}:
                subscription.is_active = False
                subscription.save(update_fields=["is_active", "updated_at"])
        except Exception:
            continue


def broadcast_emergency_update(alert) -> None:
    from apps.emergencies.serializers import EmergencyAlertSerializer

    payload = EmergencyAlertSerializer(alert).data
    _broadcast(f"emergency_{alert.pk}", "emergency.update", payload)


@transaction.atomic
def create_notification(*, concern: Concern, type: str) -> object | None:
    """Create a notification for the report's reporter."""
    from .models import Notification

    if not _report_updates_enabled(concern):
        return None

    notification = Notification.objects.create(
        recipient=concern.reporter,
        concern=concern,
        type=type,
        title=_notification_title(concern),
        body=_notification_body(concern, type),
    )
    transaction.on_commit(lambda: broadcast_notification(notification))
    return notification


@transaction.atomic
def create_emergency_notification(*, alert, type: str, recipient=None, title: str = "", body: str = "") -> object | None:
    """Create a notification for an emergency participant."""
    from .models import Notification

    recipient = recipient or alert.reporter
    if not _push_alerts_enabled(recipient):
        return None

    notification = Notification.objects.create(
        recipient=recipient,
        emergency=alert,
        type=type,
        title=title or f"Emergency alert #{alert.pk}",
        body=body or f"Emergency status updated to {alert.status.replace('_', ' ')}.",
    )
    transaction.on_commit(lambda: broadcast_notification(notification))
    return notification


def notify_emergency_status(alert, *, type: str, body: str = "") -> None:
    from .models import Notification

    type_map = {
        "submitted": Notification.Type.EMERGENCY_SUBMITTED,
        "routed": Notification.Type.EMERGENCY_ROUTED,
        "acknowledged": Notification.Type.EMERGENCY_ACKNOWLEDGED,
        "en_route": Notification.Type.EMERGENCY_EN_ROUTE,
        "arrived": Notification.Type.EMERGENCY_ARRIVED,
        "resolved": Notification.Type.EMERGENCY_RESOLVED,
        "cancelled": Notification.Type.EMERGENCY_CANCELLED,
    }
    notification_type = type_map.get(type)
    if notification_type:
        create_emergency_notification(alert=alert, type=notification_type, body=body)
    broadcast_emergency_update(alert)


def notify_status_change(concern: Concern) -> None:
    """Create an appropriate notification when a concern's status changes."""
    from .models import Notification

    type_map = {
        Concern.Status.SUBMITTED: Notification.Type.SUBMITTED,
        Concern.Status.UNDER_REVIEW: Notification.Type.UNDER_REVIEW,
        Concern.Status.IN_PROGRESS: Notification.Type.ASSIGNED,
        Concern.Status.RESOLVED: Notification.Type.RESOLVED,
        Concern.Status.REJECTED: Notification.Type.REJECTED,
    }
    notif_type = type_map.get(concern.status)
    if notif_type:
        create_notification(concern=concern, type=notif_type)
