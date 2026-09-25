import logging
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime


logger = logging.getLogger(__name__)

RUN_LEASE = timedelta(minutes=4)

# How long a row must sit unworked before the recovery sweep requeues it. Must
# exceed RUN_LEASE so a live worker is never racing the sweeper for the same job.
RECOVERY_STALE_AFTER = timedelta(minutes=6)


def _inline_fallback_allowed() -> bool:
    """Inline execution only where no Celery worker exists (local dev/tests).

    In production a broker outage used to fall back to running whole Gemma +
    SAM3 pipelines inside the request thread — minutes-long hangs under Daphne's
    shared executor. Production rows stay in their queue state instead and the
    recovery beat task picks them up once the broker is back.
    """
    return bool(getattr(settings, "IS_LOCAL_DEVELOPMENT", False))


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
    from .models import Concern, ConcernAiAssessment

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
    Concern.objects.filter(pk=assessment.concern_id).update(
        assigned_department=None,
        validation_status=Concern.ValidationStatus.PENDING,
        validation_summary=(
            "Automated review could not be completed. Your report has not been assigned "
            "to a unit yet and is waiting for review."
        ),
        update_text="Waiting for validation before routing.",
        updated_at=timezone.now(),
    )
    from .models import ConcernAssignment

    ConcernAssignment.objects.filter(
        concern_id=assessment.concern_id,
        status=ConcernAssignment.Status.ACTIVE,
    ).update(status=ConcernAssignment.Status.CANCELLED, updated_at=timezone.now())
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


