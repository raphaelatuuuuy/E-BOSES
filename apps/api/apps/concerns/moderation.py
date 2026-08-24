"""Shared takedown logic for a ContentFlag, whatever kind of content it targets.

`ContentFlagReviewView` (a human official's decision) and
`run_content_moderation_ai_task` (the automatic moderation task) both act on a
flag once a takedown is decided — the only difference is who decided it. This
module is that one place, so the two callers cannot drift into different
behavior for the same `target_kind`.

`execute_takedown` never touches `flag.status` / `flag.reviewed_by` /
`flag.staff_note` / `flag.auto_moderated` itself — each caller sets those on
the flag the way its own flow requires, before or after calling this.
"""

from django.db import transaction
from django.utils import timezone

from .models import AnnouncementComment, Concern, ConcernComment, ConcernTimelineEntry


def execute_takedown(flag, staff_note, *, actor=None, request=None):
    """Act on whatever `flag.target_kind` is.

    `actor=None` means an automatic (no human reviewer) action. `request` is
    optional and used only for the concern-post branch's live-map broadcast
    context, matching today's behavior — pass None for automated calls.
    """
    target_kind = flag.target_kind
    if target_kind == "concern":
        _take_down_concern(flag, staff_note, actor=actor)
    elif target_kind == "concern_comment":
        _take_down_comment(flag, staff_note, comment=flag.comment, status_choices=ConcernComment.Status)
    elif target_kind == "announcement_comment":
        _take_down_comment(
            flag, staff_note, comment=flag.announcement_comment, status_choices=AnnouncementComment.Status
        )
    elif target_kind == "emergency_comment":
        from apps.emergencies.models import EmergencyCommunityComment

        _take_down_comment(
            flag, staff_note, comment=flag.emergency_comment, status_choices=EmergencyCommunityComment.Status
        )


def _take_down_concern(flag, staff_note, *, actor):
    from apps.notifications.models import Notification
    from apps.notifications.services import broadcast_live_map_event, create_user_notification

    concern = flag.concern
    concern.status = Concern.Status.REJECTED
    concern.rejection_code = "content_violation"
    concern.status_version += 1
    concern.update_text = staff_note[:255]
    concern.archived_at = timezone.now()
    concern.save(
        update_fields=[
            "status",
            "rejection_code",
            "status_version",
            "update_text",
            "archived_at",
            "updated_at",
        ]
    )
    reason_label = flag.get_reason_display()
    ConcernTimelineEntry.objects.create(
        concern=concern,
        event_type=ConcernTimelineEntry.EventType.STATUS_CHANGE,
        status=Concern.Status.REJECTED,
        message=f"Post taken down due to a content violation ({reason_label}). {staff_note}",
        actor=actor,
        visible_to_resident=True,
        is_custom=False,
        metadata={},
    )
    body = (
        f"Your report was taken down because it was flagged as {reason_label}. "
        f"Official note: {staff_note}\nYou can appeal this decision."
    )
    create_user_notification(
        recipient=concern.reporter,
        concern=concern,
        type=Notification.Type.POST_TAKEN_DOWN,
        title="Post taken down",
        body=body,
    )
    if flag.reporter_id != concern.reporter_id:
        create_user_notification(
            recipient=flag.reporter,
            concern=concern,
            type=Notification.Type.POST_TAKEN_DOWN,
            title="Flag acted on",
            body=(
                f"The post you flagged as {reason_label} has been removed. "
                f"Official note: {staff_note}"
            ),
        )
    # Push the updated concern so open feeds hide the post without a reload.
    from apps.live_map import concern_payload

    from .views import decorate_concerns

    decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), actor)[0]
    transaction.on_commit(
        lambda: broadcast_live_map_event("concern.updated", {"concern": concern_payload(decorated)})
    )


def _take_down_comment(flag, staff_note, *, comment, status_choices):
    from apps.notifications.models import Notification
    from apps.notifications.services import create_user_notification

    comment.status = status_choices.REMOVED
    comment.moderation_note = staff_note
    comment.save(update_fields=["status", "moderation_note", "updated_at"])

    reason_label = flag.get_reason_display()
    create_user_notification(
        recipient=comment.author,
        concern=flag.concern,
        type=Notification.Type.COMMENT_TAKEN_DOWN,
        title="Comment removed",
        body=f"Your comment was removed because it was flagged as {reason_label}. {staff_note}",
    )
    if flag.reporter_id != comment.author_id:
        create_user_notification(
            recipient=flag.reporter,
            concern=flag.concern,
            type=Notification.Type.COMMENT_TAKEN_DOWN,
            title="Flag acted on",
            body=(
                f"The comment you flagged as {reason_label} has been removed. "
                f"Official note: {staff_note}"
            ),
        )
