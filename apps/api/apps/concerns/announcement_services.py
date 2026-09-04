from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.notifications.models import Notification

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
    roles = role_by_audience.get(announcement.audience, role_by_audience[Announcement.Audience.ALL])
    target_department_ids = list(announcement.target_departments.values_list("id", flat=True))
    community_filter = Q()
    if User.Role.RESIDENT in roles:
        community_filter |= Q(role=User.Role.RESIDENT, resident_profile__community_id=announcement.community_id)
    staff_roles = [role for role in roles if role != User.Role.RESIDENT]
    if staff_roles:
        staff_filter = Q(
            role__in=staff_roles,
            designations__is_active=True,
            designations__department__community_id=announcement.community_id,
        )
        if target_department_ids:
            staff_filter &= Q(designations__department_id__in=target_department_ids)
        community_filter |= staff_filter
    recipient_ids = list(
        User.objects.filter(status=User.Status.VERIFIED, is_active=True)
        .filter(community_filter)
        .distinct()
        .values_list("id", flat=True)
    )
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
    # One bulk INSERT for the whole audience instead of one INSERT plus one
    # broker message per resident — a barangay-wide publish used to cost
    # thousands of queries inside the request thread.
    rows = [
        Notification(
            recipient_id=recipient_id,
            community=announcement.community,
            type=Notification.Type.ANNOUNCEMENT,
            title=announcement.title,
            body=announcement.body[:240],
            metadata=metadata,
        )
        for recipient_id in recipient_ids
    ]
    Notification.objects.bulk_create(rows, batch_size=500)
    _deliver_after_commit([row.pk for row in rows])
    return len(rows)


def _deliver_after_commit(notification_ids) -> None:
    from apps.notifications.tasks import deliver_notifications_batch_task

    def _deliver():
        from django.conf import settings

        # Match individual notification delivery: a local API may have Redis
        # and only the ``heavy`` worker running. In that setup ``delay()``
        # succeeds but no worker consumes the default notification queue.
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False) and not getattr(
            settings, "IS_TEST_RUN", False
        ):
            deliver_notifications_batch_task.run(notification_ids)
            return
        try:
            deliver_notifications_batch_task.delay(notification_ids)
        except Exception as exc:
            if getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
                deliver_notifications_batch_task.run(notification_ids)
            else:
                import logging

                logging.getLogger(__name__).error(
                    "Broker unavailable; %s announcement notifications deferred (%s).",
                    len(notification_ids),
                    exc.__class__.__name__,
                )

    transaction.on_commit(_deliver)


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
