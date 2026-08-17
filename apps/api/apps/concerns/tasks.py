import logging
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime


logger = logging.getLogger(__name__)

RUN_LEASE = timedelta(minutes=4)


@dataclass(frozen=True)
class _RunClaim:
    assessment_id: int
    run_id: str
    attempt_count: int
    started_at: str
    last_failure: dict | None
    skip_reason: str = ""


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(OSError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 2},
    time_limit=180,
    soft_time_limit=120,
)
def process_concern_ai_task(self, concern_id):
    from .ai import process_concern_ai
    from .ai.pipeline import StaleAiRun

    request_id = getattr(getattr(self, "request", None), "id", None)
    claim = _claim_run(concern_id, request_id or uuid4().hex)
    if claim.skip_reason:
        from .models import ConcernAiAssessment

        assessment = ConcernAiAssessment.objects.get(pk=claim.assessment_id)
        return {
            "concern_id": concern_id,
            "assessment_id": assessment.pk,
            "status": assessment.status,
            "skipped": True,
            "skip_reason": claim.skip_reason,
        }

    try:
        assessment = process_concern_ai(concern_id, expected_run_id=claim.run_id)
    except StaleAiRun:
        from .models import ConcernAiAssessment

        assessment = ConcernAiAssessment.objects.get(pk=claim.assessment_id)
        return {
            "concern_id": concern_id,
            "assessment_id": assessment.pk,
            "status": assessment.status,
            "skipped": True,
            "skip_reason": "lease_replaced",
        }
    except Exception as exc:
        if not _record_failure(claim, exc):
            from .models import ConcernAiAssessment

            assessment = ConcernAiAssessment.objects.get(pk=claim.assessment_id)
            return {
                "concern_id": concern_id,
                "assessment_id": assessment.pk,
                "status": assessment.status,
                "skipped": True,
                "skip_reason": "lease_replaced",
            }
        raise

    assessment, completion_recorded = _record_completion(claim, assessment.pk)
    return {
        "concern_id": concern_id,
        "assessment_id": assessment.pk,
        "status": assessment.status,
        "skipped": not completion_recorded,
        **({"skip_reason": "lease_replaced"} if not completion_recorded else {}),
    }


@transaction.atomic
def _claim_run(concern_id: int, run_id: str) -> _RunClaim:
    from .models import ConcernAiAssessment

    assessment, _ = ConcernAiAssessment.objects.select_for_update().get_or_create(
        concern_id=concern_id,
        defaults={"status": ConcernAiAssessment.Status.PENDING},
    )
    raw_result = dict(assessment.raw_result or {})
    previous = dict(raw_result.get("execution") or {})

    if assessment.status == ConcernAiAssessment.Status.COMPLETED:
        return _RunClaim(assessment.pk, run_id, 0, "", None, "already_completed")

    previous_started_at = parse_datetime(previous.get("started_at") or "")
    running_elsewhere = (
        previous.get("state") == "running"
        and previous.get("run_id") != run_id
        and previous_started_at is not None
        and timezone.now() - previous_started_at < RUN_LEASE
    )
    if running_elsewhere:
        return _RunClaim(assessment.pk, run_id, 0, "", None, "already_running")

    attempt_count = max(0, int(previous.get("attempt_count") or 0)) + 1
    last_failure = previous.get("last_failure")
    started_at = timezone.now().isoformat()
    execution = {
        "state": "running",
        "run_id": run_id,
        "attempt_count": attempt_count,
        "started_at": started_at,
        "finished_at": None,
        "result_status": None,
        "recovered_from_failure": False,
    }
    if last_failure:
        execution["last_failure"] = last_failure
    raw_result["execution"] = execution
    assessment.status = ConcernAiAssessment.Status.PENDING
    assessment.raw_result = raw_result
    assessment.save(update_fields=["status", "raw_result", "updated_at"])
    return _RunClaim(
        assessment_id=assessment.pk,
        run_id=run_id,
        attempt_count=attempt_count,
        started_at=started_at,
        last_failure=last_failure,
    )


