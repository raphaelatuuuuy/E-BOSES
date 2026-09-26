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


@shared_task(time_limit=120, soft_time_limit=90)
def retry_pending_precheck_jobs_task():
    """Requeue persistent precheck/comment-street work orphaned mid-flight.

    The API never runs these inline, so a broker gap or dead worker would
    otherwise leave rows QUEUED/PROCESSING (or attachments "pending")
    forever. Idempotent: the tasks skip completed work, so a race with a
    live worker collapses into a no-op.
    """
    from .models import PrecheckJob, PublicCommentAttachment

    stale_before = timezone.now() - RECOVERY_STALE_AFTER
    requeued = {"prechecks": 0, "comment_street": 0}

    stale_jobs = list(
        PrecheckJob.objects.filter(
            status__in=[PrecheckJob.Status.QUEUED, PrecheckJob.Status.PROCESSING],
            updated_at__lt=stale_before,
        ).values_list("pk", flat=True)[:50]
    )
    for job_id in stale_jobs:
        try:
            process_classification_job.delay(job_id)
            requeued["prechecks"] += 1
        except Exception:
            break

    stale_attachments = list(
        PublicCommentAttachment.objects.filter(
            street_imagery__status="pending",
            concern_comment__isnull=False,
        ).values_list("pk", "concern_comment__concern_id")[:50]
    )
    for attachment_id, _concern_id in stale_attachments:
        try:
            attachment = PublicCommentAttachment.objects.select_related(
                "concern_comment__concern",
                "emergency_comment",
            ).filter(pk=attachment_id).first()
            if attachment is None:
                continue
            concern_id = None
            if attachment.concern_comment_id and attachment.concern_comment.concern_id:
                concern_id = attachment.concern_comment.concern_id
            if concern_id is None:
                continue
            run_comment_street_check_job.delay(attachment_id, concern_id)
            requeued["comment_street"] += 1
        except Exception:
            break

    if any(requeued.values()):
        logger.info("Recovery sweep requeued precheck jobs: %s", requeued)
    return requeued


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(OSError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 2},
    time_limit=240,
    soft_time_limit=180,
)
def run_media_check_job(self, job_id: str):
    """Media authenticity check off the request thread.

    Staged raw bytes (3MB/file cap, 3 files max) are rebuilt into upload
    objects and run through the same _concern_media_check_results the sync
    path uses, so async and sync verdicts match. Fail-safe with
    requires_review — never auto-passed.
    """
    from django.core.cache import cache
    from django.core.files.uploadedfile import SimpleUploadedFile

    from .media_check_jobs import (
        JOB_KEY_PREFIX,
        mark_completed,
        mark_failed,
        mark_processing,
        take_staged_files,
    )

    mark_processing(job_id)
    try:
        stored = cache.get(f"{JOB_KEY_PREFIX}{job_id}") or {}
        params = stored.get("_params") or {}
        staged = take_staged_files(job_id)
        rebuilt = [
            SimpleUploadedFile(
                item.get("name") or "upload",
                item.get("content") or b"",
                content_type=item.get("content_type") or "application/octet-stream",
            )
            for item in staged
        ]
        community = None
        community_id = params.get("community_id")
        if community_id:
            from apps.emergencies.models import Community

            community = Community.objects.filter(
                pk=community_id, status=Community.Status.ACTIVE
            ).first()
        from .models import ConcernClassificationConfiguration
        from .views import _concern_media_check_results

        config = ConcernClassificationConfiguration.current(community)
        files = _concern_media_check_results(
            rebuilt,
            config=config,
            run_ai=not params.get("forensics_only", False),
        )
        mark_completed(job_id, {
            "files": files,
            "automated_check_completed": True,
            "requires_review": False,
        })
        return {"job_id": job_id, "status": "completed"}
    except Exception as exc:  # noqa: BLE001 — fail safe, never 500 the poller
        logger.warning("Media check job %s failed: %s", job_id, exc.__class__.__name__)
        mark_failed(job_id, exc.__class__.__name__)
        return {"job_id": job_id, "status": "failed"}


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
def run_resident_precheck_job(self, job_id: str):
    """Full resident precheck off the request thread (text and images).

    The view validates intake and stages Gemma-sized prepared images;
    the worker runs the model call plus the shared _build_precheck_payload
    tail, so async results match sync ones. Model timeouts fail safe:
    submission stays available but flagged for human review — never
    auto-passed.
    """
    from django.core.cache import cache

    from .precheck_jobs import (
        JOB_KEY_PREFIX,
        mark_completed,
        mark_failed,
        mark_processing,
        take_staged_images,
    )

    mark_processing(job_id)
    try:
        stored = cache.get(f"{JOB_KEY_PREFIX}{job_id}") or {}
        params = stored.get("_params") or {}
        from django.conf import settings
        from django.db.models import Q

        from .ai.classification import classification_payload
        from .classification_api import _build_precheck_payload
        from .models import Concern, ConcernCategory, ConcernClassificationConfiguration

        community = None
        community_id = params.get("community_id")
        if community_id:
            from apps.emergencies.models import Community

            community = Community.objects.filter(
                pk=community_id, status=Community.Status.ACTIVE
            ).first()
        config = ConcernClassificationConfiguration.current(community)
        images = take_staged_images(job_id)
        category_ref = None
        ref_code = params.get("category_ref_code")
        if ref_code:
            category_ref = ConcernCategory.objects.filter(
                code=ref_code, is_active=True
            ).filter(Q(community=community) | Q(community__isnull=True)).first()
        title = params.get("title", "")
        description = params.get("description", "")
        latitude = params.get("latitude")
        longitude = params.get("longitude")
        photo_count = int(params.get("photo_count") or 0)
        image_errors = params.get("image_errors") or {}
        prepared_indices = params.get("prepared_indices") or []
        result = classification_payload(
            title=title,
            description=description,
            selected_category=params.get("category", ""),
            configuration=config,
            images=images or None,
            image_uploaded=photo_count > 0,
            text_timeout=getattr(settings, "OLLAMA_PRECHECK_TEXT_TIMEOUT_SECONDS", 8),
        )
        payload = _build_precheck_payload(
            result=result,
            config=config,
            incident_community=community,
            category_ref=category_ref,
            selected_category=params.get("category", ""),
            title=title,
            description=description,
            latitude=latitude,
            longitude=longitude,
            images=images or None,
            image_errors=image_errors,
            prepared_indices=prepared_indices,
            photo_count=photo_count,
            data={"title": title, "description": description,
                  "latitude": latitude, "longitude": longitude},
        )
        payload["automated_check_completed"] = True
        payload["requires_review"] = False
        mark_completed(job_id, payload)
        return {"job_id": job_id, "status": "completed"}
    except Exception as exc:  # noqa: BLE001 — fail safe, never 500 the poller
        logger.warning("Precheck job %s failed: %s", job_id, exc.__class__.__name__)
        mark_failed(job_id, exc.__class__.__name__)
        return {"job_id": job_id, "status": "failed"}


