"""Small Celery tasks for OCR processing and bounded recovery.

The module must stay import-safe: celery imports it before Django's app
registry is fully ready, so every Django import is deferred into the function
bodies (same pattern as apps/emergencies/tasks.py).
"""

from celery import shared_task


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(TimeoutError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 2},
    time_limit=180,
    soft_time_limit=120,
)
def process_verification_case_task(self, case_id, trigger=None):
    from .models import VerificationCheck
    from .ocr_runtime import process_verification_case

    resolved_trigger = trigger or VerificationCheck.Trigger.SYSTEM
    case = process_verification_case(case_id, trigger=resolved_trigger)
    return {"case_id": case.pk, "status": case.status}


@shared_task(
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=180,
    soft_time_limit=120,
)
def process_test_run_task(self, test_run_id, side=""):
    from .ocr_runtime import process_test_run

    test_side = (side or "").strip().lower() or None
    if test_side not in {None, "front", "back", "single"}:
        test_side = None
    test_run = process_test_run(test_run_id, side=test_side)
    return {"test_run_id": test_run.pk, "status": test_run.status, "side": test_side}


@shared_task(time_limit=90, soft_time_limit=60)
def ocr_health_canary_task():
    from .ocr_runtime import run_health_canary

    status = run_health_canary()
    return {"provider": status.provider, "status": status.status}


@shared_task(time_limit=180, soft_time_limit=120)
def recover_ocr_cases_task(batch_size=20):
    """Requeue only outage cases that have not received an official decision."""

    from datetime import timedelta

    from django.utils import timezone

    from .models import ResidenceVerificationCase, VerificationCheck
    from .ocr_runtime import enqueue_case, retry_case

    cutoff = timezone.now() - timedelta(seconds=30)
    case_ids = list(
        ResidenceVerificationCase.objects.filter(
            status=ResidenceVerificationCase.Status.MANUAL_REVIEW,
            review_reason=ResidenceVerificationCase.ReviewReason.OCR_UNAVAILABLE,
            retry_eligible=True,
            decision_source=ResidenceVerificationCase.DecisionSource.NONE,
            updated_at__lte=cutoff,
        )
        .order_by("updated_at")
        .values_list("pk", flat=True)[: max(1, min(int(batch_size), 100))]
    )
    queued = 0
    for case_id in case_ids:
        try:
            retry_case(case_id)
            enqueue_case(case_id, trigger=VerificationCheck.Trigger.RECOVERY)
            queued += 1
        except Exception:
            # The case remains manual-review and retry-eligible.  Do not let a
            # single stale/raced row stop recovery for the rest of the batch.
            continue
    return {"queued": queued, "examined": len(case_ids)}