def enqueue_concern_ai(concern_id):
    """Queue the assessment without ever blocking the request thread.

    The old fallback ran the whole Gemma + SAM3 pipeline inline whenever the
    broker was unreachable, turning a broker blip into a minutes-long request
    hang. The row stays in its queue state; `retry_pending_concern_jobs_task`
    requeues it once the broker is back.
    """
    from .models import ConcernAiAssessment

    try:
        return process_concern_ai_task.delay(concern_id)
    except Exception as exc:
        if _inline_fallback_allowed():
            logger.warning(
                "Concern AI queue unavailable for concern_id=%s (%s); processing inline (dev).",
                concern_id,
                exc.__class__.__name__,
            )
            return process_concern_ai_task.run(concern_id)
        logger.error(
            "Concern AI queue unavailable for concern_id=%s (%s); left PENDING for recovery sweep.",
            concern_id,
            exc.__class__.__name__,
        )
        from .models import Concern

        Concern.objects.filter(pk=concern_id).update(
            assigned_department=None,
            validation_status=Concern.ValidationStatus.PENDING,
            validation_summary=(
                "Automated review is temporarily unavailable. Your report has not been "
                "assigned to a unit yet and is waiting for review."
            ),
            update_text="Waiting for validation before routing.",
            updated_at=timezone.now(),
        )
        from .models import ConcernAssignment

        ConcernAssignment.objects.filter(
            concern_id=concern_id,
            status=ConcernAssignment.Status.ACTIVE,
        ).update(status=ConcernAssignment.Status.CANCELLED, updated_at=timezone.now())
        ConcernAiAssessment.objects.filter(concern_id=concern_id).exclude(
            status=ConcernAiAssessment.Status.COMPLETED
        ).update(status=ConcernAiAssessment.Status.PENDING)


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
    """Queue privacy processing; never run SAM3 inline in production."""
    try:
        return process_concern_media_privacy_task.delay(media_id, force=force)
    except Exception as exc:
        if _inline_fallback_allowed():
            logger.warning(
                "Concern media privacy queue unavailable for media_id=%s (%s); processing inline (dev).",
                media_id,
                exc.__class__.__name__,
            )
            return process_concern_media_privacy_task.run(media_id, force=force)
        logger.error(
            "Concern media privacy queue unavailable for media_id=%s (%s); left QUEUED for recovery sweep.",
            media_id,
            exc.__class__.__name__,
        )
        return None


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(OSError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 2},
    time_limit=120,
    soft_time_limit=90,
)
def run_content_moderation_ai_task(self, flag_id):
    """Independent AI second-look at a submitted ContentFlag.

    Only ever takes an action when the model itself identifies a specific
    `matched_reason` — the reporter's chosen reason is never trusted on its
    own. Any failure here (network, parsing, anything) leaves the flag exactly
    as SUBMITTED: this task must never be the reason real content disappears.
    """
    from .ai.community_moderation_analyzer import analyze_flagged_content, model_version_in_use
    from .models import ContentFlag, LlmDecisionLog
    from .moderation import execute_takedown

    try:
        flag = ContentFlag.objects.select_related(
            "concern",
            "comment",
            "comment__author",
            "announcement_comment",
            "announcement_comment__author",
            "emergency_comment",
            "emergency_comment__author",
        ).get(pk=flag_id)
    except ContentFlag.DoesNotExist:
        logger.warning("Content moderation AI task: flag_id=%s no longer exists.", flag_id)
        return {"flag_id": flag_id, "skipped": True, "skip_reason": "not_found"}

    target_kind = flag.target_kind
    image_payloads = []
    image_submitted = False
    if target_kind == "concern":
        content_text = f"{flag.concern.title}\n{flag.concern.description}"
        from .ai.image_prep import prepare_image_for_gemma

        for media in flag.concern.media.all():
            if not (media.mime_type or "").lower().startswith("image/"):
                continue
            image_submitted = True
            try:
                with media.file.open("rb") as handle:
                    prepared = prepare_image_for_gemma(
                        handle.read(),
                        filename=media.original_filename,
                        mime_type=media.mime_type,
                    )
            except Exception:
                logger.warning("Could not read flagged concern image media_id=%s", media.pk, exc_info=True)
                prepared = None
            if prepared is not None:
                image_payloads.append(prepared.data)
    elif target_kind == "concern_comment":
        content_text = flag.comment.body
    elif target_kind == "announcement_comment":
        content_text = flag.announcement_comment.body
    else:
        content_text = flag.emergency_comment.body

    try:
        result = analyze_flagged_content(
            content_text=content_text,
            reason=flag.reason,
            reporter_note=flag.note,
            images=image_payloads,
            image_submitted=image_submitted,
        )
        model_version = model_version_in_use()

        with transaction.atomic():
            if result.get("matched_reason"):
                execute_takedown(flag, result["short_explanation"], actor=None)
                flag.status = ContentFlag.Status.TAKEN_DOWN
                flag.auto_moderated = True
                flag.staff_note = result["short_explanation"]
                flag.reviewed_by = None
                flag.save(update_fields=["status", "auto_moderated", "staff_note", "reviewed_by", "updated_at"])

            LlmDecisionLog.objects.create(
                run_kind=LlmDecisionLog.RunKind.PRODUCTION,
                domain=LlmDecisionLog.Domain.COMMUNITY,
                concern=flag.concern,
                content_flag=flag,
                model_version=model_version,
                input_snapshot={
                    "content_text": content_text[:2000],
                    "reason": flag.reason,
                    "note": flag.note,
                    "image_submitted": image_submitted,
                    "image_count": len(image_payloads),
                },
                output_snapshot=result,
                resident_message=result.get("short_explanation", ""),
                recommended_action=result.get("recommended_disposition", ""),
            )
    except Exception:
        logger.warning(
            "Content moderation AI task failed for flag_id=%s; flag left untouched.",
            flag_id,
            exc_info=True,
        )
        return {"flag_id": flag_id, "skipped": True, "skip_reason": "error"}

    try:
        from apps.accounts.services import create_audit_log

        create_audit_log(
            "content.flag_auto_reviewed",
            actor=None,
            target_user=flag.concern.reporter if flag.concern_id else flag.reporter,
            metadata={
                "flag_id": flag.pk,
                "content_type": flag.target_kind,
                "matched_reason": result.get("matched_reason", ""),
                "action_taken": "taken_down" if flag.auto_moderated else "dismissed",
                "model_version": model_version or "",
                "backfilled": True,
            },
            request_meta={},
        )
    except Exception:
        logger.debug("Content flag auto-review audit log failed for flag_id=%s", flag_id, exc_info=True)

    return {"flag_id": flag_id, "auto_moderated": flag.auto_moderated}


