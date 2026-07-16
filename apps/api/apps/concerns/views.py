from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.media_services import log_raw_media_access
from apps.accounts.permissions import user_has_role_permission
from apps.accounts.services import (
    create_audit_log,
    phash_file,
    sha256_file,
    validate_concern_media_file,
)
from apps.accounts.views import request_meta, touch_last_seen
from apps.notifications.models import Notification
from apps.notifications.services import broadcast_notification

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernAppeal,
    ConcernAssignment,
    ConcernAiAssessment,
    ConcernClassificationConfiguration,
    ConcernClarification,
    ConcernComment,
    ConcernMedia,
    ConcernOfficialRemark,
    ConcernStatusEvent,
    ConcernVote,
    ContentFlag,
)
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
    ConcernAssignmentSerializer,
    ConcernCommentCreateSerializer,
    ConcernCommentSerializer,
    ConcernCreateSerializer,
    ConcernClarificationSerializer,
    ContentFlagSerializer,
    ConcernMediaSerializer,
    ConcernOfficialRemarkCreateSerializer,
    ConcernOfficialRemarkSerializer,
    ConcernSerializer,
    ConcernStatusUpdateSerializer,
    ConcernVoteSerializer,
)
from .services import ensure_concern_media_preview, user_can_access_concern_media_raw


ACTIVE_STATUSES = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.IN_PROGRESS,
    Concern.Status.APPEALED,
}

FEED_VISIBLE_STATUSES = {
    Concern.Status.UNDER_REVIEW,
    Concern.Status.IN_PROGRESS,
    Concern.Status.RESOLVED,
    Concern.Status.APPEALED,
}


