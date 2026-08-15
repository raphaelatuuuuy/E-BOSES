"""Completing account deletions without an official in the loop.

A resident asking to leave does not need permission, but anonymising cannot be
undone — so the request waits out a grace period they can withdraw within, and
this finishes it afterwards. Open reports and live emergencies still block it;
those clear on their own schedule and there is no review screen left to notice,
so this keeps checking.
"""

from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.accounts.models import AccountRequest
from apps.accounts.privacy_services import anonymize_resident_account, deletion_blockers


@shared_task(name="apps.accounts.privacy_tasks.complete_unblocked_deletions_task")
def complete_unblocked_deletions_task():
    grace_days = getattr(settings, "ACCOUNT_DELETION_GRACE_DAYS", 7)
    cutoff = timezone.now() - timedelta(days=grace_days)
    pending = AccountRequest.objects.filter(
        type=AccountRequest.Type.DELETION,
        status__in=[AccountRequest.Status.SUBMITTED, AccountRequest.Status.REVIEWED],
        created_at__lte=cutoff,
    ).select_related("user")

    examined = 0
    completed = 0
    for request in pending:
        examined += 1
        if request.user is None:
            continue
        blockers = deletion_blockers(request.user)
        if blockers["blocked"]:
            note = " ".join(blockers["reasons"])
            if note != request.staff_note:
                request.staff_note = note
                request.save(update_fields=["staff_note", "updated_at"])
            continue
        anonymize_resident_account(request.user)
        request.status = AccountRequest.Status.COMPLETED
        request.staff_note = "Completed automatically: account anonymised once nothing blocked it."
        request.save(update_fields=["status", "staff_note", "updated_at"])
        completed += 1

    return {"examined": examined, "completed": completed}
