"""OCR verification orchestration, health state, and idempotent decisions."""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone
from PIL import Image, ImageDraw

from .models import (
    OCRConfigurationVersion,
    OCRDocumentType,
    OCRServiceStatus,
    OCRTestRun,
    ResidenceProof,
    ResidenceVerificationCase,
    User,
    VerificationCheck,
)
from .ocr import (
    OCRProviderAuthenticationError,
    OCRProviderError,
    OCRProviderUnavailable,
)
from .ocr_engine import PaddleOCRProvider, run_engine, suffix_for_filename


logger = logging.getLogger(__name__)
PROVIDER = "paddleocr"
ACTIVE_CASE_STATUSES = {
    ResidenceVerificationCase.Status.AWAITING_EMAIL,
    ResidenceVerificationCase.Status.QUEUED,
    ResidenceVerificationCase.Status.PROCESSING,
    ResidenceVerificationCase.Status.MANUAL_REVIEW,
}
TERMINAL_CASE_STATUSES = {
    ResidenceVerificationCase.Status.APPROVED,
    ResidenceVerificationCase.Status.REJECTED,
}


def published_configuration():
    return (
        OCRConfigurationVersion.objects.filter(
            scope="residence_proof",
            status=OCRConfigurationVersion.Status.PUBLISHED,
        )
        .prefetch_related("document_types__fields", "rules")
        .first()
    )


def draft_configuration():
    return OCRConfigurationVersion.objects.filter(
        scope="residence_proof",
        status=OCRConfigurationVersion.Status.DRAFT,
    ).first()


def document_type_for_registration(code: str, *, configuration=None):
    configuration = configuration or published_configuration()
    if configuration is None:
        raise ValidationError({"proof_type": ["Residence proof verification is not configured."]})
    document_type = configuration.document_types.filter(code=code, enabled=True).first()
    if document_type is None:
        raise ValidationError({"proof_type": ["Select an enabled residence proof type."]})
    return configuration, document_type


def normalize_proof_sides(document_type, proof_files, proof_sides=None):
    sides = list(proof_sides or [])
    if not sides:
        if len(proof_files) == 2 and document_type.requires_front and document_type.requires_back:
            sides = [ResidenceProof.Side.FRONT, ResidenceProof.Side.BACK]
        else:
            sides = [ResidenceProof.Side.SINGLE] * len(proof_files)
    if len(sides) != len(proof_files):
        raise ValidationError({"proof_side": ["Provide one side value for every uploaded file."]})
    allowed = set(document_type.allowed_sides or [ResidenceProof.Side.SINGLE])
    invalid = [side for side in sides if side not in allowed]
    if invalid:
        raise ValidationError({"proof_side": ["One or more uploaded sides are not allowed for this document type."]})
    if len(proof_files) > document_type.max_files:
        raise ValidationError({"proof": [f"Upload at most {document_type.max_files} file(s) for this document type."]})
    if document_type.requires_front and ResidenceProof.Side.FRONT not in sides:
        raise ValidationError({"proof_side": ["The front side is required."]})
    if document_type.requires_back and ResidenceProof.Side.BACK not in sides:
        raise ValidationError({"proof_side": ["The back side is required."]})
    return sides


def validate_registration_selection(proof_type, proof_files, proof_sides=None):
    configuration, document_type = document_type_for_registration(proof_type)
    sides = normalize_proof_sides(document_type, proof_files, proof_sides)
    for proof_file in proof_files:
        claimed = (getattr(proof_file, "content_type", "") or "").lower()
        allowed_mimes = set(document_type.accepted_mime_types or ["image/jpeg", "image/png"])
        if claimed and claimed not in allowed_mimes:
            raise ValidationError({"proof": ["This file type is not allowed for the selected document type."]})
    return configuration, document_type, sides


@transaction.atomic
def create_registration_case(user, proofs, *, configuration, document_type, sides):
    case = ResidenceVerificationCase.objects.create(
        user=user,
        configuration=configuration,
        document_type=document_type,
        status=ResidenceVerificationCase.Status.AWAITING_EMAIL,
        retry_eligible=True,
    )
    for proof, side in zip(proofs, sides):
        proof.case = case
        proof.document_type = document_type
        proof.side = side
        proof.save(update_fields=["case", "document_type", "side"])
    return case


def service_status(*, for_update=False):
    queryset = OCRServiceStatus.objects
    if for_update:
        queryset = queryset.select_for_update()
    service, _ = queryset.get_or_create(provider=PROVIDER)
    return service


