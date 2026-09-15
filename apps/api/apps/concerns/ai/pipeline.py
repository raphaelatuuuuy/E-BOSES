"""Run automated validation for one concern.

Order of operations, and why:

1. **Gemma** reads the title, description, configured category catalog and —
   when one decoded — the photo. It produces the whole assessment in a single call,
   including whether the photo *might* contain something privacy-sensitive.
2. **The SAM3 gate** (`should_run_sam3`) decides whether a privacy scan is
   warranted. It is deliberately conservative: all four conditions must hold, so
   a report with no photo, a photo nobody could read, or a suspicion Gemma did
   not name in the allowed vocabulary never reaches Roboflow.
3. **Media state** is written for every image, then the privacy task is queued
   on commit. Anything not cleared here stays non-public.

The result completes the validation gate before a report enters the official
work queue. Officials receive accepted reports through the normal queue; there
is no separate AI-review decision.
"""

import logging
import math
import time
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.concerns.models import (
    Concern,
    ConcernAiAssessment,
    ConcernCategory,
    ConcernClassificationConfiguration,
    ConcernMedia,
    ConcernStatusEvent,
    ConcernTimelineEntry,
)
from apps.concerns.notification_subject import build_notification_subject

from .classification import BASE_TEXT_MODEL
from .duplicate_detector import find_duplicate_concern
from .gemma_analyzer import (
    CORE_SENSITIVE_CLASSES,
    INTEGRITY_FLAGGED_VERDICTS,
    GemmaAnalyzer,
    compare_photo_duplicates,
    flagged_integrity_findings,
    integrity_overall,
    safe_needs_review,
    sensitive_classes_from,
    verify_street_context,
)
from .image_prep import PreparedImage, prepare_image_for_gemma
from .privacy.masks import is_privacy_sensitive_label
from .street_imagery import fetch_latest_street_imagery
from .text_classifier import TextClassifierNotConfigured


logger = logging.getLogger(__name__)


class StaleAiRun(RuntimeError):
    """Raised when an expired worker tries to publish over a newer run lease."""


def sam3_classes_for(gemma_result: dict) -> list[str]:
    """The classes SAM3 will be asked to segment.

    Gemma names these itself rather than choosing from a fixed list — SAM3 is
    open-vocabulary, so restricting it to three terms wasted the thing it is
    good at. `sensitive_classes_from` is what keeps them usable: short concrete
    nouns only, no abstractions a segmenter cannot find.
    """
    candidates = sensitive_classes_from(gemma_result.get("suspected_sensitive_classes") or [])
    # Public automatic blur is limited to directly identifying faces and
    # plates. Blood remains a review-only signal handled by the privacy task.
    return [
        name
        for name in candidates
        if is_privacy_sensitive_label(name) or name == "blood"
    ]


def should_run_sam3(*, image_uploaded: bool, gemma_image_review_succeeded: bool, gemma_result: dict) -> bool:
    return (
        image_uploaded
        and gemma_image_review_succeeded
        and gemma_result.get("privacy_scan_required") is True
        and bool(sam3_classes_for(gemma_result))
    )


# What SAM3 looks for when Gemma could not read the photo and so named nothing.
# The three that are always worth checking on a civic report.
FALLBACK_PROTECTIVE_CLASSES = list(CORE_SENSITIVE_CLASSES)


def privacy_classes_for(gemma_result: dict, *, image_uploaded: bool, gemma_image_review_succeeded: bool) -> list[str]:
    """The classes SAM3 should segment for this photo.

    Gemma normally decides, and when it has read the image its judgement is
    used as-is. But Ollama Cloud returns an intermittent 500 on image requests,
    and the first version of this treated that as "no scan needed" — clearing
    the class list so SAM3 never ran. A photo containing a face was then
    published unblurred purely because a *different* model had a bad call.

    SAM3 does not need Gemma to find a face. When the image review failed we
    still scan for the two things we can always protect. Blurring a face that
    did not need it costs nothing; publishing one that did is the failure this
    whole pipeline exists to prevent.
    """
    if not image_uploaded:
        return []
    if gemma_image_review_succeeded:
        return sam3_classes_for(gemma_result) if gemma_result.get("privacy_scan_required") is True else []
    return list(FALLBACK_PROTECTIVE_CLASSES)


