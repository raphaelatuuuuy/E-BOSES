"""Run automated validation for one concern.

Order of operations, and why:

1. **Gemma** reads the title, description, selected category and — when one
   decoded — the photo. It produces the whole assessment in a single call,
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

from .classification import BASE_TEXT_MODEL
from .duplicate_detector import find_duplicate_concern
from .gemma_analyzer import (
    CORE_SENSITIVE_CLASSES,
    INTEGRITY_FLAGGED_VERDICTS,
    GemmaAnalyzer,
    compare_photo_duplicates,
    confirm_media_integrity,
    flagged_integrity_findings,
    integrity_overall,
    safe_needs_review,
    sensitive_classes_from,
    verify_street_context,
)
from .image_prep import PreparedImage, prepare_image_for_gemma
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
    return sensitive_classes_from(gemma_result.get("suspected_sensitive_classes") or [])


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
    categories that never need a photo are simply never ticked. Any failure or
    gap degrades to a skip status; this check can never block on its own
    unavailability. Every attached photo is sent, not just the first, so a
    wider shot with more surroundings can still confirm the place even when
    other photos are tight close-ups of just the issue.
    """
    if not config.street_imagery_enabled:
        return None
    if concern.category not in (config.street_imagery_categories or []):
        return None
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
    attached to that call anyway, so asking cost nothing extra. What happens
    here is the part that decides whether that opinion is allowed to act.

    A flag has to survive a second, independent look before it counts. One
    vision pass over a compressed night photo of a wet road will occasionally
    call it edited, and the price of believing that is turning away a real
    report from a real resident. The second pass is asked cold, with the first
    verdict presented as a claim to check rather than a conclusion to endorse.

    Every failure path here lands on "not flagged". A model outage, a photo
    that would not decode, the check being switched off — none of them may
    invent a finding, and none of them may state that a photo is genuine
    either. Both directions are unsupported when nobody looked.
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
    result = {
        "status": "checked",
        "findings": findings,
        "overall": overall,
        "second_opinion": "not_required",
    }

    if not config.media_integrity_enabled:
        return {"status": "disabled", "findings": [], "overall": "inconclusive", "second_opinion": "not_required"}
    if not prepared_images or image_review_succeeded is not True:
        return {"status": "skipped", "reason": "no_reviewable_photo", "findings": [], "overall": "inconclusive", "second_opinion": "not_required"}

    flagged = flagged_integrity_findings(findings)
    if not flagged:
        return result
    if not config.media_integrity_second_opinion_enabled:
        result["second_opinion"] = "disabled"
        return result

    minimum = float(getattr(config, "media_integrity_min_confidence", None) or 0.70)
    confirmations = []
    survivors = []
    for finding in flagged:
        index = int(finding.get("index", -1))
        if index < 0 or index >= len(prepared_images):
            continue
        second = confirm_media_integrity(
            image=prepared_images[index],
            verdict=str(finding.get("verdict") or ""),
            signals=list(finding.get("signals") or []),
            min_confidence=minimum,
        )
        confirmations.append({"index": index, "result": second})
        if second and second["agrees"]:
            survivors.append(index)

    # Anything the second pass did not confirm is downgraded in place, so the
    # findings list an official reads never carries a flag the system chose not
    # to act on.
    settled = []
    for finding in findings:
        if finding in flagged and int(finding.get("index", -1)) not in survivors:
            settled.append({**finding, "verdict": "inconclusive", "signals": []})
        else:
            settled.append(finding)

    result["findings"] = settled
    result["overall"] = integrity_overall(settled)
    result["second_opinion"] = "confirmed" if survivors else "not_confirmed"
    result["confirmations"] = confirmations
    return result


