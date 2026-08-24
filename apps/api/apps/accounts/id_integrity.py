"""Look at a submitted ID as a picture, not as text.

The OCR engine reads what the card *says*. Every threshold, regex, and rule in
`ocr_engine.py` operates on extracted strings, so an ID whose fields parse
cleanly passes — no matter what the card looks like. A cartoon portrait, a
photo pasted on with no shadow, a fully rendered card with a scribbled seal:
all of them can produce perfectly valid text.

The byte-level layer (`media_forensics.py`) does not close that gap either. It
reads EXIF tags, PNG chunks, C2PA provenance, and ELA noise, so it catches a
Photoshop save or a tagged AI export. It cannot catch a screenshot (metadata
gone), a clean re-save, or a photograph of a screen (a real camera really did
take it).

So this asks the vision model two questions the other two layers cannot:

  A. Is this the same *kind of document* as the barangay's stored sample?
  B. Does it look like a genuine physical card, photographed by a camera?

Both are advisory. `check_id_integrity` returns None whenever it could not
form an opinion — a missing key, an unreadable file, a model outage — and the
callers treat None as "not checked". An outage must never tell a real resident
their document is illegitimate.
"""

import logging

from apps.concerns.ai.image_prep import PreparedImage, prepare_image_for_gemma
from apps.concerns.ai.gemma_analyzer import (
    INTEGRITY_FLAGGED_VERDICTS,
    INTEGRITY_VERDICTS,
    MAX_INTEGRITY_SIGNALS,
    _clean_strings,
    _clean_text,
    _vision_json_call,
)

logger = logging.getLogger(__name__)

FORMAT_VERDICTS = {"format_matches", "format_mismatch", "no_reference", "inconclusive"}

RESUBMIT_MESSAGE = (
    "This does not look like an original photo of a real document. "
    "Please submit a legitimate document."
)

DEFAULT_MIN_CONFIDENCE = 0.70


def integrity_settings(configuration) -> dict:
    """Policy for this check. Running it is not a choice; the threshold is.

    Whether to look at a submitted ID as a picture was briefly a pair of
    switches in the template builder, and it should not have been: an official
    turning them off does not make forged IDs less likely, it only makes them
    invisible, and nothing in the barangay's workflow depends on the check being
    off. So both now read as on, always. The confidence threshold stays
    configurable and stays in `OCRConfigurationVersion.settings`, because that
    row is an immutable-after-publish snapshot and a decision must remain
    traceable to the exact threshold that produced it.
    """
    raw = getattr(configuration, "settings", None) or {}
    try:
        minimum = float(raw.get("id_integrity_min_confidence", DEFAULT_MIN_CONFIDENCE))
    except (TypeError, ValueError):
        minimum = DEFAULT_MIN_CONFIDENCE
    return {
        "enabled": True,
        "compare_sample": True,
        "min_confidence": min(max(minimum, 0.0), 1.0),
    }


def reference_image(document_type) -> PreparedImage | None:
    """The barangay's stored sample for this document type, ready to send.

    Officials already upload these through the Template Builder so they can
    draw field boxes on them. Until now that was the only thing they were used
    for: the sample sat in private storage and no submission was ever compared
    against it.

    Prefers a real sample over a synthetic one — a synthetic card is drawn to
    exercise the field regions, not to look like the genuine article, so
    comparing layouts against it would produce mismatches on real IDs.
    """
    if document_type is None:
        return None
    candidates = []
    try:
        samples = document_type.samples.filter(is_active=True).order_by("is_synthetic", "name")
        candidates.extend(sample.file for sample in samples if sample.file)
    except Exception:
        logger.debug("Could not list OCR samples for document type %s", getattr(document_type, "code", "?"))
    legacy = getattr(document_type, "sample_file", None)
    if legacy:
        candidates.append(legacy)

    for field_file in candidates:
        try:
            with field_file.open("rb") as handle:
                content = handle.read()
        except Exception:
            continue
        prepared = prepare_image_for_gemma(content)
        if prepared is not None:
            return prepared
    return None