def circuit_allows_request(*, force=False) -> bool:
    if force:
        return True
    status = service_status()
    if status.status == OCRServiceStatus.Status.NOT_CONFIGURED:
        return False
    if status.circuit_state != OCRServiceStatus.CircuitState.OPEN:
        return True
    if status.next_retry_at and status.next_retry_at <= timezone.now():
        status.circuit_state = OCRServiceStatus.CircuitState.HALF_OPEN
        status.save(update_fields=["circuit_state", "updated_at"])
        return True
    return False


@transaction.atomic
def record_provider_success(*, latency_ms: int, details=None):
    status = service_status(for_update=True)
    now = timezone.now()
    status.status = OCRServiceStatus.Status.HEALTHY
    status.circuit_state = OCRServiceStatus.CircuitState.CLOSED
    status.consecutive_failures = 0
    status.latency_ms = max(0, int(latency_ms))
    status.error_code = ""
    status.error_message = ""
    status.details = details or {}
    status.last_checked_at = now
    status.last_success_at = now
    status.next_retry_at = None
    status.save()
    return status


@transaction.atomic
def record_provider_failure(error: Exception):
    status = service_status(for_update=True)
    now = timezone.now()
    status.consecutive_failures += 1
    configured = bool(getattr(settings, "PADDLEOCR_TOKEN", ""))
    if not configured:
        status.status = OCRServiceStatus.Status.NOT_CONFIGURED
        status.circuit_state = OCRServiceStatus.CircuitState.OPEN
        status.next_retry_at = None
        code = "not_configured"
    else:
        immediate = isinstance(error, OCRProviderAuthenticationError)
        unavailable = immediate or status.consecutive_failures >= 2
        status.status = OCRServiceStatus.Status.UNAVAILABLE if unavailable else OCRServiceStatus.Status.DEGRADED
        status.circuit_state = OCRServiceStatus.CircuitState.OPEN if unavailable else OCRServiceStatus.CircuitState.CLOSED
        retry_seconds = int(getattr(settings, "OCR_CIRCUIT_RETRY_SECONDS", 300))
        status.next_retry_at = now + timedelta(seconds=retry_seconds) if unavailable and not immediate else None
        code = getattr(error, "reason_code", "provider_error")
    status.error_code = code
    status.error_message = str(error)[:255]
    status.last_checked_at = now
    status.last_failure_at = now
    status.save()
    return status


def _read_private_file(field_file):
    field_file.open("rb")
    try:
        return field_file.read()
    finally:
        field_file.close()


def _attempt_number(case, proof):
    current = case.checks.filter(proof=proof).aggregate(value=Max("attempt_number"))["value"] or 0
    return current + 1


def _manual_review_case(case, reason, *, decision_reason="", retry_eligible=True):
    case.status = ResidenceVerificationCase.Status.MANUAL_REVIEW
    case.review_reason = reason
    case.retry_eligible = retry_eligible
    case.decision_source = ResidenceVerificationCase.DecisionSource.NONE
    case.decision_reason = decision_reason
    case.processing_started_at = None
    case.revision += 1
    case.save()
    if case.user.status not in {User.Status.REJECTED, User.Status.SUSPENDED}:
        case.user.status = User.Status.PENDING_VERIFICATION
        case.user.save(update_fields=["status", "updated_at"])


@transaction.atomic
def prepare_case_attempt(case_id, trigger):
    case = ResidenceVerificationCase.objects.select_for_update().select_related(
        "user__resident_profile", "configuration", "document_type"
    ).get(pk=case_id)
    if case.status in TERMINAL_CASE_STATUSES or case.decision_source == ResidenceVerificationCase.DecisionSource.OFFICIAL:
        return case, []
    if case.status == ResidenceVerificationCase.Status.PROCESSING:
        stale_after = timezone.now() - timedelta(minutes=10)
        if case.processing_started_at and case.processing_started_at > stale_after:
            return case, []
    proofs = list(case.proofs.order_by("uploaded_at", "id"))
    if not proofs:
        _manual_review_case(
            case,
            ResidenceVerificationCase.ReviewReason.MISSING_REQUIRED_FIELD,
            decision_reason="No proof file is attached to this verification case.",
            retry_eligible=False,
        )
        return case, []
    case.status = ResidenceVerificationCase.Status.PROCESSING
    case.review_reason = ""
    case.processing_started_at = timezone.now()
    case.revision += 1
    case.save()
    attempts = [
        VerificationCheck.objects.create(
            user=case.user,
            proof=proof,
            case=case,
            configuration=case.configuration,
            document_type=case.document_type,
            status=VerificationCheck.Status.PROCESSING,
            attempt_number=_attempt_number(case, proof),
            trigger=trigger,
        )
        for proof in proofs
    ]
    return case, attempts