def process_concern_ai(concern_id: int, *, expected_run_id: str | None = None) -> ConcernAiAssessment:
    concern = Concern.objects.prefetch_related("media").get(pk=concern_id)
    assessment, _ = ConcernAiAssessment.objects.get_or_create(
        concern=concern,
        defaults={"status": ConcernAiAssessment.Status.PENDING},
    )

    config = ConcernClassificationConfiguration.current()
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

    street_check = _street_imagery_check(config, concern=concern, prepared_images=prepared_images)

    integrity_check = _media_integrity_check(
        config,
        details=details,
        prepared_images=prepared_images,
        image_review_succeeded=image_review_succeeded,
    )
    details["media_integrity"] = integrity_check["findings"]
    details["media_integrity_overall"] = integrity_check["overall"]

    category_match = details.get("selected_category_match")
    if category_match is None:
        category_match = bool(gemma_result.category) and gemma_result.category == concern.category

    recommended_action = details.get("recommended_action") or "accept"
    recommendation = _recommendation(
        recommended_action,
        category_match=bool(category_match),
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
        category_match=bool(category_match),
        possible_duplicate=duplicate_match.possible_duplicate,
        urgent_attention=bool(details.get("urgent_attention")),
        integrity_check=integrity_check,
    )
    if street_check and street_check.get("status") == "checked" and street_check.get("verdict") == "area_mismatch":
        # Street imagery only ever checks whether the pin sits in the same
        # place as the photo, never whether the specific issue is visible in
        # a passing car's panorama — that is a coverage lottery, not evidence
        # of anything wrong. "inconclusive" is the expected everyday outcome
        # and must never flag a report for review.
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

        _apply_automated_validation(
            concern,
            run_status=run_status,
            details=details,
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
            model_version=gemma_result.model_version,
            duration_ms=gemma_duration_ms,
        )

        if media_to_queue:
            from apps.concerns.tasks import enqueue_concern_media_privacy

            for media_id in media_to_queue:
                transaction.on_commit(
                    lambda media_id=media_id: enqueue_concern_media_privacy(media_id)
                )
    return current


def _record_decision_log(concern, *, details, integrity_check, model_version, duration_ms) -> None:
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
                "selected_category": concern.category,
            },
            output_snapshot={
                "relevance": details.get("relevance"),
                "primary_category": details.get("primary_category"),
                "severity": details.get("severity"),
                "evidence_relationship": details.get("evidence_relationship"),
                "media_integrity": (integrity_check or {}).get("findings") or [],
                "media_integrity_overall": (integrity_check or {}).get("overall"),
                "media_integrity_status": (integrity_check or {}).get("status"),
                "second_opinion": (integrity_check or {}).get("second_opinion"),
            },
            resident_message=details.get("short_explanation") or "",
            recommended_action=details.get("recommended_action") or "",
            assigned_department=concern.assigned_department,
            routing_reason=details.get("emergency_routing_reason") or "",
        )
    except Exception:
        logger.warning("Could not write the LLM decision log for concern_id=%s", concern.pk, exc_info=True)


def _reject_concern(concern: Concern, *, rejection_code: str, summary: str) -> None:
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

        notify_status_change(concern)

    transaction.on_commit(publish_rejection)