def can_access_concern(user, concern):
    if not user or not user.is_authenticated:
        return concern.visibility == Concern.Visibility.COMMUNITY
    return (
        user.is_superuser
        or user.is_staff
        or user.role == user.Role.BARANGAY_OFFICIAL
        or user.pk == concern.reporter_id
        or concern.visibility == Concern.Visibility.COMMUNITY
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
        concern.priority_score = (concern.vote_count * 3) + (concern.comment_count * 2)
    return concerns

def notify_announcement_published(announcement):
    User = get_user_model()
    recipients = User.objects.filter(
        role=User.Role.RESIDENT,
        status=User.Status.VERIFIED,
    ).exclude(resident_settings__push_alerts=False)
    for recipient in recipients:
        notification = Notification.objects.create(
            recipient=recipient,
            type=Notification.Type.ANNOUNCEMENT,
            title=announcement.title,
            body=announcement.body[:240],
        )
        transaction.on_commit(lambda notification=notification: broadcast_notification(notification))

def create_concern_notification(concern, *, recipient, type, title, body):
    notification = Notification.objects.create(
        recipient=recipient,
        concern=concern,
        type=type,
        title=title,
        body=body,
    )
    transaction.on_commit(lambda: broadcast_notification(notification))
    return notification


class ConcernListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        touch_last_seen(request.user)
        if not user_has_role_permission(request.user, "concerns.create"):
            return Response({"detail": "Only residents can submit concerns."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ConcernCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        configuration = ConcernClassificationConfiguration.current()
        enabled_categories = configuration.enabled_categories or list(Concern.Category.values)
        if serializer.validated_data["category"] not in enabled_categories:
            return Response(
                {"category": ["This concern category is temporarily unavailable. Choose another category."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        validated_media = []
        media_hashes = set()
        for uploaded_file in request.FILES.getlist("media"):
            try:
                validated_file = validate_concern_media_file(uploaded_file)
            except ValidationError as exc:
                return Response({"media": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
            media_hash = sha256_file(validated_file)
            raw_content = validated_file.read(); validated_file.seek(0)
            media_phash = phash_file(raw_content)
            if media_hash in media_hashes or ConcernMedia.objects.filter(sha256_hash=media_hash).exists():
                return Response({"media": [f"{uploaded_file.name}: duplicate media upload detected."]}, status=status.HTTP_400_BAD_REQUEST)
            media_hashes.add(media_hash)
            validated_media.append((uploaded_file, validated_file, media_hash, media_phash))
        concern = Concern.objects.create(
            reporter=request.user,
            title=serializer.validated_data["title"],
            description=serializer.validated_data.get("description", ""),
            category=serializer.validated_data["category"],
            visibility=serializer.validated_data["visibility"],
            address=serializer.validated_data.get("address", ""),
            latitude=serializer.validated_data.get("latitude"),
            longitude=serializer.validated_data.get("longitude"),
            location_source=serializer.validated_data.get("location_source", ""),
            location_accuracy=serializer.validated_data.get("location_accuracy"),
            barangay=getattr(getattr(request.user, "resident_profile", None), "barangay", "") or "Marikina Heights",
            update_text="Submitted for barangay review.",
        )
        ConcernStatusEvent.objects.create(
            concern=concern,
            status=Concern.Status.SUBMITTED,
            note="Report submitted.",
            actor=request.user,
        )
        ConcernAiAssessment.objects.create(concern=concern, status=ConcernAiAssessment.Status.PENDING)
        for uploaded_file, validated_file, media_hash, media_phash in validated_media:
            ConcernMedia.objects.create(
                concern=concern,
                file=validated_file,
                original_filename=uploaded_file.name,
                mime_type=getattr(validated_file, "content_type", "") or "",
                file_size=validated_file.size,
                sha256_hash=media_hash,
                phash=media_phash,
            )
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        from apps.live_map import concern_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("concern.created", {"concern": concern_payload(decorated)}))
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


class ConcernFeedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        queryset = Concern.objects.filter(
            visibility=Concern.Visibility.COMMUNITY,
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
        concern = get_object_or_404(Concern, pk=pk, visibility=Concern.Visibility.COMMUNITY)
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
        concern = get_object_or_404(Concern, pk=pk, visibility=Concern.Visibility.COMMUNITY)
        serializer = ConcernCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        parent = None
        parent_id = serializer.validated_data.get("parent")
        if parent_id:
            parent = get_object_or_404(ConcernComment, pk=parent_id, concern=concern)
        comment = ConcernComment.objects.create(
            concern=concern,
            author=request.user,
            parent=parent,
            body=serializer.validated_data["body"],
        )
        return Response(
            ConcernCommentSerializer(comment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

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


class ConcernAssignView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to assign reports."}, status=status.HTTP_403_FORBIDDEN)
        concern = get_object_or_404(Concern, pk=pk)
        serializer = ConcernAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignee = None
        assignee_id = serializer.validated_data.get("assignee_id")
        if assignee_id:
            User = get_user_model()
            assignee = get_object_or_404(User, pk=assignee_id, role__in=[User.Role.BARANGAY_OFFICIAL, User.Role.FIRST_RESPONDER], status=User.Status.VERIFIED)
        assignment = ConcernAssignment.objects.create(
            concern=concern,
            assignee=assignee,
            assigned_by=request.user,
            office=serializer.validated_data.get("office", ""),
            note=serializer.validated_data.get("note", ""),
        )
        note = assignment.note or f"Assigned to {assignee.email if assignee else assignment.office}."
        concern.status = Concern.Status.IN_PROGRESS
        concern.update_text = note
        concern.save(update_fields=["status", "update_text", "updated_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=Concern.Status.IN_PROGRESS, note=note, actor=request.user)
        create_concern_notification(concern, recipient=concern.reporter, type=Notification.Type.ASSIGNED, title="Your report was assigned", body=note)
        if assignee:
            create_concern_notification(concern, recipient=assignee, type=Notification.Type.ASSIGNED, title="Concern report assigned", body=note)
        create_audit_log("concern.assigned", actor=request.user, target_user=concern.reporter, metadata={"concern_id": concern.pk, "assignment_id": assignment.pk}, request_meta=request_meta(request))
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
        concern.status = Concern.Status.UNDER_REVIEW
        concern.update_text = "Barangay requested clarification."
        concern.save(update_fields=["status", "update_text", "updated_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=Concern.Status.UNDER_REVIEW, note=clarification.request_text, actor=request.user)
        create_concern_notification(concern, recipient=concern.reporter, type=Notification.Type.CLARIFICATION_REQUESTED, title="Clarification requested", body=clarification.request_text)
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
            create_concern_notification(concern, recipient=clarification.requested_by, type=Notification.Type.CLARIFICATION_REPLIED, title="Resident replied to clarification", body=clarification.response_text[:240])
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
            create_concern_notification(concern, recipient=official, type=Notification.Type.APPEAL_SUBMITTED, title="Report appeal submitted", body=appeal.reason[:240])
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
        next_status = Concern.Status.UNDER_REVIEW if appeal.status == ConcernAppeal.Status.APPROVED else Concern.Status.REJECTED
        concern.status = next_status
        concern.update_text = appeal.decision_note or f"Appeal {appeal.status}."
        concern.save(update_fields=["status", "update_text", "updated_at"])
        ConcernStatusEvent.objects.create(concern=concern, status=next_status, note=concern.update_text, actor=request.user)
        notif_type = Notification.Type.APPEAL_APPROVED if appeal.status == ConcernAppeal.Status.APPROVED else Notification.Type.APPEAL_DENIED
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
            create_concern_notification(concern, recipient=concern.reporter, type=Notification.Type.UNDER_REVIEW, title="Official remark added", body=remark.body[:240])
        create_audit_log("concern.remark_added", actor=request.user, target_user=concern.reporter, metadata={"concern_id": concern.pk, "remark_id": remark.pk, "visible_to_resident": remark.visible_to_resident}, request_meta=request_meta(request))
        return Response(ConcernOfficialRemarkSerializer(remark, context={"request": request}).data, status=status.HTTP_201_CREATED)

class ConcernStatusUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to update report status."}, status=status.HTTP_403_FORBIDDEN)

        concern = get_object_or_404(Concern, pk=pk)
        serializer = ConcernStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        next_status = serializer.validated_data["status"]
        note = serializer.validated_data.get("note", "").strip()
        if not note:
            note = f"Report status updated to {next_status.replace('_', ' ')}."

        concern.status = next_status
        concern.update_text = note
        concern.save(update_fields=["status", "update_text", "updated_at"])
        ConcernStatusEvent.objects.create(
            concern=concern,
            status=next_status,
            note=note,
            actor=request.user,
        )
        create_audit_log(
            "concern.status_updated",
            actor=request.user,
            target_user=concern.reporter,
            metadata={"concern_id": concern.pk, "status": next_status},
            request_meta=request_meta(request),
        )
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        from apps.live_map import concern_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("concern.updated", {"concern": concern_payload(decorated)}))
        return Response(ConcernSerializer(decorated, context={"request": request}).data)


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
        announcements = Announcement.objects.filter(
            is_published=True,
            audience__in=[Announcement.Audience.ALL, Announcement.Audience.RESIDENTS],
        )
        return Response(AnnouncementSerializer(announcements, many=True).data)

class AnnouncementManageListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to manage announcements."}, status=status.HTTP_403_FORBIDDEN)
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
            if not announcement.published_at:
                announcement.published_at = timezone.now()
                announcement.save(update_fields=["published_at", "updated_at"])
            notify_announcement_published(announcement)
        create_audit_log("announcement.created", actor=request.user, metadata={"announcement_id": announcement.pk, "is_published": announcement.is_published}, request_meta=request_meta(request))
        return Response(AnnouncementSerializer(announcement).data, status=status.HTTP_201_CREATED)

class AnnouncementManageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_update_concern_status(request.user):
            return Response({"detail": "You do not have permission to update announcements."}, status=status.HTTP_403_FORBIDDEN)
        announcement = get_object_or_404(Announcement, pk=pk)
        was_published = announcement.is_published
        serializer = AnnouncementSerializer(announcement, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        announcement = serializer.save()
        if announcement.is_published and not was_published:
            if not announcement.published_at:
                announcement.published_at = timezone.now()
                announcement.save(update_fields=["published_at", "updated_at"])
            notify_announcement_published(announcement)
        create_audit_log("announcement.updated", actor=request.user, metadata={"announcement_id": announcement.pk}, request_meta=request_meta(request))
        return Response(AnnouncementSerializer(announcement).data)

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
        ).select_related("resident_profile")
        return Response(ActiveResponderSerializer(responders, many=True).data)


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
    permission_classes = [AllowAny]

    def get(self, request, pk):
        media = get_object_or_404(ConcernMedia.objects.select_related("concern__reporter"), pk=pk)
        if media.concern.visibility == media.concern.Visibility.PRIVATE and not user_can_access_concern_media_raw(request.user, media):
            return Response({"detail": "You do not have permission to access this media."}, status=status.HTTP_403_FORBIDDEN)
        if media.concern.visibility == media.concern.Visibility.COMMUNITY and media.mime_type.startswith("image/"):
            return FileResponse(media.file.open("rb"), content_type=media.mime_type)
        preview = ensure_concern_media_preview(media)
        return FileResponse(preview.open("rb"), content_type="text/plain")