def _run_gemma(config, *, title, description, selected_category, images, image_uploaded=False):
    """Returns (result, run_status, fallback_reason|None).

    `images` is every photo attached to the report that decoded successfully —
    a report is never limited to one, and Gemma judges them together in a
    single call rather than only ever seeing the first.

    When Gemma is unavailable, deterministic intake checks remain authoritative.
    The report fails open to the normal queue so an outage cannot discard a real
    civic concern. Its original media remains private until privacy checks pass.

    The status is decided here, at the point where we know *why* the call did
    not produce a result, rather than inferred later from the wording of an
    error message:

    * NOT_CONFIGURED — no API key, or the client library is absent. Nothing is
      broken; automatic review is simply switched off.
    * FAILED — a configured model that we could not get an answer out of.
    * COMPLETED — we have a result, even if its image half failed.
    """
    try:
        result = GemmaAnalyzer(configuration=config).analyze(
            title=title,
            description=description,
            selected_category=selected_category,
            images=images,
            image_uploaded=image_uploaded,
        )
        return result, ConcernAiAssessment.Status.COMPLETED, None
    except TextClassifierNotConfigured as exc:
        return (
            safe_needs_review(
                model_version=BASE_TEXT_MODEL,
                reason="Automated validation is unavailable. Required intake checks remain in effect.",
                image_attached=bool(images) or image_uploaded,
            ),
            ConcernAiAssessment.Status.NOT_CONFIGURED,
            str(exc),
        )
    except Exception as exc:
        reason = f"Gemma analysis failed: {exc.__class__.__name__}"
        logger.warning("Concern AI analysis failed: %s", reason)
        return (
            safe_needs_review(
                model_version=BASE_TEXT_MODEL,
                reason="Automated validation could not run. Required intake checks remain in effect.",
                image_attached=bool(images) or image_uploaded,
            ),
            ConcernAiAssessment.Status.FAILED,
            reason,
        )


def _prepare_media_image(media):
    if media is None:
        return None
    try:
        with media.file.open("rb") as handle:
            raw = handle.read()
    except (OSError, ValueError, NotImplementedError):
        logger.warning("Concern media %s could not be read for review.", media.pk)
        return None
    return prepare_image_for_gemma(raw, filename=media.original_filename, mime_type=media.mime_type)


def _visual_duplicate_check(config, *, concern: Concern, prepared_images: list[PreparedImage]) -> dict | None:
    """LLM photo-vs-photo comparison against earlier same-category reports.

    Candidates reuse the text-duplicate rules (same barangay + category, inside
    the lookback window and distance cap) but only reports that actually have a
    readable photo. Returns a payload for `duplicate.visual_check`, or None.
    """
    if not config.photo_duplicate_llm_enabled or not prepared_images:
        return None
    limit = max(1, int(config.photo_duplicate_candidate_limit))
    since = timezone.now() - timedelta(days=config.report_duplicate_lookback_days)
    pool = (
        Concern.objects.filter(
            category=concern.category,
            barangay=concern.barangay,
            created_at__gte=since,
        )
        .exclude(pk=concern.pk)
        .exclude(status=Concern.Status.REJECTED)
        .prefetch_related("media")
        .order_by("-created_at")[:200]
    )
    origin_lat = float(concern.latitude) if concern.latitude is not None else None
    origin_lon = float(concern.longitude) if concern.longitude is not None else None

    candidates: list[dict] = []
    for other in pool:
        if len(candidates) >= limit:
            break
        if origin_lat is None or origin_lon is None or other.latitude is None or other.longitude is None:
            distance = None
        else:
            distance = _haversine_m(origin_lat, origin_lon, float(other.latitude), float(other.longitude))
            if distance > config.report_duplicate_distance_meters:
                continue
        media = next((m for m in other.media.all() if m.mime_type.startswith("image/")), None)
        image = _prepare_media_image(media)
        if image is None:
            continue
        candidates.append({
            "concern_id": other.pk,
            "tracking_id": other.tracking_id,
            "captured_at": other.created_at.date().isoformat(),
            "distance_meters": round(distance, 1) if distance is not None else None,
            "image": image,
        })
    if not candidates:
        return None

    comparisons = compare_photo_duplicates(submitted_images=prepared_images, candidates=candidates)
    payload = {
        "checked": True,
        "candidate_count": len(candidates),
        "comparisons": comparisons or [],
    }
    if comparisons is None:
        payload["checked"] = False
        payload["skip_reason"] = "vision_check_unavailable"
    return payload


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def _street_imagery_check(config, *, concern: Concern, prepared_images: list[PreparedImage]) -> dict | None:
    """Fetch the newest street panorama near the pin and verify the photo(s).

    Runs only when enabled AND the report's category was ticked in the config —
    categories that never need a photo are simply never ticked. Any provider
    failure, missing coverage, or missing input degrades to a skip status; this
    check can never block on its own unavailability. A checked but inconclusive
    comparison is different: it means the resident needs to submit a wider
    contextual photo when the configured policy requires resubmission. Every
    attached photo is sent, not just the first, so a wider shot with more
    surroundings can still confirm the place even when other photos are tight
    close-ups of just the issue.
    """
    # Keep an explicit outcome in the audit payload even when the optional
    # check is not applicable. Previously ``None`` made an accepted report
    # look as if Street View had crashed or been forgotten, which made it
    # impossible for an official to tell a valid skip from a failed run.
    if not config.street_imagery_enabled:
        return {"status": "disabled"}
    if concern.category not in (config.street_imagery_categories or []):
        return {"status": "not_applicable", "reason": "category_not_enabled"}
    if not prepared_images or concern.latitude is None or concern.longitude is None:
        return {"status": "skipped", "reason": "missing_photo_or_location"}

    imagery = fetch_latest_street_imagery(
        latitude=float(concern.latitude),
        longitude=float(concern.longitude),
        radius_meters=config.street_imagery_radius_meters,
    )
    if imagery is None:
        return {"status": "no_coverage"}

    street_prepared = PreparedImage(data=imagery.image_b64, mime_type="image/jpeg", telemetry={})
    verdict = verify_street_context(submitted=prepared_images, street=street_prepared)
    if verdict is None:
        return {
            "status": "skipped",
            "reason": "verification_unavailable",
            "pano_id": imagery.pano_id,
            "captured_date": imagery.captured_date,
            "image_b64": imagery.image_b64,
        }
    return {
        "status": "checked",
        "verdict": verdict["verdict"],
        "explanation": verdict["explanation"],
        "pano_id": imagery.pano_id,
        "captured_date": imagery.captured_date,
        "distance_meters": imagery.distance_meters,
        "latitude": imagery.latitude,
        "longitude": imagery.longitude,
        "image_b64": imagery.image_b64,
    }