def process_verification_case(case_id, *, trigger=VerificationCheck.Trigger.SYSTEM, provider=None, force=False):
    case, attempts = prepare_case_attempt(case_id, trigger)
    if not attempts:
        return case
    provider = provider or PaddleOCRProvider()
    if not getattr(settings, "PADDLEOCR_TOKEN", ""):
        error = OCRProviderAuthenticationError("PaddleOCR is not configured.")
        record_provider_failure(error)
        return fail_case_attempts(case.pk, attempts, error)
    if not circuit_allows_request(force=force):
        error = OCRProviderUnavailable("PaddleOCR circuit is open.")
        return fail_case_attempts(case.pk, attempts, error)

    all_lines = []
    responses = []
    try:
        for attempt in attempts:
            content = _read_private_file(attempt.proof.file)
            response = provider.recognize(content, suffix=suffix_for_filename(attempt.proof.original_filename))
            all_lines.extend(response.lines)
            responses.append(response)
            record_provider_success(
                latency_ms=response.latency_ms,
                details={"model": response.model, "probe": "verification"},
            )
    except OCRProviderError as exc:
        record_provider_failure(exc)
        return fail_case_attempts(case.pk, attempts, exc)
    except Exception as exc:
        logger.exception("Unexpected OCR provider adapter error for case_id=%s", case_id)
        safe_error = OCRProviderUnavailable("Unexpected OCR provider adapter failure.")
        record_provider_failure(safe_error)
        return fail_case_attempts(case.pk, attempts, safe_error)

    profile = case.user.resident_profile
    engine = run_engine(case.configuration, case.document_type, profile, all_lines)
    return finalize_case_attempts(case.pk, attempts, responses, engine)


@transaction.atomic
def fail_case_attempts(case_id, attempts, error):
    case = ResidenceVerificationCase.objects.select_for_update().select_related("user").get(pk=case_id)
    now = timezone.now()
    if case.decision_source == ResidenceVerificationCase.DecisionSource.OFFICIAL or case.status in TERMINAL_CASE_STATUSES:
        VerificationCheck.objects.filter(pk__in=[item.pk for item in attempts]).update(
            status=VerificationCheck.Status.CANCELLED,
            completed_at=now,
            failure_reason="Superseded by an official decision.",
            retryable=False,
        )
        return case
    retryable = bool(getattr(error, "retryable", False))
    VerificationCheck.objects.filter(pk__in=[item.pk for item in attempts]).update(
        status=VerificationCheck.Status.ERROR,
        failure_reason_code=getattr(error, "reason_code", "provider_error"),
        failure_reason=str(error)[:255],
        completed_at=now,
        retryable=retryable,
        available_at=now + timedelta(seconds=30),
    )
    _manual_review_case(
        case,
        ResidenceVerificationCase.ReviewReason.OCR_UNAVAILABLE,
        decision_reason="Automatic OCR is temporarily unavailable. An official can review this case.",
        retry_eligible=retryable,
    )
    return case


@transaction.atomic
def finalize_case_attempts(case_id, attempts, responses, engine):
    case = ResidenceVerificationCase.objects.select_for_update().select_related("user").get(pk=case_id)
    now = timezone.now()
    if case.decision_source == ResidenceVerificationCase.DecisionSource.OFFICIAL or case.status in TERMINAL_CASE_STATUSES:
        VerificationCheck.objects.filter(pk__in=[item.pk for item in attempts]).update(
            status=VerificationCheck.Status.CANCELLED,
            completed_at=now,
            failure_reason="Superseded by an official decision.",
            retryable=False,
        )
        return case

    response_by_index = {index: response for index, response in enumerate(responses)}
    for index, attempt in enumerate(attempts):
        response = response_by_index.get(index)
        attempt.status = (
            VerificationCheck.Status.PASSED
            if engine.outcome == "passed"
            else VerificationCheck.Status.MANUAL_REVIEW
        )
        attempt.provider_job_id = response.job_id if response else ""
        attempt.ocr_confidence = Decimal(str(engine.confidence))
        attempt.extracted_fields = engine.extracted_fields
        attempt.rule_results = engine.rule_results
        attempt.retryable = engine.outcome != "passed"
        attempt.failure_reason_code = engine.review_reason
        attempt.failure_reason = "" if engine.outcome == "passed" else "Automatic checks require official review."
        attempt.ocr_name = str(
            (engine.extracted_fields.get("full_name") or engine.extracted_fields.get("resident_name") or {}).get("value", "")
        )[:120]
        attempt.ocr_address = str(
            (engine.extracted_fields.get("address") or engine.extracted_fields.get("service_address") or {}).get("value", "")
        )[:255]
        attempt.metadata = {
            "provider": PROVIDER,
            "detected_document_type": engine.detected_document_type_code,
            "document_type_score": engine.document_type_score,
            "document_type_mismatch": engine.document_type_mismatch,
        }
        attempt.completed_at = now
        attempt.save()

    if engine.outcome == "passed":
        case.status = ResidenceVerificationCase.Status.APPROVED
        case.review_reason = ""
        case.retry_eligible = False
        case.decision_source = ResidenceVerificationCase.DecisionSource.SYSTEM
        case.decision_reason = "All published OCR verification rules passed."
        case.decided_at = now
        case.completed_at = now
        case.processing_started_at = None
        case.revision += 1
        case.save()
        if case.user.status not in {User.Status.SUSPENDED, User.Status.REJECTED}:
            case.user.status = User.Status.VERIFIED
            case.user.save(update_fields=["status", "updated_at"])
    else:
        _manual_review_case(
            case,
            engine.review_reason,
            decision_reason="Automatic checks require official review.",
            retry_eligible=True,
        )
    return case


