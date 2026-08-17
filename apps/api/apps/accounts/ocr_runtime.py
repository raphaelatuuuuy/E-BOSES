"""OCR verification orchestration, health state, and idempotent decisions."""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from statistics import fmean

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.crypto import salted_hmac
from PIL import Image, ImageDraw

from .models import (
    OCRConfigurationVersion,
    OCRDocumentType,
    OCRFieldDefinition,
    OCRServiceStatus,
    OCRTestRun,
    IdentityIdentifierClaim,
    ResidenceProof,
    ResidenceVerificationCase,
    User,
    VerificationCheck,
)
from .ocr import (
    OCRProviderAuthenticationError,
    OCRProviderError,
    OCRProviderUnavailable,
    OCRResponse,
)
from .ocr_engine import (
    EasyOCRProvider,
    FallbackOCRProvider,
    OCRSpaceProvider,
    classify_document_type,
    document_uses_field_regions,
    evaluate_template_match,
    extract_fields,
    field_matches_side,
    field_side,
    merge_extracted_fields,
    normalized_text,
    parse_date,
    run_engine,
    suffix_for_filename,
)


logger = logging.getLogger(__name__)
PROVIDER = "ocrspace"
OFFICIAL_OCR_PROVIDER = "easyocr_official"
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


def _identity_identifier_candidates(case, extracted_fields):
    if case.document_type_id is None or not isinstance(extracted_fields, dict):
        return []
    candidates = []
    fields = case.document_type.fields.filter(
        enabled=True,
        data_type=OCRFieldDefinition.DataType.IDENTIFIER,
    ).values_list("code", flat=True)
    for field_code in fields:
        extracted = extracted_fields.get(field_code) or {}
        value = extracted.get("normalized") or extracted.get("value")
        normalized = normalized_text(value)
        if len(normalized) < 4:
            continue
        namespace = f"{case.document_type.code}:{field_code}"
        candidates.append(
            {
                "document_type_code": case.document_type.code,
                "field_code": field_code,
                "value_hash": salted_hmac(
                    "accounts.identity-identifier",
                    f"{namespace}:{normalized}",
                ).hexdigest(),
            }
        )
    return candidates


def _identity_match_payload(claim, field_code):
    return {
        "field_code": field_code,
        "matching_user_id": claim.user_id,
        "matching_case_id": claim.source_case_id,
    }


def _historical_identity_matches(case, candidates):
    """Cover approved OCR checks created before identifier claims existed."""
    if not candidates:
        return []
    candidates_by_field = {item["field_code"]: item for item in candidates}
    matches = []
    checks = (
        VerificationCheck.objects.filter(
            case__status=ResidenceVerificationCase.Status.APPROVED,
            document_type__code=case.document_type.code,
        )
        .exclude(user_id=case.user_id)
        .select_related("case", "document_type")
        .order_by("user_id", "-completed_at")
    )
    for check in checks.iterator():
        for field_code, candidate in candidates_by_field.items():
            extracted = (check.extracted_fields or {}).get(field_code) or {}
            normalized = normalized_text(extracted.get("normalized") or extracted.get("value"))
            if len(normalized) < 4:
                continue
            namespace = f"{case.document_type.code}:{field_code}"
            digest = salted_hmac(
                "accounts.identity-identifier",
                f"{namespace}:{normalized}",
            ).hexdigest()
            if digest != candidate["value_hash"]:
                continue
            IdentityIdentifierClaim.objects.get_or_create(
                document_type_code=candidate["document_type_code"],
                field_code=field_code,
                value_hash=digest,
                defaults={"user_id": check.user_id, "source_case_id": check.case_id},
            )
            matches.append(
                {
                    "field_code": field_code,
                    "matching_user_id": check.user_id,
                    "matching_case_id": check.case_id,
                }
            )
    return matches


def _existing_identity_matches(case, candidates):
    matches = []
    for candidate in candidates:
        claim = (
            IdentityIdentifierClaim.objects.filter(
                document_type_code=candidate["document_type_code"],
                field_code=candidate["field_code"],
                value_hash=candidate["value_hash"],
            )
            .exclude(user_id=case.user_id)
            .first()
        )
        if claim:
            matches.append(_identity_match_payload(claim, candidate["field_code"]))
    return matches or _historical_identity_matches(case, candidates)


def _claim_identity_identifiers(case, candidates):
    matches = []
    for candidate in candidates:
        claim, created = IdentityIdentifierClaim.objects.get_or_create(
            document_type_code=candidate["document_type_code"],
            field_code=candidate["field_code"],
            value_hash=candidate["value_hash"],
            defaults={"user": case.user, "source_case": case},
        )
        if not created and claim.user_id != case.user_id:
            matches.append(_identity_match_payload(claim, candidate["field_code"]))
    return matches


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
        if len(proof_files) == 2 and document_type.requires_front:
            sides = [ResidenceProof.Side.FRONT, ResidenceProof.Side.BACK]
        elif document_type.requires_front:
            sides = [ResidenceProof.Side.FRONT] * len(proof_files)
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