def _apply_automated_validation(
    concern: Concern,
    *,
    run_status: str,
    details: dict,
    suggested_category: str,
    duplicate_match,
    config,
    street_check: dict | None = None,
    integrity_check: dict | None = None,
) -> None:
    """Finish validation without creating an AI-review task for an official."""
    uncertain = run_status != ConcernAiAssessment.Status.COMPLETED or bool(details.get("ai_result_uncertain"))
    relevance = str(details.get("relevance") or "").upper()
    action = str(details.get("recommended_action") or "")

    if duplicate_match.possible_duplicate and duplicate_match.matched_concern_id:
        concern.duplicate_of_id = duplicate_match.matched_concern_id

    category_mismatch = not uncertain and bool(suggested_category) and suggested_category != concern.category
    if category_mismatch:
        mismatch_action = config.mismatch_action
        if mismatch_action == ConcernClassificationConfiguration.MismatchAction.REJECT:
            _reject_concern(
                concern,
                rejection_code="automated_category_mismatch",
                summary=(
                    "The selected category does not match what the report describes, so it was "
                    "rejected automatically. Please submit a new report with the correct category."
                ),
            )
            return
        if mismatch_action == ConcernClassificationConfiguration.MismatchAction.RESUBMIT:
            _reject_concern(
                concern,
                rejection_code="automated_category_mismatch_resubmit",
                summary=(
                    "The selected category does not match what the report describes. Please "
                    "resubmit this report using the correct category."
                ),
            )
            return
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
                    "The photo could not be confirmed as an original camera photo, so the "
                    "report was turned down automatically. Please submit again with a photo "
                    "taken directly from your camera."
                ),
            )
            return
        if integrity_action == Actions.RESUBMIT:
            _reject_concern(
                concern,
                rejection_code="automated_media_integrity_resubmit",
                summary=(
                    "The photo could not be confirmed as an original camera photo. Please "
                    "submit again with a photo taken directly from your camera."
                ),
            )
            return
        if integrity_action == Actions.HOLD:
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

    reject_irrelevant = not uncertain and relevance == "IRRELEVANT" and action == "reject_as_irrelevant"
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

    # Street imagery only ever checks whether the pin is in the same place as
    # the photo — never whether the specific issue is visible in a passing
    # car's panorama, since that is a coverage lottery any legitimate report
    # can lose. Only a genuine area_mismatch (a clearly different place) acts;
    # "inconclusive" is the ordinary outcome and must never block a real
    # concern, same as skips and no-coverage.
    if street_check and street_check.get("status") == "checked" and street_check.get("verdict") == "area_mismatch":
        street_action = config.street_imagery_action
        if street_action == ConcernClassificationConfiguration.StreetImageryAction.REJECT:
            _reject_concern(
                concern,
                rejection_code="automated_street_imagery",
                summary=(
                    "Current street imagery of the reported location does not match the location "
                    "described, so the report was rejected automatically."
                ),
            )
            return
        if street_action == ConcernClassificationConfiguration.StreetImageryAction.RESUBMIT:
            _reject_concern(
                concern,
                rejection_code="automated_street_imagery_resubmit",
                summary=(
                    "Current street imagery of the reported location does not match the location "
                    "described. Please double-check the location and photo, then resubmit."
                ),
            )
            return

    # A configured location-policy review remains separate from AI validation.
    location_hold = concern.validation_status == Concern.ValidationStatus.PENDING and concern.validation_summary.startswith("Location ")
    if not location_hold:
        concern.validation_status = Concern.ValidationStatus.ACCEPTED
        concern.validation_summary = (
            "Required intake checks passed; automated model validation was unavailable."
            if uncertain
            else "Automated validation passed."
        )
        concern.update_text = "Report is ready for routing."
    concern.save(update_fields=[
        "category", "category_ref", "assigned_department", "duplicate_of",
        "validation_status", "validation_summary", "update_text", "updated_at",
    ])


def _apply_suggested_category(concern: Concern, suggested_category: str) -> None:
    category = ConcernCategory.objects.filter(code=suggested_category, is_active=True).select_related("department").first()
    if not category:
        if suggested_category in Concern.Category.values:
            concern.category = suggested_category
        return
    rule = category.routing_rules.filter(is_active=True).select_related("department").first()
    concern.category = suggested_category
    concern.category_ref = category
    concern.assigned_department = rule.department if rule else category.department


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
    return queued


def _flag_reasons(
    config,
    *,
    is_suspicious: bool,
    is_irrelevant: bool,
    label: str,
    category_match: bool,
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
    if not category_match:
        reasons.append({"reason": "category_mismatch", "configured_action": config.mismatch_action})
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


def _recommendation(action: str, *, category_match: bool, possible_duplicate: bool) -> str:
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
    if not category_match:
        return "Use the detected category for routing."
    if action == "accept":
        return "Valid report; continue to routing."
    return "Continue through the automatic validation rules."