def enqueue_content_moderation_ai(flag_id):
    """Queue automatic moderation review; never run the model inline in production."""
    try:
        return run_content_moderation_ai_task.delay(flag_id)
    except Exception as exc:
        if _inline_fallback_allowed():
            logger.warning(
                "Content moderation AI queue unavailable for flag_id=%s (%s); processing inline (dev).",
                flag_id,
                exc.__class__.__name__,
            )
            return run_content_moderation_ai_task.run(flag_id)
        logger.error(
            "Content moderation AI queue unavailable for flag_id=%s (%s); left SUBMITTED for recovery sweep.",
            flag_id,
            exc.__class__.__name__,
        )
        return None


@shared_task(time_limit=120, soft_time_limit=90)
def reverse_geocode_concern_task(concern_id):
    """Resolve a generic concern address to a readable place, off the request path.

    Mirrors `reverse_geocode_alert_task` on the emergency side: Nominatim paces
    itself and can take seconds, so it must never run inside the submit request.
    """
    from apps.geo_services import reverse_geocode

    from .models import Concern

    concern = Concern.objects.filter(pk=concern_id).first()
    if not concern or concern.latitude is None or concern.longitude is None:
        return {"concern_id": concern_id, "skipped": True, "skip_reason": "no_coordinates"}
    result = reverse_geocode(concern.latitude, concern.longitude)
    if result.get("status") == "success" and result.get("location"):
        concern.address = result["location"]
        concern.save(update_fields=["address", "updated_at"])
        return {"concern_id": concern_id, "address": concern.address}
    return {"concern_id": concern_id, "skipped": True, "skip_reason": "geocode_unavailable"}


@shared_task(time_limit=120, soft_time_limit=90)
def retry_pending_concern_jobs_task():
    """Requeue concern jobs orphaned by a broker outage.

    Runs on beat. Every branch is idempotent — the underlying tasks either
    claim rows through their own lease/state machine or skip completed work —
    so a requeue that races a live worker collapses into a no-op.
    """
    from .models import ConcernAiAssessment, ConcernMedia, ContentFlag, LlmDecisionLog

    stale_before = timezone.now() - RECOVERY_STALE_AFTER
    requeued = {"assessments": 0, "media_privacy": 0, "moderation": 0}

    pending_assessments = list(
        ConcernAiAssessment.objects.filter(
            status=ConcernAiAssessment.Status.PENDING,
            updated_at__lt=stale_before,
        ).values_list("concern_id", flat=True)[:50]
    )
    for concern_id in pending_assessments:
        try:
            process_concern_ai_task.delay(concern_id)
            requeued["assessments"] += 1
        except Exception:
            break

    queued_media = list(
        ConcernMedia.objects.filter(
            privacy_state=ConcernMedia.PrivacyState.QUEUED,
            uploaded_at__lt=stale_before,
        ).values_list("pk", flat=True)[:50]
    )
    for media_id in queued_media:
        try:
            process_concern_media_privacy_task.delay(media_id)
            requeued["media_privacy"] += 1
        except Exception:
            break

    # A moderation run always leaves an LlmDecisionLog behind, even when it
    # takes no action — so "SUBMITTED with no log" means it never ran.
    moderated_flag_ids = LlmDecisionLog.objects.filter(content_flag__isnull=False).values("content_flag_id")
    unmoderated_flags = list(
        ContentFlag.objects.filter(status=ContentFlag.Status.SUBMITTED, created_at__lt=stale_before)
        .exclude(pk__in=moderated_flag_ids)
        .values_list("pk", flat=True)[:50]
    )
    for flag_id in unmoderated_flags:
        try:
            run_content_moderation_ai_task.delay(flag_id)
            requeued["moderation"] += 1
        except Exception:
            break

    if any(requeued.values()):
        logger.info("Recovery sweep requeued concern jobs: %s", requeued)
    return requeued


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
