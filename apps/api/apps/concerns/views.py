from datetime import timedelta

import re

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
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

from apps.accounts.media_services import log_raw_media_access
from apps.capabilities import (
    MANAGE_CATEGORIES,
    MANAGE_ROLES,
    MANAGE_UNITS,
    MANAGE_USERS,
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
    ConcernOfficialRemark,
    ConcernResolutionEvidence,
    ConcernTimelineEntry,
    ConcernStatusEvent,
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
from .severity import priority_score as compute_priority_score, severity_label
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
    ConcernAiReviewSerializer,
    ConcernAssignmentSerializer,
    ConcernChatCreateSerializer,
    ConcernChatMessageSerializer,
    ConcernCommentCreateSerializer,
    ConcernCommentSerializer,
    ConcernCreateSerializer,
    ConcernClarificationSerializer,
    ContentFlagSerializer,
    ContentFlagReviewSerializer,
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
from .services import ensure_concern_media_preview, user_can_access_concern_media_raw
from .tasks import enqueue_concern_ai


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
#   - SUBMITTED -> UNDER_REVIEW is a manual official transition only. The AI-flagged queue
#     (concerns list filtered with `?ai=flagged`) surfaces candidates for review, but the AI
#     assessment never auto-transitions a concern's status itself (soft gate) -- an official
#     must explicitly move it into `under_review`.
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
    return (
        user.is_superuser
        or user.is_staff
        or user.role == user.Role.BARANGAY_OFFICIAL
        or user.pk == concern.reporter_id
        or concern.assignments.filter(
            assignee=user,
            status=ConcernAssignment.Status.ACTIVE,
        ).exists()
        or (
            concern.visibility == Concern.Visibility.COMMUNITY
            and concern.validation_status == Concern.ValidationStatus.ACCEPTED
        )
    )


def can_update_concern_status(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_staff
            or user.is_superuser
            or user_has_role_permission(user, "concerns.manage")
        )
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
        .select_related("reporter", "reporter__resident_profile")
        .prefetch_related(
            "media",
            "ai_assessment",
            "status_events",
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

        existing_phashes = list(
            ConcernMedia.objects.exclude(phash="").values_list("phash", "phash_blocks")
        )
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
                    {"media": ["duplicate media upload detected."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
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

    @transaction.atomic
    def post(self, request):
        touch_last_seen(request.user)
        if not user_has_role_permission(request.user, "concerns.create"):
            return Response({"detail": "Only residents can submit concerns."}, status=status.HTTP_403_FORBIDDEN)
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
        category_id = serializer.validated_data.get("category_id")
        if category_id:
            category_ref = get_object_or_404(ConcernCategory, pk=category_id, is_active=True)
            rule = category_ref.routing_rules.filter(is_active=True).select_related("department").first()
            assigned_department = rule.department if rule else category_ref.department
            selected_category = Concern.Category.OTHERS
        else:
            configuration = ConcernClassificationConfiguration.current()
            enabled_categories = configuration.enabled_categories or list(Concern.Category.values)
            selected_category = serializer.validated_data["category"]
            if selected_category not in enabled_categories:
                return Response(
                    {"category": ["This concern category is temporarily unavailable. Choose another category."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Resolve the legacy string to a real category row so every concern
            # carries a FK, not just those filed through the newer path. Without
            # this, routing and the category breakdown silently skip them.
            category_ref = ConcernCategory.objects.filter(
                code=selected_category, is_active=True
            ).select_related("department").first()
            if category_ref:
                rule = (
                    category_ref.routing_rules.filter(is_active=True)
                    .select_related("department")
                    .first()
                )
                assigned_department = rule.department if rule else category_ref.department
        location_review = serializer.validated_data.get("_location_review") or {}
        pending_location_review = location_review.get("action") == "review"
        validation_summary = location_review.get("summary") or "Required report checks passed. Advanced analysis is pending."
        validated_media = []
        media_hashes = set()
        media_files = request.FILES.getlist("media")
        if not media_files:
            return Response(
                {"media": ["Add at least one clear photo as evidence."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        existing_phashes = list(
            ConcernMedia.objects.exclude(phash="").values_list("phash", "phash_blocks")
        )
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
                return Response({"media": ["duplicate media upload detected."]}, status=status.HTTP_400_BAD_REQUEST)
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
            description=serializer.validated_data.get("description", ""),
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
            client_request_id=client_request_id,
            reporter=request.user,
            title=serializer.validated_data["title"],
            description=serializer.validated_data.get("description", ""),
            category=selected_category,
            category_ref=category_ref,
            assigned_department=assigned_department,
            visibility=serializer.validated_data["visibility"],
            address=serializer.validated_data.get("address", ""),
            latitude=serializer.validated_data.get("latitude"),
            longitude=serializer.validated_data.get("longitude"),
            report_fingerprint=fingerprints["report_fingerprint"],
            report_text_fingerprint=fingerprints["report_text_fingerprint"],
            report_location_bucket=fingerprints["report_location_bucket"],
            location_source=serializer.validated_data.get("location_source", ""),
            location_accuracy=serializer.validated_data.get("location_accuracy"),
            barangay=getattr(getattr(request.user, "resident_profile", None), "barangay", "") or "Marikina Heights",
            validation_status=Concern.ValidationStatus.PENDING if pending_location_review else Concern.ValidationStatus.ACCEPTED,
            validation_summary=validation_summary,
            update_text="Report submitted for location review." if pending_location_review else "Report submitted and accepted for routing.",
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
        return Response(ConcernSerializer(decorated, context={"request": request}).data, status=status.HTTP_201_CREATED)


class MyConcernListView(APIView):
    permission_classes = [IsAuthenticated]

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
        concerns = decorate_concerns(queryset, request.user)
        return Response(ConcernSerializer(concerns, many=True, context={"request": request}).data)


class AssignedConcernListView(APIView):
    permission_classes = [IsAuthenticated]

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
            assignments__assignee=request.user,
            assignments__status=ConcernAssignment.Status.ACTIVE,
            validation_status=Concern.ValidationStatus.ACCEPTED,
        ).exclude(status__in=[Concern.Status.RESOLVED, Concern.Status.REJECTED]).distinct()
        concerns = decorate_concerns(queryset, request.user)
        return Response(
            ConcernSerializer(concerns, many=True, context={"request": request}).data
        )


class ManagedConcernListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to manage reports."}, status=status.HTTP_403_FORBIDDEN)
        queryset = Concern.objects.all()
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
        ai_filter = request.query_params.get("ai")
        if ai_filter == "flagged":
            queryset = queryset.filter(ai_assessment__flagged=True, ai_assessment__official_decision="")
        elif ai_filter == "cleared":
            queryset = queryset.filter(ai_assessment__flagged=False, ai_assessment__status=ConcernAiAssessment.Status.COMPLETED)
        elif ai_filter == "pending":
            queryset = queryset.filter(
                ai_assessment__status__in=[
                    ConcernAiAssessment.Status.PENDING,
                    ConcernAiAssessment.Status.FAILED,
                    ConcernAiAssessment.Status.NOT_CONFIGURED,
                ]
            )
        # Any other `ai` value is ignored (no filter applied); default ordering
        # is unaffected either way.
        concerns = decorate_concerns(queryset.order_by("-updated_at", "-created_at"), request.user)
        return Response(ConcernSerializer(concerns, many=True, context={"request": request}).data)

class ConcernDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk)
        if not can_access_concern(request.user, concern):
            return Response({"detail": "You do not have permission to view this report."}, status=status.HTTP_403_FORBIDDEN)
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        return Response(ConcernSerializer(decorated, context={"request": request}).data)


class ConcernPublicDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, public_id):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, public_id=public_id)
        if not can_access_concern(request.user, concern):
            return Response({"detail": "You do not have permission to view this report."}, status=status.HTTP_403_FORBIDDEN)
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
        queryset = Concern.objects.filter(
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status__in=FEED_VISIBLE_STATUSES,
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
        return Response(ContentFlagSerializer(flag, context={"request": request}).data, status=status.HTTP_201_CREATED)

class ContentFlagListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to view content flags."}, status=status.HTTP_403_FORBIDDEN)
        flags = ContentFlag.objects.select_related(
            "concern",
            "comment",
            "reporter",
            "reporter__resident_profile",
        )
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            flags = flags.filter(status=status_filter)
        return Response(ContentFlagSerializer(flags, many=True, context={"request": request}).data)


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
        flag = get_object_or_404(ContentFlag, pk=pk)
        flag.status = serializer.validated_data["status"]
        flag.staff_note = serializer.validated_data["staff_note"]
        flag.reviewed_by = request.user
        flag.save(update_fields=["status", "staff_note", "reviewed_by", "updated_at"])
        create_audit_log(
            "content.flag_reviewed",
            actor=request.user,
            target_user=flag.concern.reporter,
            metadata={"flag_id": flag.pk, "concern_id": flag.concern_id, "status": flag.status},
            request_meta=request_meta(request),
        )
        return Response(ContentFlagSerializer(flag, context={"request": request}).data)


class ConcernAssignView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to assign reports."}, status=status.HTTP_403_FORBIDDEN)
        concern = get_object_or_404(Concern, pk=pk)
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
            assignee = get_object_or_404(User, pk=assignee_id, role__in=[User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER], status=User.Status.VERIFIED)
        department = None
        department_id = serializer.validated_data.get("department_id")
        if department_id:
            department = get_object_or_404(Department, pk=department_id, is_active=True)
        elif concern.assigned_department_id:
            department = concern.assigned_department
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
        note = assignment.note or f"Assigned to {assignee_name or 'the barangay response team'}."
        if department and not concern.assigned_department_id:
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
        concern = get_object_or_404(Concern, pk=pk)
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
        for official in User.objects.filter(role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED):
            create_concern_notification(concern, recipient=official, type="appeal_submitted", title="Report appeal submitted", body=appeal.reason[:240])
        create_audit_log("concern.appeal_submitted", actor=request.user, target_user=request.user, metadata={"concern_id": concern.pk, "appeal_id": appeal.pk}, request_meta=request_meta(request))
        return Response(ConcernAppealSerializer(appeal, context={"request": request}).data, status=status.HTTP_201_CREATED)

class ConcernAppealListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to view appeals."}, status=status.HTTP_403_FORBIDDEN)
        appeals = ConcernAppeal.objects.select_related("concern", "appellant", "appellant__resident_profile", "reviewed_by", "reviewed_by__resident_profile")
        appeal_status = request.query_params.get("status")
        if appeal_status and appeal_status != "all":
            appeals = appeals.filter(status=appeal_status)
        return Response(ConcernAppealSerializer(appeals, many=True, context={"request": request}).data)

class ConcernAppealReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, appeal_id):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to review appeals."}, status=status.HTTP_403_FORBIDDEN)
        appeal = get_object_or_404(ConcernAppeal.objects.select_related("concern", "appellant"), pk=appeal_id)
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
        concern = get_object_or_404(Concern, pk=pk)
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


class ConcernAiReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "Only authorized officials can review AI assessment."}, status=status.HTTP_403_FORBIDDEN)
        concern = get_object_or_404(Concern, pk=pk)
        serializer = ConcernAiReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assessment, _ = ConcernAiAssessment.objects.get_or_create(concern=concern, defaults={"status": ConcernAiAssessment.Status.PENDING})
        assessment.official_decision = serializer.validated_data["decision"]
        assessment.official_reason = serializer.validated_data["reason"]
        assessment.official_reviewer = request.user
        assessment.official_reviewed_at = timezone.now()
        update_fields = ["official_decision", "official_reason", "official_reviewer", "official_reviewed_at", "updated_at"]
        if assessment.official_decision == ConcernAiAssessment.OfficialDecision.RELATED:
            # The official confirmed this report is legitimate: clear the flag
            # so it drops out of the `ai=flagged` queue, but keep flag_reasons
            # for audit history. Never touches validation_status/status.
            assessment.flagged = False
            update_fields.append("flagged")
        assessment.save(update_fields=update_fields)
        create_audit_log(
            "concern.ai_assessment_reviewed",
            actor=request.user,
            target_user=concern.reporter,
            metadata={"concern_id": concern.pk, "assessment_id": assessment.pk, "decision": assessment.official_decision, "reason": assessment.official_reason},
            request_meta=request_meta(request),
        )
        from .tasks import broadcast_concern_ai_update

        transaction.on_commit(
            lambda assessment_id=assessment.pk: broadcast_concern_ai_update(assessment_id)
        )
        return Response(ConcernAiAssessmentSerializer(assessment, context={"request": request}).data)


class ConcernChatView(APIView):
    """
    Private chat on one report: resident reporter ↔ barangay officials.
    GET list · POST send.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk)
        if not can_chat_on_concern(request.user, concern):
            return Response(
                {"detail": "You do not have permission to view this report chat."},
                status=status.HTTP_403_FORBIDDEN,
            )
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
        concern = get_object_or_404(Concern, pk=pk)
        if not can_chat_on_concern(request.user, concern):
            return Response(
                {"detail": "You do not have permission to chat on this report."},
                status=status.HTTP_403_FORBIDDEN,
            )
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
            officials = User.objects.filter(
                role=User.Role.BARANGAY_OFFICIAL,
                status=User.Status.VERIFIED,
            ).exclude(pk=request.user.pk)[:20]
            for official in officials:
                create_concern_notification(
                    concern,
                    recipient=official,
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
        return Response(
            ConcernChatMessageSerializer(message, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ConcernChatAttachmentRawView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        attachment = get_object_or_404(
            ConcernChatAttachment.objects.select_related("concern", "message"),
            pk=pk,
        )
        if not can_chat_on_concern(request.user, attachment.concern):
            return Response({"detail": "You do not have permission to view this chat attachment."}, status=status.HTTP_403_FORBIDDEN)
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
    required_capability = None

    def _denied(self):
        return capability_denied(self.required_capability)

    def _allowed(self, user):
        if not can_update_concern_status(user):
            return False
        if self.required_capability and not user_has_capability(user, self.required_capability):
            return False
        return True

    def get(self, request):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        return Response(self.serializer_class(self.model.objects.all(), many=True, context={"request": request}).data)

    def post(self, request):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        serializer = self.serializer_class(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
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

    def _denied(self):
        return capability_denied(self.required_capability)

    def _allowed(self, user):
        if not can_update_concern_status(user):
            return False
        if self.required_capability and not user_has_capability(user, self.required_capability):
            return False
        return True

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        obj = get_object_or_404(self.model, pk=pk)
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
        obj = get_object_or_404(self.model, pk=pk)

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
    serializer_class = DepartmentSerializer


class DepartmentDetailView(AdminModelDetailView):
    model = Department
    required_capability = MANAGE_UNITS
    serializer_class = DepartmentSerializer
    protected_relation = "concerns"


class PositionListCreateView(AdminModelListCreateView):
    model = Position
    required_capability = MANAGE_ROLES
    serializer_class = PositionSerializer


class PositionDetailView(AdminModelDetailView):
    model = Position
    required_capability = MANAGE_ROLES
    serializer_class = PositionSerializer
    # A position still held by someone is deactivated, not deleted: dropping it
    # would strip those people of their capabilities with no record of why.
    protected_relation = "designations"


class DesignationListCreateView(AdminModelListCreateView):
    model = Designation
    required_capability = MANAGE_USERS
    serializer_class = DesignationSerializer


class DesignationDetailView(AdminModelDetailView):
    model = Designation
    required_capability = MANAGE_USERS
    serializer_class = DesignationSerializer


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
        if not can_update_concern_status(request.user):
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

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk)
        if not can_chat_on_concern(request.user, concern):
            return Response({"detail": "You do not have permission to update this timeline."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ConcernTimelineEntryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = create_timeline_entry(concern=concern, actor=request.user, **serializer.validated_data)
        if serializer.validated_data.get("status"):
            concern.status = serializer.validated_data["status"]
            concern.update_text = serializer.validated_data["message"][:255]
            concern.status_version += 1
            concern.save(update_fields=["status", "update_text", "status_version", "updated_at"])
        return Response(ConcernTimelineEntrySerializer(entry, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ConcernChatReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        concern = get_object_or_404(Concern, pk=pk)
        if not can_chat_on_concern(request.user, concern):
            return Response({"detail": "You do not have permission to read this chat."}, status=status.HTTP_403_FORBIDDEN)
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
        concern = get_object_or_404(Concern, pk=pk)
        if not can_chat_on_concern(request.user, concern):
            return Response({"detail": "You do not have permission to type in this chat."}, status=status.HTTP_403_FORBIDDEN)
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
        concern = get_object_or_404(Concern, pk=pk)
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
        allowed = LEGAL_STATUS_TRANSITIONS.get(concern.status, set())
        if next_status not in allowed:
            return Response(
                {"status": [f"A report cannot move from {concern.status} to {next_status}."]},
                status=status.HTTP_409_CONFLICT,
            )
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

        concern.status = next_status
        concern.update_text = note
        concern.status_version += 1
        concern.save(update_fields=["status", "update_text", "status_version", "updated_at"])
        ConcernStatusEvent.objects.create(
            concern=concern,
            status=next_status,
            note=note,
            actor=request.user,
        )
        evidence_records = []
        for uploaded_file, validated_file in validated_evidence:
            evidence_records.append(
                ConcernResolutionEvidence.objects.create(
                    concern=concern,
                    file=validated_file,
                    uploaded_by=request.user,
                    original_filename=uploaded_file.name,
                    mime_type=getattr(validated_file, "content_type", "") or "",
                    file_size=validated_file.size,
                    note=note,
                )
            )
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
                        type="assigned",
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


class ConcernSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        mine = Concern.objects.filter(reporter=request.user)
        active = decorate_concerns(mine.filter(status__in=ACTIVE_STATUSES)[:3], request.user)
        return Response({
            "reports_submitted": mine.count(),
            "reports_resolved": mine.filter(status=Concern.Status.RESOLVED).count(),
            "reports_active": mine.filter(status__in=ACTIVE_STATUSES).count(),
            "active_reports": ConcernSerializer(active, many=True, context={"request": request}).data,
        })


class AnnouncementListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        dispatch_due_announcements()
        now = timezone.now()
        announcements = Announcement.objects.filter(
            is_published=True,
            audience__in=[Announcement.Audience.ALL, Announcement.Audience.RESIDENTS],
        ).filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now)).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        return Response(AnnouncementSerializer(announcements, many=True).data)

class AnnouncementManageListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to manage announcements."}, status=status.HTTP_403_FORBIDDEN)
        dispatch_due_announcements()
        announcements = Announcement.objects.all()
        published = request.query_params.get("published")
        if published in {"true", "false"}:
            announcements = announcements.filter(is_published=published == "true")
        return Response(AnnouncementSerializer(announcements, many=True).data)

    def post(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to create announcements."}, status=status.HTTP_403_FORBIDDEN)
        serializer = AnnouncementSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        announcement = serializer.save()
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
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to update announcements."}, status=status.HTTP_403_FORBIDDEN)
        announcement = get_object_or_404(Announcement, pk=pk)
        serializer = AnnouncementSerializer(announcement, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        announcement = serializer.save()
        if announcement.is_published:
            mark_announcement_published(announcement)
            dispatch_due_announcements()
            announcement.refresh_from_db()
        create_audit_log("announcement.updated", actor=request.user, metadata={"announcement_id": announcement.pk}, request_meta=request_meta(request))
        return Response(AnnouncementSerializer(announcement, context={"request": request}).data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to delete announcements."}, status=status.HTTP_403_FORBIDDEN)
        announcement = get_object_or_404(Announcement, pk=pk)
        create_audit_log("announcement.deleted", actor=request.user, metadata={"announcement_id": announcement.pk}, request_meta=request_meta(request))
        announcement.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BarangayEventTodayView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        today = timezone.localdate()
        events = BarangayEvent.objects.filter(
            is_published=True,
            starts_at__date=today,
        )
        return Response(BarangayEventSerializer(events, many=True).data)

class BarangayEventManageListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to manage events."}, status=status.HTTP_403_FORBIDDEN)
        events = BarangayEvent.objects.all()
        published = request.query_params.get("published")
        if published in {"true", "false"}:
            events = events.filter(is_published=published == "true")
        return Response(BarangayEventSerializer(events, many=True).data)

    def post(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to create events."}, status=status.HTTP_403_FORBIDDEN)
        serializer = BarangayEventSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = serializer.save()
        create_audit_log("event.created", actor=request.user, metadata={"event_id": event.pk, "is_published": event.is_published}, request_meta=request_meta(request))
        return Response(BarangayEventSerializer(event).data, status=status.HTTP_201_CREATED)

class BarangayEventManageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to update events."}, status=status.HTTP_403_FORBIDDEN)
        event = get_object_or_404(BarangayEvent, pk=pk)
        serializer = BarangayEventSerializer(event, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        event = serializer.save()
        create_audit_log("event.updated", actor=request.user, metadata={"event_id": event.pk}, request_meta=request_meta(request))
        return Response(BarangayEventSerializer(event).data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
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
        return Response(
            ActiveResponderSerializer(
                responders,
                many=True,
                context={"include_location": can_update_concern_status(request.user)},
            ).data
        )


class ConcernMediaRawView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        media = get_object_or_404(ConcernMedia.objects.select_related("concern__reporter"), pk=pk)
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
        is_publicly_displayable = (
            media.concern.visibility == media.concern.Visibility.COMMUNITY
            and media.concern.validation_status == media.concern.ValidationStatus.ACCEPTED
        )
        if not is_publicly_displayable and not user_can_access_concern_media_raw(request.user, media):
            return Response({"detail": "You do not have permission to access this media."}, status=status.HTTP_403_FORBIDDEN)
        preview = ensure_concern_media_preview(media)
        return FileResponse(preview.open("rb"), content_type="image/jpeg")