def _worker_identity() -> tuple[str, str]:
    """(hostname, service_role) for worker logs, never raises."""
    import socket

    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = "unknown"
    try:
        role = getattr(settings, "SERVICE_ROLE", "prod-heavy")
    except Exception:
        role = "prod-heavy"
    return hostname, role


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(OSError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 2},
    time_limit=240,
    soft_time_limit=180,
)
def run_comment_street_check_job(self, attachment_id: int, concern_id: int):
    """Comment-image street comparison worker — tiles + vision off the POST.

    Comment uploads store ``street_imagery={"status": "pending"}`` and this
    task fills in the verdict from stored bytes, so Google tile downloads,
    cv2 frame extraction, PIL prep and the vision call never run in Daphne.
    """
    import time

    hostname, service_role = _worker_identity()
    started = time.monotonic()
    logger.info(
        "Comment-street worker start attachment_id=%s concern_id=%s hostname=%s service_role=%s",
        attachment_id, concern_id, hostname, service_role,
    )
    try:
        from .comment_media import _representative_video_frame, compare_comment_image_to_concern_pin
        from .models import Concern, PublicCommentAttachment

        attachment = PublicCommentAttachment.objects.filter(pk=attachment_id).first()
        concern = Concern.objects.filter(pk=concern_id).first()
        if attachment is None or concern is None:
            logger.warning(
                "Comment-street worker missing attachment_id=%s concern_id=%s hostname=%s service_role=%s",
                attachment_id, concern_id, hostname, service_role,
            )
            return {"attachment_id": attachment_id, "status": "failed", "error": "not_found"}
        if (attachment.street_imagery or {}).get("status") != "pending":
            return {"attachment_id": attachment_id, "status": (attachment.street_imagery or {}).get("status", "unknown")}
        try:
            with attachment.file.open("rb") as handle:
                raw = handle.read()
        except Exception:
            attachment.street_imagery = {"status": "skipped", "reason": "stored_file_unreadable"}
            attachment.save(update_fields=["street_imagery"])
            return {"attachment_id": attachment_id, "status": "skipped"}
        name = attachment.original_filename or "attachment"
        mime = attachment.mime_type or "application/octet-stream"
        if attachment.kind == PublicCommentAttachment.Kind.VIDEO:
            frame = _representative_video_frame(raw, name)
            if not frame:
                attachment.street_imagery = {"status": "skipped", "reason": "video_frame_unavailable"}
                attachment.save(update_fields=["street_imagery"])
                return {"attachment_id": attachment_id, "status": "skipped"}
            raw, name, mime = frame, f"{name}-frame.jpg", "image/jpeg"
        result = compare_comment_image_to_concern_pin(
            concern=concern, raw=raw, filename=name, mime_type=mime
        )
        attachment.street_imagery = result
        attachment.save(update_fields=["street_imagery"])
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "Comment-street worker done attachment_id=%s status=%s duration_ms=%d hostname=%s service_role=%s",
            attachment_id, result.get("status"), duration_ms, hostname, service_role,
        )
        return {"attachment_id": attachment_id, "status": result.get("status", "unknown")}
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.warning(
            "Comment-street worker failed attachment_id=%s error=%s duration_ms=%d hostname=%s service_role=%s",
            attachment_id, exc.__class__.__name__, duration_ms, hostname, service_role,
        )
        return {"attachment_id": attachment_id, "status": "failed"}


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
def process_classification_job(self, job_id: str):
    """Persistent resident precheck worker — the ONLY place precheck AI runs.

    The API only stores raw uploads + creates the ``PrecheckJob`` row, then
    calls ``process_classification_job.apply_async(args=[job_id],
    queue="heavy")``. This task does every heavy step: PIL normalization,
    ``classification_payload`` (Gemma/Ollama), duplicate feedback, street
    imagery, resolved-match — then persists the payload on the row.

    Never called from a view synchronously; never blocks Daphne.
    """
    import time

    hostname, service_role = _worker_identity()
    started = time.monotonic()
    logger.info(
        "Precheck worker start job_id=%s hostname=%s service_role=%s",
        job_id, hostname, service_role,
    )
    from django.db.models import Q

    from .models import ConcernCategory, ConcernClassificationConfiguration, PrecheckJob

    try:
        job = PrecheckJob.objects.prefetch_related("attachments").filter(pk=job_id).first()
    except Exception:
        job = None
    if job is None:
        logger.warning(
            "Precheck worker unknown job_id=%s hostname=%s service_role=%s",
            job_id, hostname, service_role,
        )
        return {"job_id": job_id, "status": "failed", "error": "unknown_job"}
    if job.status == PrecheckJob.Status.COMPLETED:
        logger.info(
            "Precheck worker already done job_id=%s hostname=%s service_role=%s",
            job_id, hostname, service_role,
        )
        return {"job_id": job_id, "status": "completed"}
    job.status = PrecheckJob.Status.PROCESSING
    try:
        job.save(update_fields=["status", "updated_at"])
    except Exception:
        pass
    try:
        from django.core.files.uploadedfile import SimpleUploadedFile

        from .ai.classification import classification_payload
        from .classification_api import _build_precheck_payload

        params = job.params or {}
        community = None
        community_id = params.get("community_id")
        if community_id:
            from apps.emergencies.models import Community

            community = Community.objects.filter(
                pk=community_id, status=Community.Status.ACTIVE
            ).first()
        config = ConcernClassificationConfiguration.current(community)
        category_ref = None
        ref_code = params.get("category_ref_code")
        if ref_code:
            category_ref = ConcernCategory.objects.filter(
                code=ref_code, is_active=True
            ).filter(Q(community=community) | Q(community__isnull=True)).first()
        title = params.get("title", "")
        description = params.get("description", "")
        latitude = params.get("latitude")
        longitude = params.get("longitude")
        photo_count = int(params.get("photo_count") or 0)

        # Heavy image work lives HERE, never in the API: read raw staged
        # files from storage, validate, PIL-normalize for Gemma.
        from apps.accounts.services import validate_concern_media_file
        from apps.concerns.ai.image_prep import prepare_image_for_gemma
        from django.core.exceptions import ValidationError as DjangoValidationError

        images, image_errors, prepared_indices = [], {}, []
        attachments = list(job.attachments.all().order_by("id"))
        for index, attachment in enumerate(attachments):
            try:
                with attachment.file.open("rb") as handle:
                    raw = handle.read()
            except Exception:
                image_errors[index] = "unreadable"
                continue
            rebuilt = SimpleUploadedFile(
                attachment.original_filename or "upload",
                raw,
                content_type=attachment.mime_type or "application/octet-stream",
            )
            try:
                validate_concern_media_file(rebuilt)
            except DjangoValidationError:
                image_errors[index] = "rejected"
                continue
            except Exception:
                image_errors[index] = "unreadable"
                continue
            try:
                rebuilt.seek(0)
            except Exception:
                pass
            prepared = prepare_image_for_gemma(
                raw,
                filename=attachment.original_filename or "",
                mime_type=attachment.mime_type or "",
            )
            if prepared is not None:
                images.append(prepared)
                prepared_indices.append(index)
            else:
                image_errors[index] = "unreadable"

        result = classification_payload(
            title=title,
            description=description,
            selected_category=params.get("category", ""),
            configuration=config,
            images=images or None,
            image_uploaded=photo_count > 0,
            text_timeout=getattr(settings, "OLLAMA_PRECHECK_TEXT_TIMEOUT_SECONDS", 8),
        )
        payload = _build_precheck_payload(
            result=result,
            config=config,
            incident_community=community,
            category_ref=category_ref,
            selected_category=params.get("category", ""),
            title=title,
            description=description,
            latitude=latitude,
            longitude=longitude,
            images=images or None,
            image_errors=image_errors,
            prepared_indices=prepared_indices,
            photo_count=photo_count,
            data={"title": title, "description": description,
                  "latitude": latitude, "longitude": longitude},
        )
        payload["automated_check_completed"] = True
        payload["requires_review"] = False
        job.status = PrecheckJob.Status.COMPLETED
        job.result = payload
        job.error_code = ""
        try:
            job.save(update_fields=["status", "result", "error_code", "updated_at"])
        except Exception:
            pass
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "Precheck worker done job_id=%s status=completed duration_ms=%d hostname=%s service_role=%s",
            job_id, duration_ms, hostname, service_role,
        )
        return {"job_id": job_id, "status": "completed"}
    except Exception as exc:  # noqa: BLE001 — fail safe, never 500 the poller
        try:
            job.status = PrecheckJob.Status.FAILED
            job.result = {
                "can_submit": True,
                "automated_check_completed": False,
                "requires_review": True,
            }
            job.error_code = exc.__class__.__name__
            job.save(update_fields=["status", "result", "error_code", "updated_at"])
        except Exception:
            pass
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.warning(
            "Precheck worker done job_id=%s status=failed error=%s duration_ms=%d hostname=%s service_role=%s",
            job_id, exc.__class__.__name__, duration_ms, hostname, service_role,
        )
        return {"job_id": job_id, "status": "failed"}


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(OSError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 2},
    time_limit=240,
    soft_time_limit=180,
)
def run_street_imagery_retry_job(self, log_id: int):
    """Street-view retry worker — Google tiles + vision never run in Daphne.

    Reads stored concern media from object storage, runs
    ``_street_imagery_preview`` (fetch + ``verify_street_context``), and merges
    the outcome into ``LlmDecisionLog.output_snapshot["street_imagery"]`` so
    officials can poll the log row instead of holding a request open.
    """
    import time

    hostname, service_role = _worker_identity()
    started = time.monotonic()
    logger.info(
        "Street retry worker start log_id=%s hostname=%s service_role=%s",
        log_id, hostname, service_role,
    )
    try:
        from .classification_api import _street_imagery_preview
        from .ai.image_prep import prepare_image_for_gemma
        from .models import ConcernClassificationConfiguration, LlmDecisionLog

        row = (
            LlmDecisionLog.objects.select_related("concern", "concern__community")
            .prefetch_related("concern__media")
            .filter(pk=log_id)
            .first()
        )
        if row is None or not row.concern_id or not row.concern:
            logger.warning(
                "Street retry worker unknown log_id=%s hostname=%s service_role=%s",
                log_id, hostname, service_role,
            )
            return {"log_id": log_id, "status": "failed", "error": "unknown_log"}
        concern = row.concern
        incident_community = concern.community
        if incident_community is None:
            # Legacy audit rows can predate community assignment. Resolve
            # data-driven (barangay match, then first active) — mirrors the
            # old inline fallback, but inside the worker, never in Daphne.
            from apps.emergencies.models import Community as _Community

            active = _Community.objects.filter(status=_Community.Status.ACTIVE)
            barangay = (getattr(concern, "barangay", "") or "").strip()
            if barangay:
                incident_community = active.filter(name__iexact=barangay).first()
            if incident_community is None:
                incident_community = active.order_by("name").first()
        if incident_community is None:
            logger.warning(
                "Street retry worker no community log_id=%s hostname=%s service_role=%s",
                log_id, hostname, service_role,
            )
            return {"log_id": log_id, "status": "failed", "error": "no_community"}
        prepared_images = []
        for item in concern.media.all():
            if not (item.mime_type or "").startswith("image/"):
                continue
            try:
                with item.file.open("rb") as handle:
                    raw = handle.read()
            except Exception:
                continue
            prepared = prepare_image_for_gemma(
                raw, filename=item.original_filename, mime_type=item.mime_type
            )
            if prepared is not None:
                prepared_images.append(prepared)
        config = ConcernClassificationConfiguration.current(incident_community)
        result = _street_imagery_preview(
            config,
            category=concern.category,
            latitude=concern.latitude,
            longitude=concern.longitude,
            images=prepared_images,
        )
        if result is None:
            result = {"status": "disabled", "reason": "street_imagery_not_configured"}
        snapshot = dict(row.output_snapshot or {})
        snapshot["street_imagery"] = result
        row.output_snapshot = snapshot
        try:
            row.save(update_fields=["output_snapshot"])
        except Exception:
            pass
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "Street retry worker done log_id=%s status=%s duration_ms=%d hostname=%s service_role=%s",
            log_id, result.get("status"), duration_ms, hostname, service_role,
        )
        return {"log_id": log_id, "status": result.get("status", "unknown")}
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.warning(
            "Street retry worker failed log_id=%s error=%s duration_ms=%d hostname=%s service_role=%s",
            log_id, exc.__class__.__name__, duration_ms, hostname, service_role,
        )
        return {"log_id": log_id, "status": "failed"}