def _enqueue_failure(case_id, exc):
    logger.warning("OCR queue submission failed for case_id=%s: %s", case_id, exc.__class__.__name__)
    with transaction.atomic():
        case = ResidenceVerificationCase.objects.select_for_update().filter(pk=case_id).first()
        if not case or case.status in TERMINAL_CASE_STATUSES:
            return
        _manual_review_case(
            case,
            ResidenceVerificationCase.ReviewReason.OCR_UNAVAILABLE,
            decision_reason="The OCR worker queue is unavailable. This case remains available for manual review and retry.",
            retry_eligible=True,
        )


def enqueue_case(case_id, *, trigger=VerificationCheck.Trigger.SYSTEM):
    try:
        from .ocr_tasks import process_verification_case_task

        result = process_verification_case_task.delay(case_id, trigger=trigger)
        if result is None and not getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
            raise RuntimeError("OCR task broker is unavailable.")
        return result
    except Exception as exc:
        _enqueue_failure(case_id, exc)
        return None


@transaction.atomic
def queue_user_verification(user, *, trigger=VerificationCheck.Trigger.REGISTRATION):
    case = (
        ResidenceVerificationCase.objects.select_for_update()
        .filter(user=user, status__in=ACTIVE_CASE_STATUSES)
        .order_by("-created_at")
        .first()
    )
    if case is None:
        configuration = published_configuration()
        proof = user.residence_proofs.order_by("-uploaded_at").first()
        case = ResidenceVerificationCase.objects.create(
            user=user,
            configuration=configuration,
            document_type=getattr(proof, "document_type", None),
            status=ResidenceVerificationCase.Status.QUEUED,
            queued_at=timezone.now(),
        )
        if proof:
            proof.case = case
            proof.save(update_fields=["case"])
    else:
        case.status = ResidenceVerificationCase.Status.QUEUED
        case.queued_at = timezone.now()
        case.review_reason = ""
        case.retry_eligible = True
        case.revision += 1
        case.save()

    if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        enqueue_case(case.pk, trigger=trigger)
    else:
        transaction.on_commit(lambda: enqueue_case(case.pk, trigger=trigger))
    return case


@transaction.atomic
def decide_case(case_id, *, official, approve: bool, reason: str):
    case = ResidenceVerificationCase.objects.select_for_update().select_related("user").get(pk=case_id)
    if case.status in TERMINAL_CASE_STATUSES:
        raise ValidationError("This verification case already has a final decision.")
    if not reason or not reason.strip():
        raise ValidationError("A decision reason is required.")
    now = timezone.now()
    case.status = ResidenceVerificationCase.Status.APPROVED if approve else ResidenceVerificationCase.Status.REJECTED
    case.review_reason = ""
    case.retry_eligible = False
    case.decision_source = ResidenceVerificationCase.DecisionSource.OFFICIAL
    case.decision_reason = reason.strip()
    case.decided_by = official
    case.decided_at = now
    case.completed_at = now
    case.processing_started_at = None
    case.revision += 1
    case.save()
    case.user.status = User.Status.VERIFIED if approve else User.Status.REJECTED
    case.user.save(update_fields=["status", "updated_at"])
    case.checks.filter(status__in=[VerificationCheck.Status.QUEUED, VerificationCheck.Status.PROCESSING]).update(
        status=VerificationCheck.Status.CANCELLED,
        failure_reason="Superseded by an official decision.",
        retryable=False,
        completed_at=now,
    )
    return case


