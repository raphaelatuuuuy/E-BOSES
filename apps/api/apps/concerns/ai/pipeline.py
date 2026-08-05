"""Run the automatic review for one concern.

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

The soft-gate contract from the previous version is unchanged: this function
flags reports for official attention and never touches `validation_status`,
`status`, or any resident-visible workflow state.
"""

import logging

from django.db import transaction

from apps.concerns.models import (
    Concern,
    ConcernAiAssessment,
    ConcernClassificationConfiguration,
    ConcernMedia,
)

from .classification import BASE_TEXT_MODEL
from .duplicate_detector import find_duplicate_concern
from .gemma_analyzer import CORE_SENSITIVE_CLASSES, GemmaAnalyzer, safe_needs_review, sensitive_classes_from
from .image_prep import prepare_image_for_gemma
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


def _run_gemma(config, *, title, description, selected_category, image):
    """Returns (result, run_status, fallback_reason|None).

    Gemma is advisory. When it is unavailable the report goes to official review
    rather than falling back to hidden keyword rules.

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
            image=image,
        )
        return result, ConcernAiAssessment.Status.COMPLETED, None
    except TextClassifierNotConfigured as exc:
        return (
            safe_needs_review(
                model_version=BASE_TEXT_MODEL,
                reason="Automatic review is not switched on, so this report needs a manual look.",
                image_attached=image is not None,
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
                reason="The automatic review could not run, so this report needs a manual look.",
                image_attached=image is not None,
            ),
            ConcernAiAssessment.Status.FAILED,
            reason,
        )


def _first_image_media(concern) -> ConcernMedia | None:
    return next(
        (
            media
            for media in concern.media.all()
            if media.mime_type.startswith("image/") and hasattr(media.file, "path")
        ),
        None,
    )


def _prepare_first_image(media):
    if media is None:
        return None
    try:
        with open(media.file.path, "rb") as handle:
            raw = handle.read()
    except OSError:
        logger.warning("Concern media %s could not be read from disk for review.", media.pk)
        return None
    return prepare_image_for_gemma(raw, filename=media.original_filename, mime_type=media.mime_type)


def process_concern_ai(concern_id: int, *, expected_run_id: str | None = None) -> ConcernAiAssessment:
    concern = Concern.objects.prefetch_related("media").get(pk=concern_id)
    assessment, _ = ConcernAiAssessment.objects.get_or_create(
        concern=concern,
        defaults={"status": ConcernAiAssessment.Status.PENDING},
    )

    config = ConcernClassificationConfiguration.current()
    image_media_list = [media for media in concern.media.all() if media.mime_type.startswith("image/")]
    image_uploaded = bool(image_media_list)
    first_image_media = _first_image_media(concern)
    prepared_image = _prepare_first_image(first_image_media)

    # A photo that exists but could not be decoded is a failed review, not an
    # absent one. Recording it here is what keeps "no photo was submitted" off
    # the screen for a report that has one.
    prepare_failed = image_uploaded and prepared_image is None

    gemma_result, run_status, fallback_reason = _run_gemma(
        config,
        title=concern.title,
        description=concern.description,
        selected_category=concern.category,
        image=prepared_image,
    )
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

    category_match = details.get("selected_category_match")
    if category_match is None:
        category_match = bool(gemma_result.category) and gemma_result.category == concern.category

    recommended_action = details.get("recommended_action") or "manual_review"
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
    )

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

        # Soft gate only: this advisory summary never changes validation_status
        # or status. AI findings flag reports for official review, they never
        # auto-reject and never move the concern's real workflow state.
        summary = (
            "AI review flagged: " + ", ".join(reason["reason"].replace("_", " ") for reason in flag_reasons)
            if flag_reasons
            else "AI checks passed; cleared for official review."
        )
        Concern.objects.filter(pk=concern.pk).update(validation_summary=summary)

        if media_to_queue:
            from apps.concerns.tasks import enqueue_concern_media_privacy

            for media_id in media_to_queue:
                transaction.on_commit(
                    lambda media_id=media_id: enqueue_concern_media_privacy(media_id)
                )
    return current


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
        return "Possible duplicate; compare the nearby report before routing."
    if action == "reject_as_irrelevant":
        return "Review as a potentially unrelated submission."
    if action == "request_more_information":
        return "Request additional details from the resident."
    if action == "accept_with_privacy_review":
        return "Continue using the protected image."
    if not category_match:
        return "Review the category before assigning."
    if action == "accept":
        return "Likely valid; proceed with official review."
    return "Review this report manually."
