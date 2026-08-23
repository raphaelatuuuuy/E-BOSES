"""Data retention enforcement and resident erasure (PH Data Privacy Act).

Two entry points:
- enforce_retention_limits_task: nightly beat sweep deleting content whose
  retention period expired (notifications, closed-case chat, resolved media,
  old audit rows).
- process_data_subject_request_task: full erasure for an approved resident
  request — files first, then the account row; CASCADE removes every row the
  resident owns while SET_NULL audit actors keep the legal trail anonymous.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


def _delete_file_quietly(file_field) -> None:
    if not file_field:
        return
    try:
        file_field.storage.delete(file_field.name)
    except Exception:
        pass


@shared_task(name="apps.retention.enforce_retention_limits_task")
def enforce_retention_limits_task():
    from apps.accounts.models import AuditLog
    from apps.concerns.models import Concern, ConcernChatMessage, ConcernMedia
    from apps.notifications.models import Notification

    now = timezone.now()
    summary = {}

    notification_cutoff = now - timedelta(days=getattr(settings, "RETENTION_NOTIFICATION_DAYS", 180))
    summary["notifications"] = Notification.objects.filter(created_at__lt=notification_cutoff).delete()[0]

    chat_days = getattr(settings, "RETENTION_CHAT_MESSAGE_DAYS", 90)
    chat_cutoff = now - timedelta(days=chat_days)
    closed_statuses = [Concern.Status.RESOLVED, Concern.Status.REJECTED]
    stale_messages = ConcernChatMessage.objects.filter(
        concern__status__in=closed_statuses,
        concern__updated_at__lt=chat_cutoff,
    ).select_related("attachment")
    removed_messages = 0
    for message in stale_messages.iterator():
        attachment = getattr(message, "attachment", None)
        if attachment:
            _delete_file_quietly(attachment.file)
            _delete_file_quietly(attachment.preview_file)
        message.delete()
        removed_messages += 1
    summary["chat_messages"] = removed_messages

    years = getattr(settings, "RETENTION_CONCERN_MEDIA_YEARS", 2)
    media_cutoff = now - timedelta(days=365 * years)
    stale_media = ConcernMedia.objects.filter(
        concern__status__in=closed_statuses,
        concern__updated_at__lt=media_cutoff,
    )
    removed_media = 0
    for media in stale_media.iterator():
        _delete_file_quietly(media.file)
        _delete_file_quietly(media.preview_file)
        media.delete()
        removed_media += 1
    summary["concern_media"] = removed_media

    audit_years = getattr(settings, "RETENTION_AUDIT_LOG_YEARS", 5)
    audit_cutoff = now - timedelta(days=365 * audit_years)
    summary["audit_logs"] = AuditLog.objects.filter(created_at__lt=audit_cutoff).delete()[0]

    logger.info("Retention sweep: %s", summary)
    return summary


def _erase_resident_files(user) -> None:
    from apps.accounts.models import ResidenceProof
    from apps.concerns.models import ConcernChatMessage, ConcernMedia
    from apps.emergencies.models import EmergencyChatAttachment, EmergencyMedia

    def concern_media_rows():
        return ConcernMedia.objects.filter(concern__reporter=user)

    for media in concern_media_rows().iterator():
        _delete_file_quietly(media.file)
        _delete_file_quietly(media.preview_file)

    for proof in ResidenceProof.objects.filter(user=user).iterator():
        _delete_file_quietly(proof.file)
        _delete_file_quietly(proof.blurred_preview_file)

    for message in ConcernChatMessage.objects.filter(concern__reporter=user).select_related("attachment").iterator():
        attachment = getattr(message, "attachment", None)
        if attachment:
            _delete_file_quietly(attachment.file)
            _delete_file_quietly(attachment.preview_file)

    for media in EmergencyMedia.objects.filter(alert__reporter=user).iterator():
        _delete_file_quietly(media.file)
        _delete_file_quietly(media.preview_file)

    for attachment in EmergencyChatAttachment.objects.filter(message__alert__reporter=user).iterator():
        _delete_file_quietly(attachment.file)
        _delete_file_quietly(attachment.preview_file)


def erase_user_data(user_id: int) -> dict:
    """Delete a resident's personal data and anonymize their account row."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    user = User.objects.filter(pk=user_id).first()
    if not user:
        return {"user_id": user_id, "erased": False, "reason": "not_found"}

    with transaction.atomic():
        _erase_resident_files(user)
        email = user.email
        user.delete()
    logger.info("Erased account %s on approved data subject request.", email)
    return {"user_id": user_id, "erased": True}


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
    time_limit=600,
    soft_time_limit=540,
)
def process_data_subject_request_task(self, request_id):
    from apps.accounts.models import DataSubjectRequest

    request = DataSubjectRequest.objects.select_related("user", "processed_by").filter(pk=request_id).first()
    if not request or request.status != DataSubjectRequest.Status.APPROVED:
        return {"request_id": request_id, "skipped": True}

    result = erase_user_data(request.user_id)
    request.status = DataSubjectRequest.Status.COMPLETED
    request.processed_at = timezone.now()
    request.save(update_fields=["status", "processed_at"])
    return {"request_id": request_id, **result}