@transaction.atomic
def retry_case(case_id):
    case = ResidenceVerificationCase.objects.select_for_update().get(pk=case_id)
    if case.status != ResidenceVerificationCase.Status.MANUAL_REVIEW or not case.retry_eligible:
        raise ValidationError("Only retry-eligible manual-review cases can be retried.")
    if case.decision_source == ResidenceVerificationCase.DecisionSource.OFFICIAL:
        raise ValidationError("An official decision cannot be overwritten by OCR.")
    case.status = ResidenceVerificationCase.Status.QUEUED
    case.review_reason = ""
    case.queued_at = timezone.now()
    case.revision += 1
    case.save()
    if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        enqueue_case(case.pk, trigger=VerificationCheck.Trigger.OFFICIAL)
    else:
        transaction.on_commit(lambda: enqueue_case(case.pk, trigger=VerificationCheck.Trigger.OFFICIAL))
    return case


def run_health_canary(*, provider=None):
    if not getattr(settings, "PADDLEOCR_TOKEN", ""):
        error = OCRProviderAuthenticationError("PaddleOCR is not configured.")
        return record_provider_failure(error)
    provider = provider or PaddleOCRProvider()
    image = Image.new("RGB", (460, 100), "white")
    ImageDraw.Draw(image).text((18, 38), "E-BOSES OCR HEALTH CHECK", fill="black")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    try:
        response = provider.recognize(buffer.getvalue(), suffix=".png")
    except OCRProviderError as exc:
        return record_provider_failure(exc)
    except Exception:
        logger.exception("Unexpected PaddleOCR health canary adapter failure")
        return record_provider_failure(OCRProviderUnavailable("Unexpected OCR canary failure."))
    return record_provider_success(
        latency_ms=response.latency_ms,
        details={"model": response.model, "probe": "synthetic_canary", "line_count": len(response.lines)},
    )


def process_test_run(test_run_id, *, provider=None, force=False):
    with transaction.atomic():
        test_run = OCRTestRun.objects.select_for_update().select_related(
            "configuration", "document_type", "requested_by__resident_profile", "sample"
        ).get(pk=test_run_id)
        if test_run.status not in {OCRTestRun.Status.QUEUED, OCRTestRun.Status.ERROR}:
            return test_run
        test_run.status = OCRTestRun.Status.PROCESSING
        test_run.started_at = timezone.now()
        test_run.save(update_fields=["status", "started_at", "updated_at"])
    if not circuit_allows_request(force=force):
        return fail_test_run(test_run_id, OCRProviderUnavailable("PaddleOCR circuit is open."))
    field_file = test_run.file or (test_run.sample.file if test_run.sample_id else None)
    if not field_file:
        return fail_test_run(test_run_id, OCRProviderError("No test document was provided."))
    provider = provider or PaddleOCRProvider()
    try:
        response = provider.recognize(
            _read_private_file(field_file),
            suffix=suffix_for_filename(test_run.original_filename or getattr(test_run.sample, "original_filename", "")),
        )
        record_provider_success(latency_ms=response.latency_ms, details={"model": response.model, "probe": "test"})
        profile = getattr(test_run.requested_by, "resident_profile", None)
        if profile is None:
            profile = _SyntheticProfile()
        engine = run_engine(test_run.configuration, test_run.document_type, profile, response.lines)
    except OCRProviderError as exc:
        record_provider_failure(exc)
        return fail_test_run(test_run_id, exc)
    with transaction.atomic():
        test_run = OCRTestRun.objects.select_for_update().get(pk=test_run_id)
        test_run.status = OCRTestRun.Status.PASSED if engine.outcome == "passed" else OCRTestRun.Status.WARNING
        test_run.provider_job_id = response.job_id
        test_run.ocr_confidence = Decimal(str(engine.confidence))
        test_run.extracted_fields = engine.extracted_fields
        test_run.rule_results = engine.rule_results
        test_run.error_code = engine.review_reason
        test_run.error_message = "" if engine.outcome == "passed" else "One or more checks require review."
        test_run.completed_at = timezone.now()
        test_run.save()
        return test_run


@transaction.atomic
def fail_test_run(test_run_id, error):
    test_run = OCRTestRun.objects.select_for_update().get(pk=test_run_id)
    test_run.status = OCRTestRun.Status.ERROR
    test_run.error_code = getattr(error, "reason_code", "provider_error")
    test_run.error_message = str(error)[:255]
    test_run.completed_at = timezone.now()
    test_run.save()
    return test_run


class _SyntheticProfile:
    first_name = ""
    middle_name = ""
    last_name = ""
    address = ""
    date_of_birth = timezone.now().date()