class _EmptyProfile:
    first_name = ""
    middle_name = ""
    last_name = ""
    address = ""
    date_of_birth = None
    gender = ""


class _SubmittedProfile:
    """Registrant details from the in-flight sign-up form, used at detect time.

    Signup is unauthenticated so we cannot query a resident profile — we trust
    the values the user is typing into their own form. The point is not
    authentication; it is: "does the ID you uploaded match what you claim you
    are?" Same shape ocr_engine.evaluate_rules expects.
    """

    def __init__(self, data: dict | None):
        data = data or {}
        self.first_name = str(data.get("first_name") or "").strip()
        self.middle_name = str(data.get("middle_name") or "").strip()
        self.last_name = str(data.get("last_name") or "").strip()
        self.address = str(data.get("address") or "").strip()
        self.gender = str(data.get("gender") or "").strip()
        dob = str(data.get("date_of_birth") or "").strip()
        # Keep as string; ocr_engine parses via parse_date.
        self.date_of_birth = dob or None


def detect_residence_proof(
    proof_file,
    *,
    hint_type: str | None = None,
    side: str | None = None,
    submitted_profile: dict | None = None,
) -> dict:
    """Classify an uploaded/captured proof against published enabled templates.

    Used at sign-up so the ID type dropdown can auto-select. Does not create a case.
    When ``side`` is front/back, only fields for that side are extracted and validated.
    """
    configuration = published_configuration()
    if configuration is None:
        return {
            "detected": False,
            "document_type": None,
            "match_score": 0.0,
            "confidence": None,
            "extracted_fields": {},
            "template_match": None,
            "reasons": ["Residence proof verification is not configured."],
            "message": "Residence proof verification is not configured. Contact your Barangay Office.",
        }

    enabled_types = list(configuration.document_types.filter(enabled=True).order_by("display_order", "id"))
    if not enabled_types:
        return {
            "detected": False,
            "document_type": None,
            "match_score": 0.0,
            "confidence": None,
            "extracted_fields": {},
            "template_match": None,
            "reasons": ["No approved document types are published."],
            "message": "No approved document types are available. Contact your Barangay Office.",
        }

    filename = getattr(proof_file, "name", "") or "proof.jpg"
    content = proof_file.read()
    if hasattr(proof_file, "seek"):
        try:
            proof_file.seek(0)
        except Exception:
            pass
    if not content:
        return {
            "detected": False,
            "document_type": None,
            "match_score": 0.0,
            "confidence": None,
            "extracted_fields": {},
            "template_match": None,
            "reasons": ["Empty file."],
            "message": "Upload a clear photo of your document.",
        }

    hint = None
    if hint_type:
        hint = next((item for item in enabled_types if item.code == hint_type), None)

    # Do not spend another hosted request while the configured provider circuit
    # is open. A missing key is handled by the normal fallback path and is not a
    # circuit outage.
    service = service_status()
    cloud_allowed = service.status == OCRServiceStatus.Status.NOT_CONFIGURED or circuit_allows_request(force=False)

    # Prefer the user-selected type early so we know whether field regions exist.
    # When regions are drawn, do NOT deskew/crop — that shifts coordinates vs the boxes.
    preselected = None
    if hint_type:
        preselected = next((item for item in enabled_types if item.code == hint_type), None)
    use_regions = document_uses_field_regions(preselected) if preselected else any(
        document_uses_field_regions(item) for item in enabled_types
    )

    deskew_meta = {"deskewed": False, "skipped_for_regions": use_regions}
    enhance_meta = {"enhanced": False}
    if not use_regions:
        # Auto-crop/deskew ID card when possible (small/tilted/off-center uploads)
        try:
            from .document_deskew import deskew_id_card_bytes

            deskewed, deskew_meta = deskew_id_card_bytes(content)
            deskew_meta = {**deskew_meta, "skipped_for_regions": False}
            if deskew_meta.get("deskewed") and deskewed:
                content = deskewed
                filename = "deskewed.jpg"
        except Exception:
            logger.exception("Sign-up detect deskew skipped")

    # Always enhance for OCR (CLAHE + mild sharpen). No geometry change — safe with region boxes.
    try:
        from .document_deskew import enhance_for_ocr_bytes

        enhanced, enhance_meta = enhance_for_ocr_bytes(content)
        if enhance_meta.get("enhanced") and enhanced:
            content = enhanced
            filename = "enhanced.jpg" if not deskew_meta.get("deskewed") else "deskewed-enhanced.jpg"
    except Exception:
        logger.exception("Sign-up detect OCR enhance skipped")

    if cloud_allowed:
        provider = FallbackOCRProvider(
            primary=OCRSpaceProvider(),
            fallback_factory=lambda: EasyOCRProvider(gpu=False),
            caller="signup.detect",
        )
    else:
        provider = EasyOCRProvider(gpu=False)
    try:
        # deskew=False when regions are used so OCR geometry matches Mark Areas boxes.
        response = provider.recognize(
            content,
            suffix=suffix_for_filename(filename),
            deskew=not use_regions,
        )
        if cloud_allowed:
            record_provider_success(
                latency_ms=response.latency_ms,
                details={
                    "model": response.model,
                    "probe": "sign_up_detect",
                    "deskew": deskew_meta,
                    "enhance": enhance_meta,
                    "regions": use_regions,
                },
            )
        lines = response.lines or []
    except OCRProviderError as exc:
        record_provider_failure(exc)
        return {
            "detected": False,
            "document_type": None,
            "match_score": 0.0,
            "confidence": None,
            "extracted_fields": {},
            "template_match": None,
            "reasons": ["OCR service unavailable."],
            "message": "We could not read the document right now. Try again in a moment.",
        }
    except Exception:
        logger.exception("Unexpected error detecting residence proof")
        return {
            "detected": False,
            "document_type": None,
            "match_score": 0.0,
            "confidence": None,
            "extracted_fields": {},
            "template_match": None,
            "reasons": ["Unexpected detection error."],
            "message": "We could not read the document. Try a clearer photo.",
        }

    detected_type, type_score, _mismatch = classify_document_type(configuration, lines, hint)
    # Only allow enabled published types.
    if detected_type is not None and not any(item.pk == detected_type.pk for item in enabled_types):
        detected_type = None
        type_score = 0.0

    # User explicitly selected a document type on sign-up — prefer that template.
    # Keyword classification alone is brittle (custom names/keywords often miss OCR text).
    user_selected = hint is not None
    if user_selected:
        detected_type = hint
        # Keep classifier score for UI, but give a floor so selected type is not rejected
        # solely because keywords were not configured or OCR wording differs slightly.
        type_score = max(float(type_score or 0), 0.45)
    elif detected_type is None and len(enabled_types) == 1:
        # Single published type: use it when auto-detect is weak.
        detected_type = enabled_types[0]
        type_score = max(float(type_score or 0), 0.2)

    line_count = len(lines or [])
    if detected_type is None:
        reasons = [
            "Could not match this photo to an approved document type",
            "Missing expected keywords for approved templates" if line_count else "No readable text found in the photo",
            "Low template match score",
        ]
        return {
            "detected": False,
            "document_type": None,
            "match_score": round(float(type_score or 0), 4),
            "confidence": None,
            "extracted_fields": {},
            "template_match": None,
            "reasons": reasons,
            "message": (
                "We could not read enough text from this photo. Use a clearer, well-lit image of your document."
                if line_count < 3
                else "This document does not match any approved Barangay template. Select the correct ID type and try again."
            ),
        }

    # No usable OCR text at all
    if line_count == 0:
        return {
            "detected": False,
            "document_type": {
                "code": detected_type.code,
                "name": detected_type.name,
            },
            "match_score": round(float(type_score or 0), 4),
            "confidence": 0.0,
            "extracted_fields": {},
            "template_match": None,
            "reasons": ["No readable text found in the photo"],
            "message": "We could not read any text from this photo. Retake with better lighting and hold steady.",
        }

    # Trust the sign-up form values when provided — the whole point of the
    # detect step is to check the uploaded ID matches what the resident says.
    profile = _SubmittedProfile(submitted_profile) if submitted_profile else _EmptyProfile()
    from .ocr_engine import (
        evaluate_rules,
        normalize_extracted_dates,
        validate_extracted_field_rules,
    )

    proof_side = (side or "").strip().lower() or None
    if proof_side not in {None, "front", "back", "single"}:
        proof_side = None

    page_size = None
    if getattr(response, "image_width", None) and getattr(response, "image_height", None):
        page_size = (float(response.image_width), float(response.image_height))

    extracted = extract_fields(
        detected_type,
        lines,
        profile,
        side=proof_side,
        page_size=page_size,
    )
    # Normalize expiry / DOB strings (e.g. "FEBRUARY 29, 2025") to ISO dates
    extracted = normalize_extracted_dates(detected_type, extracted)

    confidences = [float(item["confidence"]) for item in extracted.values() if item.get("value")]
    overall = round(fmean(confidences), 4) if confidences else 0.0
    # Soft floor for template confidence during sign-up (avoid rejecting every phone photo)
    soft_confidence = max(overall, 0.55 if user_selected else overall)
    template_match = evaluate_template_match(detected_type, lines, soft_confidence)

    extracted_any = any(str((item or {}).get("value") or "").strip() for item in extracted.values())

    if user_selected:
        detected_ok = line_count >= 1 and (
            extracted_any or type_score >= 0.2 or overall >= 0.2 or line_count >= 3
        )
    else:
        template_ok = bool(template_match.get("passed", True)) if template_match else True
        detected_ok = type_score >= 0.25 or (type_score >= 0.18 and template_ok) or (
            len(enabled_types) == 1 and type_score >= 0.12 and (extracted_any or overall >= 0.3)
        )

    # Field-level rules for this photo side only (front fields vs back fields).
    field_checks = validate_extracted_field_rules(
        detected_type,
        extracted,
        configuration=configuration,
        side=proof_side,
    )
    # Admin-configured OCRRule rows (profile_match / required / not_expired /
    # contains_any / format / within_days …). These are the toggles surfaced
    # in the builder's Rules step; running them here is what makes sign-up
    # actually enforce what the admin configured. Skipped rules (e.g. profile
    # match with no submitted value) return passed=None and do not block.
    configured_rule_results = evaluate_rules(
        configuration,
        detected_type,
        extracted,
        profile,
        lines,
        side=proof_side,
    )
    for rule_result in configured_rule_results:
        if rule_result.get("passed") is False:
            field_checks.append(rule_result)
    field_failures = [
        c
        for c in field_checks
        if c.get("passed") is False
        and (c.get("on_failure") or "manual_review") == "manual_review"
    ]

    reasons = []
    if not detected_ok:
        reasons = [
            "We could not confirm this photo matches the document type you selected. "
            "Please use a clearer photo of the correct ID."
        ]
    for fail in field_failures:
        detail = fail.get("detail") or (
            "We could not read this part of your ID. Please try a clearer photo."
        )
        if detail not in reasons:
            reasons.append(detail)

    if not detected_ok or field_failures:
        # Prefer the most actionable field failure message for the user
        primary = (
            next((f.get("detail") for f in field_failures if f.get("rule") == "not_expired"), None)
            or next((f.get("detail") for f in field_failures), None)
            or (
                f"We could not verify this photo as a {detected_type.name}. "
                "Use a clearer photo of the correct side, or retake with better lighting."
            )
        )
        return {
            "detected": False,
            "document_type": {
                "code": detected_type.code,
                "name": detected_type.name,
            },
            "match_score": round(float(type_score), 4),
            "confidence": overall,
            "extracted_fields": extracted,
            "template_match": template_match,
            "field_checks": field_checks,
            "reasons": reasons,
            "message": primary,
        }

    return {
        "detected": True,
        "document_type": {
            "code": detected_type.code,
            "name": detected_type.name,
        },
        "match_score": round(float(type_score), 4),
        "confidence": overall,
        "extracted_fields": extracted,
        "template_match": template_match,
        "field_checks": field_checks,
        "deskew": deskew_meta,
        "reasons": [],
        "message": f"Your {detected_type.name} looks good.",
    }


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