def _build_prompt(*, document_label: str, has_reference: bool) -> str:
    if has_reference:
        opening = (
            f"IMAGE 1 is the official reference sample of a {document_label}, kept by the "
            "barangay. IMAGE 2 is the document a resident has just submitted.\n\n"
            "Answer two separate questions about IMAGE 2.\n\n"
            "(A) format_verdict — is IMAGE 2 the same KIND of document as IMAGE 1?\n"
            "Compare the layout only: where the portrait box sits, the header and "
            "issuing-authority wording, the placement of the seal or logo, which field "
            "labels appear and in what order, the colour scheme, the proportions of the "
            "card, and any background security pattern.\n"
            "IGNORE the personal details completely. A different name, portrait, address, "
            "signature, or number is expected and normal — it is a different person.\n"
            "IGNORE lighting, camera angle, crop, glare, print wear, and image quality.\n"
            "Answer format_matches when it is recognisably the same template, "
            "format_mismatch when it is clearly a different document, or inconclusive "
            "when you genuinely cannot tell.\n\n"
        )
    else:
        opening = (
            f"IMAGE 1 is a {document_label} a resident has just submitted. The barangay has "
            "no reference sample for this document type, so do not judge the layout.\n"
            'Set format_verdict to "no_reference".\n\n'
        )

    subject = "IMAGE 2" if has_reference else "IMAGE 1"
    return (
        "You check identity documents submitted to E-Boses, a barangay system in the "
        "Philippines.\n\n"
        f"{opening}"
        f"(B) integrity_verdict — look at {subject} on its own. Does it look like a "
        "genuine physical card, photographed by a camera?\n"
        "Signs that it does not:\n"
        "- the portrait is a cartoon, drawing, rendering, logo, animal, or a well-known "
        "fictional character rather than an ordinary photograph of a person\n"
        "- the portrait does not sit flat on the card: lighting from the wrong "
        "direction, a visible cut-out edge, no shadow, or a sharpness plainly different "
        "from the rest of the card\n"
        "- text in one field is in a different font, weight, baseline, or sharpness from "
        "its neighbours, suggesting a value was replaced\n"
        "- header, seal, or security-print text that is warped, misspelled, or dissolves "
        "into scribble\n"
        "- a smooth, grainless, rendered surface, or small text that turns to mush, "
        "suggesting the whole card was generated\n"
        "- screen glare, moire, a pixel grid, or a device bezel, meaning this is a photo "
        "of a screen rather than of a card\n\n"
        "integrity_verdict must be authentic, suspected_edit, suspected_ai, "
        "impossible_content, photo_of_screen, or inconclusive.\n\n"
        "IMPORTANT — these are normal in a photo of a real card and must NEVER be "
        "treated as signs of forgery: blur, motion blur, low light, grain, compression "
        "artefacts, a photo taken at an angle, a cropped edge, glare from a flash or a "
        "window, a scratched or worn card, a fingerprint on the surface, a plastic "
        "sleeve, or a shadow cast by the person holding it.\n\n"
        "Answer inconclusive whenever the image is too blurry, dark, small, or cropped "
        "to judge. That is a normal and correct answer, and it is far better than a "
        "guess: a wrong flag turns away a real resident with a real ID.\n\n"
        "Never state that a document is genuine or verified. \"authentic\" means only "
        "that you saw no sign of a problem.\n\n"
        "signals must list only what you can actually see, as short plain phrases, for "
        'example "the portrait is a cartoon character, not a photograph". Leave it empty '
        "unless you are reporting a problem.\n\n"
        'Respond as JSON: {"format_verdict": "...", "integrity_verdict": "...", '
        '"confidence": 0.0, "signals": [], "note": "one short sentence"}'
    )


def check_id_integrity(*, submitted, document_type, configuration) -> dict | None:
    """Judge one submitted ID. None means "not checked" — never a finding.

    `submitted` is raw image bytes or a PreparedImage.
    """
    policy = integrity_settings(configuration)
    if not policy["enabled"]:
        return None

    if isinstance(submitted, PreparedImage):
        submitted_image = submitted
    else:
        submitted_image = prepare_image_for_gemma(submitted)
    if submitted_image is None:
        return None

    reference = reference_image(document_type) if policy["compare_sample"] else None
    label = (
        getattr(document_type, "display_template_name", None)
        or getattr(document_type, "name", None)
        or "government identity document"
    )
    images = [reference, submitted_image] if reference is not None else [submitted_image]
    parsed = _vision_json_call(
        prompt=_build_prompt(document_label=label, has_reference=reference is not None),
        images=images,
    )
    if not parsed:
        return None

    format_verdict = str(parsed.get("format_verdict") or "").lower().strip()
    if reference is None:
        format_verdict = "no_reference"
    elif format_verdict not in FORMAT_VERDICTS or format_verdict == "no_reference":
        format_verdict = "inconclusive"

    integrity_verdict = str(parsed.get("integrity_verdict") or "").lower().strip()
    if integrity_verdict not in INTEGRITY_VERDICTS:
        integrity_verdict = "inconclusive"

    try:
        confidence = round(min(max(float(parsed.get("confidence") or 0.0), 0.0), 1.0), 3)
    except (TypeError, ValueError):
        confidence = 0.0

    # One number gates both verdicts. A low-confidence opinion is not evidence,
    # and the cost of believing one here is a real resident being told their
    # real ID is fake.
    if confidence < policy["min_confidence"]:
        if integrity_verdict in INTEGRITY_FLAGGED_VERDICTS:
            integrity_verdict = "inconclusive"
        if format_verdict == "format_mismatch":
            format_verdict = "inconclusive"

    flagged = integrity_verdict in INTEGRITY_FLAGGED_VERDICTS or format_verdict == "format_mismatch"
    return {
        "checked": True,
        "compared_to_sample": reference is not None,
        "format_verdict": format_verdict,
        "integrity_verdict": integrity_verdict,
        "confidence": confidence,
        "flagged": flagged,
        "signals": _clean_strings(parsed.get("signals"))[:MAX_INTEGRITY_SIGNALS] if flagged else [],
        "note": _clean_text(parsed.get("note"))[:200],
    }


def authenticity_score(result: dict | None) -> float | None:
    """1.0 means nothing was found. None means nobody looked.

    Fills `VerificationCheck.authenticity_score`, which has been in the schema
    since the first migration and has never been written to.
    """
    if not result or not result.get("checked"):
        return None
    confidence = float(result.get("confidence") or 0.0)
    return round(1.0 - confidence, 3) if result.get("flagged") else 1.0
