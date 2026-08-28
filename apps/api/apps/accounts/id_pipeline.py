"""The order the three ID checks run in, and the gate between them.

A submitted ID passes through three layers, cheapest and most certain first:

  1. File check   — `media_forensics` layers 1-4. EXIF/PNG software tags, C2PA
                    provenance, ELA + noise inconsistency. Reads bytes, costs
                    milliseconds, and is the only layer that can prove an edit
                    rather than suspect one.
  2. Picture check — `id_integrity`. A vision model answers whether the photo
                    looks like a genuine physical card and whether it is the
                    same layout as the barangay's stored sample.
  3. Text reading — OCR plus the published field rules.

Each layer only runs when the one before it passed. That ordering is the point
of this module: OCR is the slowest and most expensive layer, it bills a hosted
provider per call, and its answer is worthless on a document the earlier layers
already rejected. Reading crisp text off a cartoon ID is not evidence of
anything.

`run_pre_ocr_gate` returns the verdict for layers 1-2. Callers run OCR only
when `passed` is True.
"""

import logging

from .media_forensics import forensics_findings

logger = logging.getLogger(__name__)

STAGE_FORENSICS = "media_forensics"
STAGE_INTEGRITY = "id_integrity"
STAGE_OCR = "ocr"

STAGE_LABELS = {
    STAGE_FORENSICS: "File check",
    STAGE_INTEGRITY: "Picture check",
    STAGE_OCR: "Text reading",
}

FORENSICS_RESUBMIT_MESSAGE = "Please upload the original document photo."


def _safe_id_integrity(*, content, document_type, configuration, side: str | None = None) -> dict | None:
    """Run the picture check, swallowing every failure into "not checked".

    Advisory by design. A missing key, a dead socket, or an unreadable file must
    never interrupt a registration, so no exception escapes and the caller reads
    None as "no opinion" — which lets OCR proceed.
    """
    try:
        from .id_integrity import check_id_integrity

        return check_id_integrity(
            submitted=content,
            document_type=document_type,
            configuration=configuration,
            side=side,
        )
    except Exception:
        logger.exception("ID integrity check failed; continuing without it")
        return None


def run_pre_ocr_gate(
    *,
    contents,
    document_type,
    configuration,
    run_forensics=True,
    forensics=None,
    sides=None,
) -> dict:
    """Layers 1-2 over every photo in one submission. OCR runs only if passed.

    `contents` is a list of raw image bytes — one entry per uploaded side. One
    bad photo condemns the submission: a forged front does not become acceptable
    because the back is genuine.

    `forensics` accepts a verdict the caller already computed. It matters which
    bytes layer 1 saw: normalizing an upload re-encodes it to JPEG, which strips
    EXIF and C2PA and rewrites the compression history ELA reads. Callers whose
    files were normalized on the way in must run `forensics_findings` on the
    bytes the resident actually sent and hand the answer here, rather than let
    this run against a re-encode that can no longer show an edit — or invent one.
    """
    blobs = [item for item in contents if item]

    if forensics is not None:
        forensics = dict(forensics)
    else:
        forensics = {"checked": False, "flagged": False, "layer": "", "message": ""}
        if run_forensics:
            for content in blobs:
                result = forensics_findings(content)
                if not forensics.get("checked") or result.get("flagged"):
                    forensics = result
                if result.get("flagged"):
                    break

    if forensics.get("flagged"):
        return {
            "passed": False,
            "blocked_by": STAGE_FORENSICS,
            "reached": STAGE_FORENSICS,
            "forensics": forensics,
            "integrity": None,
            "integrity_checks": [],
            "message": FORENSICS_RESUBMIT_MESSAGE,
            "detail": forensics.get("message") or "",
        }

    integrity = None
    integrity_checks = []
    for index, content in enumerate(blobs):
        side = None
        if sides and index < len(sides):
            candidate_side = str(sides[index] or "").strip().lower()
            side = candidate_side if candidate_side in {"front", "back", "single"} else None
        result = _safe_id_integrity(
            content=content,
            document_type=document_type,
            configuration=configuration,
            side=side,
        )
        if result is None:
            continue
        integrity_checks.append(result)
        if (
            integrity is None
            or result.get("flagged")
            or (
                result.get("integrity_advisory")
                and not integrity.get("flagged")
                and not integrity.get("integrity_advisory")
            )
        ):
            integrity = result

    if integrity and integrity.get("flagged"):
        from .id_integrity import RESUBMIT_MESSAGE, integrity_feedback

        return {
            "passed": False,
            "blocked_by": STAGE_INTEGRITY,
            "reached": STAGE_INTEGRITY,
            "forensics": forensics,
            "integrity": integrity,
            "integrity_checks": integrity_checks,
            "message": RESUBMIT_MESSAGE,
            "detail": integrity.get("feedback") or integrity_feedback(integrity),
        }

    return {
        "passed": True,
        "blocked_by": None,
        "reached": STAGE_OCR,
        "forensics": forensics,
        "integrity": integrity,
        "integrity_checks": integrity_checks,
        "message": "",
        "detail": "",
    }


def gate_payload(gate: dict | None) -> dict:
    """The shape the API hands the UI so it can draw the three stages."""
    if not gate:
        return {
            "reached": STAGE_OCR,
            "blocked_by": None,
            "forensics": {"checked": False, "flagged": False, "layer": "", "message": ""},
            "integrity_checked": False,
            "integrity_checks": [],
            "message": "",
            "detail": "",
        }
    return {
        "reached": gate.get("reached") or STAGE_OCR,
        "blocked_by": gate.get("blocked_by"),
        "forensics": gate.get("forensics") or {"checked": False, "flagged": False},
        "integrity_checked": bool(gate.get("integrity_checks")),
        "integrity_checks": gate.get("integrity_checks") or [],
        "message": gate.get("message") or "",
        "detail": gate.get("detail") or "",
    }
