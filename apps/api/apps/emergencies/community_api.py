from django.db import transaction
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.accounts.services import create_audit_log
from apps.accounts.views import request_meta, touch_last_seen
from apps.concerns.community_api import (
    CommentBodySerializer,
    CommentRemovalSerializer,
    author_label,
    display_name,
    is_official,
)
from apps.concerns.models import ContentFlag
from apps.concerns.serializers import ContentFlagSerializer
from apps.concerns.tasks import enqueue_content_moderation_ai

from .models import EmergencyAlert, EmergencyCommunityComment


def serialize_comment(comment, request_user, include_replies=True):
    from apps.concerns.comment_media import serialize_public_comment_attachment

    payload = {
        "id": comment.pk,
        "parent": comment.parent_id,
        "body": comment.body,
        "status": comment.status,
        "is_official_update": comment.is_official_update,
        "author_label": author_label(comment.author),
        "author": {"id": comment.author_id, "full_name": display_name(comment.author)},
        "is_mine": bool(request_user and comment.author_id == request_user.pk),
        "created_at": comment.created_at,
        "attachment": serialize_public_comment_attachment(
            getattr(comment, "attachment", None), None
        ),
    }
    if include_replies:
        payload["replies"] = [
            serialize_comment(reply, request_user, include_replies=False)
            for reply in comment.replies.all()
            if reply.status == EmergencyCommunityComment.Status.VISIBLE
        ]
    return payload


class EmergencyCommunityCommentListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, pk):
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        from apps.community_access import emergency_access_mode

        access_mode = emergency_access_mode(request.user, alert)
        if access_mode in {"foreign_read_only", None}:
            return Response([])
        comments = (
            alert.community_comments.filter(
                parent__isnull=True, status=EmergencyCommunityComment.Status.VISIBLE
            )
            .select_related("author", "author__resident_profile")
            .prefetch_related("replies__author__resident_profile")
            .prefetch_related("attachment", "replies__attachment")
        )
        return Response(
            [serialize_comment(comment, request.user) for comment in comments]
        )

    def post(self, request, pk):
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        from apps.community_access import emergency_access_mode, foreign_read_only_response

        access_mode = emergency_access_mode(request.user, alert)
        if access_mode == "foreign_read_only":
            return foreign_read_only_response()
        if access_mode is None:
            return Response({"detail": "You cannot interact with this emergency."}, status=status.HTTP_404_NOT_FOUND)
        serializer = CommentBodySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        parent = None
        parent_id = serializer.validated_data.get("parent")
        if parent_id:
            parent = get_object_or_404(
                EmergencyCommunityComment, pk=parent_id, alert=alert
            )
            parent = parent.parent or parent

        official = is_official(request.user)
        try:
            with transaction.atomic():
                comment = EmergencyCommunityComment.objects.create(
                    alert=alert,
                    author=request.user,
                    parent=parent,
                    body=serializer.validated_data["body"],
                    is_official_update=official,
                    verified_by=request.user if official else None,
                )
                uploaded_file = serializer.validated_data.get("media")
                if uploaded_file:
                    from apps.concerns.comment_media import create_public_comment_attachment

                    create_public_comment_attachment(
                        uploaded_file=uploaded_file,
                        parent_field="emergency_comment",
                        parent=comment,
                    )
        except ValidationError as exc:
            detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", [str(exc)])
            return Response({"media": detail}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            serialize_comment(comment, request.user), status=status.HTTP_201_CREATED
        )


class EmergencyCommunityCommentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk, comment_id):
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        from apps.community_access import emergency_access_mode, foreign_read_only_response

        access_mode = emergency_access_mode(request.user, alert)
        if access_mode == "foreign_read_only":
            return foreign_read_only_response()
        if access_mode is None:
            return Response({"detail": "You cannot interact with this emergency."}, status=status.HTTP_404_NOT_FOUND)
        comment = get_object_or_404(
            EmergencyCommunityComment, pk=comment_id, alert_id=pk
        )
        if comment.author_id != request.user.pk and not is_official(request.user):
            return Response(
                {"detail": "You can only remove your own comment."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = CommentRemovalSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        comment.status = EmergencyCommunityComment.Status.REMOVED
        comment.moderation_note = serializer.validated_data.get("reason", "")
        comment.save(update_fields=["status", "moderation_note", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class EmergencyCommentFlagCreateView(APIView):
    """A resident flagging one emergency community comment for moderation.

    Mirrors `AnnouncementCommentFlagCreateView` (concerns/community_api.py)
    and `ContentFlagCreateView` (concerns/views.py) but targets
    `ContentFlag.emergency_comment`.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk, comment_id):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        from apps.community_access import emergency_access_mode, foreign_read_only_response

        access_mode = emergency_access_mode(request.user, alert)
        if access_mode == "foreign_read_only":
            return foreign_read_only_response()
        if access_mode is None:
            return Response({"detail": "You cannot interact with this emergency."}, status=status.HTTP_404_NOT_FOUND)
        comment = get_object_or_404(
            EmergencyCommunityComment, pk=comment_id, alert_id=pk
        )
        serializer = ContentFlagSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        flag = ContentFlag.objects.create(
            emergency_comment=comment,
            reporter=request.user,
            reason=serializer.validated_data["reason"],
            note=serializer.validated_data.get("note", ""),
        )
        create_audit_log(
            "content.flag_submitted",
            actor=request.user,
            target_user=comment.author,
            metadata={
                "emergency_comment_id": comment.pk,
                "alert_id": pk,
                "flag_id": flag.pk,
                "reason": flag.reason,
            },
            request_meta=request_meta(request),
        )
        transaction.on_commit(lambda: enqueue_content_moderation_ai(flag.pk))
        return Response(
            ContentFlagSerializer(flag, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )
