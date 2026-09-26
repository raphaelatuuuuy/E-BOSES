from datetime import timedelta
from io import BytesIO

import logging
import math
import re
from importlib import import_module

from drf_spectacular.utils import OpenApiResponse, extend_schema

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Count, Q
from django.forms.models import model_to_dict
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from apps.throttling import LocalAnonRateThrottle
from rest_framework.views import APIView

from apps.accounts.media_services import build_redacted_preview_bytes, log_raw_media_access, placeholder_preview_jpeg
from apps.docs_schema import PAGE_PARAMETERS, list_envelope_response
from apps.phash_index import SCOPE_CONCERN_MEDIA, phash_candidate_ids
from apps.capabilities import (
    MANAGE_CATEGORIES,
    MANAGE_ROLES,
    MANAGE_UNITS,
    MANAGE_USERS,
    PUBLISH_ANNOUNCEMENTS,
    RESOLVE_CONCERNS,
    capability_denied,
    user_has_capability,
)
from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated, user_has_role_permission
from apps.accounts.services import (
    create_audit_log,
    validate_concern_chat_attachment,
    validate_concern_media_file,
)
from apps.media_utils import (
    has_similar_phash_block,
    is_similar_phash,
    phash_blocks_file,
    phash_file,
    sha256_file,
)
from apps.accounts.views import request_meta, touch_last_seen
from apps.notifications.services import create_user_notification, notify_status_change
from apps.pagination import paginate_response
from apps.concerns.ai.duplicate_detector import report_fingerprints
from apps.concerns.ai.gemma_analyzer import low_information_reason

from .models import (
    Announcement,
    BarangayEvent,
    ChatMessageRead,
    ChatTypingIndicator,
    Concern,
    ConcernAppeal,
    ConcernAssignment,
    ConcernCategory,
    ConcernAiAssessment,
    ConcernChatAttachment,
    ConcernChatMessage,
    ConcernClassificationConfiguration,
    ConcernClarification,
    ConcernComment,
    ConcernFormField,
    ConcernFormValue,
    ConcernMedia,
    ConcernMediaRedaction,
    ConcernOfficialRemark,
    PublicCommentAttachment,
    ConcernResolutionEvidence,
    ConcernTimelineEntry,
    ConcernStatusEvent,
    ConcernView,
    ConcernVote,
    ContentFlag,
    Department,
    DepartmentChatMessage,
    DepartmentChatThread,
    Designation,
    Position,
    RoutingRule,
)
from .announcement_services import dispatch_due_announcements, mark_announcement_published
from .announcement_summary import refresh_announcement_summary
from .severity import severity_label, severity_level
from .units import assigned_unit_for, department_for_responder_unit

from .serializers import (
    ActiveResponderSerializer,
    AnnouncementSerializer,
    BarangayEventSerializer,
    ClarificationReplySerializer,
    ClarificationRequestSerializer,
    ConcernAppealCreateSerializer,
    ConcernAppealReviewSerializer,
    ConcernAppealSerializer,
    ConcernAssignSerializer,
    ConcernAiAssessmentSerializer,
    ConcernAssignmentSerializer,
    ConcernChatCreateSerializer,
    ConcernChatMessageSerializer,
    ConcernCommentCreateSerializer,
    ConcernCommentSerializer,
    ConcernCreateSerializer,
    GuestConcernCreateSerializer,
    ConcernClarificationSerializer,
    ContentFlagSerializer,
    ContentFlagReviewSerializer,
    ConcernListSerializer,
    ConcernMediaRedactionSerializer,
    ConcernMediaSerializer,
    ConcernOfficialRemarkCreateSerializer,
    ConcernOfficialRemarkSerializer,
    ConcernResolutionEvidenceSerializer,
    ConcernSerializer,
    ConcernStatusUpdateSerializer,
    ConcernTimelineEntryCreateSerializer,
    ConcernTimelineEntrySerializer,
    ConcernVoteSerializer,
    ChatReadSerializer,
    ChatTypingSerializer,
    DepartmentChatMessageSerializer,
    DepartmentChatThreadSerializer,
    DepartmentSerializer,
    DesignationSerializer,
    PositionSerializer,
    ConcernCategorySerializer,
    ConcernFormFieldSerializer,
    RoutingRuleSerializer,
    PublicUserSerializer,
)
from .services import (
    concern_media_is_publicly_displayable,
    ensure_concern_media_preview,
    user_can_access_concern_media_raw,
)
from .tasks import enqueue_concern_media_privacy, enqueue_content_moderation_ai
from .moderation import execute_takedown, restore_automated_takedown

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.ASSIGNED,
    Concern.Status.IN_PROGRESS,
    Concern.Status.APPEALED,
}

MAX_CONCERN_MEDIA_FILES = 3
DUPLICATE_PHOTO_MESSAGE = "This photo was already used in another report. Please use a different photo."


def _existing_concern_match(media):
    concern = media.concern
    if concern.status == Concern.Status.REJECTED:
        return None
    return {
        "concern_id": concern.pk,
        "tracking_id": concern.tracking_id,
        "public_id": str(concern.public_id),
        "status": concern.status,
    }


def _discard_unaccepted_concern(concern):
    """Remove the temporary concern and every validation artifact it created."""
    from .models import LlmDecisionLog

    # LLM logs intentionally use SET_NULL for normal historical audit rows,
    # but a pre-commit rejection must not leave an orphaned decision behind.
    LlmDecisionLog.objects.filter(concern_id=concern.pk).delete()
    concern.delete()


def _validation_photo_verdicts(concern):
    """Return the per-upload photo feedback before a rejected row is deleted.

    The intake pipeline keeps the image review in the AI assessment's raw
    result.  A rejected concern is intentionally removed, so the only safe
    time to copy that result into the resident response is immediately before
    cleanup.  This keeps the upload in the composer, marks the exact photo,
    and still guarantees that no rejected concern or media row is persisted.
    """
    assessment = ConcernAiAssessment.objects.filter(concern_id=concern.pk).first()
    raw_result = getattr(assessment, "raw_result", None) or {}
    review = raw_result.get("review") if isinstance(raw_result, dict) else {}
    details = dict(review) if isinstance(review, dict) else {}
    integrity = raw_result.get("media_integrity") if isinstance(raw_result, dict) else {}
    if isinstance(integrity, dict):
        details["media_integrity"] = integrity.get("findings") or []

    photo = raw_result.get("photo") if isinstance(raw_result, dict) else {}
    if "image_review_succeeded" not in details and isinstance(photo, dict):
        details["image_review_succeeded"] = photo.get("image_review_succeeded")

    image_count = concern.media.filter(mime_type__startswith="image/").count()
    if not image_count:
        return []

    from apps.concerns.classification_api import _photo_verdict_payload

    return _photo_verdict_payload(
        details,
        photo_count=image_count,
        image_errors={},
        prepared_indices=list(range(image_count)),
    )


def _validate_concern_before_commit(concern):
    """Run automated validation before a concern is allowed to persist.

    A rejected report is feedback for the resident, not an operational record.
    Keep the row inside the request transaction while the existing AI pipeline
    evaluates it, then remove it before commit when validation does not pass.
    This also removes the uploaded media, so a rejected photo can be corrected
    and uploaded again instead of being treated as a duplicate forever.
    """
    from apps.concerns.ai.pipeline import process_concern_ai

    try:
        process_concern_ai(concern.pk)
    except Exception:
        logger.exception("Concern validation failed before commit for concern_id=%s", concern.pk)
        _discard_unaccepted_concern(concern)
        return Response(
            {
                "description": [
                    "We could not validate this report right now. Please check the details and try again."
                ]
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    concern.refresh_from_db()
    if concern.validation_status == Concern.ValidationStatus.ACCEPTED:
        return None

    message = (
        concern.validation_summary.strip()
        or "This report could not be accepted. Please check the details and try again."
    )
    rejection_code = concern.rejection_code
    description_failed = rejection_code in {
        "automated_multiple_issues",
        "automated_unclear_description",
    }
    photo_verdicts = [] if description_failed else _validation_photo_verdicts(concern)
    duplicate = (concern.ai_assessment.raw_result or {}).get("duplicate") or {}
    visual_check = duplicate.get("visual_check") or {}
    existing_match = visual_check.get("match")
    _discard_unaccepted_concern(concern)
    photo_failed = rejection_code in {
        "automated_photo_mismatch",
        "automated_photo_unsupported",
        "automated_photo_duplicate",
    } or any(item.get("state") != "relevant" for item in photo_verdicts)
    payload = {
        "code": rejection_code or "automated_validation_rejected",
        "photo_verdicts": photo_verdicts,
        "media" if photo_failed else "description": [
            message
            if rejection_code == "automated_photo_duplicate"
            else "Please remove photos that don't show the reported issue and upload clear ones."
            if photo_failed
            else message
        ],
    }
    if existing_match:
        payload["existing_match"] = existing_match
    return Response(payload, status=status.HTTP_400_BAD_REQUEST)


def create_timeline_entry(*, concern, event_type, message, actor=None, status="", visible_to_resident=True, is_custom=False, metadata=None):
    return ConcernTimelineEntry.objects.create(
        concern=concern,
        event_type=event_type,
        status=status or "",
        message=message or "",
        actor=actor,
        visible_to_resident=visible_to_resident,
        is_custom=is_custom,
        metadata=metadata or {},
    )


GENERIC_ADDRESS_PATTERNS = {
    "pinned location on map",
    "marikina heights",
    "marikina heights subdivision",
    "marikina",
    "location needs confirmation",
    "",
}


def _schedule_concern_location(concern_id: int) -> None:
    """Reverse-geocode a concern's address after save if it looks generic.

    The location picker already reverse-gecodes when a resident pins a spot,
    but some concerns arrive with placeholder text or just a barangay name.
    Nominatim paces itself and can take seconds, so the lookup runs in a Celery
    task — mirroring the emergency path — instead of inside on_commit on the
    request thread.
    """
    from django.conf import settings

    try:
        from apps.concerns.models import Concern
        from apps.concerns.tasks import reverse_geocode_concern_task

        concern = Concern.objects.filter(pk=concern_id).only("latitude", "longitude", "address").first()
        if not concern or concern.latitude is None or concern.longitude is None:
            return
        addr = (concern.address or "").strip().lower()
        if addr and addr not in GENERIC_ADDRESS_PATTERNS and "pinned location" not in addr:
            return  # address already looks good
        try:
            reverse_geocode_concern_task.delay(concern_id)
        except Exception:
            if getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
                reverse_geocode_concern_task.run(concern_id)
            else:
                logging.getLogger(__name__).warning(
                    "Broker unavailable; concern %s address left for manual review.", concern_id
                )
    except Exception:
        logging.getLogger(__name__).debug("Concern location resolution failed for %s", concern_id, exc_info=True)


def user_is_department_member(user, department):
    if not user or not user.is_authenticated or not department:
        return False
    if user.is_superuser:
        return True
    return Designation.objects.filter(user=user, department=department, is_active=True).exists()


COMMENT_MENTION_RE = re.compile(r"@\[([^\]]+)\]\(u:(\d+)\)")


def comment_mention_ids(body):
    ids = []
    seen = set()
    for match in COMMENT_MENTION_RE.finditer(body or ""):
        user_id = int(match.group(2))
        if user_id not in seen:
            ids.append(user_id)
            seen.add(user_id)
        if len(ids) >= 10:
            break
    return ids


def comment_notification_preview(body):
    visible = COMMENT_MENTION_RE.sub(lambda match: f"@{match.group(1)}", body or "")
    visible = " ".join(visible.split())
    return visible[:237] + ("..." if len(visible) > 240 else "")


def notify_comment_mentions(comment, mention_ids):
    if not mention_ids:
        return set()
    User = get_user_model()
    recipients = User.objects.filter(
        pk__in=mention_ids,
        is_active=True,
        status=User.Status.VERIFIED,
    ).filter(
        Q(resident_profile__community_id=comment.concern.community_id)
        | Q(designations__is_active=True, designations__department__community_id=comment.concern.community_id)
    ).exclude(pk=comment.author_id).distinct()
    notified = set()
    for recipient in recipients:
        create_user_notification(
            recipient=recipient,
            concern=comment.concern,
            type="concern_mention",
            title="You were mentioned in a community report",
            body=comment_notification_preview(comment.body),
        )
        notified.add(recipient.pk)
    return notified


def notify_comment_participants(comment):
    notified = notify_comment_mentions(comment, comment_mention_ids(comment.body))
    candidates = []
    if comment.parent_id:
        candidates.append(comment.parent.author)
    candidates.append(comment.concern.reporter)
    for recipient in candidates:
        if recipient.pk == comment.author_id or recipient.pk in notified:
            continue
        create_user_notification(
            recipient=recipient,
            concern=comment.concern,
            type="concern_comment",
            title="New reply on a community report" if comment.parent_id else "New comment on your community report",
            body=comment_notification_preview(comment.body),
        )
        notified.add(recipient.pk)

FEED_VISIBLE_STATUSES = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.ASSIGNED,
    Concern.Status.IN_PROGRESS,
    Concern.Status.RESOLVED,
    Concern.Status.APPEALED,
}

# Legal status transitions for a Concern's lifecycle. Notes on two transitions that are
# easy to misread from the table alone:
#   - SUBMITTED -> UNDER_REVIEW is an optional operational status. Automated
#     validation is completed before the concern enters the official queue.
#   - APPEALED -> SUBMITTED is the appeal-approval reopen path: when an official approves a
#     resident's appeal of a rejected/resolved concern, the concern is sent back to
#     `submitted` to re-enter the normal review pipeline (see ConcernAppealReviewView).
LEGAL_STATUS_TRANSITIONS = {
    Concern.Status.SUBMITTED: {Concern.Status.UNDER_REVIEW, Concern.Status.ASSIGNED, Concern.Status.REJECTED},
    Concern.Status.UNDER_REVIEW: {Concern.Status.SUBMITTED, Concern.Status.ASSIGNED, Concern.Status.REJECTED},
    Concern.Status.ASSIGNED: {Concern.Status.IN_PROGRESS, Concern.Status.REJECTED},
    Concern.Status.IN_PROGRESS: {Concern.Status.RESOLVED, Concern.Status.REJECTED},
    Concern.Status.RESOLVED: {Concern.Status.APPEALED},
    Concern.Status.REJECTED: {Concern.Status.APPEALED},
    Concern.Status.APPEALED: {Concern.Status.SUBMITTED, Concern.Status.REJECTED},
}


def media_looks_duplicate(phash, blocks, candidates):
    for candidate_phash, candidate_blocks in candidates:
        if is_similar_phash(phash, candidate_phash):
            return True
        if has_similar_phash_block(phash, candidate_blocks):
            return True
        if has_similar_phash_block(candidate_phash, blocks):
            return True
    return False


def _media_check_configuration(request):
    """Select the active community policy used by upload-time AI checks."""
    from apps.emergencies.models import Community

    active = Community.objects.filter(status=Community.Status.ACTIVE, code="marikina-heights")
    community_id = request.data.get("community_id")
    community = active.filter(pk=community_id).first() if community_id else None
    community = community or active.order_by("name").first()
    try:
        return ConcernClassificationConfiguration.current(community)
    except ValueError:
        return ConcernClassificationConfiguration.current_fresh(community)


def _attachment_authenticity_results(uploaded_files, *, config, run_ai=True):
    """Run duplicate-independent authenticity checks without persisting files.

    The final submit endpoint still repeats the complete validation pipeline;
    this function only provides early feedback while the composer is open.
    """
    from apps.accounts.media_forensics import forensics_findings

    if not run_ai:
        checked = []
        for file_index, uploaded_file in enumerate(uploaded_files):
            try:
                uploaded_file.seek(0)
                raw_content = uploaded_file.read()
                uploaded_file.seek(0)
            except Exception:
                raw_content = b""
            forensic = forensics_findings(raw_content) if raw_content else {
                "checked": False,
                "flagged": False,
            }
            flagged = bool(forensic.get("flagged"))
            checked.append({
                "index": file_index,
                "name": uploaded_file.name,
                "status": "rejected" if flagged else "accepted",
                "authenticity_status": "blocked" if flagged else "passed",
                "authenticity_verdict": "forensics_flagged" if flagged else "forensics_clear",
                "message": "Please upload an original, unedited photo." if flagged else "",
            })
        return checked

    from apps.concerns.ai.classification import classification_payload
    from apps.concerns.ai.gemma_analyzer import INTEGRITY_FLAGGED_VERDICTS
    from apps.concerns.classification_api import (
        _media_integrity_preview,
        _prepared_images_from_uploads,
    )
    from django.conf import settings

    images, image_errors, prepared_indices = _prepared_images_from_uploads(uploaded_files)
    result = classification_payload(
        title="Attachment authenticity check",
        description=(
            "Review the attached photos for duplicate, edited, or AI-generated media. "
            "Do not assess the report description."
        ),
        selected_category=Concern.Category.OTHERS,
        configuration=config,
        images=images or None,
        image_uploaded=bool(uploaded_files),
        text_timeout=getattr(settings, "OLLAMA_PRECHECK_TEXT_TIMEOUT_SECONDS", 8),
    )
    details = result.get("details") or {}
    integrity = _media_integrity_preview(config, details=details, images=images)
    findings = {
        int(item.get("index", -1)): item
        for item in integrity.get("findings") or []
        if isinstance(item, dict)
    }
    prepared_index_by_file = {
        file_index: image_index
        for image_index, file_index in enumerate(prepared_indices)
    }

    checked = []
    for file_index, uploaded_file in enumerate(uploaded_files):
        try:
            uploaded_file.seek(0)
            raw_content = uploaded_file.read()
            uploaded_file.seek(0)
        except Exception:
            raw_content = b""
        forensic = forensics_findings(raw_content) if raw_content else {
            "checked": False,
            "flagged": False,
            "message": "",
        }
        if forensic.get("flagged"):
            checked.append(
                {
                    "index": file_index,
                    "name": uploaded_file.name,
                    "status": "rejected",
                    "authenticity_status": "blocked",
                    "authenticity_verdict": "forensics_flagged",
                    "message": forensic.get("message") or (
                        "This photo could not pass the authenticity check. "
                        "Please upload the original photo."
                    ),
                }
            )
            continue

        if file_index in image_errors:
            checked.append(
                {
                    "index": file_index,
                    "name": uploaded_file.name,
                    "status": "accepted",
                    "authenticity_status": "review_required",
                    "authenticity_verdict": "inconclusive",
                    "message": "This photo could not be checked automatically. An official will review it.",
                }
            )
            continue

        finding = findings.get(prepared_index_by_file.get(file_index, -1))
        verdict = str((finding or {}).get("verdict") or "").lower()
        if integrity.get("status") == "checked" and verdict in INTEGRITY_FLAGGED_VERDICTS:
            checked.append(
                {
                    "index": file_index,
                    "name": uploaded_file.name,
                    "status": "rejected",
                    "authenticity_status": "blocked",
                    "authenticity_verdict": verdict,
                    "message": "Please upload an original, unedited photo.",
                }
            )
            continue

        review_required = integrity.get("status") != "checked" or verdict == "inconclusive"
        checked.append(
            {
                "index": file_index,
                "name": uploaded_file.name,
                "status": "accepted",
                "authenticity_status": "review_required" if review_required else "passed",
                "authenticity_verdict": verdict or "inconclusive",
                "message": (
                    "Authenticity could not be confirmed automatically; an official will review it."
                    if review_required
                    else ""
                ),
            }
        )
    return checked


def _deterministic_concern_media_check(media_files):
    """Return accepted files and per-file failures before the AI probe.

    Duplicate detection used to return one request-level 400 immediately.
    That left the browser unable to tell which file in a multi-file selection
    failed, so the composer previewed every file anyway. Keep checking the
    remaining files and attach the failure to its original index instead.
    """
    current_phashes = []
    current_hashes = set()
    accepted_files = []
    accepted_indices = []
    rejected = {}
    duplicate_matches = {}

    for file_index, uploaded_file in enumerate(media_files):
        try:
            validated_file = validate_concern_media_file(uploaded_file)
        except ValidationError as exc:
            messages = [str(message) for message in getattr(exc, "messages", [])]
            if not messages and getattr(exc, "message_dict", None):
                for value in exc.message_dict.values():
                    if isinstance(value, (list, tuple)):
                        messages.extend(str(item) for item in value)
                    else:
                        messages.append(str(value))
            if not messages:
                messages = [str(exc)]
            cleaned = []
            for message in messages:
                text = str(message).strip()
                if text.startswith("[") and text.endswith("]"):
                    text = text[1:-1].strip().strip("'\"")
                if text:
                    cleaned.append(text)
            rejected[file_index] = cleaned[0] if cleaned else "This photo could not be validated."
            continue

        media_hash = sha256_file(validated_file)
        raw_content = validated_file.read()
        validated_file.seek(0)
        media_phash = phash_file(raw_content)
        media_phash_blocks = phash_blocks_file(raw_content)
        exact_match = (
            ConcernMedia.objects.filter(sha256_hash=media_hash)
            .exclude(concern__status=Concern.Status.REJECTED)
            .select_related("concern")
            .first()
        )
        if media_hash in current_hashes or exact_match is not None:
            rejected[file_index] = DUPLICATE_PHOTO_MESSAGE
            if exact_match is not None:
                duplicate_matches[file_index] = _existing_concern_match(exact_match)
            continue

        candidate_ids = phash_candidate_ids(
            SCOPE_CONCERN_MEDIA,
            phashes=[media_phash],
            blocks=media_phash_blocks,
        )
        existing_media = (
            list(
                ConcernMedia.objects.filter(pk__in=candidate_ids)
                .exclude(phash="")
                .exclude(concern__status=Concern.Status.REJECTED)
                .select_related("concern")
            )
            if candidate_ids
            else []
        )
        existing_phashes = [(media.phash, media.phash_blocks) for media in existing_media]
        if media_looks_duplicate(
            media_phash,
            media_phash_blocks,
            [*existing_phashes, *current_phashes],
        ):
            rejected[file_index] = DUPLICATE_PHOTO_MESSAGE
            matched_media = next(
                (
                    media
                    for media in existing_media
                    if media_looks_duplicate(
                        media_phash,
                        media_phash_blocks,
                        [(media.phash, media.phash_blocks)],
                    )
                ),
                None,
            )
            if matched_media is not None:
                duplicate_matches[file_index] = _existing_concern_match(matched_media)
            continue

        current_hashes.add(media_hash)
        current_phashes.append((media_phash, media_phash_blocks))
        accepted_files.append(uploaded_file)
        accepted_indices.append(file_index)

    return accepted_files, accepted_indices, rejected, duplicate_matches


def _concern_media_check_results(media_files, *, config, run_ai=True):
    """Build an indexed result for every uploaded file without persisting it."""
    (
        accepted_files,
        accepted_indices,
        rejected,
        duplicate_matches,
    ) = _deterministic_concern_media_check(media_files)
    ai_results = (
        _attachment_authenticity_results(
            accepted_files,
            config=config,
            run_ai=run_ai,
        )
        if accepted_files
        else []
    )
    ai_by_index = {
        int(item.get("index", -1)): item
        for item in ai_results
        if isinstance(item, dict)
    }
    accepted_position_by_original = {
        original_index: position
        for position, original_index in enumerate(accepted_indices)
    }

    results = []
    for original_index, uploaded_file in enumerate(media_files):
        if original_index in rejected:
            result = {
                "index": original_index,
                "name": uploaded_file.name,
                "status": "rejected",
                "authenticity_status": "blocked",
                "authenticity_verdict": "deterministic_rejection",
                "message": rejected[original_index],
            }
            if duplicate_matches.get(original_index) is not None:
                result["existing_match"] = duplicate_matches[original_index]
            results.append(result)
            continue

        accepted_position = accepted_position_by_original[original_index]
        result = dict(ai_by_index.get(accepted_position) or {})
        result["index"] = original_index
        result["name"] = uploaded_file.name
        result.setdefault("status", "accepted")
        result.setdefault("authenticity_status", "review_required")
        result.setdefault("authenticity_verdict", "inconclusive")
        result.setdefault("message", "")
        results.append(result)
    return results


def can_access_concern(user, concern):
    if not user or not user.is_authenticated:
        return (
            concern.visibility == Concern.Visibility.COMMUNITY
            and concern.validation_status == Concern.ValidationStatus.ACCEPTED
        )
    from apps.community_scope import scope_concern_queryset
    return scope_concern_queryset(Concern.objects.filter(pk=concern.pk), user).exists()


def operational_concerns(user, queryset=None):
    from apps.community_scope import scope_concern_queryset

    queryset = queryset if queryset is not None else Concern.objects.all()
    return scope_concern_queryset(queryset, user, include_public=False)


def operational_concern_or_404(user, pk, *, lock=False):
    from apps.community_access import ForeignCommunityReadOnly, concern_access_mode

    candidate = Concern.objects.filter(pk=pk).first()
    if candidate and concern_access_mode(user, candidate) == "foreign_read_only":
        raise ForeignCommunityReadOnly()
    if not lock:
        return get_object_or_404(operational_concerns(user), pk=pk)

    # `scope_concern_queryset()` ends in `.distinct()` for staff because the
    # authorization rule joins assignments and department memberships.  That
    # is valid for a visibility query, but PostgreSQL rejects
    # `SELECT DISTINCT ... FOR UPDATE`.  Keep the distinct authorization check
    # in a subquery, then lock the concern row with a plain primary-key query.
    # The visibility predicate remains part of the locking SQL, so an
    # unauthorized concern cannot be locked by this path.
    visible_ids = operational_concerns(user, Concern.objects.filter(pk=pk)).values("pk")
    return get_object_or_404(
        Concern.objects.select_for_update().filter(pk__in=visible_ids),
        pk=pk,
    )


def can_manage_concern_operations(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_superuser
            or user_has_role_permission(user, "concerns.manage")
        )
    )