def _media_integrity_check(
    config,
    *,
    details: dict,
    prepared_images: list[PreparedImage],
    image_review_succeeded,
) -> dict:
    """Settle whether any submitted photo looks manipulated, AI-made, or impossible.

    The main analysis already produced a per-photo opinion — the image was
    attached to that call anyway, so asking cost nothing extra. This applies
    the confidence floor and hands that verdict back as-is.
    """
    minimum = float(getattr(config, "media_integrity_min_confidence", None) or 0.70)
    # The parser applies this floor too. It is applied again here because this
    # is the last point before a verdict can reject someone's report, and the
    # details dict does not always arrive through the parser — a replayed run,
    # a fixture, or a future caller would otherwise act on a 0.3 hunch.
    findings = [
        {**finding, "verdict": "inconclusive", "signals": []}
        if finding.get("verdict") in INTEGRITY_FLAGGED_VERDICTS
        and float(finding.get("confidence") or 0.0) < minimum
        else finding
        for finding in (details.get("media_integrity") or [])
    ]
    overall = integrity_overall(findings)

    if not config.media_integrity_enabled:
        return {"status": "disabled", "findings": [], "overall": "inconclusive"}
    if not prepared_images or image_review_succeeded is not True:
        return {"status": "skipped", "reason": "no_reviewable_photo", "findings": [], "overall": "inconclusive"}

    return {"status": "checked", "findings": findings, "overall": overall}