def service_status(*, for_update=False, provider_key=PROVIDER):
    queryset = OCRServiceStatus.objects
    if for_update:
        queryset = queryset.select_for_update()
    service, _ = queryset.get_or_create(provider=provider_key)
    return service


def circuit_allows_request(*, force=False, provider_key=PROVIDER) -> bool:
    if force:
        return True
    status = service_status(provider_key=provider_key)
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
def record_provider_success(*, latency_ms: int, details=None, provider_key=PROVIDER):
    status = service_status(for_update=True, provider_key=provider_key)
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
def record_provider_failure(error: Exception, *, provider_key=PROVIDER, configured=None):
    status = service_status(for_update=True, provider_key=provider_key)
    now = timezone.now()
    status.consecutive_failures += 1
    if configured is None:
        configured = bool(getattr(settings, "OCRSPACE_API_KEY", ""))
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
    # PostgreSQL rejects FOR UPDATE on the nullable side of an outer join.
    # Lock only the case row (of=("self",)), then join related data.
    case = (
        ResidenceVerificationCase.objects.select_for_update(of=("self",))
        .select_related("user", "user__resident_profile", "configuration", "document_type")
        .get(pk=case_id)
    )
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
    if provider is None:
        # Always prefer hosted OCR.space, falling back to local EasyOCR only
        # when the primary actually fails. The circuit breaker still tracks
        # health, but it no longer short-circuits sign-up straight to EasyOCR
        # while OCR.space may be available again.
        service = service_status()
        cloud_allowed = service.status == OCRServiceStatus.Status.NOT_CONFIGURED or circuit_allows_request(force=force)
        if not cloud_allowed:
            provider = EasyOCRProvider(gpu=False)
        else:
            provider = FallbackOCRProvider(
                primary=OCRSpaceProvider(),
                fallback_factory=lambda: EasyOCRProvider(gpu=False),
                caller="signup.case",
            )
    else:
        if not getattr(settings, "OCRSPACE_API_KEY", ""):
            error = OCRProviderAuthenticationError("OCR.space is not configured.")
            record_provider_failure(error)
            return fail_case_attempts(case.pk, attempts, error)
        if not circuit_allows_request(force=force):
            error = OCRProviderUnavailable("OCR.space circuit is open.")
            return fail_case_attempts(case.pk, attempts, error)

    all_lines = []
    responses = []
    per_side_extracted = []
    profile = case.user.resident_profile
    use_regions = document_uses_field_regions(case.document_type)
    try:
        for attempt in attempts:
            content = _read_private_file(attempt.proof.file)
            response = provider.recognize(
                content,
                suffix=suffix_for_filename(attempt.proof.original_filename),
                # Keep original geometry when template boxes are defined.
                deskew=not use_regions,
            )
            all_lines.extend(response.lines)
            responses.append(response)
            proof_side = (getattr(attempt.proof, "side", None) or "single").strip().lower()
            if proof_side not in {"front", "back", "single"}:
                proof_side = "single"
            page_size = None
            if response.image_width and response.image_height:
                page_size = (float(response.image_width), float(response.image_height))
            # Extract only fields marked for this photo side — never apply front
            # regions to the back image (or vice versa).
            side_fields = extract_fields(
                case.document_type,
                response.lines,
                profile,
                side=proof_side,
                page_size=page_size,
            )
            per_side_extracted.append(side_fields)
            if cloud_allowed:
                record_provider_success(
                    latency_ms=response.latency_ms,
                    details={
                        "model": response.model,
                        "probe": "verification",
                        "side": proof_side,
                        "regions": use_regions,
                    },
                )
    except OCRProviderError as exc:
        record_provider_failure(exc)
        return fail_case_attempts(case.pk, attempts, exc)
    except Exception as exc:
        logger.exception("Unexpected OCR provider adapter error for case_id=%s", case_id)
        safe_error = OCRProviderUnavailable("Unexpected OCR provider adapter failure.")
        record_provider_failure(safe_error)
        return fail_case_attempts(case.pk, attempts, safe_error)

    merged = merge_extracted_fields(*per_side_extracted)
    # Include any enabled field not present after side-scoped merge as empty so
    # required-field checks still cover the whole document across both photos.
    if case.document_type is not None:
        for field in case.document_type.fields.filter(enabled=True):
            if field.code not in merged:
                merged[field.code] = {
                    "label": field.label,
                    "value": "",
                    "normalized": "",
                    "confidence": 0.0,
                    "required": field.required,
                    "min_confidence": float(field.min_confidence),
                    "side": field_side(field),
                    "evidence": {},
                    "bbox": None,
                    "pattern_ok": True,
                    "extraction_method": None,
                }

    engine = run_engine(
        case.configuration,
        case.document_type,
        profile,
        all_lines,
        extracted=merged,
    )
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

    identifier_candidates = _identity_identifier_candidates(case, engine.extracted_fields)
    duplicate_identity_matches = _existing_identity_matches(case, identifier_candidates)
    if not duplicate_identity_matches and engine.outcome == "passed":
        # The unique database claim closes the race where two OCR workers try
        # to approve the same configured document identifier concurrently.
        duplicate_identity_matches = _claim_identity_identifiers(case, identifier_candidates)
    duplicate_identity_found = bool(duplicate_identity_matches)

    response_by_index = {index: response for index, response in enumerate(responses)}
    for index, attempt in enumerate(attempts):
        response = response_by_index.get(index)
        attempt.status = (
            VerificationCheck.Status.PASSED
            if engine.outcome == "passed" and not duplicate_identity_found
            else VerificationCheck.Status.FAILED
            if engine.outcome == "reject"
            else VerificationCheck.Status.MANUAL_REVIEW
        )
        attempt.provider_job_id = response.job_id if response else ""
        attempt.ocr_confidence = Decimal(str(engine.confidence))
        attempt.extracted_fields = engine.extracted_fields
        attempt.rule_results = engine.rule_results
        attempt.retryable = engine.outcome in {"manual_review", "request_resubmission"}
        attempt.duplicate_match_found = duplicate_identity_found
        attempt.failure_reason_code = (
            ResidenceVerificationCase.ReviewReason.DUPLICATE_IDENTITY
            if duplicate_identity_found
            else engine.review_reason
        )
        attempt.failure_reason = "" if engine.outcome == "passed" and not duplicate_identity_found else (
            "An exact identity-document identifier matches another verified account and requires official review."
            if duplicate_identity_found
            else
            "Automatic checks rejected this document."
            if engine.outcome == "reject"
            else "A new document submission is required."
            if engine.outcome == "request_resubmission"
            else "Automatic checks require official review."
        )
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
            "duplicate_identity_matches": duplicate_identity_matches,
        }
        attempt.completed_at = now
        attempt.save()

    if duplicate_identity_found:
        _manual_review_case(
            case,
            ResidenceVerificationCase.ReviewReason.DUPLICATE_IDENTITY,
            decision_reason=(
                "An exact configured identity-document identifier matches another verified account. "
                "An official must resolve the duplicate before this account can be activated."
            ),
            retry_eligible=False,
        )
    elif engine.outcome == "passed":
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
            from .email_services import send_account_email_after_commit
            send_account_email_after_commit(case.user, "welcome")
    elif engine.outcome == "reject":
        case.status = ResidenceVerificationCase.Status.REJECTED
        case.review_reason = ""
        case.retry_eligible = False
        case.decision_source = ResidenceVerificationCase.DecisionSource.SYSTEM
        case.decision_reason = "Published OCR rules rejected the submitted document."
        case.decided_at = now
        case.completed_at = now
        case.processing_started_at = None
        case.revision += 1
        case.save()
        if case.user.status != User.Status.SUSPENDED:
            case.user.status = User.Status.REJECTED
            case.user.save(update_fields=["status", "updated_at"])
            from .email_services import send_account_email_after_commit
            send_account_email_after_commit(case.user, "verification_rejected")
    else:
        review_reason = (
            ResidenceVerificationCase.ReviewReason.RESUBMISSION_REQUIRED
            if engine.outcome == "request_resubmission"
            else engine.review_reason
        )
        _manual_review_case(
            case,
            review_reason,
            decision_reason=(
                "The submitted document did not meet the published checks. Please submit a new document."
                if engine.outcome == "request_resubmission"
                else "Automatic checks require official review."
            ),
            retry_eligible=engine.outcome in {"manual_review", "request_resubmission"},
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

    case_id = case.pk

    def kick_off():
        # Registration must not leave residents stuck on "queued" when no Celery
        # worker is running (common in local/dev). Process inline first; fall
        # back to the broker only if inline processing cannot start.
        if trigger == VerificationCheck.Trigger.REGISTRATION or getattr(
            settings, "CELERY_TASK_ALWAYS_EAGER", False
        ):
            try:
                process_verification_case(case_id, trigger=trigger)
                return
            except Exception as exc:
                logger.warning(
                    "Inline OCR processing failed for case_id=%s (%s); enqueueing.",
                    case_id,
                    exc.__class__.__name__,
                )
        enqueue_case(case_id, trigger=trigger)

    transaction.on_commit(kick_off)
    return case


def process_stuck_user_case(user):
    """If a resident is stuck in queued/processing, run OCR once (self-heal).

    Used by the account-pending poll endpoint so cases do not wait forever when
    the worker never picked up the task.
    """
    case = (
        ResidenceVerificationCase.objects.filter(user=user)
        .order_by("-created_at")
        .first()
    )
    if case is None:
        return None

    if case.status not in {
        ResidenceVerificationCase.Status.QUEUED,
        ResidenceVerificationCase.Status.PROCESSING,
    }:
        return case
    # Avoid thrashing: only auto-retry cases that have been waiting a bit,
    # or have never started processing.
    if case.status == ResidenceVerificationCase.Status.PROCESSING and case.processing_started_at:
        if case.processing_started_at > timezone.now() - timedelta(minutes=2):
            return case
    try:
        return process_verification_case(case.pk, trigger=VerificationCheck.Trigger.REGISTRATION)
    except Exception as exc:
        logger.warning(
            "Stuck-case recovery failed for case_id=%s: %s",
            case.pk,
            exc.__class__.__name__,
        )
        return case


@transaction.atomic
def decide_case(case_id, *, official, approve: bool, reason: str):
    case = (
        ResidenceVerificationCase.objects.select_for_update()
        .select_related("user", "document_type")
        .get(pk=case_id)
    )
    if case.status in TERMINAL_CASE_STATUSES:
        raise ValidationError("This verification case already has a final decision.")
    if not reason or not reason.strip():
        raise ValidationError("A decision reason is required.")
    if approve:
        latest_attempt = case.checks.order_by("-created_at").first()
        identifier_candidates = _identity_identifier_candidates(
            case,
            latest_attempt.extracted_fields if latest_attempt else {},
        )
        duplicate_matches = _existing_identity_matches(case, identifier_candidates)
        if not duplicate_matches:
            duplicate_matches = _claim_identity_identifiers(case, identifier_candidates)
        if duplicate_matches:
            if latest_attempt:
                latest_attempt.duplicate_match_found = True
                latest_attempt.failure_reason_code = ResidenceVerificationCase.ReviewReason.DUPLICATE_IDENTITY
                latest_attempt.failure_reason = (
                    "An exact identity-document identifier matches another verified account."
                )
                latest_attempt.metadata = {
                    **(latest_attempt.metadata or {}),
                    "duplicate_identity_matches": duplicate_matches,
                }
                latest_attempt.save(
                    update_fields=[
                        "duplicate_match_found",
                        "failure_reason_code",
                        "failure_reason",
                        "metadata",
                    ]
                )
            raise ValidationError(
                "This identity identifier already belongs to another verified account. "
                "Reject the duplicate or request corrected proof before approval."
            )
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
    from .email_services import send_account_email_after_commit
    send_account_email_after_commit(case.user, "welcome" if approve else "verification_rejected")
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
    if not getattr(settings, "OCRSPACE_API_KEY", ""):
        error = OCRProviderAuthenticationError("OCR.space is not configured.")
        return record_provider_failure(error)
    provider = provider or OCRSpaceProvider()
    image = Image.new("RGB", (460, 100), "white")
    ImageDraw.Draw(image).text((18, 38), "E-BOSES OCR HEALTH CHECK", fill="black")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    try:
        response = provider.recognize(buffer.getvalue(), suffix=".png")
    except OCRProviderError as exc:
        return record_provider_failure(exc)
    except Exception:
        logger.exception("Unexpected OCR.space health canary adapter failure")
        return record_provider_failure(OCRProviderUnavailable("Unexpected OCR canary failure."))
    return record_provider_success(
        latency_ms=response.latency_ms,
        details={"model": response.model, "probe": "synthetic_canary", "line_count": len(response.lines)},
    )



def official_service_status(*, for_update=False):
    return service_status(for_update=for_update, provider_key=OFFICIAL_OCR_PROVIDER)


def run_official_health_canary(*, provider=None):
    provider = provider or EasyOCRProvider(gpu=False)
    image = Image.new("RGB", (460, 100), "white")
    ImageDraw.Draw(image).text((18, 38), "E-BOSES OCR HEALTH CHECK", fill="black")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    try:
        response = provider.recognize(buffer.getvalue(), suffix=".png")
    except OCRProviderError as exc:
        return record_provider_failure(exc, provider_key=OFFICIAL_OCR_PROVIDER, configured=True)
    except Exception:
        logger.exception("Unexpected EasyOCR official health canary adapter failure")
        return record_provider_failure(
            OCRProviderUnavailable("Unexpected official OCR canary failure."),
            provider_key=OFFICIAL_OCR_PROVIDER,
            configured=True,
        )
    return record_provider_success(
        latency_ms=response.latency_ms,
        details={"model": response.model, "probe": "official_synthetic_canary", "line_count": len(response.lines)},
        provider_key=OFFICIAL_OCR_PROVIDER,
    )

_OCR_CACHE_TTL_SECONDS = 600


def _provider_id(provider) -> str:
    # Prefer an explicit stable name; fall back to the model string. Never
    # isinstance against module-level classes — tests patch those names and
    # isinstance(provider, <mock>) raises TypeError.
    provider_name = getattr(provider, "provider_name", None)
    if provider_name:
        return provider_name
    return getattr(provider, "model", provider.__class__.__name__)


def _recognize_with_cache(provider, image_bytes: bytes, *, suffix: str, deskew: bool):
    return provider.recognize(image_bytes, suffix=suffix, deskew=deskew)


def process_test_run(test_run_id, *, provider=None, force=False, side: str | None = None):
    with transaction.atomic():
        test_run = OCRTestRun.objects.select_for_update(of=("self",)).select_related(
            "configuration", "document_type", "requested_by__resident_profile", "sample"
        ).get(pk=test_run_id)
        if test_run.status not in {OCRTestRun.Status.QUEUED, OCRTestRun.Status.ERROR}:
            return test_run
        test_run.status = OCRTestRun.Status.PROCESSING
        test_run.started_at = timezone.now()
        test_run.save(update_fields=["status", "started_at", "updated_at"])
    field_file = test_run.file or (test_run.sample.file if test_run.sample_id else None)
    if not field_file:
        return fail_test_run(test_run_id, OCRProviderError("No test document was provided."))
    if provider is None:
        if getattr(settings, "OCRSPACE_API_KEY", ""):
            provider = FallbackOCRProvider(
                primary=OCRSpaceProvider(),
                fallback_factory=lambda: EasyOCRProvider(gpu=False),
                caller="test_tool",
            )
        else:
            import sys
            print("[OCR] test_tool using EasyOCR (no OCRSPACE_API_KEY)", file=sys.stderr, flush=True)
            provider = EasyOCRProvider(gpu=False)
    # Prefer explicit side arg; fall back to linked sample name (front/back/single).
    test_side = (side or "").strip().lower() or None
    if not test_side and test_run.sample_id:
        test_side = (getattr(test_run.sample, "name", None) or "").strip().lower() or None
    if test_side not in {None, "front", "back", "single"}:
        test_side = None
    try:
        use_regions = document_uses_field_regions(test_run.document_type)
        image_bytes = _read_private_file(field_file)
        response = _recognize_with_cache(
            provider,
            image_bytes,
            suffix=suffix_for_filename(test_run.original_filename or getattr(test_run.sample, "original_filename", "")),
            deskew=not use_regions,
        )
        record_provider_success(
            latency_ms=response.latency_ms,
            details={"model": response.model, "probe": "test", "side": test_side, "regions": use_regions},
            provider_key=OFFICIAL_OCR_PROVIDER,
        )
        simulated = (test_run.metadata or {}).get("simulated_profile") or {}
        profile = _SimulatedProfile(simulated)
        profile_source = "simulated" if any(str(value or "").strip() for value in simulated.values()) else "empty"
        page_size = None
        if response.image_width and response.image_height:
            page_size = (float(response.image_width), float(response.image_height))
        engine = run_engine(
            test_run.configuration,
            test_run.document_type,
            profile,
            response.lines,
            side=test_side,
            page_size=page_size,
        )
    except OCRProviderError as exc:
        record_provider_failure(exc, provider_key=OFFICIAL_OCR_PROVIDER, configured=True)
        return fail_test_run(test_run_id, exc)
    except Exception:
        logger.exception("Unexpected OCR test provider failure for test_run_id=%s", test_run_id)
        safe_error = OCRProviderUnavailable("Unexpected OCR provider adapter failure.")
        record_provider_failure(safe_error, provider_key=OFFICIAL_OCR_PROVIDER, configured=True)
        return fail_test_run(test_run_id, safe_error)
    with transaction.atomic():
        test_run = OCRTestRun.objects.select_for_update().get(pk=test_run_id)
        template_match = engine.template_match or {}
        template_checks = [
            {
                "code": f"template_{item.get('key')}",
                "name": item.get("label") or item.get("key"),
                "field": None,
                "passed": bool(item.get("passed")),
                "score": None,
                "on_failure": "warning",
                "detail": item.get("detail") or "",
                "template_check": True,
            }
            for item in (template_match.get("checks") or [])
        ]
        # Persist template_match inside extracted_fields so the API can return it
        # without a schema change.
        extracted = dict(engine.extracted_fields or {})
        extracted["__template_match__"] = template_match
        if test_side:
            extracted["__test_side__"] = test_side
        is_easyocr = response.job_id == "local-easyocr"
        test_run.metadata = {
            **(test_run.metadata or {}),
            "provider": "easyocr" if is_easyocr else "ocrspace",
            "model": response.model,
            "profile_source": profile_source,
        }
        template_ok = bool(template_match.get("passed", True))
        outcome_passed = engine.outcome == "passed" and template_ok
        test_run.status = OCRTestRun.Status.PASSED if outcome_passed else OCRTestRun.Status.WARNING
        test_run.provider_job_id = response.job_id
        test_run.ocr_confidence = Decimal(str(engine.confidence))
        test_run.extracted_fields = extracted
        # Emit synthetic PASSED rule_results for hints-based checks (Advanced
        # regex "Must contain", DOB parseability) so the Try Sample results
        # panel does not report "No rule configured" for fields that DO have a
        # rule that simply passed. Failures are already handled by
        # _prepend_priority_failures inside run_engine.
        engine_rules = list(engine.rule_results or [])
        rule_field_codes = {
            str(rule.get("field"))
            for rule in engine_rules
            if rule.get("field")
        }
        hint_passes: list[dict] = []
        try:
            fields_iter = test_run.document_type.fields.all()
        except Exception:
            fields_iter = []
        for field in fields_iter:
            if test_side and not field_matches_side(field, test_side):
                continue
            code = getattr(field, "code", "") or ""
            if not code or code in rule_field_codes:
                # Fail already recorded or field not testable.
                continue
            item = (engine.extracted_fields or {}).get(code) or {}
            value = str(item.get("value") or "").strip() if isinstance(item, dict) else ""
            hints = getattr(field, "extraction_hints", None) or {}
            if not isinstance(hints, dict):
                hints = {}
            pattern = str(hints.get("regex_pattern") or "").strip()
            label = getattr(field, "label", None) or code
            if pattern and value:
                # Emit "passed" only when it actually matched — extractor sets
                # pattern_ok=True/False; None means not checked (skip).
                if item.get("pattern_ok") is True:
                    hint_passes.append({
                        "code": f"{code}_pattern",
                        "name": f"{label} matches the expected pattern",
                        "field": code,
                        "passed": True,
                        "score": 1.0,
                        "on_failure": "manual_review",
                        "detail": f"{label} contains the required text.",
                    })
        test_run.rule_results = [*template_checks, *engine_rules, *hint_passes]
        test_run.error_code = engine.review_reason if not outcome_passed else ""
        test_run.error_message = (
            ""
            if outcome_passed
            else ("Template match failed." if not template_ok else "One or more checks require review.")
        )
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


class _SimulatedProfile:
    """Resident profile typed by the official to simulate a sign-up submission."""

    def __init__(self, values: dict):
        self.first_name = str(values.get("first_name") or "")
        self.middle_name = str(values.get("middle_name") or "")
        self.last_name = str(values.get("last_name") or "")
        self.address = str(values.get("address") or "")
        self.gender = str(values.get("gender") or "")
        raw_dob = str(values.get("date_of_birth") or "").strip()
        if raw_dob:
            self.date_of_birth = parse_date(raw_dob)
        else:
            self.date_of_birth = None