@transaction.atomic
def _record_completion(claim: _RunClaim, assessment_id: int):
    from .models import ConcernAiAssessment

    assessment = ConcernAiAssessment.objects.select_for_update().get(pk=assessment_id)
    raw_result = dict(assessment.raw_result or {})
    current_execution = dict(raw_result.get("execution") or {})
    if current_execution.get("run_id") != claim.run_id:
        return assessment, False
    execution = {
        "state": "finished",
        "run_id": claim.run_id,
        "attempt_count": claim.attempt_count,
        "started_at": claim.started_at,
        "finished_at": timezone.now().isoformat(),
        "result_status": assessment.status,
        "recovered_from_failure": bool(claim.last_failure),
    }
    if claim.last_failure:
        execution["last_failure"] = claim.last_failure
    raw_result["execution"] = execution
    assessment.raw_result = raw_result
    assessment.save(update_fields=["raw_result", "updated_at"])
    transaction.on_commit(lambda assessment_id=assessment.pk: broadcast_concern_ai_update(assessment_id))
    return assessment, True


@transaction.atomic
def _record_failure(claim: _RunClaim, exc: Exception):
    from .models import ConcernAiAssessment

    assessment = ConcernAiAssessment.objects.select_for_update().get(pk=claim.assessment_id)
    raw_result = dict(assessment.raw_result or {})
    current_execution = dict(raw_result.get("execution") or {})
    if current_execution.get("run_id") != claim.run_id:
        return False
    failure = {
        "error_type": exc.__class__.__name__,
        "retryable": isinstance(exc, (OSError, TimeoutError)),
        "failed_at": timezone.now().isoformat(),
    }
    raw_result["execution"] = {
        "state": "failed",
        "run_id": claim.run_id,
        "attempt_count": claim.attempt_count,
        "started_at": claim.started_at,
        "finished_at": failure["failed_at"],
        "result_status": ConcernAiAssessment.Status.FAILED,
        "recovered_from_failure": False,
        "last_failure": failure,
    }
    assessment.status = ConcernAiAssessment.Status.FAILED
    assessment.raw_result = raw_result
    assessment.save(update_fields=["status", "raw_result", "updated_at"])
    transaction.on_commit(lambda assessment_id=assessment.pk: broadcast_concern_ai_update(assessment_id))
    return True


def broadcast_concern_ai_update(assessment_id: int) -> None:
    """Emit privacy-limited map refresh plus a dedicated official AI event."""
    from apps.live_map import concern_payload
    from apps.notifications.services import broadcast_live_map_event

    from .models import ConcernAiAssessment

    assessment = ConcernAiAssessment.objects.select_related(
        "concern",
        "concern__reporter",
        "concern__reporter__resident_profile",
    ).get(pk=assessment_id)
    concern = assessment.concern
    broadcast_live_map_event("concern.updated", {"concern": concern_payload(concern)})
    broadcast_live_map_event(
        "concern.ai_assessment.updated",
        {
            "concern_id": concern.pk,
            "assessment": {
                "id": assessment.pk,
                "status": assessment.status,
                "category_match": assessment.category_match,
                "recommendation": assessment.recommendation,
                "model_version": assessment.model_version,
                "flagged": assessment.flagged,
                "flag_reasons": assessment.flag_reasons,
                "updated_at": assessment.updated_at.isoformat(),
            },
        },
    )


def _current_classification_configuration():
    from .models import ConcernClassificationConfiguration

    try:
        return ConcernClassificationConfiguration.current()
    except Exception:
        return None


