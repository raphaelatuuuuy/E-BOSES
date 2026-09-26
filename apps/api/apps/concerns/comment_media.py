from pathlib import Path
import os
import tempfile

from django.core.files.base import ContentFile

from apps.accounts.media_services import build_redacted_preview_bytes
from apps.accounts.services import validate_concern_chat_attachment

from .ai.gemma_analyzer import verify_street_context
from .ai.image_prep import PreparedImage, prepare_image_for_gemma
from .ai.street_imagery import fetch_latest_street_imagery
from .models import ConcernClassificationConfiguration, PublicCommentAttachment


def _read_file(file_obj) -> bytes:
    file_obj.seek(0)
    content = file_obj.read()
    file_obj.seek(0)
    return content


def _representative_video_frame(raw: bytes, filename: str) -> bytes | None:
    """Extract one middle frame so sent videos can use the same pin comparison."""
    suffix = Path(filename).suffix.lower() or ".mp4"
    path = ""
    try:
        import cv2

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            handle.write(raw)
            path = handle.name
        capture = cv2.VideoCapture(path)
        try:
            count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if count > 1:
                capture.set(cv2.CAP_PROP_POS_FRAMES, count // 2)
            ok, frame = capture.read()
            if not ok:
                capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = capture.read()
            if not ok:
                return None
            encoded, jpeg = cv2.imencode(".jpg", frame)
            return jpeg.tobytes() if encoded else None
        finally:
            capture.release()
    except Exception:
        return None
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


def _comment_street_fast_status(*, concern) -> dict | None:
    """Pure-config gates for the comment street check (no I/O, no model).

    Returns a terminal status when the check can never apply, else None
    meaning "needs the worker" (PIL + Google tiles + vision).
    """
    config = ConcernClassificationConfiguration.current(concern.community)
    if not config.street_imagery_enabled:
        return {"status": "disabled"}
    if concern.category not in (config.street_imagery_categories or []):
        return {"status": "not_applicable", "reason": "category_not_enabled"}
    if concern.latitude is None or concern.longitude is None:
        return {"status": "skipped", "reason": "concern_has_no_pin"}
    return None


def compare_comment_image_to_concern_pin(*, concern, raw: bytes, filename: str, mime_type: str) -> dict:
    """Compare a sent comment image with the concern pin; absence never blocks posting.

    NOTE: worker-only. The request thread must not call this (Google tiles +
    vision); it stores ``pending`` and dispatches ``run_comment_street_check_job``.
    Kept for the worker and for tests.
    """
    fast = _comment_street_fast_status(concern=concern)
    if fast is not None:
        return fast
    prepared = prepare_image_for_gemma(raw, filename=filename, mime_type=mime_type)
    if prepared is None:
        return {"status": "skipped", "reason": "image_unreadable"}
    imagery = fetch_latest_street_imagery(
        latitude=float(concern.latitude),
        longitude=float(concern.longitude),
        radius_meters=config.street_imagery_radius_meters,
    )
    if imagery is None:
        return {"status": "no_coverage"}
    verdict = verify_street_context(
        submitted=[prepared],
        street=PreparedImage(data=imagery.image_b64, mime_type="image/jpeg", telemetry={}),
    )
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
    }


def create_public_comment_attachment(*, uploaded_file, parent_field: str, parent, concern=None):
    validated, mime_type, kind, authenticity, detail = validate_concern_chat_attachment(uploaded_file)
    raw = _read_file(validated)
    # Worker-only street check: fast config gates stay inline (no I/O), but
    # Google tiles + vision never run in the comment POST. Applicable cases
    # store "pending" and the heavy worker fills in the verdict.
    street_imagery = {}
    needs_street_worker = False
    if concern is not None:
        fast = _comment_street_fast_status(concern=concern)
        if fast is not None:
            street_imagery = fast
        elif kind == PublicCommentAttachment.Kind.VIDEO:
            # Video frame extraction (cv2) is also CPU work for the worker;
            # mark pending and let it extract + compare from stored bytes.
            street_imagery = {"status": "pending"}
            needs_street_worker = True
        else:
            street_imagery = {"status": "pending"}
            needs_street_worker = True

    status = {
        "clear": PublicCommentAttachment.AnalysisStatus.COMPLETE,
        "flagged": PublicCommentAttachment.AnalysisStatus.REVIEW_REQUIRED,
        "review_required": PublicCommentAttachment.AnalysisStatus.REVIEW_REQUIRED,
    }.get(authenticity, PublicCommentAttachment.AnalysisStatus.UNAVAILABLE)
    attachment = PublicCommentAttachment.objects.create(
        **{parent_field: parent},
        file=validated,
        original_filename=getattr(uploaded_file, "name", "attachment")[:255],
        mime_type=mime_type,
        kind=kind,
        file_size=getattr(uploaded_file, "size", len(raw)),
        authenticity_status=status,
        authenticity_detail=detail[:255],
        street_imagery=street_imagery,
    )
    preview = build_redacted_preview_bytes(ContentFile(raw), mime_type)
    suffix = Path(attachment.original_filename).stem[:80] or "attachment"
    attachment.preview_file.save(f"{suffix}-protected.jpg", ContentFile(preview), save=True)
    if needs_street_worker and concern is not None:
        try:
            from django.conf import settings as _settings

            from .tasks import run_comment_street_check_job

            run_comment_street_check_job.apply_async(
                args=[attachment.pk, concern.pk], queue="heavy"
            )
            import logging as _logging

            _logging.getLogger(__name__).info(
                "comment-street dispatch attachment_id=%s concern_id=%s queue=heavy service_role=%s",
                attachment.pk, concern.pk, getattr(_settings, "SERVICE_ROLE", "api"),
            )
        except Exception:
            from django.conf import settings as _settings

            if getattr(_settings, "IS_LOCAL_DEVELOPMENT", False):
                from .tasks import run_comment_street_check_job

                run_comment_street_check_job.run(attachment.pk, concern.pk)
            # Production: stays "pending" for the recovery sweep; never fetch
            # tiles/vision inline in the comment POST.
    return attachment


def serialize_public_comment_attachment(attachment, request):
    if attachment is None:
        return None
    preview_path = f"/api/concerns/comment-media/{attachment.pk}/preview/"
    raw_path = f"/api/concerns/comment-media/{attachment.pk}/raw/"
    street = attachment.street_imagery or {}
    return {
        "id": attachment.pk,
        "kind": attachment.kind,
        "mime_type": attachment.mime_type,
        "original_filename": attachment.original_filename,
        "file_size": attachment.file_size,
        "analysis_status": attachment.authenticity_status,
        "authenticity_detail": attachment.authenticity_detail,
        "street_imagery_status": street.get("status", "not_applicable"),
        "street_imagery_verdict": street.get("verdict", ""),
        "preview_url": request.build_absolute_uri(preview_path) if request else preview_path,
        "raw_url": request.build_absolute_uri(raw_path) if request else raw_path,
    }
