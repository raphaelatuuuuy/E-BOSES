from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.notifications.services import create_user_notification

from .models import Announcement


def announcement_is_active(announcement: Announcement, *, now=None) -> bool:
    current = now or timezone.now()
    if not announcement.is_published:
        return False
    if announcement.starts_at and announcement.starts_at > current:
        return False
    if announcement.expires_at and announcement.expires_at <= current:
        return False
    return True


def notify_announcement_published(announcement: Announcement) -> int:
    User = get_user_model()
    role_by_audience = {
        Announcement.Audience.RESIDENTS: [User.Role.RESIDENT],
        Announcement.Audience.RESPONDERS: [User.Role.FIRST_RESPONDER],
        Announcement.Audience.OFFICIALS: [User.Role.BARANGAY_OFFICIAL],
        Announcement.Audience.ALL: [User.Role.RESIDENT, User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL],
    }
    recipients = User.objects.filter(
        status=User.Status.VERIFIED,
        role__in=role_by_audience.get(announcement.audience, role_by_audience[Announcement.Audience.ALL]),
    )
    count = 0
    metadata = {
        "announcement_id": announcement.pk,
        "tag": announcement.tag,
        "urgency": announcement.urgency,
        "audience": announcement.audience,
        "barangay": announcement.barangay,
        "image_url": announcement.image.url if announcement.image else "",
        "action_url": "/dashboard/notifications?type=announcements",
        "actions": [
            {
                "action": "open",
                "title": "View announcement",
                "url": "/dashboard/notifications?type=announcements",
            }
        ],
    }
    for recipient in recipients.iterator():
        create_user_notification(
            recipient=recipient,
            type="announcement",
            title=announcement.title,
            body=announcement.body[:240],
            metadata=metadata,
        )
        count += 1
    return count


def mark_announcement_published(announcement: Announcement) -> Announcement:
    changed = []
    if announcement.is_published and not announcement.published_at:
        announcement.published_at = timezone.now()
        changed.append("published_at")
    if changed:
        announcement.save(update_fields=[*changed, "updated_at"])
    return announcement


def dispatch_due_announcements(*, now=None) -> int:
    current = now or timezone.now()
    sent = 0
    with transaction.atomic():
        due = (
            Announcement.objects.select_for_update()
            .filter(is_published=True, notification_sent_at__isnull=True)
            .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=current))
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=current))
            .order_by("starts_at", "published_at", "id")
        )
        for announcement in due:
            if not announcement_is_active(announcement, now=current):
                continue
            notify_announcement_published(announcement)
            announcement.notification_sent_at = current
            if not announcement.published_at:
                announcement.published_at = current
            announcement.save(update_fields=["notification_sent_at", "published_at", "updated_at"])
            sent += 1
    return sent