def process_concern_ai(concern_id: int, *, expected_run_id: str | None = None) -> ConcernAiAssessment:
    concern = Concern.objects.prefetch_related("media").get(pk=concern_id)
    assessment, _ = ConcernAiAssessment.objects.get_or_create(
        concern=concern,
        defaults={"status": ConcernAiAssessment.Status.PENDING},
    )

    config = ConcernClassificationConfiguration.current(concern.community)
    image_media_list = [media for media in concern.media.all() if media.mime_type.startswith("image/")]
    image_uploaded = bool(image_media_list)
    # Every attached photo is decoded and sent together, not just the first —
    # a report is never limited to one, and a photo further down the list is
    # not less real evidence than the first.
    prepared_images = [image for image in (_prepare_media_image(media) for media in image_media_list) if image is not None]

    # Photos that exist but none could be decoded is a failed review, not an
    # absent one. Recording it here is what keeps "no photo was submitted" off
    # the screen for a report that has one.
    prepare_failed = image_uploaded and not prepared_images

    started = time.monotonic()
    gemma_result, run_status, fallback_reason = _run_gemma(
        config,
        title=concern.title,
        description=concern.description,
        selected_category=concern.category,
        images=prepared_images,
        image_uploaded=image_uploaded,
    )
    gemma_duration_ms = int((time.monotonic() - started) * 1000)
    details = gemma_result.details or {}
    # The subject is generated as part of the existing asynchronous Gemma run.
    # Validate it here and always keep a concrete local fallback for model
    # outages, malformed output, or reports that predate this field.
    details["notification_subject"] = build_notification_subject(
        details.get("notification_subject"),
        title=concern.title,
        description=concern.description,
        category=concern.category,
    )

    image_review_succeeded = details.get("image_review_succeeded")
    if prepare_failed:
        image_review_succeeded = False
    if not image_uploaded:
        image_review_succeeded = None

    evidence_relationship = details.get("evidence_relationship") or "image_unavailable"
    if prepare_failed:
        evidence_relationship = "image_review_failed"

    sam3_classes = privacy_classes_for(
        details,
        image_uploaded=image_uploaded,
        gemma_image_review_succeeded=image_review_succeeded is True,
    )
    run_sam3 = bool(sam3_classes)

    duplicate_match = find_duplicate_concern(
        concern,
        enabled=config.duplicate_detection_enabled,
        threshold=getattr(config, "report_duplicate_similarity_threshold", config.duplicate_threshold),
        lookback_days=getattr(config, "report_duplicate_lookback_days", 180),
        distance_meters=getattr(config, "report_duplicate_distance_meters", 1000),
    )
    duplicate_payload = duplicate_match.as_payload(
        enabled=config.duplicate_detection_enabled,
        threshold=config.duplicate_threshold,
    )

    visual_duplicate = _visual_duplicate_check(config, concern=concern, prepared_images=prepared_images)
    if visual_duplicate:
        duplicate_payload["visual_check"] = visual_duplicate

    try:
        issue_count = int(details.get("issue_count", 1))
    except (TypeError, ValueError):
        issue_count = 1
    street_check = (
        None
        if issue_count != 1
        else _street_imagery_check(config, concern=concern, prepared_images=prepared_images)
    )

    integrity_check = _media_integrity_check(
        config,
        details=details,
        prepared_images=prepared_images,
        image_review_succeeded=image_review_succeeded,
    )
    details["media_integrity"] = integrity_check["findings"]
    details["media_integrity_overall"] = integrity_check["overall"]
    photo_evidence_contradicted = _photo_evidence_contradicted(details)
    photo_evidence_unsupported = _photo_evidence_unsupported(
        details,
        photo_count=len(image_media_list),
    )
    if photo_evidence_contradicted or photo_evidence_unsupported:
        details["recommended_action"] = "request_more_information"

    # The model owns category selection. The report's initial category is only
    # a storage fallback until the model returns a configured category.
    category_match = bool(gemma_result.category)
    initial_category = concern.category

    recommended_action = details.get("recommended_action") or "accept"
    recommendation = _recommendation(
        recommended_action,
        possible_duplicate=duplicate_match.possible_duplicate,
    )

    analysis_result = {
        "review": {
            **details,
            "provider": config.nlp_provider,
            "model_version": gemma_result.model_version,
        },
        "media_integrity": integrity_check,
        "photo": {
            "image_uploaded": image_uploaded,
            "image_count": len(image_media_list),
            "image_review_succeeded": image_review_succeeded,
            "evidence_relationship": evidence_relationship,
            "sam3_triggered": run_sam3,
            "sam3_requested_classes": sam3_classes if run_sam3 else [],
        },
        "suggested_category": gemma_result.category,
        "duplicate": duplicate_payload,
    }
    if street_check:
        analysis_result["street_imagery"] = street_check
    if fallback_reason:
        # Developer-only. Serializers never expose `raw_result` to officials.
        analysis_result["review"]["fallback_reason"] = fallback_reason

    flag_reasons = _flag_reasons(
        config,
        is_suspicious=gemma_result.is_suspicious,
        is_irrelevant=gemma_result.is_irrelevant,
        label=gemma_result.label,
        possible_duplicate=duplicate_match.possible_duplicate,
        urgent_attention=bool(details.get("urgent_attention")),
        integrity_check=integrity_check,
    )
    if photo_evidence_contradicted:
        flag_reasons.append({"reason": "photo_description_mismatch"})
    if (
        street_check
        and street_check.get("status") == "checked"
        and street_check.get("verdict") in {"area_mismatch", "inconclusive"}
    ):
        # Both outcomes need to remain visible in the official audit trail.
        # A mismatch is strong evidence of a wrong pin; an inconclusive result
        # means the submitted photo did not provide enough surrounding context
        # to verify the pin. Neither should be silently treated as a clean
        # location check.
        flag_reasons.append({
            "reason": f"street_imagery_{street_check['verdict']}",
            "pano_date": street_check.get("captured_date"),
        })
    if visual_duplicate:
        same = [c for c in visual_duplicate.get("comparisons", []) if c.get("verdict") == "same_issue"]
        if same:
            flag_reasons.append({"reason": "visual_duplicate", "matches": len(same)})

    result_values = {
        "status": run_status,
        "detected_objects": details.get("detected_objects") or [],
        "severity_estimate": gemma_result.severity,
        "severity_reason": details.get("severity_reason") or "",
        "nlp_validity": gemma_result.label,
        "nlp_confidence": gemma_result.confidence,
        "category_match": bool(category_match),
        "image_review_succeeded": image_review_succeeded,
        "evidence_relationship": evidence_relationship,
        "privacy_scan_required": bool(details.get("privacy_scan_required")),
        "privacy_scan_reasons": details.get("privacy_scan_reasons") or [],
        "suspected_sensitive_classes": sam3_classes,
        "urgent_attention": bool(details.get("urgent_attention")),
        "missing_information": details.get("missing_information") or [],
        "recommended_action": recommended_action,
        "recommendation": recommendation,
        "explanation": details.get("short_explanation") or "",
        "model_version": f"gemma:{gemma_result.model_version}",
        "flagged": bool(flag_reasons),
        "flag_reasons": flag_reasons,
    }

    media_to_queue: list[int] = []
    with transaction.atomic():
        current = ConcernAiAssessment.objects.select_for_update().get(pk=assessment.pk)
        execution = dict((current.raw_result or {}).get("execution") or {})
        if expected_run_id and execution.get("run_id") != expected_run_id:
            raise StaleAiRun("The AI run lease was replaced before inference completed.")
        for field, value in result_values.items():
            setattr(current, field, value)
        current.raw_result = {
            **analysis_result,
            **({"execution": execution} if execution else {}),
        }
        current.save()

        media_to_queue = _stage_media_privacy(
            image_media_list,
            run_sam3=run_sam3,
            sam3_classes=sam3_classes,
            image_review_succeeded=image_review_succeeded,
        )

        _apply_formatted_summary(concern, details=details, run_status=run_status)

        _apply_automated_validation(
            concern,
            run_status=run_status,
            details=details,
            photo_count=len(image_media_list),
            suggested_category=gemma_result.category,
            duplicate_match=duplicate_match,
            config=config,
            street_check=street_check,
            integrity_check=integrity_check,
        )

        _record_decision_log(
            concern,
            details=details,
            integrity_check=integrity_check,
            street_check=street_check,
            model_version=gemma_result.model_version,
            duration_ms=gemma_duration_ms,
            initial_category=initial_category,
        )

        if media_to_queue:
            for media_id in media_to_queue:
                transaction.on_commit(
                    lambda media_id=media_id, concern_id=concern.pk: _enqueue_media_privacy_if_present(
                        media_id,
                        concern_id,
                    )
                )
    return current


