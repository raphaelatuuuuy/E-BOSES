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


def compare_comment_image_to_concern_pin(*, concern, raw: bytes, filename: str, mime_type: str) -> dict:
    """Compare a sent comment image with the concern pin; absence never blocks posting."""
    config = ConcernClassificationConfiguration.current(concern.community)
    if not config.street_imagery_enabled:
        return {"status": "disabled"}
    if concern.category not in (config.street_imagery_categories or []):
        return {"status": "not_applicable", "reason": "category_not_enabled"}
    if concern.latitude is None or concern.longitude is None:
        return {"status": "skipped", "reason": "concern_has_no_pin"}
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
    street_imagery = {}
    if concern is not None:
        comparison_raw = raw
        comparison_name = getattr(uploaded_file, "name", "attachment")
        comparison_mime = mime_type
        if kind == PublicCommentAttachment.Kind.VIDEO:
            comparison_raw = _representative_video_frame(raw, comparison_name)
            comparison_name = f"{Path(comparison_name).stem}-frame.jpg"
            comparison_mime = "image/jpeg"
        if comparison_raw:
            street_imagery = compare_comment_image_to_concern_pin(
                concern=concern,
                raw=comparison_raw,
                filename=comparison_name,
                mime_type=comparison_mime,
            )
        else:
            street_imagery = {"status": "skipped", "reason": "video_frame_unavailable"}

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