def can_update_concern_status(user):
    return can_manage_concern_operations(user) and user_has_capability(
        user, RESOLVE_CONCERNS
    )


def can_publish_announcements(user):
    return can_manage_concern_operations(user) and user_has_capability(
        user, PUBLISH_ANNOUNCEMENTS
    )


def can_progress_assigned_concern(user, concern, next_status):
    return (
        next_status in {Concern.Status.IN_PROGRESS, Concern.Status.RESOLVED}
        and user_has_role_permission(user, "concerns.update_assigned")
        and concern.assignments.filter(assignee=user, status=ConcernAssignment.Status.ACTIVE).exists()
    )


def can_chat_on_concern(user, concern):
    """Private operational thread: reporter, assigned responder, and authorized officials."""
    if not user or not user.is_authenticated:
        return False
    from apps.community_scope import community_ids_for_user

    return (
        user.is_superuser
        or user.pk == concern.reporter_id
        or concern.assignments.filter(
            assignee=user,
            status=ConcernAssignment.Status.ACTIVE,
        ).exists()
        or concern.community_id in community_ids_for_user(user)
        and (
            user.role == user.Role.BARANGAY_OFFICIAL
            or user_has_role_permission(user, "concerns.manage")
        )
    )


def decorate_concerns(queryset, user):
    concerns = list(
        queryset
        .select_related(
            "reporter",
            "reporter__resident_profile",
            "community",
            "reporter_community",
            # The duplicate-group walk and the nested category serializer both
            # run per row; without these they issue one query per concern.
            "duplicate_of",
            "duplicate_of__reporter",
            "duplicate_of__reporter__resident_profile",
            "recurrence_of",
            "category_ref",
            "category_ref__department",
            "assigned_department",
        )
        .prefetch_related(
            "media",
            "duplicates",
            "votes",
            "votes__user",
            "votes__user__resident_profile",
            "ai_assessment",
            "status_events",
            "status_events__actor",
            "status_events__actor__resident_profile",
            "status_events__actor__designations__position",
            "status_events__actor__designations__department",
            "resolution_evidence",
            "resolution_evidence__uploaded_by",
            "resolution_evidence__uploaded_by__resident_profile",
            "resolution_evidence__uploaded_by__designations__position",
            "resolution_evidence__uploaded_by__designations__department",
            "assignments",
            "assignments__assignee",
            "assignments__assignee__resident_profile",
            "assignments__assigned_by",
            "assignments__assigned_by__resident_profile",
            "timeline_entries",
            "timeline_entries__actor",
            "timeline_entries__actor__resident_profile",
            "timeline_entries__actor__designations__position",
            "timeline_entries__actor__designations__department",
            "form_values",
            "form_values__field",
            "clarifications",
            "clarifications__requested_by",
            "clarifications__requested_by__resident_profile",
            "clarifications__responded_by",
            "clarifications__responded_by__resident_profile",
            "appeals",
            "appeals__appellant",
            "appeals__appellant__resident_profile",
            "appeals__reviewed_by",
            "appeals__reviewed_by__resident_profile",
            "official_remarks",
            "official_remarks__author",
            "official_remarks__author__resident_profile",
            "chat_messages",
            "chat_messages__sender",
            "chat_messages__sender__resident_profile",
            "chat_messages__sender__designations__position",
            "chat_messages__sender__designations__department",
            "chat_messages__attachment",
            "category_ref__form_fields",
            "category_ref__department__designations",
            "assigned_department__designations",
            "duplicate_of__media",
            "duplicates",
            "duplicates__reporter",
            "duplicates__reporter__resident_profile",
            "duplicates__media",
            "comments__author",
            "comments__author__resident_profile",
            "comments__attachment",
            "comments__replies__author",
            "comments__replies__author__resident_profile",
            "comments__replies__attachment",
        )
        .annotate(
            vote_count=Count("votes", distinct=True),
            comment_count=Count("comments", distinct=True),
        )
    )
    if user and user.is_authenticated:
        voted_ids = set(
            ConcernVote.objects.filter(user=user, concern__in=concerns).values_list("concern_id", flat=True)
        )
    else:
        voted_ids = set()
    for concern in concerns:
        concern.user_vote = 1 if concern.pk in voted_ids else 0
        concern.severity = severity_label(concern)
        concern.severity_assessed = severity_level(concern)[1]
    return concerns


def decorate_concerns_for_feed(queryset, user):
    """Lightweight feed decoration: slim rows only.

    Mirrors decorate_concerns() but prefetches just what ConcernFeedSerializer
    reads. The dropped collections (comments, timeline, chat, clarifications,
    appeals, official remarks, form values, viewers) load on the detail view.
    """
    concerns = list(
        queryset
        .select_related(
            "reporter",
            "reporter__resident_profile",
            "community",
            "reporter_community",
            "duplicate_of",
            "duplicate_of__reporter",
            "duplicate_of__reporter__resident_profile",
            "recurrence_of",
            "category_ref",
            "category_ref__department",
            "assigned_department",
        )
        .prefetch_related(
            "media",
            "duplicates",
            "votes",
            "votes__user",
            "votes__user__resident_profile",
            "ai_assessment",
            "status_events",
            "status_events__actor",
            "status_events__actor__resident_profile",
            "status_events__actor__designations__position",
            "status_events__actor__designations__department",
            "resolution_evidence",
            "resolution_evidence__uploaded_by",
            "resolution_evidence__uploaded_by__resident_profile",
            "assignments",
            "assignments__assignee",
            "assignments__assignee__resident_profile",
            "assignments__assigned_by",
            "assignments__assigned_by__resident_profile",
            "category_ref__form_fields",
            "category_ref__department__designations",
            "assigned_department__designations",
            "duplicate_of__media",
            "duplicates__reporter",
            "duplicates__reporter__resident_profile",
            "duplicates__media",
        )
        .annotate(
            vote_count=Count("votes", distinct=True),
            comment_count=Count("comments", distinct=True),
        )
    )
    if user and user.is_authenticated:
        voted_ids = set(
            ConcernVote.objects.filter(user=user, concern__in=concerns).values_list("concern_id", flat=True)
        )
    else:
        voted_ids = set()
    for concern in concerns:
        concern.user_vote = 1 if concern.pk in voted_ids else 0
        concern.severity = severity_label(concern)
        concern.severity_assessed = severity_level(concern)[1]
    return concerns

def create_concern_notification(concern, *, recipient, type, title, body):
    return create_user_notification(
        recipient=recipient,
        concern=concern,
        type=type,
        title=title,
        body=body,
    )


MEDIA_CHECK_MAX_BYTES = 3 * 1024 * 1024