def _apply_formatted_summary(concern, *, details, run_status) -> None:
    subject = (details.get("notification_subject") or "").strip()[:80]
    title = (details.get("report_title") or "").strip()[:140]
    summary = (details.get("text_assessment") or "").strip()[:300]
    updates = {}
    if subject and concern.notification_subject != subject:
        updates["notification_subject"] = subject
    if run_status != ConcernAiAssessment.Status.COMPLETED:
        if updates:
            for field, value in updates.items():
                setattr(concern, field, value)
            concern.save(update_fields=list(updates))
        return
    if title and concern.official_title != title:
        updates["official_title"] = title
    if summary and concern.summary != summary:
        updates["summary"] = summary
    if not updates:
        return
    for field, value in updates.items():
        setattr(concern, field, value)
    concern.save(update_fields=list(updates))


def _record_decision_log(
    concern,
    *,
    details,
    integrity_check,
    street_check,
    model_version,
    duration_ms,
    initial_category,
) -> None:
    """Append one audit row for this run.

    The concern pipeline is the highest-volume model path in the system and
    until now it wrote no audit row at all: `LlmDecisionLog.Domain.CONCERN`
    existed as an enum value that nothing ever used. Without this there is
    nothing behind the "photos checked" counters on the Configuration screen,
    and no way to answer "what did the model actually say about that report
    last Tuesday".

    Never allowed to fail the run — an audit row is worth less than the
    validation result it describes.
    """
    from apps.concerns.models import LlmDecisionLog

    rejection_source = {
        "automated_street_imagery": "Street-view location check",
        "automated_street_imagery_resubmit": "Street-view location check",
        "automated_street_imagery_inconclusive": "Street-view location check",
        "automated_street_imagery_inconclusive_resubmit": "Street-view location check",
        "automated_media_integrity": "Photo authenticity check",
        "automated_media_integrity_resubmit": "Photo authenticity check",
        "automated_irrelevant": "Relevance check",
        "automated_incomplete": "Required information check",
        "automated_multiple_issues": "Description issue-count check",
        "automated_unclear_description": "Description clarity check",
    }
    output_snapshot = {
        "model_recommended_action": details.get("recommended_action"),
        "street_imagery": street_check or {},
        "media_integrity": (integrity_check or {}).get("findings") or [],
        "media_integrity_overall": (integrity_check or {}).get("overall"),
        "media_integrity_status": (integrity_check or {}).get("status"),
        "final_decision": {
            "status": concern.validation_status,
            "reason": concern.validation_summary,
            "source": rejection_source.get(concern.rejection_code, "Automated validation"),
        },
    }
    try:
        LlmDecisionLog.objects.create(
            run_kind=LlmDecisionLog.RunKind.PRODUCTION,
            domain=LlmDecisionLog.Domain.CONCERN,
            concern=concern,
            model_version=model_version or "",
            duration_ms=duration_ms,
            input_snapshot={
                "title": (concern.title or "")[:300],
                "description": (concern.description or "")[:2000],
                "initial_category": initial_category,
                "location": (concern.address or "")[:255],
            },
            output_snapshot={
                **output_snapshot,
                "relevance": details.get("relevance"),
        "primary_category": details.get("primary_category"),
        "issue_count": details.get("issue_count"),
        "notification_subject": details.get("notification_subject"),
                "severity": details.get("severity"),
                "evidence_relationship": details.get("evidence_relationship"),
            },
            resident_message=details.get("short_explanation") or "",
            recommended_action=details.get("recommended_action") or "",
            assigned_department=concern.assigned_department,
            routing_reason=details.get("emergency_routing_reason") or "",
        )
    except Exception:
        logger.warning("Could not write the LLM decision log for concern_id=%s", concern.pk, exc_info=True)


