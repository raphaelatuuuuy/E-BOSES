from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.accounts.permissions import user_has_role_permission
from apps.capabilities import PUBLISH_ANNOUNCEMENTS, RESOLVE_CONCERNS, user_has_capability
from apps.live_map import static_map_payload

from .models import Announcement, AnnouncementComment, BarangayEvent
from .serializers import BarangayEventSerializer


MAX_COMMENT_LENGTH = 1000
MAX_CALENDAR_DAYS = 365


def is_official(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_staff
            or user.is_superuser
            or user_has_role_permission(user, "concerns.manage")
        )
    )


def can_moderate_community(user):
    return is_official(user) and user_has_capability(user, PUBLISH_ANNOUNCEMENTS)


def can_resolve_concerns(user):
    return is_official(user) and user_has_capability(user, RESOLVE_CONCERNS)


def display_name(user):
    profile = getattr(user, "resident_profile", None)
    if profile:
        name = f"{profile.first_name} {profile.last_name}".strip()
        if name:
            return name
    return user.email.split("@")[0]


def author_label(user):
    if is_official(user):
        return "Barangay Official"
    return display_name(user)


class CommentBodySerializer(serializers.Serializer):
    body = serializers.CharField(max_length=MAX_COMMENT_LENGTH, trim_whitespace=True)
    parent = serializers.IntegerField(required=False, allow_null=True)


class CommentRemovalSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255)


def serialize_comment(comment, request_user, include_replies=True):
    payload = {
        "id": comment.pk,
        "announcement": comment.announcement_id,
        "parent": comment.parent_id,
        "body": comment.body,
        "status": comment.status,
        "is_official_reply": comment.is_official_reply,
        "author_label": author_label(comment.author),
        "author": {"id": comment.author_id, "full_name": display_name(comment.author)},
        "is_mine": bool(request_user and comment.author_id == request_user.pk),
        "created_at": comment.created_at,
    }
    if include_replies:
        payload["replies"] = [
            serialize_comment(reply, request_user, include_replies=False)
            for reply in comment.replies.all()
            if reply.status == AnnouncementComment.Status.VISIBLE
        ]
    return payload


class AnnouncementCommentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, announcement_id):
        announcement = get_object_or_404(Announcement, pk=announcement_id)
        comments = (
            announcement.comments.filter(
                parent__isnull=True, status=AnnouncementComment.Status.VISIBLE
            )
            .select_related("author", "author__resident_profile")
            .prefetch_related("replies__author__resident_profile")
        )
        return Response(
            [serialize_comment(comment, request.user) for comment in comments]
        )

    def post(self, request, announcement_id):
        announcement = get_object_or_404(Announcement, pk=announcement_id)
        serializer = CommentBodySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        parent = None
        parent_id = serializer.validated_data.get("parent")
        if parent_id:
            parent = get_object_or_404(
                AnnouncementComment, pk=parent_id, announcement=announcement
            )


            parent = parent.parent or parent

        comment = AnnouncementComment.objects.create(
            announcement=announcement,
            author=request.user,
            parent=parent,
            body=serializer.validated_data["body"],
            is_official_reply=is_official(request.user),
        )
        return Response(
            serialize_comment(comment, request.user), status=status.HTTP_201_CREATED
        )


class AnnouncementCommentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, announcement_id, comment_id):
        comment = get_object_or_404(
            AnnouncementComment, pk=comment_id, announcement_id=announcement_id
        )
        if comment.author_id != request.user.pk and not can_moderate_community(request.user):
            return Response(
                {"detail": "You can only remove your own comment."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = CommentRemovalSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        comment.status = AnnouncementComment.Status.REMOVED
        comment.moderation_note = serializer.validated_data.get("reason", "")
        comment.save(update_fields=["status", "moderation_note", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AnnouncementAreaContextView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(static_map_payload())


class BarangayEventCalendarView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = int(request.query_params.get("days", 60))
        except (TypeError, ValueError):
            days = 60
        days = max(1, min(days, MAX_CALENDAR_DAYS))

        now = timezone.now()
        events = BarangayEvent.objects.filter(
            is_published=True,
            starts_at__gte=now - timedelta(days=1),
            starts_at__lte=now + timedelta(days=days),
        ).order_by("starts_at", "id")
        return Response(BarangayEventSerializer(events, many=True).data)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, trim_whitespace=True)


class ConcernReopenRequestView(APIView):
    """A resident asking for a closed report to be looked at again.

    Reopening does not reset the report to submitted — it moves it back to
    under review so the original timeline and tracking number survive.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from .models import Concern, ConcernTimelineEntry
        from .serializers import ConcernSerializer
        from .views import decorate_concerns

        concern = get_object_or_404(Concern, pk=pk)
        if concern.reporter_id != request.user.pk and not can_resolve_concerns(request.user):
            return Response(
                {"detail": "Only the reporter can ask to reopen this report."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if concern.status not in {Concern.Status.RESOLVED, Concern.Status.REJECTED}:
            return Response(
                {"detail": "Only a resolved or rejected report can be reopened."},
                status=status.HTTP_409_CONFLICT,
            )
        if concern.archived_at:
            return Response(
                {"detail": "This report has been archived and cannot be reopened."},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]

        concern.status = Concern.Status.UNDER_REVIEW
        concern.reopen_count += 1
        concern.reopened_at = timezone.now()
        concern.status_version += 1
        concern.update_text = reason[:255]
        concern.save(
            update_fields=[
                "status",
                "reopen_count",
                "reopened_at",
                "status_version",
                "update_text",
                "updated_at",
            ]
        )
        ConcernTimelineEntry.objects.create(
            concern=concern,
            event_type=ConcernTimelineEntry.EventType.STATUS_CHANGE,
            status=Concern.Status.UNDER_REVIEW,
            actor=request.user,
            message=f"Reopen requested: {reason}",
        )
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        return Response(ConcernSerializer(decorated, context={"request": request}).data)


class ConcernCancelView(APIView):
    """The reporter withdrawing a report they no longer need actioned."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from .models import Concern, ConcernTimelineEntry
        from .serializers import ConcernSerializer
        from .views import decorate_concerns

        concern = get_object_or_404(Concern, pk=pk)
        if concern.reporter_id != request.user.pk:
            return Response(
                {"detail": "Only the reporter can cancel this report."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if concern.status in {Concern.Status.RESOLVED, Concern.Status.REJECTED}:
            return Response(
                {"detail": "This report is already closed."},
                status=status.HTTP_409_CONFLICT,
            )

        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]

        concern.status = Concern.Status.REJECTED
        concern.rejection_code = "cancelled_by_reporter"
        concern.status_version += 1
        concern.update_text = reason[:255]
        concern.archived_at = timezone.now()
        concern.save(
            update_fields=[
                "status",
                "rejection_code",
                "status_version",
                "update_text",
                "archived_at",
                "updated_at",
            ]
        )
        ConcernTimelineEntry.objects.create(
            concern=concern,
            event_type=ConcernTimelineEntry.EventType.STATUS_CHANGE,
            status=Concern.Status.REJECTED,
            actor=request.user,
            message=f"Cancelled by reporter: {reason}",
        )
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
        return Response(ConcernSerializer(decorated, context={"request": request}).data)
