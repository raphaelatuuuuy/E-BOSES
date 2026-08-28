from datetime import timedelta
from io import BytesIO

import logging
import re

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
from .severity import priority_score as compute_priority_score, severity_label, severity_level

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
    user_can_access_concern_media_raw,
)
from .tasks import enqueue_concern_ai, enqueue_concern_media_privacy, enqueue_content_moderation_ai
from .moderation import execute_takedown, restore_automated_takedown

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.ASSIGNED,
    Concern.Status.IN_PROGRESS,
    Concern.Status.APPEALED,
}

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
    if user.is_staff or user.is_superuser or user.role == user.Role.BARANGAY_OFFICIAL:
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
    ).exclude(pk=comment.author_id)
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
    queryset = Concern.objects.all()
    if lock:
        queryset = queryset.select_for_update()
    return get_object_or_404(operational_concerns(user, queryset), pk=pk)


def can_manage_concern_operations(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_staff
            or user.is_superuser
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
    return (
        user.is_superuser
        or user.is_staff
        or user.role == user.Role.BARANGAY_OFFICIAL
        or user.pk == concern.reporter_id
        or concern.assignments.filter(
            assignee=user,
            status=ConcernAssignment.Status.ACTIVE,
        ).exists()
        or user_has_role_permission(user, "concerns.manage")
    )


def decorate_concerns(queryset, user):
    concerns = list(
        queryset
        .select_related(
            "reporter",
            "reporter__resident_profile",
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
            "resolution_evidence",
            "resolution_evidence__uploaded_by",
            "resolution_evidence__uploaded_by__resident_profile",
            "assignments",
            "assignments__assignee",
            "assignments__assignee__resident_profile",
            "assignments__assigned_by",
            "assignments__assigned_by__resident_profile",
            "timeline_entries",
            "timeline_entries__actor",
            "timeline_entries__actor__resident_profile",
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
            "comments__replies__author",
            "comments__replies__author__resident_profile",
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
        # Severity-banded, not popularity. See concerns/severity.py for why
        # `votes * 3 + comments * 2` was wrong for this system.
        concern.priority_score = compute_priority_score(concern)
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


class ConcernMediaCheckView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        media_files = request.FILES.getlist("media")
        if not media_files:
            return Response({"media": ["Choose a photo to check."]}, status=status.HTTP_400_BAD_REQUEST)

        current_phashes = []
        current_hashes = set()
        checked = []
        for uploaded_file in media_files:
            try:
                validated_file = validate_concern_media_file(uploaded_file)
            except ValidationError as exc:
                # Return clean user-facing messages only (no filename / list repr)
                messages = []
                if hasattr(exc, "messages") and exc.messages:
                    messages = [str(m) for m in exc.messages]
                elif getattr(exc, "message_dict", None):
                    for value in exc.message_dict.values():
                        if isinstance(value, (list, tuple)):
                            messages.extend(str(v) for v in value)
                        else:
                            messages.append(str(value))
                else:
                    messages = [str(exc)]
                cleaned = []
                for msg in messages:
                    text = str(msg).strip()
                    # Strip accidental list-repr wrappers: "['...']"
                    if text.startswith("[") and text.endswith("]"):
                        text = text[1:-1].strip().strip("'\"")
                    if text:
                        cleaned.append(text)
                return Response(
                    {"media": cleaned or ["This photo could not be validated."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            media_hash = sha256_file(validated_file)
            raw_content = validated_file.read()
            validated_file.seek(0)
            media_phash = phash_file(raw_content)
            media_phash_blocks = phash_blocks_file(raw_content)
            if media_hash in current_hashes or ConcernMedia.objects.filter(sha256_hash=media_hash).exists():
                return Response(
                    {"media": ["This photo was already uploaded before."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Banded candidates replace the whole-table scan; the exact
            # comparison still runs over everything the index could match.
            candidate_ids = phash_candidate_ids(
                SCOPE_CONCERN_MEDIA, phashes=[media_phash], blocks=media_phash_blocks
            )
            existing_phashes = list(
                ConcernMedia.objects.filter(pk__in=candidate_ids).exclude(phash="").values_list("phash", "phash_blocks")
            ) if candidate_ids else []
            if media_looks_duplicate(media_phash, media_phash_blocks, [*existing_phashes, *current_phashes]):
                return Response(
                    {"media": ["This image appears to have been uploaded before."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            current_hashes.add(media_hash)
            current_phashes.append((media_phash, media_phash_blocks))
            checked.append({"name": uploaded_file.name, "status": "accepted"})
        return Response({"files": checked})


class ConcernListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(
        summary="File a report",
        description=(
            "Submit a new concern. Multipart form-data: `title`, `description`, "
            "`category`, location fields, optional `media` photos (up to 5). Every "
            "photo passes signature + pixel validation; duplicates by hash or "
            "perceptual similarity are rejected with 400. AI triage runs in the "
            "background after creation."
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
                decorated = decorate_concerns(Concern.objects.filter(pk=existing.pk), request.user)[0]
                return Response(ConcernSerializer(decorated, context={"request": request}).data)
        category_ref = None
        assigned_department = None
        community = getattr(getattr(request.user, "resident_profile", None), "community", None)
        if not community:
            return Response({"detail": "Your account is not assigned to an active community."}, status=status.HTTP_409_CONFLICT)
        located_community_id = (serializer.validated_data.get("_location_review") or {}).get("community_id")
        if located_community_id and located_community_id != community.pk:
            return Response(
                {"location": ["The pinned location must be inside your assigned community."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        category_id = serializer.validated_data.get("category_id")
        if category_id:
            category_ref = get_object_or_404(ConcernCategory, pk=category_id, community=community, is_active=True)
            rule = category_ref.routing_rules.filter(is_active=True).select_related("department").first()
            assigned_department = rule.department if rule else category_ref.department
            selected_category = Concern.Category.OTHERS
        else:
            configuration = ConcernClassificationConfiguration.current()
            enabled_categories = configuration.enabled_categories or list(Concern.Category.values)
            selected_category = serializer.validated_data["category"]
            category_ref = ConcernCategory.objects.filter(code=selected_category, community=community, is_active=True).select_related("department").first()
            if not category_ref and selected_category not in enabled_categories:
                return Response(
                    {"category": ["This concern category is temporarily unavailable. Choose another category."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Resolve the legacy string to a real category row so every concern
            # carries a FK, not just those filed through the newer path. Without
            # this, routing and the category breakdown silently skip them.
            if category_ref:
                rule = (
                    category_ref.routing_rules.filter(is_active=True)
                    .select_related("department")
                    .first()
                )
                assigned_department = rule.department if rule else category_ref.department
        description = serializer.validated_data.get("description", "").strip()
        if category_ref and category_ref.description_required and len(description) < 20:
            return Response({"description": ["Describe the issue in at least 20 characters."]}, status=status.HTTP_400_BAD_REQUEST)
        if category_ref and category_ref.location_required:
            if serializer.validated_data.get("latitude") is None or serializer.validated_data.get("longitude") is None or not serializer.validated_data.get("address", "").strip():
                return Response({"address": ["Pin where the issue is located."]}, status=status.HTTP_400_BAD_REQUEST)
        if category_ref and not category_ref.public_feed_allowed and serializer.validated_data.get("visibility") == Concern.Visibility.COMMUNITY:
            return Response({"visibility": ["Public sharing is not available for this concern type."]}, status=status.HTTP_400_BAD_REQUEST)
        location_review = serializer.validated_data.get("_location_review") or {}
        pending_location_review = location_review.get("action") == "review"
        validation_summary = location_review.get("summary") or "Required report checks passed. Advanced analysis is pending."
        validated_media = []
        media_hashes = set()
        media_files = request.FILES.getlist("media")
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
            if media_hash in media_hashes or ConcernMedia.objects.filter(sha256_hash=media_hash).exists():
                return Response({"media": ["This photo was already uploaded before."]}, status=status.HTTP_400_BAD_REQUEST)
            candidate_ids = phash_candidate_ids(
                SCOPE_CONCERN_MEDIA, phashes=[media_phash], blocks=media_phash_blocks
            )
            if candidate_ids:
                existing_phashes = list(
                    ConcernMedia.objects.filter(pk__in=candidate_ids).exclude(phash="").values_list("phash", "phash_blocks")
                )
            else:
                existing_phashes = []
            if media_looks_duplicate(media_phash, media_phash_blocks, [*existing_phashes, *current_phashes]):
                return Response(
                    {"media": ["This image appears to have been uploaded before."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            media_hashes.add(media_hash)
            current_phashes.append((media_phash, media_phash_blocks))
            validated_media.append((uploaded_file, validated_file, media_hash, media_phash, media_phash_blocks))
        duplicate_config = ConcernClassificationConfiguration.current()
        fingerprints = report_fingerprints(
            barangay=getattr(getattr(request.user, "resident_profile", None), "barangay", "") or "Marikina Heights",
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
                and Concern.objects.filter(report_fingerprint=fingerprints["report_fingerprint"]).exclude(status=Concern.Status.REJECTED).exists()
            )
            if duplicate_exists:
                return Response(
                    {"description": ["A similar report already exists near this location. Add new details only if this is a different issue."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        concern = Concern.objects.create(
            community=community,
            client_request_id=client_request_id,
            reporter=request.user,
            title=serializer.validated_data["title"],
            description=serializer.validated_data.get("description", ""),
            category=selected_category,
            category_ref=category_ref,
            assigned_department=assigned_department,
            visibility=Concern.Visibility.PRIVATE if category_ref and not category_ref.public_feed_allowed else serializer.validated_data["visibility"],
            address=serializer.validated_data.get("address", ""),
            latitude=serializer.validated_data.get("latitude"),
            longitude=serializer.validated_data.get("longitude"),
            report_fingerprint=fingerprints["report_fingerprint"],
            report_text_fingerprint=fingerprints["report_text_fingerprint"],
            report_location_bucket=fingerprints["report_location_bucket"],
            location_source=serializer.validated_data.get("location_source", ""),
            location_accuracy=serializer.validated_data.get("location_accuracy"),
            barangay=getattr(getattr(request.user, "resident_profile", None), "barangay", "") or "Marikina Heights",
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
        notify_status_change(concern)
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
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        from apps.live_map import concern_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("concern.created", {"concern": concern_payload(decorated)}))
        transaction.on_commit(lambda: enqueue_concern_ai(concern.pk))
        transaction.on_commit(lambda: _schedule_concern_location(concern.pk))
        return Response(ConcernSerializer(decorated, context={"request": request}).data, status=status.HTTP_201_CREATED)


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
        queryset = Concern.objects.filter(reporter=request.user)
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
            request.user.is_staff
            or request.user.is_superuser
            or request.user.role in {User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL}
        ):
            return Response(
                {"detail": "You do not have permission to view assigned concerns."},
                status=status.HTTP_403_FORBIDDEN,
            )
        queryset = Concern.objects.filter(
            Q(
                assignments__assignee=request.user,
                assignments__status=ConcernAssignment.Status.ACTIVE,
            )
            | Q(
                assignments__status=ConcernAssignment.Status.ACTIVE,
                assignments__assignee__isnull=True,
                assignments__department__designations__user=request.user,
                assignments__department__designations__is_active=True,
            ),
            validation_status=Concern.ValidationStatus.ACCEPTED,
        ).exclude(status__in=[Concern.Status.RESOLVED, Concern.Status.REJECTED]).distinct().order_by("-created_at", "-id")
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
    is_official = bool(user.is_staff or user.is_superuser or user.role == user.Role.BARANGAY_OFFICIAL)
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
        return Response(ConcernSerializer(decorated, context={"request": request}).data)


class ConcernPublicDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, public_id):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, public_id=public_id)
        if not can_access_concern(request.user, concern):
            return Response({"detail": "You do not have permission to view this report."}, status=status.HTTP_403_FORBIDDEN)
        _record_official_view(request.user, concern)
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        can_view_private_case = bool(
            request.user.is_superuser
            or request.user.is_staff
            or request.user.role == request.user.Role.BARANGAY_OFFICIAL
            or request.user.pk == concern.reporter_id
            or concern.assignments.filter(
                assignee=request.user,
                status=ConcernAssignment.Status.ACTIVE,
            ).exists()
        )
        return Response(
            ConcernSerializer(
                decorated,
                context={"request": request, "privacy_safe": not can_view_private_case},
            ).data
        )


class ConcernFeedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        from apps.community_scope import scope_concern_queryset
        queryset = scope_concern_queryset(Concern.objects.filter(
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status__in=FEED_VISIBLE_STATUSES,
        ), request.user)
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
        concerns = decorate_concerns(queryset, request.user)
        concerns.sort(key=lambda item: (item.priority_score, item.updated_at, item.pk), reverse=True)
        return Response(ConcernSerializer(concerns, many=True, context={"request": request, "privacy_safe": True}).data)


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

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(
            Concern,
            pk=pk,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        )
        serializer = ConcernCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = None
        parent_id = serializer.validated_data.get("parent")
        if parent_id:
            parent = get_object_or_404(ConcernComment, pk=parent_id, concern=concern)
            # One-level replies only — always hang off the top-level comment
            if parent.parent_id is not None:
                parent = parent.parent
        comment = ConcernComment.objects.create(
            concern=concern,
            author=request.user,
            parent=parent,
            body=serializer.validated_data["body"],
        )
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
        comment = get_object_or_404(ConcernComment, pk=comment_id, concern=concern)
        if comment.author_id != request.user.id:
            return Response({"detail": "You can only delete your own comments."}, status=status.HTTP_403_FORBIDDEN)
        comment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContentFlagCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
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
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            flags = flags.filter(status=status_filter)
        return Response(ContentFlagSerializer(flags, many=True, context={"request": request}).data)


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
            ContentFlag.objects.select_related(
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
            ConcernAssignment.objects.select_for_update()
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
        department_id = concern.assigned_department_id or getattr(concern.configured_category, "department_id", None)
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
        categories = (
            ConcernCategory.objects.filter(is_active=True)
            .select_related("department")
            .order_by("name")
        )
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
        queryset = self.model.objects.all()
        if self.model in {Department, ConcernCategory}:
            from apps.community_scope import community_ids_for_user
            queryset = queryset.filter(community_id__in=community_ids_for_user(request.user))
        return Response(self.serializer_class(queryset, many=True, context={"request": request}).data)

    def post(self, request):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        serializer = self.serializer_class(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
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
        queryset = self.model.objects.all()
        if self.model in {Department, ConcernCategory}:
            from apps.community_scope import community_ids_for_user
            queryset = queryset.filter(community_id__in=community_ids_for_user(request.user))
        obj = get_object_or_404(queryset, pk=pk)
        serializer = self.serializer_class(
            obj, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        queryset = self.model.objects.all()
        if self.model in {Department, ConcernCategory}:
            from apps.community_scope import community_ids_for_user
            queryset = queryset.filter(community_id__in=community_ids_for_user(request.user))
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
        category = get_object_or_404(ConcernCategory, pk=category_id)
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
        serializer = ConcernStatusUpdateSerializer(data=request.data)
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
            concern.category_ref = ConcernCategory.objects.filter(code=new_category, is_active=True).first()
            changed_fields.extend(["category", "category_ref"])

        new_department_id = serializer.validated_data.get("department_id")
        department_changed = bool(new_department_id) and new_department_id != concern.assigned_department_id
        department = None
        if department_changed:
            department = get_object_or_404(Department, pk=new_department_id, is_active=True)
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
        return FileResponse(preview.open("rb"), content_type="image/jpeg")


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
        from apps.community_scope import community_ids_for_user
        community_id = next(iter(community_ids_for_user(request.user)), None)
        if not community_id:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        announcement = serializer.save(community_id=community_id)
        if announcement.is_published:
            mark_announcement_published(announcement)
            dispatch_due_announcements()
            announcement.refresh_from_db()
        create_audit_log("announcement.created", actor=request.user, metadata={"announcement_id": announcement.pk, "is_published": announcement.is_published}, request_meta=request_meta(request))
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
        old_image_name = announcement.image.name if announcement.image else ""
        serializer = AnnouncementSerializer(announcement, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        announcement = serializer.save()
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
        create_audit_log("announcement.updated", actor=request.user, metadata={"announcement_id": announcement.pk}, request_meta=request_meta(request))
        return Response(AnnouncementSerializer(announcement, context={"request": request}).data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to delete announcements."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import community_ids_for_user
        announcement = get_object_or_404(Announcement, pk=pk, community_id__in=community_ids_for_user(request.user))
        create_audit_log("announcement.deleted", actor=request.user, metadata={"announcement_id": announcement.pk}, request_meta=request_meta(request))
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
        from apps.community_scope import community_ids_for_user
        community_id = next(iter(community_ids_for_user(request.user)), None)
        if not community_id:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        event = serializer.save(community_id=community_id)
        create_audit_log("event.created", actor=request.user, metadata={"event_id": event.pk, "is_published": event.is_published}, request_meta=request_meta(request))
        return Response(BarangayEventSerializer(event).data, status=status.HTTP_201_CREATED)

class BarangayEventManageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to update events."}, status=status.HTTP_403_FORBIDDEN)
        event = get_object_or_404(BarangayEvent, pk=pk)
        serializer = BarangayEventSerializer(event, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        event = serializer.save()
        create_audit_log("event.updated", actor=request.user, metadata={"event_id": event.pk}, request_meta=request_meta(request))
        return Response(BarangayEventSerializer(event).data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not can_publish_announcements(request.user):
            return Response({"detail": "You do not have permission to delete events."}, status=status.HTTP_403_FORBIDDEN)
        event = get_object_or_404(BarangayEvent, pk=pk)
        create_audit_log("event.deleted", actor=request.user, metadata={"event_id": event.pk}, request_meta=request_meta(request))
        event.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ActiveResponderListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        User = get_user_model()
        responders = User.objects.filter(
            role__in=[User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL],
            status=User.Status.VERIFIED,
            is_on_duty=True,
            last_seen_at__gte=timezone.now() - timedelta(minutes=5),
        ).select_related("resident_profile")
        resident_profile = getattr(request.user, "resident_profile", None)
        resident_barangay = getattr(resident_profile, "barangay", "").strip()
        if resident_barangay:
            responders = responders.filter(resident_profile__barangay__iexact=resident_barangay)
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
            return FileResponse(media.preview_file.open("rb"), content_type="image/jpeg")
        # No preview yet: hand the work to the privacy pipeline instead of
        # decoding/re-encoding on the request thread. A placeholder keeps the
        # feed layout intact until the worker lands the real preview.
        transaction.on_commit(lambda media_id=media.pk: enqueue_concern_media_privacy(media_id))
        return FileResponse(BytesIO(placeholder_preview_jpeg()), content_type="image/jpeg")


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
        media = get_object_or_404(ConcernMedia.objects.select_related("concern__reporter"), pk=pk)
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