def _notify_validated_and_routed_concern(concern_id: int) -> None:
    from apps.notifications.models import Notification
    from apps.notifications.services import (
        notify_status_change,
        notify_validated_anonymous_concern_staff,
    )
    # Absolute import: this function runs from a transaction.on_commit
    # callback in the report-intake request. A relative `from .models` here
    # resolved to apps.concerns.ai.models, which does not exist — the
    # ModuleNotFoundError fired AFTER the concern had already committed, so
    # residents saw "Request failed." even though the report was created,
    # assigned a unit, and the success dialog never opened.
    from apps.concerns.models import Concern

    concern = Concern.objects.select_related(
        "reporter",
        "community",
        "assigned_department",
    ).get(pk=concern_id)
    if (
        concern.validation_status != Concern.ValidationStatus.ACCEPTED
        or not concern.assigned_department_id
    ):
        return
    if concern.is_anonymous:
        notify_validated_anonymous_concern_staff(concern)
        return
    if Notification.objects.filter(
        concern=concern,
        recipient=concern.reporter,
        type=Notification.Type.SUBMITTED,
    ).exists():
        return
    notify_status_change(concern)


def _reject_concern(concern: Concern, *, rejection_code: str, summary: str) -> None:
    concern.assigned_department = None
    concern.assignments.filter(status="active").update(status="cancelled")
    concern.validation_status = Concern.ValidationStatus.REJECTED
    concern.status = Concern.Status.REJECTED
    concern.status_version += 1
    concern.rejection_code = rejection_code
    concern.validation_summary = summary
    concern.update_text = concern.validation_summary
    concern.save(update_fields=[
        "category", "category_ref", "assigned_department", "duplicate_of",
        "validation_status", "validation_summary", "status", "status_version",
        "rejection_code", "update_text", "updated_at",
    ])
    ConcernStatusEvent.objects.create(
        concern=concern,
        status=Concern.Status.REJECTED,
        note=concern.validation_summary,
    )
    ConcernTimelineEntry.objects.create(
        concern=concern,
        event_type=ConcernTimelineEntry.EventType.STATUS_CHANGE,
        status=Concern.Status.REJECTED,
        message=concern.validation_summary,
    )

    def publish_rejection():
        from apps.notifications.services import notify_status_change

        # A resident-facing validation rejection is removed by the intake
        # transaction before it commits. Do not emit a notification for a row
        # that no longer exists.
        current = Concern.objects.filter(pk=concern.pk).first()
        if current is not None:
            notify_status_change(current)

    transaction.on_commit(publish_rejection)