def _media_check_size_gate(media_files):
    """Reject empty/oversized files before any bytes are decoded.

    Returns a 4xx Response when rejecting, else None. The 3MB ceiling keeps
    staged async payloads bounded; dimension/pixel guards run later in
    image_prep (20MP) and the upload profiles.
    """
    for uploaded in media_files:
        if (getattr(uploaded, "size", 0) or 0) <= 0:
            return Response({"media": ["Attach a non-empty file."]}, status=status.HTTP_400_BAD_REQUEST)
        if uploaded.size > MEDIA_CHECK_MAX_BYTES:
            return Response(
                {"media": ["Photos must be 3MB or smaller."]},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
    return None


def _wants_async_check(request):
    return str(
        request.query_params.get("async") or request.data.get("async") or ""
    ).lower() in {"1", "true"}


def _is_forensics_only(request):
    return str(request.data.get("forensics_only", "")).lower() in {"1", "true", "yes"}


def _guest_check_owner(request):
    """Stable per-guest owner for job ownership + rate limits."""
    try:
        key = request.session.session_key
        if not key:
            request.session.save()
            key = request.session.session_key
        if key:
            return f"guest:{key}"
    except Exception:
        pass
    return "guest:anonymous"


def _enqueue_media_check_job(*, owner, media_files, forensics_only, community_id, rate_limit):
    from .media_check_jobs import create_media_check_job

    # Bytes are read once here (already size-gated above); the worker
    # rebuilds upload objects from the staged copy. Originals are rewound
    # so the sync fallback path (if enqueue fails) still works.
    staged = []
    for uploaded in media_files:
        try:
            content = uploaded.read()
        except Exception:
            content = b""
        try:
            uploaded.seek(0)
        except Exception:
            pass
        staged.append({
            "name": getattr(uploaded, "name", "upload"),
            "content_type": getattr(uploaded, "content_type", "") or "",
            "size": getattr(uploaded, "size", 0) or 0,
            "content": content,
        })
    job, _created, throttled = create_media_check_job(
        owner=owner,
        files=staged,
        forensics_only=forensics_only,
        community_id=community_id,
        rate_limit=rate_limit,
    )
    if throttled or job is None:
        return None
    try:
        from django.conf import settings as _settings

        from .tasks import run_media_check_job

        run_media_check_job.apply_async(args=[job["job_id"]], queue="heavy")
        import logging as _logging

        _logging.getLogger(__name__).info(
            "media-check dispatch job_id=%s queue=heavy service_role=%s status=202",
            job["job_id"], getattr(_settings, "SERVICE_ROLE", "api"),
        )
    except Exception:
        from django.conf import settings as _settings

        if getattr(_settings, "IS_LOCAL_DEVELOPMENT", False):
            from .tasks import run_media_check_job

            run_media_check_job.run(job["job_id"])
        # Production: leave the row QUEUED for the worker; never run
        # Gemma/forensics inline in Daphne.
    return job


def _public_media_check_job(job):
    return {k: v for k, v in job.items() if k in {"job_id", "status", "result", "error_code", "expires_at"}}


class ConcernMediaCheckView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        media_files = request.FILES.getlist("media")
        if not media_files:
            return Response({"media": ["Choose a photo to check."]}, status=status.HTTP_400_BAD_REQUEST)
        if len(media_files) > MAX_CONCERN_MEDIA_FILES:
            return Response(
                {"media": [f"You can attach up to {MAX_CONCERN_MEDIA_FILES} photos."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        size_gate = _media_check_size_gate(media_files)
        if size_gate is not None:
            return size_gate
        # Worker-only AI: any check that needs the model is enqueued and
        # answered 202 — Gemma/forensics/vision never run in Daphne. The
        # cheap forensics-only path (no model) may still answer inline.
        if not _is_forensics_only(request) or _wants_async_check(request):
            owner = f"user:{request.user.pk}"
            job = _enqueue_media_check_job(
                owner=owner,
                media_files=media_files,
                forensics_only=_is_forensics_only(request),
                community_id=request.data.get("community_id"),
                rate_limit=5,
            )
            if job is None:
                return Response(
                    {"detail": "Too many checks. Please wait a bit before trying again."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            return Response(
                {**_public_media_check_job(job),
                 "status_url": f"/api/concerns/media/check/jobs/{job['job_id']}/"},
                status=status.HTTP_202_ACCEPTED,
            )

        return Response(
            {
                "files": _concern_media_check_results(
                    media_files,
                    config=_media_check_configuration(request),
                    run_ai=not _is_forensics_only(request),
                )
            }
        )


class GuestConcernThrottle(LocalAnonRateThrottle):
    """Keep the public intake bounded even when settings are changed."""

    scope = "public_guest_concern"
    rate = "15/hour"


class GuestConcernMediaCheckThrottle(LocalAnonRateThrottle):
    """Bound anonymous image-only checks separately from report submissions."""

    scope = "public_guest_concern_media"
    # A short rolling window prevents an accidental hour-long lockout while
    # still bounding this unauthenticated, compute-heavy image analysis route.
    rate = "6/minute"


class GuestConcernMediaCheckView(APIView):
    """Run attachment checks before a guest report is submitted.

    The files are never persisted or included in audit/LLM decision logs. The
    final guest submit endpoint repeats the checks before committing a report.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [GuestConcernMediaCheckThrottle]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        media_files = request.FILES.getlist("media")
        if not media_files:
            return Response({"media": ["Choose a photo to check."]}, status=status.HTTP_400_BAD_REQUEST)
        if len(media_files) > MAX_CONCERN_MEDIA_FILES:
            return Response(
                {"media": [f"You can attach up to {MAX_CONCERN_MEDIA_FILES} photos."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        size_gate = _media_check_size_gate(media_files)
        if size_gate is not None:
            return size_gate
        # Same worker-only rule as the resident check: model work is
        # enqueued; only the cheap forensics-only probe answers inline.
        if not _is_forensics_only(request) or _wants_async_check(request):
            owner = _guest_check_owner(request)
            job = _enqueue_media_check_job(
                owner=owner,
                media_files=media_files,
                forensics_only=_is_forensics_only(request),
                community_id=request.data.get("community_id"),
                rate_limit=2,
            )
            if job is None:
                return Response(
                    {"detail": "Too many checks. Please wait a bit before trying again."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            return Response(
                {**_public_media_check_job(job),
                 "status_url": f"/api/public/concerns/guest/media-check/jobs/{job['job_id']}/"},
                status=status.HTTP_202_ACCEPTED,
            )

        return Response(
            {
                "files": _concern_media_check_results(
                    media_files,
                    config=_media_check_configuration(request),
                    run_ai=not _is_forensics_only(request),
                )
            }
        )


class ConcernMediaCheckJobStatusView(APIView):
    """Poll endpoint for async resident media checks. Ownership enforced."""

    permission_classes = [IsAuthenticated]

    def get(self, request, job_id):
        from .media_check_jobs import get_media_check_job

        job = get_media_check_job(str(job_id), owner=f"user:{request.user.pk}")
        if job is None:
            return Response({"detail": "Unknown or expired job."}, status=status.HTTP_404_NOT_FOUND)
        return Response(job)


class GuestConcernMediaCheckJobStatusView(APIView):
    """Poll endpoint for async guest media checks (session-scoped)."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [GuestConcernMediaCheckThrottle]

    def get(self, request, job_id):
        from .media_check_jobs import get_media_check_job

        job = get_media_check_job(str(job_id), owner=_guest_check_owner(request))
        if job is None:
            return Response({"detail": "Unknown or expired job."}, status=status.HTTP_404_NOT_FOUND)
        return Response(job)


def _notify_anonymous_concern_staff(concern):
    """Notify only verified staff designated to the incident community."""
    if (
        concern.validation_status != Concern.ValidationStatus.ACCEPTED
        or not concern.assigned_department_id
    ):
        return
    from apps.notifications.models import Notification

    User = get_user_model()
    recipients = (
        User.objects.filter(
            is_active=True,
            status=User.Status.VERIFIED,
            role__in=[User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER],
            designations__is_active=True,
            designations__department__community=concern.community,
        )
        .distinct()
    )
    for recipient in recipients:
        create_user_notification(
            recipient=recipient,
            concern=concern,
            type=Notification.Type.SUBMITTED,
            title="New anonymous report",
            body=f"A new issue report was submitted in {concern.community.name}.",
            community=concern.community,
            department=concern.assigned_department,
            event_key=f"anonymous-concern:{concern.pk}",
        )


class GuestConcernCreateView(APIView):
    """Public submit-only concern intake.

    Guests use the same validation pipeline as residents, but receive only a
    generic acknowledgement and never a case identifier or reporter profile.
    A report is not stored when validation rejects it.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [GuestConcernThrottle]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @transaction.atomic
    def post(self, request):
        from apps.accounts.ip_intel import evaluate_request, ip_blocked_response
        from apps.geo_services import active_communities_for_coverage_point
        from .anonymous_intake import get_anonymous_intake_user

        _, ip_meta, ip_reason = evaluate_request(request)
        if ip_reason:
            return ip_blocked_response(ip_reason)

        serializer = GuestConcernCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        latitude = serializer.validated_data["latitude"]
        longitude = serializer.validated_data["longitude"]
        # Match the public location picker and authenticated report flow:
        # configured boundary and acceptance radius/zone are both valid.
        matches = active_communities_for_coverage_point(latitude, longitude)
        if len(matches) != 1:
            return Response(
                {
                    "code": "location_outside_active_community",
                    "detail": "Choose a location inside an active community.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        community = matches[0]
        reporter = get_anonymous_intake_user(community)
        client_request_id = serializer.validated_data.get("client_request_id")
        if client_request_id:
            existing = Concern.objects.filter(
                reporter=reporter,
                client_request_id=client_request_id,
            ).select_related("community").first()
            if existing:
                if existing.validation_status != Concern.ValidationStatus.ACCEPTED:
                    _discard_unaccepted_concern(existing)
                else:
                    return Response(
                        {
                            "submitted": True,
                            "community": {
                                "public_id": str(existing.community.public_id),
                                "code": existing.community.code,
                                "name": existing.community.name,
                            },
                            "status": "submitted",
                        }
                    )

        # Resolve incident-community configuration before applying category,
        # dynamic-form, duplicate, or routing rules.
        configuration = ConcernClassificationConfiguration.current(community)
        enabled_categories = configuration.enabled_categories or list(Concern.Category.values)
        category_queryset = list(
            ConcernCategory.objects.filter(
                Q(community=community) | Q(community__isnull=True),
                is_active=True,
            )
            .select_related("department")
            .order_by("community_id", "name")
        )
        requested_category = str(request.data.get("category", "")).strip()
        requested_category_ref = next(
            (
                row
                for row in category_queryset
                if row.code == requested_category and row.code in enabled_categories
            ),
            None,
        )
        category_ref = requested_category_ref or next(
            (
                row
                for row in category_queryset
                if row.community_id == community.pk
                and row.code == Concern.Category.OTHERS
                and row.code in enabled_categories
            ),
            None,
        ) or next(
            (
                row
                for row in category_queryset
                if row.code == Concern.Category.OTHERS and row.code in enabled_categories
            ),
            None,
        ) or next(
            (row for row in category_queryset if row.community_id == community.pk and row.code in enabled_categories),
            None,
        ) or next((row for row in category_queryset if row.code in enabled_categories), None)
        selected_category = (
            category_ref.code
            if category_ref and category_ref.code in Concern.Category.values
            else Concern.Category.OTHERS
        )
        description = serializer.validated_data["description"]
        minimum_description_length = max(20, int(configuration.minimum_description_length or 0))
        if len(description) < minimum_description_length:
            return Response(
                {"description": [f"Describe the issue in at least {minimum_description_length} characters."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if low_information_reason(description):
            return Response(
                {"description": ["Please include only relevant details about the issue."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        validated_media = []
        media_hashes = set()
        current_phashes = []
        media_files = request.FILES.getlist("media")
        if len(media_files) > MAX_CONCERN_MEDIA_FILES:
            return Response(
                {"media": [f"You can attach up to {MAX_CONCERN_MEDIA_FILES} photos."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for uploaded_file in media_files:
            try:
                validated_file = validate_concern_media_file(uploaded_file)
            except ValidationError as exc:
                messages = [str(message) for message in getattr(exc, "messages", [])] or [str(exc)]
                return Response({"media": messages}, status=status.HTTP_400_BAD_REQUEST)
            media_hash = sha256_file(validated_file)
            raw_content = validated_file.read()
            validated_file.seek(0)
            media_phash = phash_file(raw_content)
            media_phash_blocks = phash_blocks_file(raw_content)
            exact_match = (
                ConcernMedia.objects.filter(sha256_hash=media_hash)
                .exclude(concern__status=Concern.Status.REJECTED)
                .select_related("concern")
                .first()
            )
            if media_hash in media_hashes or exact_match is not None:
                payload = {"media": [DUPLICATE_PHOTO_MESSAGE]}
                if exact_match is not None:
                    payload["existing_match"] = _existing_concern_match(exact_match)
                return Response(payload, status=status.HTTP_400_BAD_REQUEST)
            candidate_ids = phash_candidate_ids(
                SCOPE_CONCERN_MEDIA,
                phashes=[media_phash],
                blocks=media_phash_blocks,
            )
            existing_media = (
                list(
                    ConcernMedia.objects.filter(pk__in=candidate_ids)
                    .exclude(phash="")
                    .exclude(concern__status=Concern.Status.REJECTED)
                    .select_related("concern")
                )
                if candidate_ids
                else []
            )
            existing_phashes = [(media.phash, media.phash_blocks) for media in existing_media]
            if media_looks_duplicate(media_phash, media_phash_blocks, [*existing_phashes, *current_phashes]):
                matched_media = next(
                    (
                        media
                        for media in existing_media
                        if media_looks_duplicate(
                            media_phash,
                            media_phash_blocks,
                            [(media.phash, media.phash_blocks)],
                        )
                    ),
                    None,
                )
                payload = {"media": [DUPLICATE_PHOTO_MESSAGE]}
                if matched_media is not None:
                    payload["existing_match"] = _existing_concern_match(matched_media)
                return Response(payload, status=status.HTTP_400_BAD_REQUEST)
            media_hashes.add(media_hash)
            current_phashes.append((media_phash, media_phash_blocks))
            validated_media.append((uploaded_file, validated_file, media_hash, media_phash, media_phash_blocks))

        title = description.splitlines()[0].strip()[:160] or "Community Reporter report"
        fingerprints = report_fingerprints(
            barangay=community.name,
            category=selected_category,
            title=title,
            description=description,
            latitude=latitude,
            longitude=longitude,
            precision=configuration.report_duplicate_location_precision,
        )
        if (
            configuration.report_duplicate_detection_enabled
            and configuration.report_duplicate_action == ConcernClassificationConfiguration.ReportDuplicateAction.BLOCK
            and fingerprints["report_fingerprint"]
            and Concern.objects.filter(
                community=community,
                report_fingerprint=fingerprints["report_fingerprint"],
            )
            .exclude(status=Concern.Status.REJECTED)
            .exists()
        ):
            return Response(
                {"code": "duplicate_report", "detail": "A similar report already exists near this location."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        concern = Concern.objects.create(
            client_request_id=client_request_id,
            reporter=reporter,
            is_anonymous=True,
            community=community,
            reporter_community=None,
            category_ref=category_ref,
            title=title,
            description=description,
            category=selected_category,
            status=Concern.Status.SUBMITTED,
            validation_status=Concern.ValidationStatus.PENDING,
            validation_summary="Required report checks passed. Advanced analysis is pending.",
            update_text="Report submitted for automated validation.",
            address=serializer.validated_data["address"],
            latitude=latitude,
            longitude=longitude,
            location_source=serializer.validated_data.get("location_source", "manual_pin"),
            barangay=community.name,
            # Guest reports are explicitly community-visible after validation.
            # The guest intake has no private-report option, so category feed
            # settings must not silently hide a successfully submitted report.
            visibility=Concern.Visibility.COMMUNITY,
            report_fingerprint=fingerprints["report_fingerprint"],
            report_text_fingerprint=fingerprints["report_text_fingerprint"],
            report_location_bucket=fingerprints["report_location_bucket"],
            ip_asn=ip_meta.get("asn", ""),
            ip_country=ip_meta.get("country", ""),
            ip_org=ip_meta.get("org", ""),
            ip_verdict=ip_meta.get("verdict", ""),
            ip_score=ip_meta.get("score"),
        )
        concern.tracking_number = f"RPT-{concern.created_at.year}-{concern.pk:06d}"
        concern.save(update_fields=["tracking_number"])
        ConcernStatusEvent.objects.create(
            concern=concern,
            status=Concern.Status.SUBMITTED,
            note="Community Reporter report submitted.",
            actor=None,
        )
        create_timeline_entry(
            concern=concern,
            event_type=ConcernTimelineEntry.EventType.SUBMITTED,
            status=Concern.Status.SUBMITTED,
            message="Community Reporter report submitted.",
            actor=None,
        )
        if category_ref:
            description_field = category_ref.form_fields.filter(field_key="description", is_active=True).first()
            if description_field:
                ConcernFormValue.objects.create(concern=concern, field=description_field, value=description)
        ConcernAiAssessment.objects.create(concern=concern, status=ConcernAiAssessment.Status.PENDING)
        for uploaded_file, validated_file, media_hash, media_phash, media_phash_blocks in validated_media:
            ConcernMedia.objects.create(
                concern=concern,
                file=validated_file,
                original_filename=uploaded_file.name,
                mime_type=getattr(validated_file, "content_type", "") or "",
                file_size=validated_file.size,
                sha256_hash=media_hash,
                phash=media_phash,
                phash_blocks=media_phash_blocks,
            )
        validation_error = _validate_concern_before_commit(concern)
        if validation_error is not None:
            return validation_error
        concern.refresh_from_db()
        assigned_unit = None
        if concern.assigned_department_id and concern.assigned_department:
            assigned_unit = {
                "name": concern.assigned_department.name,
                "short_name": concern.assigned_department.short_name or concern.assigned_department.name,
            }
        elif concern.category_ref and concern.category_ref.department_id and concern.category_ref.department:
            assigned_unit = {
                "name": concern.category_ref.department.name,
                "short_name": concern.category_ref.department.short_name or concern.category_ref.department.name,
            }
        return Response(
            {
                "submitted": True,
                "community": {
                    "public_id": str(community.public_id),
                    "code": community.code,
                    "name": community.name,
                },
                "status": "submitted",
                "assigned_unit": assigned_unit,
            },
            status=status.HTTP_201_CREATED,
        )


class ConcernListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(
        summary="File a report",
        description=(
            "Submit a new concern. Multipart form-data: `title`, `description`, "
            "`category`, location fields, optional `media` photos (up to 3). Every "
            "photo passes signature + pixel validation; duplicates by hash or "
            "perceptual similarity are rejected with 400. Automated validation "
            "finishes before an accepted report is committed; rejected reports "
            "are returned as feedback and are not stored."
        ),
        request=ConcernCreateSerializer,
        responses={
            201: ConcernSerializer,
            400: OpenApiResponse(description="Field errors, or `{media: [...]}` for rejected/duplicate photos."),
        },
        tags=["concerns"],
    )

    @transaction.atomic
    def post(self, request):
        touch_last_seen(request.user)
        if not user_has_role_permission(request.user, "concerns.create"):
            return Response({"detail": "Only residents can submit concerns."}, status=status.HTTP_403_FORBIDDEN)
        from apps.accounts.ip_intel import evaluate_request, ip_blocked_response

        _, ip_meta, ip_reason = evaluate_request(request)
        if ip_reason:
            return ip_blocked_response(ip_reason)
        serializer = ConcernCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        client_request_id = serializer.validated_data.get("client_request_id")
        if client_request_id:
            existing = Concern.objects.filter(
                reporter=request.user,
                client_request_id=client_request_id,
            ).first()
            if existing:
                if existing.validation_status != Concern.ValidationStatus.ACCEPTED:
                    _discard_unaccepted_concern(existing)
                else:
                    decorated = decorate_concerns(Concern.objects.filter(pk=existing.pk), request.user)[0]
                    response_payload = ConcernSerializer(decorated, context={"request": request}).data
                    emergency_models = import_module("apps.emergencies.models")
                    existing_alert = emergency_models.EmergencyAlert.objects.filter(source_concern=existing).order_by("-created_at").first()
                    if existing_alert:
                        from apps.emergencies.views import serialize_alert
                        response_payload["escalated_alert"] = serialize_alert(existing_alert, request)
                    return Response(response_payload)
        category_ref = None
        reporter_community = getattr(getattr(request.user, "resident_profile", None), "community", None)
        if not reporter_community:
            return Response({"detail": "Your account is not assigned to an active community."}, status=status.HTTP_409_CONFLICT)
        located_community_id = (serializer.validated_data.get("_location_review") or {}).get("community_id")
        community_model = import_module("apps.emergencies.models").Community

        community = community_model.objects.filter(
            pk=located_community_id or reporter_community.pk,
            status=community_model.Status.ACTIVE,
        ).first()
        if not community:
            return Response({"location": ["The pinned location is outside every active community."]}, status=status.HTTP_400_BAD_REQUEST)
        category_id = serializer.validated_data.get("category_id")
        if category_id:
            selected_row = get_object_or_404(ConcernCategory, pk=category_id, is_active=True)
            category_ref = ConcernCategory.objects.filter(
                community=community,
                code=selected_row.code,
                is_active=True,
            ).first()
            if not category_ref:
                return Response(
                    {"category": ["Choose a category available in the incident community."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            selected_category = Concern.Category.OTHERS
        else:
            configuration = ConcernClassificationConfiguration.current(community)
            enabled_categories = configuration.enabled_categories or list(Concern.Category.values)
            selected_category = serializer.validated_data["category"]
            category_ref = (
                ConcernCategory.objects.filter(code=selected_category, is_active=True)
                .filter(Q(community=community) | Q(community__isnull=True))
                .select_related("department")
                .first()
            )
            if not category_ref and selected_category not in enabled_categories:
                return Response(
                    {"category": ["This concern category is temporarily unavailable. Choose another category."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Resolve the legacy string to a real category row so every concern
            # carries a FK, not just those filed through the newer path. Without
            # this, routing and the category breakdown silently skip them.
        description = serializer.validated_data.get("description", "").strip()
        if category_ref and category_ref.description_required and len(description) < 20:
            return Response({"description": ["Describe the issue in at least 20 characters."]}, status=status.HTTP_400_BAD_REQUEST)
        if low_information_reason(description):
            return Response(
                {"description": ["Please include only relevant details about the issue."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if category_ref and category_ref.location_required:
            if serializer.validated_data.get("latitude") is None or serializer.validated_data.get("longitude") is None or not serializer.validated_data.get("address", "").strip():
                return Response({"address": ["Pin where the issue is located."]}, status=status.HTTP_400_BAD_REQUEST)
        location_review = serializer.validated_data.get("_location_review") or {}
        pending_location_review = location_review.get("action") == "review"
        validation_summary = location_review.get("summary") or "Required report checks passed. Advanced analysis is pending."
        validated_media = []
        media_hashes = set()
        media_files = request.FILES.getlist("media")
        if len(media_files) > MAX_CONCERN_MEDIA_FILES:
            return Response(
                {"media": [f"You can attach up to {MAX_CONCERN_MEDIA_FILES} photos."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if category_ref and category_ref.photo_required and not media_files:
            return Response(
                {"media": ["Add at least one clear photo as evidence."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        existing_phashes = []
        current_phashes = []
        for uploaded_file in media_files:
            try:
                validated_file = validate_concern_media_file(uploaded_file)
            except ValidationError as exc:
                messages = []
                if hasattr(exc, "messages") and exc.messages:
                    messages = [str(m) for m in exc.messages]
                else:
                    text = str(exc).strip()
                    if text.startswith("[") and text.endswith("]"):
                        text = text[1:-1].strip().strip("'\"")
                    messages = [text] if text else ["This photo could not be validated."]
                return Response({"media": messages}, status=status.HTTP_400_BAD_REQUEST)
            media_hash = sha256_file(validated_file)
            raw_content = validated_file.read(); validated_file.seek(0)
            media_phash = phash_file(raw_content)
            media_phash_blocks = phash_blocks_file(raw_content)
            exact_match = (
                ConcernMedia.objects.filter(sha256_hash=media_hash)
                .exclude(concern__status=Concern.Status.REJECTED)
                .select_related("concern")
                .first()
            )
            if media_hash in media_hashes or exact_match is not None:
                payload = {"media": [DUPLICATE_PHOTO_MESSAGE]}
                if exact_match is not None:
                    payload["existing_match"] = _existing_concern_match(exact_match)
                return Response(payload, status=status.HTTP_400_BAD_REQUEST)
            candidate_ids = phash_candidate_ids(
                SCOPE_CONCERN_MEDIA, phashes=[media_phash], blocks=media_phash_blocks
            )
            existing_media = (
                list(
                    ConcernMedia.objects.filter(pk__in=candidate_ids)
                    .exclude(phash="")
                    .exclude(concern__status=Concern.Status.REJECTED)
                    .select_related("concern")
                )
                if candidate_ids
                else []
            )
            existing_phashes = [(media.phash, media.phash_blocks) for media in existing_media]
            if media_looks_duplicate(media_phash, media_phash_blocks, [*existing_phashes, *current_phashes]):
                matched_media = next(
                    (
                        media
                        for media in existing_media
                        if media_looks_duplicate(
                            media_phash,
                            media_phash_blocks,
                            [(media.phash, media.phash_blocks)],
                        )
                    ),
                    None,
                )
                payload = {"media": [DUPLICATE_PHOTO_MESSAGE]}
                if matched_media is not None:
                    payload["existing_match"] = _existing_concern_match(matched_media)
                return Response(payload, status=status.HTTP_400_BAD_REQUEST)
            media_hashes.add(media_hash)
            current_phashes.append((media_phash, media_phash_blocks))
            validated_media.append((uploaded_file, validated_file, media_hash, media_phash, media_phash_blocks))
        duplicate_config = ConcernClassificationConfiguration.current(community)
        fingerprints = report_fingerprints(
            barangay=community.name,
            category=selected_category,
            title=serializer.validated_data["title"],
            description=description,
            latitude=serializer.validated_data.get("latitude"),
            longitude=serializer.validated_data.get("longitude"),
            precision=duplicate_config.report_duplicate_location_precision,
        )
        if duplicate_config.report_duplicate_detection_enabled and duplicate_config.report_duplicate_action == ConcernClassificationConfiguration.ReportDuplicateAction.BLOCK:
            duplicate_exists = bool(
                fingerprints["report_fingerprint"]
                and Concern.objects.filter(
                    community=community,
                    report_fingerprint=fingerprints["report_fingerprint"],
                ).exclude(status=Concern.Status.REJECTED).exists()
            )
            if duplicate_exists:
                return Response(
                    {"description": ["A similar report already exists near this location. Add new details only if this is a different issue."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        # Feed visibility is a category policy, not a resident-controlled
        # setting. Public-capable categories publish to the community feed;
        # restricted categories always remain private.
        effective_visibility = (
            Concern.Visibility.COMMUNITY
            if not category_ref or category_ref.public_feed_allowed
            else Concern.Visibility.PRIVATE
        )
        concern = Concern.objects.create(
            community=community,
            reporter_community=reporter_community,
            client_request_id=client_request_id,
            reporter=request.user,
            title=serializer.validated_data["title"],
            description=serializer.validated_data.get("description", ""),
            category=selected_category,
            category_ref=category_ref,
            visibility=effective_visibility,
            address=serializer.validated_data.get("address", ""),
            latitude=serializer.validated_data.get("latitude"),
            longitude=serializer.validated_data.get("longitude"),
            report_fingerprint=fingerprints["report_fingerprint"],
            report_text_fingerprint=fingerprints["report_text_fingerprint"],
            report_location_bucket=fingerprints["report_location_bucket"],
            location_source=serializer.validated_data.get("location_source", ""),
            location_accuracy=serializer.validated_data.get("location_accuracy"),
            barangay=community.name,
            validation_status=Concern.ValidationStatus.PENDING,
            validation_summary=validation_summary,
            update_text="Report submitted for location review." if pending_location_review else "Report submitted for automated validation.",
            ip_asn=ip_meta.get("asn", ""),
            ip_country=ip_meta.get("country", ""),
            ip_org=ip_meta.get("org", ""),
            ip_verdict=ip_meta.get("verdict", ""),
            ip_score=ip_meta.get("score"),
            duplicate_of_id=serializer.validated_data.get("duplicate_of"),
            recurrence_of_id=serializer.validated_data.get("recurrence_of"),
        )
        concern.tracking_number = f"RPT-{concern.created_at.year}-{concern.pk:06d}"
        concern.save(update_fields=["tracking_number"])
        ConcernStatusEvent.objects.create(
            concern=concern,
            status=Concern.Status.SUBMITTED,
            note="Report submitted.",
            actor=request.user,
        )
        create_timeline_entry(
            concern=concern,
            event_type=ConcernTimelineEntry.EventType.SUBMITTED,
            status=Concern.Status.SUBMITTED,
            message="Report submitted.",
            actor=request.user,
        )
        if category_ref:
            dynamic_values = serializer.validated_data.get("dynamic_fields") or {}
            for field in category_ref.form_fields.filter(is_active=True):
                value = dynamic_values.get(field.field_key, "")
                if field.field_key == "description" and value in (None, "", []):
                    value = concern.description
                if field.is_required and value in (None, "", []):
                    raise ValidationError({field.field_key: "This field is required."})
                if value not in (None, "", []):
                    ConcernFormValue.objects.create(concern=concern, field=field, value=str(value))
        ConcernAiAssessment.objects.create(concern=concern, status=ConcernAiAssessment.Status.PENDING)
        for uploaded_file, validated_file, media_hash, media_phash, media_phash_blocks in validated_media:
            ConcernMedia.objects.create(
                concern=concern,
                file=validated_file,
                original_filename=uploaded_file.name,
                mime_type=getattr(validated_file, "content_type", "") or "",
                file_size=validated_file.size,
                sha256_hash=media_hash,
                phash=media_phash,
                phash_blocks=media_phash_blocks,
            )
        validation_error = _validate_concern_before_commit(concern)
        if validation_error is not None:
            return validation_error
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        from apps.live_map import concern_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("concern.created", {"concern": concern_payload(decorated)}))
        transaction.on_commit(lambda: _schedule_concern_location(concern.pk))
        response_payload = ConcernSerializer(decorated, context={"request": request}).data
        return Response(response_payload, status=status.HTTP_201_CREATED)


class MyConcernListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="My reports",
        description=(
            "The authenticated resident's own reports, newest first, as slim list "
            "rows. Open a report with the detail endpoint for the full record "
            "(timeline, chat, community incident). Supports `status`, `date_from` "
            "and `date_to` filters plus pagination."
        ),
        request=None,
        responses={200: list_envelope_response(ConcernListSerializer, name="ConcernListEnvelope")},
        parameters=PAGE_PARAMETERS,
        tags=["concerns"],
    )
    def get(self, request):
        touch_last_seen(request.user)
        queryset = Concern.objects.filter(
            reporter=request.user,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            if status_filter == "active":
                queryset = queryset.filter(status__in=ACTIVE_STATUSES)
            else:
                queryset = queryset.filter(status=status_filter)
        date_from = request.query_params.get("date_from")
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        date_to = request.query_params.get("date_to")
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        queryset = queryset.order_by("-created_at", "-id")
        queryset = queryset.select_related("assigned_department", "category_ref")
        return paginate_response(
            request,
            queryset,
            lambda page: ConcernListSerializer(
                decorate_concerns(page, request.user),
                many=True,
                context={"request": request},
            ).data,
        )


class AssignedConcernListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="My assigned reports",
        description="Open reports assigned to the authenticated responder or official.",
        request=None,
        responses={200: list_envelope_response(ConcernListSerializer, name="ConcernListEnvelope")},
        parameters=PAGE_PARAMETERS,
        tags=["concerns"],
    )
    def get(self, request):
        touch_last_seen(request.user)
        User = get_user_model()
        if not (
            request.user.is_superuser
            or request.user.role in {User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL}
        ):
            return Response(
                {"detail": "You do not have permission to view assigned concerns."},
                status=status.HTTP_403_FORBIDDEN,
            )
        scope = request.query_params.get("scope")
        if scope == "unit" and request.user.role == User.Role.FIRST_RESPONDER:
            # The current unit comes from the server-side designation (with the
            # legacy responder enum handled by assigned_unit_for). A responder
            # cannot turn this into a cross-unit report query.
            assigned_unit = assigned_unit_for(request.user)
            unit = (
                Department.objects.filter(
                    pk=assigned_unit.get("id") if assigned_unit else None,
                    is_active=True,
                ).first()
                if assigned_unit
                else None
            )
            if unit is None:
                legacy_unit = department_for_responder_unit(
                    getattr(request.user, "responder_unit", "")
                )
                unit = (
                    legacy_unit
                    if legacy_unit and legacy_unit.is_active
                    else None
                )
            if unit is None:
                queryset = Concern.objects.none()
            else:
                queryset = Concern.objects.filter(
                    Q(assigned_department_id=unit.pk)
                    | Q(
                        assigned_department_id__isnull=True,
                        category_ref__department_id=unit.pk,
                    ),
                    validation_status=Concern.ValidationStatus.ACCEPTED,
                )
        else:
            include_closed = scope == "all"
            assignment_statuses = [ConcernAssignment.Status.ACTIVE]
            if include_closed:
                assignment_statuses.append(ConcernAssignment.Status.COMPLETED)
            assigned_filter = Q(
                assignments__assignee=request.user,
                assignments__status__in=assignment_statuses,
            )
            # Responders see only work explicitly assigned to their account.
            # The department-wide unassigned fallback remains for officials
            # managing a queue, never for a responder's personal workspace.
            if request.user.role == User.Role.BARANGAY_OFFICIAL or request.user.is_superuser:
                assigned_filter |= Q(
                    assignments__status=ConcernAssignment.Status.ACTIVE,
                    assignments__assignee__isnull=True,
                    assignments__department__designations__user=request.user,
                    assignments__department__designations__is_active=True,
                )
            queryset = Concern.objects.filter(
                assigned_filter,
                validation_status=Concern.ValidationStatus.ACCEPTED,
            )
        if scope not in {"all", "unit"}:
            queryset = queryset.exclude(
                status__in=[Concern.Status.RESOLVED, Concern.Status.REJECTED]
            )
        queryset = queryset.distinct().order_by("-created_at", "-id")
        queryset = queryset.select_related("assigned_department", "category_ref")
        return paginate_response(
            request,
            queryset,
            lambda page: ConcernListSerializer(
                decorate_concerns(page, request.user),
                many=True,
                context={"request": request},
            ).data,
        )


class ManagedConcernListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Report management queue",
        description=(
            "Officials' working queue across all residents with server-side "
            "`status`, `category`, `q` and `ai` filters. Rows are slim; open a "
            "report for the full record."
        ),
        request=None,
        responses={200: list_envelope_response(ConcernListSerializer, name="ConcernListEnvelope")},
        parameters=PAGE_PARAMETERS,
        tags=["concerns"],
    )
    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to manage reports."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import scope_concern_queryset
        queryset = scope_concern_queryset(Concern.objects.exclude(validation_status=Concern.ValidationStatus.PENDING), request.user, include_public=False)
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            if status_filter == "active":
                queryset = queryset.filter(status__in=ACTIVE_STATUSES)
            else:
                queryset = queryset.filter(status=status_filter)
        category = request.query_params.get("category")
        if category and category != "all":
            queryset = queryset.filter(category=category)
        search = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(address__icontains=search)
                | Q(barangay__icontains=search)
                | Q(update_text__icontains=search)
            )
        concerns_queryset = queryset.order_by("-updated_at", "-created_at", "-id").select_related("assigned_department", "category_ref")
        return paginate_response(
            request,
            concerns_queryset,
            lambda page: ConcernListSerializer(
                decorate_concerns(page, request.user),
                many=True,
                context={"request": request},
            ).data,
        )

def _record_official_view(user, concern):
    """Log that an official opened this report — a resident's only way to see
    someone has actually looked, before any assignment exists to name them.
    """
    if concern.reporter_id == user.pk:
        return
    is_official = bool(user.is_superuser or user.role == user.Role.BARANGAY_OFFICIAL)
    if not is_official:
        return
    view, created = ConcernView.objects.get_or_create(concern=concern, viewer=user)
    if not created:
        view.save(update_fields=["last_viewed_at"])


class ConcernDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Report detail",
        description=(
            "The full record for one concern: timeline, chat thread, media with "
            "preview URLs, appeals, clarifications and community context. The web "
            "app calls this when a list row is opened."
        ),
        request=None,
        responses={
            200: ConcernSerializer,
            403: OpenApiResponse(description="Not the reporter, assignee or an official."),
            404: OpenApiResponse(description="Unknown id."),
        },
        tags=["concerns"],
    )
    def get(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk)
        if not can_access_concern(request.user, concern):
            return Response({"detail": "You do not have permission to view this report."}, status=status.HTTP_403_FORBIDDEN)
        _record_official_view(request.user, concern)
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        from apps.community_access import concern_access_mode

        access_mode = concern_access_mode(request.user, decorated)
        return Response(ConcernSerializer(
            decorated,
            context={"request": request, "privacy_safe": access_mode not in {"owner", "operational"}},
        ).data)


class ConcernPublicDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, public_id):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, public_id=public_id)
        if not can_access_concern(request.user, concern):
            return Response({"detail": "You do not have permission to view this report."}, status=status.HTTP_403_FORBIDDEN)
        _record_official_view(request.user, concern)
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        from apps.community_access import concern_access_mode

        access_mode = concern_access_mode(request.user, decorated)
        can_view_private_case = access_mode in {"owner", "operational"}
        return Response(
            ConcernSerializer(
                decorated,
                context={"request": request, "privacy_safe": not can_view_private_case},
            ).data
        )


class ConcernPublishView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(
            Concern.objects.select_for_update(),
            pk=pk,
            reporter=request.user,
        )
        if concern.category_ref and not concern.category_ref.public_feed_allowed:
            return Response(
                {"visibility": ["This report category is private."]},
                status=status.HTTP_409_CONFLICT,
            )
        if concern.validation_status != Concern.ValidationStatus.ACCEPTED:
            return Response(
                {"validation_status": ["This report must be accepted before it can be shared publicly."]},
                status=status.HTTP_409_CONFLICT,
            )
        if concern.status == Concern.Status.REJECTED:
            return Response(
                {"status": ["Rejected reports cannot be shared publicly."]},
                status=status.HTTP_409_CONFLICT,
            )
        if concern.visibility != Concern.Visibility.COMMUNITY:
            concern.visibility = Concern.Visibility.COMMUNITY
            concern.publication_block_reason = ""
            concern.update_text = "Report shared with the community."
            concern.status_version += 1
            concern.save(
                update_fields=[
                    "visibility",
                    "publication_block_reason",
                    "update_text",
                    "status_version",
                    "updated_at",
                ]
            )
            create_timeline_entry(
                concern=concern,
                event_type=ConcernTimelineEntry.EventType.CUSTOM,
                status=concern.status,
                message="Report shared with the community.",
                actor=request.user,
                metadata={"visibility": Concern.Visibility.COMMUNITY},
            )
            create_audit_log(
                "concern.published",
                actor=request.user,
                target_user=concern.reporter,
                metadata={"concern_id": concern.pk},
                request_meta=request_meta(request),
            )

            from apps.live_map import concern_payload
            from apps.notifications.services import broadcast_live_map_event

            decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
            transaction.on_commit(
                lambda: broadcast_live_map_event(
                    "concern.updated",
                    {"concern": concern_payload(decorated)},
                )
            )
        else:
            decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]

        return Response(ConcernSerializer(decorated, context={"request": request}).data)


class ConcernFeedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        from apps.community_scope import community_ids_for_user, department_ids_for_user
        User = get_user_model()
        queryset = Concern.objects.filter(
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status__in=FEED_VISIBLE_STATUSES,
        )
        home_ids = community_ids_for_user(request.user)
        scope = (request.query_params.get("scope") or "home").strip().lower()
        if scope == "home":
            queryset = queryset.filter(community_id__in=home_ids)
        elif scope == "other":
            queryset = queryset.exclude(community_id__in=home_ids)
        elif scope != "all":
            return Response({"scope": ["Use home, other, or all."]}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.is_superuser and request.user.role in {User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER}:
            department_ids = department_ids_for_user(request.user)
            queryset = queryset.filter(
                Q(assigned_department_id__in=department_ids)
                | Q(assigned_department__isnull=True, category_ref__department_id__in=department_ids)
            )
        category = request.query_params.get("category")
        if category and category != "all":
            queryset = queryset.filter(category=category)
        search = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(barangay__icontains=search)
                | Q(update_text__icontains=search)
            )
        date_from = request.query_params.get("date_from")
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        date_to = request.query_params.get("date_to")
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        # Bound the work: the old code decorated + serialized the whole table,
        # so scope=all degraded to 4-12s. Order in the DB, cap rows, decorate
        # only the visible window. Cost is O(page) instead of O(table).
        # NOTE (index safeguard): no new index is added here. Candidate would
        # be a partial index on (updated_at DESC) WHERE visibility='community'
        # AND validation_status='accepted' — but low-cardinality leading
        # columns may make Postgres prefer a seq scan anyway. Run
        # EXPLAIN (ANALYZE, BUFFERS) on the prod-shaped query before creating
        # it. Existing concern_comm_status / concern_status_queue cover the
        # common paths.
        # MEASURED 2026-09-26 on dev (255/269 rows matching): planner still
        # seq-scans + quicksorts in ~0.6ms even WITH the partial index present
        # — the index is dead weight at this selectivity. The 4-12s feed cost
        # was Python (decorate + serialize), now bounded by the cap above.
        # Revisit only if EXPLAIN on prod-shaped volume shows otherwise.
        from apps.concerns.serializers import ConcernFeedSerializer as _FeedSerializer

        # Server-side "nearby" support: the client passes its own position and
        # we attach a coarse distance per concern. The concern's exact
        # coordinates stay hidden (privacy_safe below), but distance-from-viewer
        # is safe — the viewer already knows where they are.
        try:
            viewer_lat = float(request.query_params.get("lat", "").strip() or "nan")
            viewer_lng = float(request.query_params.get("lng", "").strip() or "nan")
        except (TypeError, ValueError):
            viewer_lat = viewer_lng = float("nan")

        def _serialize_window(window):
            if math.isfinite(viewer_lat) and math.isfinite(viewer_lng):
                from apps.geo_services import haversine_meters

                for concern in window:
                    if concern.latitude is None or concern.longitude is None:
                        concern.distance_meters = None
                    else:
                        concern.distance_meters = haversine_meters(
                            viewer_lat,
                            viewer_lng,
                            float(concern.latitude),
                            float(concern.longitude),
                        )
            # Band-encoded priority: severity band first, recency/support only
            # within a band. Pure Python over annotated/prefetched relations.
            from apps.concerns.severity import priority_score

            ordered = sorted(
                window,
                key=lambda item: (priority_score(item), item.updated_at, item.pk),
                reverse=True,
            )
            return _FeedSerializer(ordered, many=True, context={"request": request, "privacy_safe": True}).data

        # Paginated envelope path (opt-in): ?page=&page_size= return
        # {count, next, previous, results} with slim rows, so new clients page
        # 3-by-3 (default) up to 20 per page. Severity ordering applies
        # within the page; global severity ordering needs an annotated
        # severity column (follow-up) — do not Python-sort the whole table.
        if "page" in request.query_params or "page_size" in request.query_params:
            ordered_qs = queryset.order_by("-updated_at", "-id")
            return paginate_response(
                request,
                ordered_qs,
                lambda page: _serialize_window(decorate_concerns_for_feed(page, request.user)),
                default_size=3,
                max_size=20,
            )
        try:
            limit = int(request.query_params.get("limit", 20))
        except (TypeError, ValueError):
            limit = 20
        limit = min(max(1, limit), 20)
        concerns = decorate_concerns_for_feed(
            queryset.order_by("-updated_at", "-id")[:limit], request.user
        )
        return Response(_serialize_window(concerns))


class ConcernVoteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(
            Concern,
            pk=pk,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        from apps.community_access import concern_access_mode

        access_mode = concern_access_mode(request.user, concern)
        if access_mode is None:
            return Response({"detail": "You cannot interact with this concern."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ConcernVoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        value = serializer.validated_data["value"]
        if value == 0:
            ConcernVote.objects.filter(concern=concern, user=request.user).delete()
        else:
            ConcernVote.objects.update_or_create(
                concern=concern,
                user=request.user,
                defaults={"value": 1},
            )
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        return Response({
            "vote_count": decorated.vote_count,
            "user_vote": decorated.user_vote,
        })


class ConcernCommentCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(
            Concern,
            pk=pk,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        from apps.community_access import concern_access_mode

        access_mode = concern_access_mode(request.user, concern)
        if access_mode is None:
            return Response({"detail": "You cannot interact with this concern."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ConcernCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = None
        parent_id = serializer.validated_data.get("parent")
        if parent_id:
            parent = get_object_or_404(ConcernComment, pk=parent_id, concern=concern)
            # One-level replies only — always hang off the top-level comment
            if parent.parent_id is not None:
                parent = parent.parent
        try:
            with transaction.atomic():
                comment = ConcernComment.objects.create(
                    concern=concern,
                    author=request.user,
                    parent=parent,
                    body=serializer.validated_data["body"],
                )
                uploaded_file = serializer.validated_data.get("media")
                if uploaded_file:
                    from .comment_media import create_public_comment_attachment

                    create_public_comment_attachment(
                        uploaded_file=uploaded_file,
                        parent_field="concern_comment",
                        parent=comment,
                        concern=concern,
                    )
        except ValidationError as exc:
            detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", [str(exc)])
            return Response({"media": detail}, status=status.HTTP_400_BAD_REQUEST)
        notify_comment_participants(comment)
        return Response(
            ConcernCommentSerializer(comment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ConcernCommentDetailView(APIView):
    """Author can edit or delete their own comment."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk, comment_id):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk)
        from apps.community_access import concern_access_mode, foreign_read_only_response

        access_mode = concern_access_mode(request.user, concern)
        if access_mode == "foreign_read_only":
            return foreign_read_only_response()
        if access_mode is None:
            return Response({"detail": "You cannot interact with this concern."}, status=status.HTTP_404_NOT_FOUND)
        comment = get_object_or_404(ConcernComment, pk=comment_id, concern=concern)
        if comment.author_id != request.user.id:
            return Response({"detail": "You can only edit your own comments."}, status=status.HTTP_403_FORBIDDEN)
        body = (request.data.get("body") or "").strip()
        if not body:
            return Response({"body": ["Comment cannot be empty."]}, status=status.HTTP_400_BAD_REQUEST)
        if len(body) > 1000:
            return Response({"body": ["Comment is too long."]}, status=status.HTTP_400_BAD_REQUEST)
        if body == comment.body:
            return Response(ConcernCommentSerializer(comment, context={"request": request}).data)
        previous_mentions = set(comment_mention_ids(comment.body))
        # Preserve original text on first edit only
        if not comment.is_edited:
            comment.original_body = comment.body
            comment.is_edited = True
        comment.body = body
        comment.save(update_fields=["body", "original_body", "is_edited", "updated_at"])
        new_mentions = [user_id for user_id in comment_mention_ids(body) if user_id not in previous_mentions]
        notify_comment_mentions(comment, new_mentions)
        return Response(ConcernCommentSerializer(comment, context={"request": request}).data)

    def delete(self, request, pk, comment_id):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk)
        from apps.community_access import concern_access_mode, foreign_read_only_response

        access_mode = concern_access_mode(request.user, concern)
        if access_mode == "foreign_read_only":
            return foreign_read_only_response()
        if access_mode is None:
            return Response({"detail": "You cannot interact with this concern."}, status=status.HTTP_404_NOT_FOUND)
        comment = get_object_or_404(ConcernComment, pk=comment_id, concern=concern)
        if comment.author_id != request.user.id:
            return Response({"detail": "You can only delete your own comments."}, status=status.HTTP_403_FORBIDDEN)
        comment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContentFlagCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        concern = get_object_or_404(Concern, pk=pk)
        from apps.community_access import concern_access_mode, foreign_read_only_response

        access_mode = concern_access_mode(request.user, concern)
        if access_mode == "foreign_read_only":
            return foreign_read_only_response()
        if access_mode is None:
            return Response({"detail": "You cannot interact with this concern."}, status=status.HTTP_404_NOT_FOUND)
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk, visibility=Concern.Visibility.COMMUNITY)
        serializer = ContentFlagSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = None
        comment_id = serializer.validated_data.get("comment")
        if comment_id:
            comment = get_object_or_404(ConcernComment, pk=comment_id, concern=concern)
        flag = ContentFlag.objects.create(
            concern=concern,
            comment=comment,
            reporter=request.user,
            reason=serializer.validated_data["reason"],
            note=serializer.validated_data.get("note", ""),
        )
        create_audit_log(
            "content.flag_submitted",
            actor=request.user,
            target_user=concern.reporter,
            metadata={"concern_id": concern.pk, "flag_id": flag.pk, "reason": flag.reason},
            request_meta=request_meta(request),
        )
        transaction.on_commit(lambda: enqueue_content_moderation_ai(flag.pk))
        return Response(ContentFlagSerializer(flag, context={"request": request}).data, status=status.HTTP_201_CREATED)

class ContentFlagListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to view content flags."}, status=status.HTTP_403_FORBIDDEN)
        flags = ContentFlag.objects.select_related(
            "concern",
            "concern__reporter",
            "concern__reporter__resident_profile",
            "comment",
            "comment__author",
            "comment__author__resident_profile",
            "announcement_comment",
            "announcement_comment__author",
            "announcement_comment__author__resident_profile",
            "announcement_comment__announcement",
            "emergency_comment",
            "emergency_comment__author",
            "emergency_comment__author__resident_profile",
            "emergency_comment__alert",
            "reporter",
            "reporter__resident_profile",
        )
        if not request.user.is_superuser:
            from apps.community_scope import community_ids_for_user

            community_ids = community_ids_for_user(request.user)
            flags = flags.filter(
                Q(concern__community_id__in=community_ids)
                | Q(announcement_comment__announcement__community_id__in=community_ids)
                | Q(emergency_comment__alert__community_id__in=community_ids)
            )
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            flags = flags.filter(status=status_filter)
        return Response(ContentFlagSerializer(flags, many=True, context={"request": request}).data)


class PublicCommentAttachmentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, preview=False):
        attachment = get_object_or_404(
            PublicCommentAttachment.objects.select_related(
                "concern_comment__concern",
                "announcement_comment__announcement",
                "emergency_comment__alert",
            ),
            pk=pk,
        )
        allowed = False
        if attachment.concern_comment_id:
            from apps.community_access import concern_access_mode

            allowed = concern_access_mode(request.user, attachment.concern_comment.concern) is not None
        elif attachment.announcement_comment_id:
            from .community_api import community_content_allowed

            allowed = community_content_allowed(
                request.user, attachment.announcement_comment.announcement.community_id
            )
        elif attachment.emergency_comment_id:
            from apps.community_access import emergency_access_mode

            allowed = emergency_access_mode(request.user, attachment.emergency_comment.alert) not in {None, "foreign_read_only"}
        if not allowed:
            return Response({"detail": "You cannot access this attachment."}, status=status.HTTP_404_NOT_FOUND)
        field = attachment.preview_file if preview else attachment.file
        if not field:
            return Response({"detail": "Attachment unavailable."}, status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(field.open("rb"), content_type="image/jpeg" if preview else attachment.mime_type)
        response["Content-Disposition"] = f'inline; filename="{attachment.original_filename}"'
        if preview:
            response["Cache-Control"] = "public, max-age=86400, immutable"
        return response


def _can_take_down(concern):
    return concern.status == Concern.Status.REJECTED or Concern.Status.REJECTED in LEGAL_STATUS_TRANSITIONS.get(
        concern.status, set()
    )


def _flag_target_author(flag):
    """Whoever authored the flagged content, whatever kind it is."""
    kind = flag.target_kind
    if kind == "concern_comment":
        return flag.comment.author
    if kind == "announcement_comment":
        return flag.announcement_comment.author
    if kind == "emergency_comment":
        return flag.emergency_comment.author
    return flag.concern.reporter if flag.concern_id else None


class ContentFlagReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        return self.patch(request, pk)

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to review content flags."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ContentFlagReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        decision = serializer.validated_data["status"]
        staff_note = serializer.validated_data["staff_note"]
        flag = get_object_or_404(
            self._scoped_flags(request.user).select_related(
                "concern",
                "concern__reporter",
                "comment",
                "comment__author",
                "announcement_comment",
                "announcement_comment__author",
                "emergency_comment",
                "emergency_comment__author",
                "reporter",
            ),
            pk=pk,
        )
        # A closed-post terminal-state guard only makes sense for a whole-post
        # takedown. Hiding an already-hidden comment is harmless and idempotent,
        # so comment-kind flags skip this check entirely.
        if (
            decision == ContentFlag.Status.TAKEN_DOWN
            and flag.target_kind == "concern"
            and not _can_take_down(flag.concern)
        ):
            return Response(
                {"detail": "This report is already closed and can no longer be taken down."},
                status=status.HTTP_409_CONFLICT,
            )
        was_automated_takedown = (
            decision == ContentFlag.Status.DISMISSED
            and flag.status == ContentFlag.Status.TAKEN_DOWN
            and flag.auto_moderated
        )
        flag.status = decision
        flag.staff_note = staff_note
        flag.reviewed_by = request.user
        flag.save(update_fields=["status", "staff_note", "reviewed_by", "updated_at"])

        target_author = _flag_target_author(flag)
        if decision == ContentFlag.Status.TAKEN_DOWN:
            execute_takedown(flag, staff_note, actor=request.user, request=request)
        elif was_automated_takedown:
            restore_automated_takedown(flag, staff_note, actor=request.user)
            flag.auto_moderated = False
            flag.save(update_fields=["auto_moderated", "updated_at"])
        elif target_author is not None and flag.reporter_id != target_author.pk:
            self._notify_flag_reporter_dismissed(flag, staff_note)

        create_audit_log(
            "content.flag_reviewed",
            actor=request.user,
            target_user=flag.concern.reporter if flag.concern_id else target_author,
            metadata={"flag_id": flag.pk, "concern_id": flag.concern_id, "status": flag.status},
            request_meta=request_meta(request),
        )
        return Response(ContentFlagSerializer(flag, context={"request": request}).data)

    @staticmethod
    def _scoped_flags(user):
        queryset = ContentFlag.objects.all()
        if user.is_superuser:
            return queryset
        from apps.community_scope import community_ids_for_user

        community_ids = community_ids_for_user(user)
        return queryset.filter(
            Q(concern__community_id__in=community_ids)
            | Q(announcement_comment__announcement__community_id__in=community_ids)
            | Q(emergency_comment__alert__community_id__in=community_ids)
        )

    @staticmethod
    def _notify_flag_reporter_dismissed(flag, staff_note):
        from apps.notifications.services import notify_flag_review_dismissed

        notify_flag_review_dismissed(
            flag_reporter=flag.reporter,
            concern=flag.concern,
            staff_note=staff_note,
        )


class ConcernAssignView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to assign reports."}, status=status.HTTP_403_FORBIDDEN)
        concern = operational_concern_or_404(request.user, pk)
        if concern.validation_status != Concern.ValidationStatus.ACCEPTED:
            return Response(
                {"validation_status": ["This report must pass validation before it can be assigned."]},
                status=status.HTTP_409_CONFLICT,
            )
        if concern.status not in {
            Concern.Status.SUBMITTED,
            Concern.Status.UNDER_REVIEW,
            Concern.Status.ASSIGNED,
            Concern.Status.IN_PROGRESS,
        }:
            return Response(
                {"status": ["Only active reports can be assigned or reassigned."]},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = ConcernAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignee = None
        assignee_id = serializer.validated_data.get("assignee_id")
        if assignee_id:
            User = get_user_model()
            assignee = get_object_or_404(
                User.objects.filter(
                    pk=assignee_id,
                    role__in=[User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER],
                    status=User.Status.VERIFIED,
                    designations__is_active=True,
                    designations__department__community=concern.community,
                ).distinct()
            )
        department = None
        department_id = serializer.validated_data.get("department_id")
        if department_id:
            department = get_object_or_404(
                Department,
                pk=department_id,
                community=concern.community,
                is_active=True,
            )
        elif concern.assigned_department_id:
            department = concern.assigned_department
        if assignee and not department:
            return Response(
                {"department_id": ["Choose the unit that will handle this report."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if assignee and department and not assignee.designations.filter(
            is_active=True,
            department=department,
        ).exists():
            return Response(
                {"assignee_id": ["Choose a member of the selected unit."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        office = serializer.validated_data.get("office", "").strip()
        assignment_note = serializer.validated_data.get("note", "").strip()
        active_assignments = list(
            ConcernAssignment.objects.select_for_update(of=("self",))
            .filter(concern=concern, status=ConcernAssignment.Status.ACTIVE)
            .select_related("assignee")
        )
        matching = next(
            (
                item
                for item in active_assignments
                if item.assignee_id == (assignee.pk if assignee else None)
                and item.office.strip().casefold() == office.casefold()
                and item.department_id == (department.pk if department else None)
            ),
            None,
        )
        if matching and len(active_assignments) == 1:
            if assignment_note and assignment_note != matching.note:
                matching.note = assignment_note
                matching.save(update_fields=["note", "updated_at"])
            return Response(
                ConcernAssignmentSerializer(matching, context={"request": request}).data
            )

        previous_assignment_ids = [item.pk for item in active_assignments]
        ConcernAssignment.objects.filter(pk__in=previous_assignment_ids).update(
            status=ConcernAssignment.Status.CANCELLED
        )
        for previous in active_assignments:
            if previous.assignee and previous.assignee_id != (assignee.pk if assignee else None):
                create_concern_notification(
                    concern,
                    recipient=previous.assignee,
                    type="assigned",
                    title="Concern assignment changed",
                    body="This concern was reassigned and is no longer in your active field queue.",
                )
        assignment = ConcernAssignment.objects.create(
            concern=concern,
            assignee=assignee,
            assigned_by=request.user,
            department=department,
            office=office,
            note=assignment_note,
        )
        assignee_name = PublicUserSerializer(assignee).data["full_name"] if assignee else assignment.office
        assignment_verb = "Reassigned to" if previous_assignment_ids else "Assigned to"
        note = assignment.note or f"{assignment_verb} {assignee_name or 'the barangay response team'}."
        if department and concern.assigned_department_id != department.pk:
            concern.assigned_department = department
        concern.status = Concern.Status.ASSIGNED
        concern.update_text = note
        concern.status_version += 1
        concern.save(update_fields=["assigned_department", "status", "update_text", "status_version", "updated_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=Concern.Status.ASSIGNED, note=note, actor=request.user)
        create_timeline_entry(concern=concern, event_type=ConcernTimelineEntry.EventType.ASSIGNMENT, status=Concern.Status.ASSIGNED, message=note, actor=request.user, metadata={"assignee_id": assignee.pk if assignee else None, "department_id": department.pk if department else None})
        if assignee:
            create_concern_notification(concern, recipient=assignee, type="assigned", title="Concern report assigned", body=note)
        notify_status_change(concern)
        create_audit_log(
            "concern.reassigned" if previous_assignment_ids else "concern.assigned",
            actor=request.user,
            target_user=concern.reporter,
            metadata={
                "concern_id": concern.pk,
                "assignment_id": assignment.pk,
                "previous_assignment_ids": previous_assignment_ids,
            },
            request_meta=request_meta(request),
        )
        from apps.live_map import concern_payload
        from apps.notifications.services import broadcast_live_map_event
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        transaction.on_commit(
            lambda: broadcast_live_map_event(
                "concern.updated",
                {"concern": concern_payload(decorated)},
            )
        )
        return Response(ConcernAssignmentSerializer(assignment, context={"request": request}).data, status=status.HTTP_201_CREATED)

class ConcernClarificationRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to request clarification."}, status=status.HTTP_403_FORBIDDEN)
        concern = operational_concern_or_404(request.user, pk)
        serializer = ClarificationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        clarification = ConcernClarification.objects.create(concern=concern, requested_by=request.user, request_text=serializer.validated_data["request_text"])
        concern.update_text = "Barangay requested clarification."
        concern.save(update_fields=["update_text", "updated_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=concern.status, note=clarification.request_text, actor=request.user)
        create_concern_notification(concern, recipient=concern.reporter, type="clarification_requested", title="Clarification requested", body=clarification.request_text)
        create_audit_log("concern.clarification_requested", actor=request.user, target_user=concern.reporter, metadata={"concern_id": concern.pk, "clarification_id": clarification.pk}, request_meta=request_meta(request))
        return Response(ConcernClarificationSerializer(clarification, context={"request": request}).data, status=status.HTTP_201_CREATED)

class ConcernClarificationReplyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, clarification_id):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk, reporter=request.user)
        clarification = get_object_or_404(ConcernClarification, pk=clarification_id, concern=concern)
        if clarification.status != ConcernClarification.Status.OPEN:
            return Response({"detail": "This clarification is already answered."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ClarificationReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        clarification.response_text = serializer.validated_data["response_text"]
        clarification.responded_by = request.user
        clarification.status = ConcernClarification.Status.ANSWERED
        clarification.responded_at = timezone.now()
        clarification.save(update_fields=["response_text", "responded_by", "status", "responded_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=concern.status, note="Resident replied to clarification request.", actor=request.user)
        if clarification.requested_by:
            create_concern_notification(concern, recipient=clarification.requested_by, type="clarification_replied", title="Resident replied to clarification", body=clarification.response_text[:240])
        create_audit_log("concern.clarification_replied", actor=request.user, target_user=concern.reporter, metadata={"concern_id": concern.pk, "clarification_id": clarification.pk}, request_meta=request_meta(request))
        return Response(ConcernClarificationSerializer(clarification, context={"request": request}).data)

class ConcernAppealCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk, reporter=request.user)
        if concern.status not in {Concern.Status.REJECTED, Concern.Status.RESOLVED}:
            return Response({"detail": "Only rejected or resolved reports can be appealed."}, status=status.HTTP_400_BAD_REQUEST)
        if concern.appeals.filter(status=ConcernAppeal.Status.SUBMITTED).exists():
            return Response({"detail": "This report already has a pending appeal."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ConcernAppealCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        appeal = ConcernAppeal.objects.create(concern=concern, appellant=request.user, reason=serializer.validated_data["reason"])
        concern.status = Concern.Status.APPEALED
        concern.update_text = "Appeal submitted for barangay review."
        concern.save(update_fields=["status", "update_text", "updated_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=Concern.Status.APPEALED, note=appeal.reason[:255], actor=request.user)
        User = get_user_model()
        department_id = concern.assigned_department_id or getattr(concern.category_ref, "department_id", None)
        officials = User.objects.filter(
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
            is_active=True,
            designations__is_active=True,
            designations__department__community_id=concern.community_id,
        )
        if department_id:
            officials = officials.filter(designations__department_id=department_id)
        for official in officials.distinct():
            if not user_has_capability(official, RESOLVE_CONCERNS):
                continue
            create_concern_notification(concern, recipient=official, type="appeal_submitted", title="Report appeal submitted", body=appeal.reason[:240])
        create_audit_log("concern.appeal_submitted", actor=request.user, target_user=request.user, metadata={"concern_id": concern.pk, "appeal_id": appeal.pk}, request_meta=request_meta(request))
        return Response(ConcernAppealSerializer(appeal, context={"request": request}).data, status=status.HTTP_201_CREATED)

class ConcernAppealListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to view appeals."}, status=status.HTTP_403_FORBIDDEN)
        appeals = ConcernAppeal.objects.filter(
            concern__in=operational_concerns(request.user)
        ).select_related("concern", "appellant", "appellant__resident_profile", "reviewed_by", "reviewed_by__resident_profile")
        appeal_status = request.query_params.get("status")
        if appeal_status and appeal_status != "all":
            appeals = appeals.filter(status=appeal_status)
        return Response(ConcernAppealSerializer(appeals, many=True, context={"request": request}).data)

class ConcernAppealReviewView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, appeal_id):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to review appeals."}, status=status.HTTP_403_FORBIDDEN)
        appeal = get_object_or_404(
            ConcernAppeal.objects.filter(
                concern__in=operational_concerns(request.user)
            ).select_for_update().select_related("concern", "appellant"),
            pk=appeal_id,
        )
        if appeal.status != ConcernAppeal.Status.SUBMITTED:
            return Response({"detail": "This appeal has already been decided."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ConcernAppealReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        appeal.status = serializer.validated_data["status"]
        appeal.decision_note = serializer.validated_data.get("decision_note", "")
        appeal.reviewed_by = request.user
        appeal.decided_at = timezone.now()
        appeal.save(update_fields=["status", "decision_note", "reviewed_by", "decided_at"])
        concern = appeal.concern
        next_status = Concern.Status.SUBMITTED if appeal.status == ConcernAppeal.Status.APPROVED else Concern.Status.REJECTED
        concern.status = next_status
        concern.update_text = appeal.decision_note or f"Appeal {appeal.status}."
        concern.save(update_fields=["status", "update_text", "updated_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=next_status, note=concern.update_text, actor=request.user)
        notif_type = "appeal_approved" if appeal.status == ConcernAppeal.Status.APPROVED else "appeal_denied"
        create_concern_notification(concern, recipient=appeal.appellant, type=notif_type, title=f"Appeal {appeal.status}", body=concern.update_text)
        create_audit_log("concern.appeal_reviewed", actor=request.user, target_user=appeal.appellant, metadata={"concern_id": concern.pk, "appeal_id": appeal.pk, "status": appeal.status}, request_meta=request_meta(request))
        return Response(ConcernAppealSerializer(appeal, context={"request": request}).data)

class ConcernOfficialRemarkCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to add remarks."}, status=status.HTTP_403_FORBIDDEN)
        concern = operational_concern_or_404(request.user, pk)
        serializer = ConcernOfficialRemarkCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        remark = ConcernOfficialRemark.objects.create(
            concern=concern,
            author=request.user,
            body=serializer.validated_data["body"],
            visible_to_resident=serializer.validated_data.get("visible_to_resident", True),
        )
        if remark.visible_to_resident:
            create_concern_notification(concern, recipient=concern.reporter, type="under_review", title="Official remark added", body=remark.body[:240])
        create_audit_log("concern.remark_added", actor=request.user, target_user=concern.reporter, metadata={"concern_id": concern.pk, "remark_id": remark.pk, "visible_to_resident": remark.visible_to_resident}, request_meta=request_meta(request))
        return Response(ConcernOfficialRemarkSerializer(remark, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ConcernChatView(APIView):
    """
    Private chat on one report: resident reporter ↔ barangay officials.
    GET list · POST send.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        concern = operational_concern_or_404(request.user, pk)
        after_id = request.query_params.get("after")
        qs = (
            ConcernChatMessage.objects.filter(concern=concern)
            .select_related("sender", "sender__resident_profile")
            .order_by("created_at", "id")
        )
        if after_id and str(after_id).isdigit():
            qs = qs.filter(pk__gt=int(after_id))
        messages = list(qs[:200])
        return Response(
            ConcernChatMessageSerializer(messages, many=True, context={"request": request}).data
        )

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = operational_concern_or_404(request.user, pk)
        serializer = ConcernChatCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        body = serializer.validated_data.get("body", "").strip()
        uploaded_file = serializer.validated_data.get("media")
        attachment_data = None
        if uploaded_file:
            try:
                attachment_data = validate_concern_chat_attachment(uploaded_file)
            except ValidationError as exc:
                detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", [str(exc)])
                return Response({"media": detail}, status=status.HTTP_400_BAD_REQUEST)
        if not body and not attachment_data:
            return Response({"body": ["Message text or an image/video attachment is required."]}, status=status.HTTP_400_BAD_REQUEST)
        message = ConcernChatMessage.objects.create(
            concern=concern,
            sender=request.user,
            body=body,
        )
        if attachment_data:
            validated_file, mime_type, kind, authenticity_status, authenticity_detail = attachment_data
            ConcernChatAttachment.objects.create(
                concern=concern,
                message=message,
                file=validated_file,
                original_filename=getattr(uploaded_file, "name", "attachment"),
                mime_type=mime_type,
                kind=kind,
                file_size=getattr(uploaded_file, "size", 0),
                authenticity_status=authenticity_status,
                authenticity_detail=authenticity_detail,
            )
        message = (
            ConcernChatMessage.objects.select_related("sender", "sender__resident_profile")
            .get(pk=message.pk)
        )
        preview = message.body[:240] or "New media attachment"
        # Notify the other party
        if request.user.pk == concern.reporter_id:
            User = get_user_model()
            department_ids = list(filter(None, [
                concern.assigned_department_id,
                getattr(concern.category_ref, "department_id", None),
            ]))
            recipient_ids = set(
                concern.assignments.filter(status=ConcernAssignment.Status.ACTIVE)
                .exclude(assignee_id=request.user.pk)
                .values_list("assignee_id", flat=True)
            )
            recipient_ids.update(
                User.objects.filter(
                    role=User.Role.BARANGAY_OFFICIAL,
                    status=User.Status.VERIFIED,
                    is_active=True,
                    designations__is_active=True,
                    designations__department_id__in=department_ids,
                )
                .exclude(pk=request.user.pk)
                .distinct()
                .values_list("pk", flat=True)[:20]
            )
            recipients = User.objects.filter(
                pk__in=recipient_ids,
                status=User.Status.VERIFIED,
                is_active=True,
            )
            for recipient in recipients:
                create_concern_notification(
                    concern,
                    recipient=recipient,
                    type="chat_message",
                    title=f"New message on {concern.tracking_id}",
                    body=preview,
                )
        elif concern.reporter_id:
            create_concern_notification(
                concern,
                recipient=concern.reporter,
                type="chat_message",
                title="New message on your report",
                body=preview,
            )
        create_audit_log(
            "concern.chat_message",
            actor=request.user,
            target_user=concern.reporter,
            metadata={"concern_id": concern.pk, "message_id": message.pk},
            request_meta=request_meta(request),
        )
        try:
            from django.db import transaction

            from apps.notifications.services import broadcast_concern_chat

            chat_payload = ConcernChatMessageSerializer(message, context={"request": request}).data
            transaction.on_commit(lambda: broadcast_concern_chat(concern.pk, chat_payload))
        except Exception:
            # WebSocket delivery is an enhancement; the 6s polling fallback in
            # the frontend keeps chat working without it.
            pass
        return Response(
            ConcernChatMessageSerializer(message, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ConcernChatAttachmentRawView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        attachment = get_object_or_404(
            ConcernChatAttachment.objects.filter(
                concern__in=operational_concerns(request.user)
            ).select_related("concern", "message"),
            pk=pk,
        )
        log_raw_media_access(
            actor=request.user,
            target_user=attachment.concern.reporter,
            media_type="concern_chat_attachment",
            object_id=attachment.pk,
            request_meta=request_meta(request),
        )
        return FileResponse(
            attachment.file.open("rb"),
            content_type=attachment.mime_type or "application/octet-stream",
        )


class ConcernCategoryOptionsView(APIView):
    """Active categories, for anyone filing or viewing a concern.

    The admin endpoint is capability-gated, so residents had no way to read the
    list and the report form hardcoded four values. Those hardcoded values could
    not be renamed, routed or added to, which made the Categories screen
    decorative.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.query_params.get("community_id"))
        categories = (
            ConcernCategory.objects.filter(is_active=True)
            .filter(community=community) if community else ConcernCategory.objects.none()
        ).select_related("department").order_by("name")
        return Response(
            [
                {
                    "id": category.pk,
                    "code": category.code,
                    "name": category.name,
                    "description": category.description,
                    "icon_key": category.icon_key,
                    "custom_icon_label": category.custom_icon_label,
                    "icon_image_url": request.build_absolute_uri(category.icon_image.url) if category.icon_image else "",
                    "photo_required": category.photo_required,
                    "description_required": category.description_required,
                    "location_required": category.location_required,
                    "public_feed_allowed": category.public_feed_allowed,
                    "department": (
                        {
                            "id": category.department_id,
                            "name": category.department.name,
                            "short_name": category.department.short_name,
                        }
                        if category.department
                        else None
                    ),
                }
                for category in categories
            ]
        )


def _designation_manages_roles(designation):
    return bool(
        designation.is_active
        and designation.department.is_active
        and designation.position.is_active
        and MANAGE_ROLES in (designation.position.permissions or [])
    )


def _has_role_manager(*, exclude_position_id=None, exclude_designation_id=None):
    User = get_user_model()
    if User.objects.filter(is_superuser=True, is_active=True).exists():
        return True
    designations = Designation.objects.filter(
        is_active=True,
        department__is_active=True,
        position__is_active=True,
        user__is_active=True,
        user__status=User.Status.VERIFIED,
        user__role=User.Role.BARANGAY_OFFICIAL,
    ).select_related("position")
    if exclude_position_id:
        designations = designations.exclude(position_id=exclude_position_id)
    if exclude_designation_id:
        designations = designations.exclude(pk=exclude_designation_id)
    return any(MANAGE_ROLES in (item.position.permissions or []) for item in designations)


class AdminModelListCreateView(APIView):
    """List and create configuration rows.

    Two gates: the coarse role check that has always been here, and the
    capability declared by the subclass. Capabilities distinguish a Secretary
    from the Barangay Captain, which `role` alone cannot — every staff member
    carries the same `barangay_official` role.
    """

    permission_classes = [IsAuthenticated]
    model = None
    serializer_class = None
    # Capability required to read/write this configuration. See apps.capabilities.
    # A tuple means any one suffices (positions live in both the Units and the
    # Roles screens, so either manager may edit them).
    required_capability = None
    required_capabilities = None
    read_capabilities = None

    def _queryset(self, user):
        from apps.community_scope import community_ids_for_user

        ids = community_ids_for_user(user)
        queryset = self.model.objects.all()
        if self.model in {Department, ConcernCategory}:
            return queryset.filter(community_id__in=ids).select_related("community")
        if self.model is Designation:
            return queryset.filter(department__community_id__in=ids).select_related("department__community", "position", "user")
        if self.model is RoutingRule:
            return queryset.filter(category__community_id__in=ids, department__community_id__in=ids)
        if self.model is Position:
            return queryset.filter(
                Q(department__isnull=True)
                | Q(department__community_id__in=ids)
                | Q(designations__department__community_id__in=ids)
            ).distinct()
        return queryset if user.is_superuser else queryset.none()

    def _caps(self, *, read=False):
        if read and self.read_capabilities:
            return self.read_capabilities
        return self.required_capabilities or (self.required_capability,)

    def _denied(self):
        return capability_denied(self._caps()[0])

    def _allowed(self, user, *, read=False):
        if not can_manage_concern_operations(user):
            return False
        caps = [c for c in self._caps(read=read) if c]
        if caps and not any(user_has_capability(user, c) for c in caps):
            return False
        return True

    def get(self, request):
        touch_last_seen(request.user)
        if not self._allowed(request.user, read=True):
            return self._denied()
        queryset = self._queryset(request.user)
        return Response(self.serializer_class(queryset, many=True, context={"request": request}).data)

    def post(self, request):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        from apps.community_scope import selected_community

        serializer_community = selected_community(request.user, request.data.get("community_id"))
        serializer = self.serializer_class(
            data=request.data,
            context={"request": request, "community": serializer_community},
        )
        serializer.is_valid(raise_exception=True)
        from apps.community_scope import community_ids_for_user, scope_user_queryset

        ids = community_ids_for_user(request.user)
        department = serializer.validated_data.get("department")
        category = serializer.validated_data.get("category")
        target_user = serializer.validated_data.get("user")
        if department and department.community_id not in ids:
            return Response({"department": ["Choose a unit in the selected community."]}, status=status.HTTP_400_BAD_REQUEST)
        if category and category.community_id not in ids:
            return Response({"category": ["Choose a category in the selected community."]}, status=status.HTTP_400_BAD_REQUEST)
        if target_user and not scope_user_queryset(type(target_user).objects.filter(pk=target_user.pk), request.user).exists():
            return Response({"user": ["Choose an account in the selected community."]}, status=status.HTTP_400_BAD_REQUEST)
        if self.model in {Department, ConcernCategory}:
            from apps.community_scope import selected_community
            community = selected_community(request.user, request.data.get("community_id"))
            if not community:
                return Response({"detail": "Select an active community."}, status=status.HTTP_400_BAD_REQUEST)
            obj = serializer.save(community=community)
        else:
            obj = serializer.save()
        return Response(self.serializer_class(obj, context={"request": request}).data, status=status.HTTP_201_CREATED)


class AdminModelDetailView(APIView):
    """Update or remove one configuration row.

    Deletion is guarded rather than silently destructive: a unit that still owns
    concerns is deactivated instead of deleted, because dropping it would
    detach that history with no way to get it back. The response says which
    happened so the UI can report it accurately instead of guessing.
    """

    permission_classes = [IsAuthenticated]
    model = None
    serializer_class = None
    # Reverse accessor checked before a hard delete is allowed.
    protected_relation = None
    required_capability = None
    required_capabilities = None

    def _queryset(self, user):
        return AdminModelListCreateView._queryset(self, user)

    def _caps(self):
        return self.required_capabilities or (self.required_capability,)

    def _denied(self):
        return capability_denied(self._caps()[0])

    def _allowed(self, user):
        if not can_manage_concern_operations(user):
            return False
        caps = [c for c in self._caps() if c]
        if caps and not any(user_has_capability(user, c) for c in caps):
            return False
        return True

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        queryset = self._queryset(request.user)
        obj = get_object_or_404(queryset, pk=pk)
        serializer = self.serializer_class(
            obj, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        from apps.community_scope import community_ids_for_user, scope_user_queryset

        ids = community_ids_for_user(request.user)
        department = serializer.validated_data.get("department")
        category = serializer.validated_data.get("category")
        target_user = serializer.validated_data.get("user")
        if department and department.community_id not in ids:
            return Response({"department": ["Choose a unit in the selected community."]}, status=status.HTTP_400_BAD_REQUEST)
        if category and category.community_id not in ids:
            return Response({"category": ["Choose a category in the selected community."]}, status=status.HTTP_400_BAD_REQUEST)
        if target_user and not scope_user_queryset(type(target_user).objects.filter(pk=target_user.pk), request.user).exists():
            return Response({"user": ["Choose an account in the selected community."]}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        queryset = self._queryset(request.user)
        obj = get_object_or_404(queryset, pk=pk)

        in_use = 0
        if self.protected_relation:
            in_use = getattr(obj, self.protected_relation).count()

        if in_use:
            obj.is_active = False
            obj.save(update_fields=["is_active", "updated_at"])
            return Response(
                {
                    "deleted": False,
                    "deactivated": True,
                    "in_use": in_use,
                    "detail": (
                        f"Still assigned to {in_use} concern(s), so it was deactivated "
                        "instead of deleted. It can no longer be assigned to new work."
                    ),
                }
            )

        obj.delete()
        return Response({"deleted": True, "deactivated": False, "in_use": 0})


class DepartmentListCreateView(AdminModelListCreateView):
    model = Department
    required_capability = MANAGE_UNITS
    read_capabilities = (MANAGE_UNITS, MANAGE_ROLES, MANAGE_USERS)
    serializer_class = DepartmentSerializer

    def _allowed(self, user, *, read=False):
        if read and can_update_concern_status(user):
            return True
        return super()._allowed(user, read=read)


class DepartmentDetailView(AdminModelDetailView):
    model = Department
    required_capability = MANAGE_UNITS
    serializer_class = DepartmentSerializer
    protected_relation = "concerns"


class DepartmentMembersView(APIView):
    """Return verified staff currently designated to one barangay unit."""

    permission_classes = [IsAuthenticated]

    def get(self, request, department_id):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return capability_denied(RESOLVE_CONCERNS)

        from apps.community_scope import community_ids_for_user

        department = get_object_or_404(
            Department,
            pk=department_id,
            is_active=True,
            community_id__in=community_ids_for_user(request.user),
        )
        User = get_user_model()
        members = (
            User.objects.filter(
                status=User.Status.VERIFIED,
                is_active=True,
                role__in=[User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER],
                designations__department=department,
                designations__is_active=True,
            )
            .select_related("resident_profile")
            .distinct()
            .order_by("resident_profile__last_name", "resident_profile__first_name", "email")
        )
        return Response(PublicUserSerializer(members, many=True).data)


class PositionListCreateView(AdminModelListCreateView):
    model = Position
    required_capabilities = (MANAGE_ROLES, MANAGE_UNITS)
    read_capabilities = (MANAGE_ROLES, MANAGE_UNITS, MANAGE_USERS)
    serializer_class = PositionSerializer

    def post(self, request):
        if "permissions" in request.data and not user_has_capability(request.user, MANAGE_ROLES):
            return capability_denied(MANAGE_ROLES)
        return super().post(request)


class PositionDetailView(AdminModelDetailView):
    model = Position
    required_capabilities = (MANAGE_ROLES, MANAGE_UNITS)
    serializer_class = PositionSerializer
    # A position still held by someone is deactivated, not deleted: dropping it
    # would strip those people of their capabilities with no record of why.
    protected_relation = "designations"

    def patch(self, request, pk):
        if ({"permissions", "is_active"} & set(request.data)) and not user_has_capability(
            request.user, MANAGE_ROLES
        ):
            return capability_denied(MANAGE_ROLES)
        position = get_object_or_404(Position, pk=pk)
        next_permissions = request.data.get("permissions", position.permissions)
        next_active = request.data.get("is_active", position.is_active)
        removes_role_manager = (
            position.is_active
            and MANAGE_ROLES in (position.permissions or [])
            and (not next_active or MANAGE_ROLES not in next_permissions)
        )
        if removes_role_manager and not _has_role_manager(exclude_position_id=position.pk):
            return Response(
                {"permissions": ["Assign Manage roles to another active user first."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().patch(request, pk)

    def delete(self, request, pk):
        if not user_has_capability(request.user, MANAGE_ROLES):
            return capability_denied(MANAGE_ROLES)
        position = get_object_or_404(Position, pk=pk)
        if (
            position.is_active
            and MANAGE_ROLES in (position.permissions or [])
            and not _has_role_manager(exclude_position_id=position.pk)
        ):
            return Response(
                {"detail": "Assign Manage roles to another active user first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().delete(request, pk)


class DesignationListCreateView(AdminModelListCreateView):
    model = Designation
    required_capability = MANAGE_USERS
    serializer_class = DesignationSerializer


class DesignationDetailView(AdminModelDetailView):
    model = Designation
    required_capability = MANAGE_USERS
    serializer_class = DesignationSerializer

    def patch(self, request, pk):
        designation = get_object_or_404(Designation, pk=pk)
        if (
            request.data.get("is_active") is False
            and _designation_manages_roles(designation)
            and not _has_role_manager(exclude_designation_id=designation.pk)
        ):
            return Response(
                {"detail": "Assign Manage roles to another active user first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().patch(request, pk)

    def delete(self, request, pk):
        designation = get_object_or_404(Designation, pk=pk)
        if _designation_manages_roles(designation) and not _has_role_manager(
            exclude_designation_id=designation.pk
        ):
            return Response(
                {"detail": "Assign Manage roles to another active user first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().delete(request, pk)


class ConcernCategoryListCreateView(AdminModelListCreateView):
    model = ConcernCategory
    required_capability = MANAGE_CATEGORIES
    serializer_class = ConcernCategorySerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]


class ConcernCategoryDetailView(AdminModelDetailView):
    model = ConcernCategory
    required_capability = MANAGE_CATEGORIES
    serializer_class = ConcernCategorySerializer
    protected_relation = "concerns"
    parser_classes = [MultiPartParser, FormParser, JSONParser]


class ConcernFormFieldListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, category_id):
        touch_last_seen(request.user)
        if not can_manage_concern_operations(request.user) or not user_has_capability(request.user, MANAGE_CATEGORIES):
            return Response({"detail": "You do not have permission to manage forms."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import community_ids_for_user

        category = get_object_or_404(
            ConcernCategory,
            pk=category_id,
            community_id__in=community_ids_for_user(request.user),
        )
        data = request.data.copy()
        data["category"] = category.pk
        serializer = ConcernFormFieldSerializer(data=data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        field = serializer.save(category=category)
        return Response(ConcernFormFieldSerializer(field, context={"request": request}).data, status=status.HTTP_201_CREATED)


class RoutingRuleListCreateView(AdminModelListCreateView):
    model = RoutingRule
    required_capability = MANAGE_CATEGORIES
    serializer_class = RoutingRuleSerializer


class RoutingRuleDetailView(AdminModelDetailView):
    model = RoutingRule
    required_capability = MANAGE_CATEGORIES
    serializer_class = RoutingRuleSerializer


class ConcernTimelineEntryView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = operational_concern_or_404(request.user, pk, lock=True)
        serializer = ConcernTimelineEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        next_status = serializer.validated_data.get("status")
        if next_status:
            return Response(
                {"status": ["Use the report status action to change status."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        can_manage = can_update_concern_status(request.user)
        can_progress = concern.assignments.filter(
            assignee=request.user,
            status=ConcernAssignment.Status.ACTIVE,
        ).exists()
        if not (can_manage or can_progress):
            return Response({"detail": "You do not have permission to update this timeline."}, status=status.HTTP_403_FORBIDDEN)
        entry = create_timeline_entry(concern=concern, actor=request.user, **serializer.validated_data)
        return Response(ConcernTimelineEntrySerializer(entry, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ConcernChatReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = operational_concern_or_404(request.user, pk)
        serializer = ChatReadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        messages = ConcernChatMessage.objects.filter(concern=concern, pk__lte=serializer.validated_data["last_read_message_id"]).exclude(sender=request.user)
        for message in messages:
            ChatMessageRead.objects.get_or_create(message=message, user=request.user)
        return Response({"read_count": messages.count()})


class ConcernChatTypingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = operational_concern_or_404(request.user, pk)
        serializer = ChatTypingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        indicator, _ = ChatTypingIndicator.objects.update_or_create(
            concern=concern,
            user=request.user,
            defaults={"is_typing": serializer.validated_data["is_typing"]},
        )
        return Response({"is_typing": indicator.is_typing, "updated_at": indicator.updated_at})


class DepartmentChatThreadListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        department = get_object_or_404(Department, pk=request.data.get("department"), is_active=True)
        if not user_is_department_member(request.user, department):
            return Response({"detail": "You do not have permission to create this department thread."}, status=status.HTTP_403_FORBIDDEN)
        serializer = DepartmentChatThreadSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        thread = serializer.save(created_by=request.user)
        return Response(DepartmentChatThreadSerializer(thread, context={"request": request}).data, status=status.HTTP_201_CREATED)


class DepartmentChatMessageListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, thread_id):
        touch_last_seen(request.user)
        thread = get_object_or_404(DepartmentChatThread.objects.select_related("department"), pk=thread_id)
        if not user_is_department_member(request.user, thread.department):
            return Response({"detail": "You do not have permission to post in this department thread."}, status=status.HTTP_403_FORBIDDEN)
        serializer = DepartmentChatMessageSerializer(data={"thread": thread.pk, "body": request.data.get("body", "")}, context={"request": request})
        serializer.is_valid(raise_exception=True)
        message = serializer.save(thread=thread, sender=request.user)
        thread.save(update_fields=["updated_at"])
        return Response(DepartmentChatMessageSerializer(message, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ConcernStatusUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = operational_concern_or_404(request.user, pk, lock=True)
        serializer = ConcernStatusUpdateSerializer(
            data=request.data,
            context={"request": request, "community": concern.community},
        )
        serializer.is_valid(raise_exception=True)
        next_status = serializer.validated_data["status"]
        if not (
            can_update_concern_status(request.user)
            or can_progress_assigned_concern(request.user, concern, next_status)
        ):
            return Response({"detail": "You do not have permission to update report status."}, status=status.HTTP_403_FORBIDDEN)

        if concern.validation_status != Concern.ValidationStatus.ACCEPTED:
            return Response(
                {"validation_status": ["This report must pass validation before its operational status can change."]},
                status=status.HTTP_409_CONFLICT,
            )
        expected_version = serializer.validated_data.get("status_version")
        if expected_version is not None and expected_version != concern.status_version:
            return Response(
                {"status_version": ["This report was updated elsewhere. Refresh and try again."]},
                status=status.HTTP_409_CONFLICT,
            )
        # Status updates are intentionally flexible. Officials may correct or
        # advance a report directly (for example, assigned -> resolved), and
        # posting an update may keep the current status. Permissions,
        # validation, evidence, and the optimistic status-version check still
        # protect the write below.
        note = serializer.validated_data.get("note", "").strip()
        evidence_files = request.FILES.getlist("resolution_evidence")
        if evidence_files and next_status != Concern.Status.RESOLVED:
            return Response(
                {"resolution_evidence": ["Resolution evidence can only be added when resolving a report."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(evidence_files) > 5:
            return Response(
                {"resolution_evidence": ["Upload no more than 5 resolution photos."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if next_status in {Concern.Status.RESOLVED, Concern.Status.REJECTED} and len(note) < 10:
            return Response(
                {"note": ["Explain the final decision in at least 10 characters."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if (
            next_status == Concern.Status.RESOLVED
            and not evidence_files
            and not concern.resolution_evidence.exists()
        ):
            return Response(
                {"resolution_evidence": ["Add at least one photo showing the completed resolution."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        validated_evidence = []
        for uploaded_file in evidence_files:
            try:
                validated_file = validate_concern_media_file(uploaded_file)
            except ValidationError as exc:
                messages = getattr(exc, "messages", None) or [str(exc)]
                return Response(
                    {"resolution_evidence": messages},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            validated_evidence.append((uploaded_file, validated_file))

        if not note:
            note = f"Report status updated to {next_status.replace('_', ' ')}."

        changed_fields = ["status", "update_text", "status_version", "updated_at"]

        # Category and unit ride along with the status change so one press of
        # "Save update" is one atomic write and one audit entry, rather than
        # three requests that can half-apply.
        new_category = serializer.validated_data.get("category") or ""
        category_changed = bool(new_category) and new_category != concern.category
        if category_changed:
            concern.category = new_category
            concern.category_ref = ConcernCategory.objects.filter(
                code=new_category,
                community=concern.community,
                is_active=True,
            ).first()
            if concern.category_ref is None and new_category not in Concern.Category.values:
                return Response({"category": ["Choose a category available in the incident community."]}, status=status.HTTP_400_BAD_REQUEST)
            changed_fields.extend(["category", "category_ref"])

        new_department_id = serializer.validated_data.get("department_id")
        department_changed = bool(new_department_id) and new_department_id != concern.assigned_department_id
        department = None
        if department_changed:
            department = get_object_or_404(Department, pk=new_department_id, is_active=True)
            if department.community_id != concern.community_id:
                return Response({"department_id": ["Choose a unit in the incident community."]}, status=status.HTTP_400_BAD_REQUEST)
            concern.assigned_department = department
            changed_fields.append("assigned_department")

        assignee_ids = serializer.validated_data.get("assignee_ids")
        assignment_members = []
        assignment_changed = False
        if next_status == Concern.Status.ASSIGNED and assignee_ids is not None:
            assignment_department = department or concern.assigned_department
            if assignment_department is None:
                return Response(
                    {"department_id": ["Choose the unit that will handle this report."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            User = get_user_model()
            assignment_members = list(
                User.objects.filter(
                    pk__in=set(assignee_ids),
                    role__in=[User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER],
                    status=User.Status.VERIFIED,
                    is_active=True,
                    designations__department=assignment_department,
                    designations__is_active=True,
                )
                .select_related("resident_profile")
                .distinct()
            )
            if len(assignment_members) != len(set(assignee_ids)):
                return Response(
                    {"assignee_ids": ["Choose members of the selected unit."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            active_assignments = list(
                concern.assignments.filter(status=ConcernAssignment.Status.ACTIVE)
            )
            current_assignee_ids = {item.assignee_id for item in active_assignments if item.assignee_id}
            assignment_changed = (
                department_changed
                or current_assignee_ids != set(assignee_ids)
                or any(item.department_id != assignment_department.pk for item in active_assignments)
            )
            if assignment_changed:
                concern.assignments.filter(status=ConcernAssignment.Status.ACTIVE).update(
                    status=ConcernAssignment.Status.CANCELLED
                )
                assignment_note = note or f"Assigned to {assignment_department.name}."
                for member in assignment_members:
                    ConcernAssignment.objects.create(
                        concern=concern,
                        assignee=member,
                        assigned_by=request.user,
                        department=assignment_department,
                        note=assignment_note,
                    )
                    create_concern_notification(
                        concern,
                        recipient=member,
                        type="assigned",
                        title="Concern report assigned",
                        body=assignment_note,
                    )

        concern.status = next_status
        concern.update_text = note
        concern.status_version += 1
        concern.save(update_fields=changed_fields)
        ConcernStatusEvent.objects.create(
            concern=concern,
            status=next_status,
            note=note,
            actor=request.user,
        )
        if category_changed:
            create_timeline_entry(
                concern=concern,
                event_type=ConcernTimelineEntry.EventType.CUSTOM,
                status=next_status,
                message=f"Category changed to {new_category.replace('_', ' ')}.",
                actor=request.user,
                metadata={"category": new_category},
            )
        if (department_changed or assignment_changed) and (department or concern.assigned_department) is not None:
            assignment_department = department or concern.assigned_department
            assignment_verb = "Reassigned to" if assignment_changed and active_assignments else "Assigned to"
            create_timeline_entry(
                concern=concern,
                event_type=ConcernTimelineEntry.EventType.ASSIGNMENT,
                status=next_status,
                message=f"{assignment_verb} {assignment_department.name}.",
                actor=request.user,
                metadata={
                    "department_id": assignment_department.pk,
                    "assignee_ids": [member.pk for member in assignment_members],
                },
            )
        internal_note = (serializer.validated_data.get("internal_note") or "").strip()
        if internal_note:
            # An internal note is not a status note: the resident never sees it.
            ConcernOfficialRemark.objects.create(
                concern=concern,
                author=request.user,
                body=internal_note,
                visible_to_resident=False,
            )
        evidence_records = []
        for uploaded_file, validated_file in validated_evidence:
            evidence = ConcernResolutionEvidence.objects.create(
                concern=concern,
                file=validated_file,
                uploaded_by=request.user,
                original_filename=uploaded_file.name,
                mime_type=getattr(validated_file, "content_type", "") or "",
                file_size=validated_file.size,
                note=note,
            )
            # Render the sanitized public preview now: the community-feed
            # preview route must never fall back to streaming the raw file.
            _ensure_evidence_preview(evidence)
            evidence_records.append(evidence)
        closed_assignments = list(
            concern.assignments.filter(status=ConcernAssignment.Status.ACTIVE).select_related("assignee")
        )
        if next_status == Concern.Status.RESOLVED:
            concern.assignments.filter(pk__in=[item.pk for item in closed_assignments]).update(
                status=ConcernAssignment.Status.COMPLETED
            )
        elif next_status == Concern.Status.REJECTED:
            concern.assignments.filter(pk__in=[item.pk for item in closed_assignments]).update(
                status=ConcernAssignment.Status.CANCELLED
            )
        if next_status in {Concern.Status.RESOLVED, Concern.Status.REJECTED}:
            for closed_assignment in closed_assignments:
                if closed_assignment.assignee:
                    create_concern_notification(
                        concern,
                        recipient=closed_assignment.assignee,
                        type=next_status,
                        title=f"Assigned concern {next_status.replace('_', ' ')}",
                        body=note,
                    )
        create_audit_log(
            "concern.status_updated",
            actor=request.user,
            target_user=concern.reporter,
            metadata={
                "concern_id": concern.pk,
                "status": next_status,
                "resolution_evidence_ids": [record.pk for record in evidence_records],
                "closed_assignment_ids": [item.pk for item in closed_assignments],
                "category_changed_to": new_category if category_changed else "",
                "department_changed_to": department.pk if department_changed and department else None,
                "internal_note_recorded": bool(internal_note),
                # Distinguishes an accepted recommendation from an independent
                # decision that happened to match one.
                "applied_ai_suggestion": bool(serializer.validated_data.get("applied_ai_suggestion")),
            },
            request_meta=request_meta(request),
        )
        notify_status_change(concern)
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        from apps.live_map import concern_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("concern.updated", {"concern": concern_payload(decorated)}))
        return Response(ConcernSerializer(decorated, context={"request": request}).data)


class ConcernResolutionEvidenceRawView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        evidence = get_object_or_404(
            ConcernResolutionEvidence.objects.select_related("concern__reporter"),
            pk=pk,
        )
        if not user_can_access_concern_media_raw(request.user, evidence):
            return Response(
                {"detail": "You do not have permission to access this resolution evidence."},
                status=status.HTTP_403_FORBIDDEN,
            )
        log_raw_media_access(
            actor=request.user,
            target_user=evidence.concern.reporter,
            media_type="concern_resolution_evidence",
            object_id=evidence.pk,
            request_meta=request_meta(request),
        )
        return FileResponse(
            evidence.file.open("rb"),
            content_type=evidence.mime_type or "application/octet-stream",
        )


def _ensure_evidence_preview(evidence):
    """Render the sanitized public preview for resolution evidence.

    Only ever reads `file` to produce a redacted JPEG; the raw original is
    never streamed from an AllowAny route. Called at evidence creation, so
    this path only fires for legacy rows.
    """
    if evidence.preview_file:
        return evidence.preview_file
    try:
        with evidence.file.open("rb") as source:
            content = build_redacted_preview_bytes(source, evidence.mime_type)
    except Exception:
        logger.warning("Evidence preview rendering failed for pk=%s", evidence.pk)
        return None
    evidence.preview_file.save(f"preview-{evidence.pk}.jpg", ContentFile(content), save=True)
    return evidence.preview_file


class ConcernResolutionEvidencePreviewView(APIView):
    """Serve approved resolution evidence to the community feed."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        evidence = get_object_or_404(
            ConcernResolutionEvidence.objects.select_related("concern"),
            pk=pk,
        )
        concern = evidence.concern
        if not (
            concern.visibility == Concern.Visibility.COMMUNITY
            and concern.validation_status == Concern.ValidationStatus.ACCEPTED
            and concern.status in {Concern.Status.RESOLVED, Concern.Status.REJECTED}
        ):
            return Response(
                {"detail": "This resolution evidence is not publicly available."},
                status=status.HTTP_403_FORBIDDEN,
            )
        # Public routes stream the sanitized preview only — never the raw file.
        preview = _ensure_evidence_preview(evidence)
        if not preview:
            return FileResponse(BytesIO(placeholder_preview_jpeg()), content_type="image/jpeg")
        response = FileResponse(preview.open("rb"), content_type="image/jpeg")
        response["Cache-Control"] = "public, max-age=86400, immutable"
        return response


class ConcernSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        mine = Concern.objects.filter(reporter=request.user)
        active = decorate_concerns(mine.filter(status__in=ACTIVE_STATUSES)[:3], request.user)
        counts = mine.aggregate(
            reports_submitted=Count("id"),
            reports_resolved=Count("id", filter=Q(status=Concern.Status.RESOLVED)),
            reports_active=Count("id", filter=Q(status__in=ACTIVE_STATUSES)),
        )
        return Response({
            **counts,
            "active_reports": ConcernSerializer(active, many=True, context={"request": request}).data,
        })


class AnnouncementListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Announcement feed",
        description=(
            "Published announcements visible to the caller's audience, pinned "
            "first. Includes photo preview URLs when the post has images."
        ),
        request=None,
        responses={200: list_envelope_response(AnnouncementSerializer, name="AnnouncementListEnvelope")},
        parameters=PAGE_PARAMETERS,
        tags=["announcements"],
    )
    def get(self, request):
        touch_last_seen(request.user)
        dispatch_due_announcements()
        now = timezone.now()
        from apps.community_scope import community_ids_for_user
        announcements = Announcement.objects.filter(
            community_id__in=community_ids_for_user(request.user),
            is_published=True,
            audience__in=[Announcement.Audience.ALL, Announcement.Audience.RESIDENTS],
        ).filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now)).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        announcements = announcements.order_by("-is_pinned", "-published_at", "-created_at", "-id")
        return paginate_response(
            request,
            announcements,
            lambda page: AnnouncementSerializer(page, many=True).data,
        )

def _announcement_audit_snapshot(announcement):
    """Immutable, human-readable context for announcement audit details."""
    return {
        "announcement_id": announcement.pk,
        "announcement_title": announcement.title,
        "publication_status": AnnouncementSerializer().get_status_label(announcement),
        "is_published": announcement.is_published,
        "is_pinned": announcement.is_pinned,
        "audience": announcement.audience,
        "urgency": announcement.urgency,
        "tag": announcement.tag,
        "community": announcement.community.name if announcement.community else announcement.barangay,
        "place": announcement.place_label,
        "affected_streets": announcement.affected_streets,
        "starts_at": announcement.starts_at.isoformat() if announcement.starts_at else None,
        "expires_at": announcement.expires_at.isoformat() if announcement.expires_at else None,
        "published_at": announcement.published_at.isoformat() if announcement.published_at else None,
        "has_image": bool(announcement.image),
        "image_alt": announcement.image_alt,
    }


class AnnouncementManageListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to manage announcements."}, status=status.HTTP_403_FORBIDDEN)
        dispatch_due_announcements()
        from apps.community_scope import community_ids_for_user, department_ids_for_user
        announcements = Announcement.objects.filter(community_id__in=community_ids_for_user(request.user)).filter(
            Q(target_departments__isnull=True) | Q(target_departments__id__in=department_ids_for_user(request.user))
        ).distinct().order_by("-created_at", "-id")
        published = request.query_params.get("published")
        if published in {"true", "false"}:
            announcements = announcements.filter(is_published=published == "true")
        return paginate_response(
            request,
            announcements,
            lambda page: AnnouncementSerializer(page, many=True).data,
        )

    def post(self, request):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to create announcements."}, status=status.HTTP_403_FORBIDDEN)
        serializer = AnnouncementSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from apps.community_scope import selected_community
        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        announcement = serializer.save(community=community, barangay=community.name)
        refresh_announcement_summary(announcement, force=True)
        if announcement.is_published:
            mark_announcement_published(announcement)
            dispatch_due_announcements()
            announcement.refresh_from_db()
        create_audit_log("announcement.created", actor=request.user, metadata=_announcement_audit_snapshot(announcement), request_meta=request_meta(request))
        return Response(AnnouncementSerializer(announcement, context={"request": request}).data, status=status.HTTP_201_CREATED)

class AnnouncementManageDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to update announcements."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import community_ids_for_user
        announcement = get_object_or_404(Announcement, pk=pk, community_id__in=community_ids_for_user(request.user))
        before = _announcement_audit_snapshot(announcement)
        before_title = announcement.title
        before_body = announcement.body
        old_image_name = announcement.image.name if announcement.image else ""
        serializer = AnnouncementSerializer(announcement, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        announcement = serializer.save()
        refresh_announcement_summary(
            announcement,
            force=(announcement.title != before_title or announcement.body != before_body),
        )
        if old_image_name and announcement.image.name != old_image_name:
            # A replaced upload must not leave the previous blob orphaned.
            try:
                announcement.image.storage.delete(old_image_name)
            except Exception:
                logger.warning("Could not delete replaced announcement image %s", old_image_name)
        if announcement.is_published:
            mark_announcement_published(announcement)
            dispatch_due_announcements()
            announcement.refresh_from_db()
        after = _announcement_audit_snapshot(announcement)
        changes = {
            key: {"before": before.get(key), "after": value}
            for key, value in after.items()
            if key != "announcement_id" and before.get(key) != value
        }
        create_audit_log("announcement.updated", actor=request.user, metadata={**after, "changes": changes}, request_meta=request_meta(request))
        return Response(AnnouncementSerializer(announcement, context={"request": request}).data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to delete announcements."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import community_ids_for_user
        announcement = get_object_or_404(Announcement, pk=pk, community_id__in=community_ids_for_user(request.user))
        create_audit_log("announcement.deleted", actor=request.user, metadata=_announcement_audit_snapshot(announcement), request_meta=request_meta(request))
        announcement.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BarangayEventTodayView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        from apps.community_scope import community_ids_for_user
        today = timezone.localdate()
        events = BarangayEvent.objects.filter(
            community_id__in=community_ids_for_user(request.user),
            is_published=True,
            starts_at__date=today,
        )
        return Response(BarangayEventSerializer(events, many=True).data)

class BarangayEventManageListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to manage events."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import community_ids_for_user
        events = BarangayEvent.objects.filter(community_id__in=community_ids_for_user(request.user)).order_by("-starts_at", "-id")
        published = request.query_params.get("published")
        if published in {"true", "false"}:
            events = events.filter(is_published=published == "true")
        return paginate_response(
            request,
            events,
            lambda page: BarangayEventSerializer(page, many=True).data,
        )

    def post(self, request):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to create events."}, status=status.HTTP_403_FORBIDDEN)
        serializer = BarangayEventSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from apps.community_scope import selected_community
        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        event = serializer.save(community=community, barangay=community.name)
        create_audit_log("event.created", actor=request.user, metadata={"event_id": event.pk, "is_published": event.is_published}, request_meta=request_meta(request))
        return Response(BarangayEventSerializer(event).data, status=status.HTTP_201_CREATED)

class BarangayEventManageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to update events."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import community_ids_for_user
        event = get_object_or_404(
            BarangayEvent,
            pk=pk,
            community_id__in=community_ids_for_user(request.user),
        )
        serializer = BarangayEventSerializer(event, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        event = serializer.save()
        create_audit_log("event.updated", actor=request.user, metadata={"event_id": event.pk}, request_meta=request_meta(request))
        return Response(BarangayEventSerializer(event).data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to delete events."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import community_ids_for_user
        event = get_object_or_404(
            BarangayEvent,
            pk=pk,
            community_id__in=community_ids_for_user(request.user),
        )
        create_audit_log("event.deleted", actor=request.user, metadata={"event_id": event.pk}, request_meta=request_meta(request))
        event.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ActiveResponderListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        User = get_user_model()
        from apps.community_scope import scope_user_queryset

        responders = scope_user_queryset(User.objects.all(), request.user).filter(
            role__in=[User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL],
            status=User.Status.VERIFIED,
            last_seen_at__gte=timezone.now() - timedelta(minutes=5),
        ).select_related("resident_profile")
        responders = responders.order_by("-last_seen_at", "-id")
        include_location = can_update_concern_status(request.user)
        return paginate_response(
            request,
            responders,
            lambda page: ActiveResponderSerializer(
                page,
                many=True,
                context={"include_location": include_location},
            ).data,
        )


class ConcernMediaRawView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        media = get_object_or_404(
            ConcernMedia.objects.filter(concern__in=operational_concerns(request.user)).select_related("concern__reporter"),
            pk=pk,
        )
        if not user_can_access_concern_media_raw(request.user, media):
            return Response({"detail": "You do not have permission to access this media."}, status=status.HTTP_403_FORBIDDEN)
        log_raw_media_access(
            actor=request.user,
            target_user=media.concern.reporter,
            media_type="concern_media",
            object_id=media.pk,
            request_meta=request_meta(request),
        )
        return FileResponse(media.file.open("rb"), content_type=media.mime_type or "application/octet-stream")


class ConcernMediaPreviewView(APIView):
    # Intentionally AllowAny: previews must render unauthenticated on the
    # public community feed. The `is_publicly_displayable` guard below is
    # what actually enforces the public/private boundary — a preview is
    # only ever served without auth when the concern is COMMUNITY-visible
    # AND already ACCEPTED. Anything else falls through to
    # user_can_access_concern_media_raw, the same authenticated check used
    # for raw media access.
    permission_classes = [AllowAny]

    def get(self, request, pk):
        media = get_object_or_404(ConcernMedia.objects.select_related("concern__reporter"), pk=pk)
        # Three conditions, all required: the concern is public, it passed
        # validation, and a privacy run cleared this specific image. The third
        # is new — before it, a photo whose protection had failed was still
        # served on the community feed because the concern itself was public.
        is_publicly_displayable = (
            media.concern.visibility == media.concern.Visibility.COMMUNITY
            and media.concern.validation_status == media.concern.ValidationStatus.ACCEPTED
            and concern_media_is_publicly_displayable(media)
        )
        if not is_publicly_displayable and not user_can_access_concern_media_raw(request.user, media):
            return Response({"detail": "You do not have permission to access this media."}, status=status.HTTP_403_FORBIDDEN)
        if media.preview_file:
            if request.query_params.get("link") in {"1", "true", "yes"}:
                from apps.accounts.storage import preview_link_response

                link = preview_link_response(media.preview_file)
                if link is not None:
                    return link
            response = FileResponse(media.preview_file.open("rb"), content_type="image/jpeg")
            response["X-EBOSES-Preview-Status"] = "ready"
            # Ready previews are immutable bytes: browser/CDN may cache for a
            # day. Pending placeholders below must stay no-store so the client
            # keeps polling instead of caching the placeholder.
            response["Cache-Control"] = "public, max-age=86400, immutable"
            return response

        # A completed no-scan decision is safe to render immediately. The old
        # code returned a placeholder here and queued a task, but completed
        # NOT_REQUIRED/NO_MATCH_FOUND rows cannot be claimed by that task, so
        # the placeholder lasted forever.
        if (
            media.privacy_state in {
                ConcernMedia.PrivacyState.NOT_REQUIRED,
                ConcernMedia.PrivacyState.NO_MATCH_FOUND,
            }
            and media.public_visible
        ):
            try:
                preview = ensure_concern_media_preview(media)
            except Exception:
                logger.warning("Could not render missing preview for media=%s", media.pk, exc_info=True)
            else:
                if request.query_params.get("link") in {"1", "true", "yes"}:
                    from apps.accounts.storage import preview_link_response

                    link = preview_link_response(preview)
                    if link is not None:
                        return link
                response = FileResponse(preview.open("rb"), content_type="image/jpeg")
                response["X-EBOSES-Preview-Status"] = "ready"
                response["Cache-Control"] = "public, max-age=86400, immutable"
                return response

        # No preview yet: hand the work to the privacy pipeline instead of
        # decoding/re-encoding on the request thread. The frontend treats this
        # response as pending and polls without caching the placeholder.
        if media.privacy_state == ConcernMedia.PrivacyState.QUEUED:
            transaction.on_commit(lambda media_id=media.pk: enqueue_concern_media_privacy(media_id))
        elif media.privacy_state == ConcernMedia.PrivacyState.PROTECTED:
            transaction.on_commit(lambda media_id=media.pk: enqueue_concern_media_privacy(media_id, force=True))
        response = FileResponse(BytesIO(placeholder_preview_jpeg()), content_type="image/jpeg")
        response["X-EBOSES-Preview-Status"] = "pending"
        response["Cache-Control"] = "no-store"
        return response


class ConcernMediaRedactionView(APIView):
    """Let an official blur something the automatic scan did not catch.

    The automatic pipeline is deliberately narrow — Gemma only asks for a scan
    when it suspects a face, a plate, or blood, and SAM3 only looks for what it
    was asked to look for. A reflection in a window, a house number, a name on a
    delivery box: none of that is in scope, and an official looking at the photo
    will see it.

    Adding a box never calls SAM3. The automatic regions are already stored, so
    the protected copy is rebuilt from both sets locally — which also means an
    official can still protect an image while Roboflow is down.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to edit media redactions."}, status=status.HTTP_403_FORBIDDEN)
        media = get_object_or_404(
            ConcernMedia.objects.filter(concern__in=operational_concerns(request.user)).select_related("concern__reporter"),
            pk=pk,
        )
        serializer = ConcernMediaRedactionSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        if not serializer.validated_data:
            return Response({"regions": ["Add at least one area to blur."]}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            ConcernMediaRedaction.objects.bulk_create(
                [
                    ConcernMediaRedaction(
                        media=media,
                        x=item["x"],
                        y=item["y"],
                        width=item["width"],
                        height=item["height"],
                        label=item.get("label", ""),
                        source=ConcernMediaRedaction.Source.OFFICIAL,
                        created_by=request.user,
                    )
                    for item in serializer.validated_data
                ]
            )
            media.refresh_from_db()
            from .ai.privacy import rerender_protected_copy

            media = rerender_protected_copy(media)
            create_audit_log(
                "concern.media_redacted",
                actor=request.user,
                target_user=media.concern.reporter,
                metadata={
                    "concern_id": media.concern_id,
                    "media_id": media.pk,
                    "regions_added": len(serializer.validated_data),
                    "privacy_state": media.privacy_state,
                },
                request_meta=request_meta(request),
            )
            create_timeline_entry(
                concern=media.concern,
                event_type=ConcernTimelineEntry.EventType.CUSTOM,
                status=media.concern.status,
                message="An official blurred part of an uploaded photo before public display.",
                actor=request.user,
                metadata={"media_id": media.pk},
            )
        return Response(ConcernMediaSerializer(media, context={"request": request}).data)

    def delete(self, request, pk, redaction_id):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to edit media redactions."}, status=status.HTTP_403_FORBIDDEN)
        media = get_object_or_404(
            ConcernMedia.objects.filter(concern__in=operational_concerns(request.user)).select_related("concern__reporter"),
            pk=pk,
        )
        # Only official regions can be removed. A SAM3 region is the record of
        # what the privacy scan found; deleting it through this endpoint would
        # un-blur a face with no trace of the decision.
        redaction = get_object_or_404(
            ConcernMediaRedaction,
            pk=redaction_id,
            media=media,
            source=ConcernMediaRedaction.Source.OFFICIAL,
        )
        with transaction.atomic():
            redaction.delete()
            media.refresh_from_db()
            from .ai.privacy import rerender_protected_copy

            media = rerender_protected_copy(media)
            create_audit_log(
                "concern.media_redaction_removed",
                actor=request.user,
                target_user=media.concern.reporter,
                metadata={"concern_id": media.concern_id, "media_id": media.pk, "redaction_id": redaction_id},
                request_meta=request_meta(request),
            )
        return Response(ConcernMediaSerializer(media, context={"request": request}).data)


class ConcernMediaPrivacyReprocessView(APIView):
    """Re-run the automatic privacy scan for one image, at an official's request.

    The normal cache refuses to call Roboflow twice for the same image and class
    list. This is the documented way round that: an official who thinks the scan
    missed something can force it, and the forced run is recorded.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to reprocess media."}, status=status.HTTP_403_FORBIDDEN)
        media = get_object_or_404(
            ConcernMedia.objects.filter(concern__in=operational_concerns(request.user)).select_related(
                "concern__reporter"
            ),
            pk=pk,
        )
        if not media.privacy_requested_classes:
            return Response(
                {"detail": "The automatic review did not ask for a privacy scan on this photo."},
                status=status.HTTP_409_CONFLICT,
            )
        create_audit_log(
            "concern.media_privacy_reprocessed",
            actor=request.user,
            target_user=media.concern.reporter,
            metadata={"concern_id": media.concern_id, "media_id": media.pk},
            request_meta=request_meta(request),
        )
        from .tasks import enqueue_concern_media_privacy

        enqueue_concern_media_privacy(media.pk, force=True)
        media.refresh_from_db()
        return Response(ConcernMediaSerializer(media, context={"request": request}).data)