def enqueue_concern_ai(concern_id):
    """Queue assessment, with a local fallback when no broker is reachable."""
    try:
        return process_concern_ai_task.delay(concern_id)
    except Exception as exc:
        logger.warning(
            "Concern AI queue unavailable for concern_id=%s (%s); processing inline.",
            concern_id,
            exc.__class__.__name__,
        )
        # Use the same claimed/idempotent execution path as a worker so local
        # fallback runs retain attempt, failure, and recovery evidence too.
        return process_concern_ai_task.run(concern_id)


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(OSError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 2},
    time_limit=180,
    soft_time_limit=150,
)
def process_concern_media_privacy_task(self, media_id, force=False):
    """Run SAM3 + OpenCV for one image, after Gemma has asked for a scan.

    Separate from the assessment task on purpose. Roboflow is a third-party
    round trip on top of a Gemma round trip, and putting both inside one task
    means a slow segmentation call can time out an assessment that already
    succeeded. Splitting them also makes QUEUED → PROCESSING → terminal a real,
    observable sequence rather than three values a single function passes
    through.
    """
    from .ai.privacy import process_media_privacy
    from .models import ConcernMedia

    claimed = _claim_media_privacy(media_id, force=force)
    if claimed is None:
        return {"media_id": media_id, "skipped": True, "skip_reason": "already_running_or_done"}

    media = ConcernMedia.objects.get(pk=media_id)
    try:
        media = process_media_privacy(
            media,
            requested_classes=list(media.privacy_requested_classes or []),
            force=bool(force),
        )
    except Exception:
        # Never leave a row stuck in PROCESSING: that state reads as "in
        # progress" forever in the UI and blocks the next claim.
        ConcernMedia.objects.filter(pk=media_id, privacy_state=ConcernMedia.PrivacyState.PROCESSING).update(
            privacy_state=ConcernMedia.PrivacyState.FAILED_RESTRICTED,
            public_visible=False,
            privacy_failure={"reason": "privacy_task_crashed", "at": timezone.now().isoformat()},
            privacy_processed_at=timezone.now(),
        )
        raise

    transaction.on_commit(lambda: broadcast_media_privacy_update(media_id))
    return {
        "media_id": media_id,
        "privacy_state": media.privacy_state,
        "public_visible": media.public_visible,
        "skipped": False,
    }


@transaction.atomic
def _claim_media_privacy(media_id: int, *, force: bool):
    """Take the row if nobody else is working on it.

    Cheaper than the assessment's run-lease bookkeeping because the state field
    is itself the lease: only QUEUED (or anything at all, when an official asks
    for a re-run) is claimable.
    """
    from .models import ConcernMedia

    media = ConcernMedia.objects.select_for_update().filter(pk=media_id).first()
    if media is None:
        return None
    if not force and media.privacy_state != ConcernMedia.PrivacyState.QUEUED:
        return None
    media.privacy_state = ConcernMedia.PrivacyState.PROCESSING
    media.public_visible = False
    media.save(update_fields=["privacy_state", "public_visible"])
    return media.pk


def enqueue_concern_media_privacy(media_id, *, force=False):
    """Queue privacy processing, with the same inline fallback as the assessment."""
    try:
        return process_concern_media_privacy_task.delay(media_id, force=force)
    except Exception as exc:
        logger.warning(
            "Concern media privacy queue unavailable for media_id=%s (%s); processing inline.",
            media_id,
            exc.__class__.__name__,
        )
        return process_concern_media_privacy_task.run(media_id, force=force)


def broadcast_media_privacy_update(media_id: int) -> None:
    """Tell an open Details pane that a photo's privacy state moved."""
    from apps.notifications.services import broadcast_live_map_event

    from .models import ConcernMedia

    media = ConcernMedia.objects.select_related("concern").filter(pk=media_id).first()
    if media is None:
        return
    broadcast_live_map_event(
        "concern.media_privacy.updated",
        {
            "concern_id": media.concern_id,
            "media": {
                "id": media.pk,
                "privacy_state": media.privacy_state,
                "public_visible": media.public_visible,
            },
        },
    )