def _apply_automated_validation(
    concern: Concern,
    *,
    run_status: str,
    details: dict,
    photo_count: int = 0,
    suggested_category: str,
    duplicate_match,
    config,
    street_check: dict | None = None,
    integrity_check: dict | None = None,
) -> None:
    """Finish validation without creating an AI-review task for an official."""
    uncertain = (
        run_status != ConcernAiAssessment.Status.COMPLETED
        or (bool(details.get("ai_result_uncertain")) and not bool(details.get("low_information")))
        or not suggested_category
    )
    relevance = str(details.get("relevance") or "").upper()
    action = str(details.get("recommended_action") or "")
    concern.assigned_department = None

    if duplicate_match.possible_duplicate and duplicate_match.matched_concern_id:
        concern.duplicate_of_id = duplicate_match.matched_concern_id

    try:
        issue_count = int(details.get("issue_count", 1))
    except (TypeError, ValueError):
        issue_count = 1
    if issue_count > 1:
        _reject_concern(
            concern,
            rejection_code="automated_multiple_issues",
            summary="Please report one issue at a time only",
        )
        return
    if issue_count == 0:
        _reject_concern(
            concern,
            rejection_code="automated_unclear_description",
            summary="Please describe one concern clearly and include only relevant details about the issue.",
        )
        return

    if uncertain:
        concern.validation_status = Concern.ValidationStatus.PENDING
        concern.validation_summary = (
            "Automated review could not be completed. Your report has not been assigned "
            "to a unit yet and is waiting for review."
        )
        concern.update_text = "Waiting for validation before routing."
        concern.save(update_fields=[
            "category", "category_ref", "assigned_department", "duplicate_of",
            "validation_status", "validation_summary", "update_text", "updated_at",
        ])
        return

    if _photo_evidence_contradicted(details):
        _reject_concern(
            concern,
            rejection_code="automated_photo_mismatch",
            summary=(
                "The photo contradicts the issue described in the report. Please submit a photo "
                "that shows the reported issue."
            ),
        )
        return

    if _photo_evidence_unsupported(details, photo_count=photo_count):
        _reject_concern(
            concern,
            rejection_code="automated_photo_unsupported",
            summary=(
                "Please submit a photo that clearly shows the reported issue."
            ),
        )
        return

    # The LLM classification is authoritative. Apply the configured category
    # it selected before resolving the department routing rule; there is no
    # resident-category mismatch decision in this flow anymore.
    _apply_suggested_category(concern, suggested_category)

    # Placed after the category correction and before everything else: a photo
    # that may be fabricated is a more serious finding than a wrong category,
    # and auto-correcting the category of a fabricated report first would file
    # it more neatly rather than stop it.
    if (
        not uncertain
        and integrity_check
        and integrity_check.get("status") == "checked"
        and flagged_integrity_findings(integrity_check.get("findings") or [])
    ):
        integrity_action = config.media_integrity_action
        Actions = ConcernClassificationConfiguration.MediaIntegrityAction
        if integrity_action == Actions.AUTO_REJECT:
            _reject_concern(
                concern,
                rejection_code="automated_media_integrity",
                summary=(
                    "The photo appears to be AI-generated or edited, so the "
                    "report was turned down automatically. Please submit again "
                    "with a genuine photo taken with your camera."
                ),
            )
            return
        if integrity_action == Actions.RESUBMIT:
            _reject_concern(
                concern,
                rejection_code="automated_media_integrity_resubmit",
                summary=(
                    "The photo appears to be AI-generated or edited. Please "
                    "submit again with a genuine photo taken with your camera."
                ),
            )
            return
        if integrity_action == Actions.HOLD:
            concern.assigned_department = None
            concern.validation_status = Concern.ValidationStatus.PENDING
            concern.validation_summary = (
                "The photo needs a check by an official before this report is routed."
            )
            concern.update_text = "An official will review the photo."
            concern.save(update_fields=[
                "category", "category_ref", "assigned_department", "duplicate_of",
                "validation_status", "validation_summary", "update_text", "updated_at",
            ])
            return
        # FLAG_NOTIFY falls through: the finding is already on the assessment
        # and in flag_reasons, and the report routes normally.

    reject_irrelevant = not uncertain and relevance == "IRRELEVANT"
    request_resubmission = not uncertain and action == "request_more_information"

    if reject_irrelevant or request_resubmission:
        _reject_concern(
            concern,
            rejection_code="automated_irrelevant" if reject_irrelevant else "automated_incomplete",
            summary=(
                "Automated validation rejected unrelated content."
                if reject_irrelevant
                else "More report details are required. Submit again with the missing information."
            ),
        )
        return

    # Street imagery checks whether the pin and submitted photo show the same
    # general place, never whether a passing panorama happens to contain the
    # reported pothole or other transient issue. A clear mismatch is acted on
    # immediately. An inconclusive result is also acted on when the configured
    # policy is resubmission/rejection: the resident needs to provide a wider
    # contextual photo before the report is allowed into the queue.
    if street_check and street_check.get("status") == "checked":
        street_verdict = street_check.get("verdict")
        if street_verdict in {"area_mismatch", "inconclusive"}:
            street_action = config.street_imagery_action
            Actions = ConcernClassificationConfiguration.StreetImageryAction
            if street_verdict == "inconclusive":
                reject_code = (
                    "automated_street_imagery_inconclusive"
                    if street_action == Actions.REJECT
                    else "automated_street_imagery_inconclusive_resubmit"
                )
                summary = (
                    "The submitted photo does not show enough surrounding landmarks to verify the "
                    "reported location. Please recapture a wider photo showing the road and nearby "
                    "buildings, signs, or other landmarks, then resubmit."
                )
            else:
                reject_code = (
                    "automated_street_imagery"
                    if street_action == Actions.REJECT
                    else "automated_street_imagery_resubmit"
                )
                summary = (
                    "Please pin the exact area where the issue is found."
                )

            if street_action in {Actions.REJECT, Actions.RESUBMIT}:
                _reject_concern(
                    concern,
                    rejection_code=reject_code,
                    summary=summary,
                )
                return

    # A configured location-policy review remains separate from AI validation.
    location_hold = concern.validation_status == Concern.ValidationStatus.PENDING and concern.validation_summary.startswith("Location ")
    if not location_hold:
        concern.validation_status = Concern.ValidationStatus.ACCEPTED
        concern.validation_summary = (
            "Automated validation passed."
        )
        concern.update_text = "Report is ready for routing."
        concern.assigned_department = _routing_department_for_concern(concern)
    else:
        concern.assigned_department = None
    concern.save(update_fields=[
        "category", "category_ref", "assigned_department", "duplicate_of",
        "validation_status", "validation_summary", "update_text", "updated_at",
    ])
    if concern.validation_status == Concern.ValidationStatus.ACCEPTED and concern.assigned_department_id:
        transaction.on_commit(
            lambda concern_id=concern.pk: _notify_validated_and_routed_concern(concern_id)
        )


def _apply_suggested_category(concern: Concern, suggested_category: str) -> None:
    category = (
        ConcernCategory.objects.filter(
            code=suggested_category,
            community=concern.community,
            is_active=True,
        )
        .select_related("department")
        .first()
        or ConcernCategory.objects.filter(
            code=suggested_category,
            community__isnull=True,
            is_active=True,
        )
        .select_related("department")
        .first()
    )
    if not category:
        if suggested_category in Concern.Category.values:
            concern.category = suggested_category
            # Never route with the previous category's department when the
            # LLM selected a legacy enum without a configured category row.
            concern.category_ref = None
        return
    concern.category = suggested_category
    concern.category_ref = category


def _photo_evidence_contradicted(details: dict) -> bool:
    relationship = str(details.get("evidence_relationship") or "").lower()
    if relationship == "contradicts_report":
        return True
    return any(
        isinstance(item, dict)
        and str(item.get("relevance") or "").lower() == "contradicts_report"
        for item in details.get("photo_verdicts") or []
    )


def _photo_evidence_unsupported(details: dict, *, photo_count: int | None = None) -> bool:
    """Require every successfully reviewed photo to visibly support the report.

    Location context and a generally related scene are not evidence of the
    claimed defect. For example, a photo of an intact wet road does not support
    a report of road damage even when another attached photo shows the damage.
    """
    if details.get("image_review_succeeded") is not True:
        return False
    if str(details.get("evidence_relationship") or "").lower() != "supports_report":
        return True
    verdicts = [item for item in details.get("photo_verdicts") or [] if isinstance(item, dict)]
    if not verdicts:
        return True
    if photo_count is not None and len(verdicts) < photo_count:
        return True
    return any(str(item.get("relevance") or "").lower() != "supports_report" for item in verdicts)


def _routing_department_for_concern(concern: Concern):
    category = concern.category_ref
    if not category:
        return None
    rule = category.routing_rules.filter(is_active=True).select_related("department").first()
    return rule.department if rule else category.department


def _stage_media_privacy(image_media, *, run_sam3: bool, sam3_classes: list[str], image_review_succeeded) -> list[int]:
    """Write each image's starting privacy state. Returns the ids to queue.

    Three outcomes, and only the first one ever queues Roboflow work:

    * Gemma asked for a scan → QUEUED, and the privacy task takes it from there.
    * Gemma read the image and asked for nothing → NOT_REQUIRED, publicly
      displayable. This is the honest state: nothing was found, which is not the
      same as a guarantee that nothing is there.
    * Gemma never managed to read the image → FAILED_RESTRICTED. The original
      stays restricted and a person has to look at it. We do not guess.
    """
    queued: list[int] = []
    for media in image_media:
        if run_sam3 or sam3_classes:
            media.privacy_state = ConcernMedia.PrivacyState.QUEUED
            media.privacy_requested_classes = list(sam3_classes)
            media.public_visible = False
            media.privacy_failure = {}
            queued.append(media.pk)
        elif image_review_succeeded is True:
            media.privacy_state = ConcernMedia.PrivacyState.NOT_REQUIRED
            media.privacy_requested_classes = []
            media.public_visible = True
            media.privacy_failure = {}
        else:
            media.privacy_state = ConcernMedia.PrivacyState.FAILED_RESTRICTED
            media.privacy_requested_classes = []
            media.public_visible = False
            media.privacy_failure = {"reason": "gemma_image_review_failed"}
        media.save(
            update_fields=[
                "privacy_state",
                "privacy_requested_classes",
                "public_visible",
                "privacy_failure",
            ]
        )
        if image_review_succeeded is True and not sam3_classes:
            # A no-scan result is already publishable. Create its sanitized
            # preview during the AI run so the first feed request never gets a
            # placeholder that has no task capable of replacing it.
            from ..services import ensure_concern_media_preview

            ensure_concern_media_preview(media)
    return queued


def _enqueue_media_privacy_if_present(media_id: int, concern_id: int) -> None:
    """Do not queue privacy work for a validation-rejected concern."""
    if not ConcernMedia.objects.filter(pk=media_id, concern_id=concern_id).exists():
        return
    from apps.concerns.tasks import enqueue_concern_media_privacy

    enqueue_concern_media_privacy(media_id)


def _flag_reasons(
    config,
    *,
    is_suspicious: bool,
    is_irrelevant: bool,
    label: str,
    possible_duplicate: bool,
    urgent_attention: bool,
    integrity_check: dict | None = None,
) -> list[dict]:
    # Driven by the analyzer-reported booleans, not by sniffing substrings out
    # of `label` — `label` is kept only for the human-readable payload.
    reasons: list[dict] = []
    if config.flag_suspicious and is_suspicious:
        reasons.append({"reason": "suspicious_text", "label": label})
    if config.flag_irrelevant and is_irrelevant:
        reasons.append({"reason": "irrelevant_text", "label": label})
    if possible_duplicate:
        reasons.append({"reason": "possible_duplicate"})
    if urgent_attention:
        reasons.append({"reason": "urgent_attention"})
    if integrity_check and integrity_check.get("status") == "checked":
        for finding in flagged_integrity_findings(integrity_check.get("findings") or []):
            reasons.append({
                "reason": "media_integrity",
                "verdict": finding.get("verdict"),
                "photo_index": finding.get("index"),
                "confidence": finding.get("confidence"),
                "signals": finding.get("signals") or [],
                "configured_action": config.media_integrity_action,
            })
    return reasons


def _recommendation(action: str, *, possible_duplicate: bool) -> str:
    """One short line for the queue list. The full wording lives in the UI.

    Duplicates and emergencies outrank the model's own suggestion because both
    change what the official should open next, not just how they should judge
    this one report.
    """
    if action == "escalate_as_emergency":
        return "Possible emergency; notify the appropriate personnel."
    if possible_duplicate:
        return "Possible duplicate linked to the earlier report."
    if action == "reject_as_irrelevant":
        return "Reject unrelated content automatically."
    if action == "request_more_information":
        return "Ask the resident to submit the missing details."
    if action == "accept_with_privacy_review":
        return "Continue using the protected image."
    if action == "accept":
        return "Valid report; continue to routing."
    return "Continue through the automatic validation rules."
