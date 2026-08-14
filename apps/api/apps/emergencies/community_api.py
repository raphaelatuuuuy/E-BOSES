from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.concerns.community_api import (
    CommentBodySerializer,
    CommentRemovalSerializer,
    author_label,
    display_name,
    is_official,
)

from .models import EmergencyAlert, EmergencyCommunityComment


def serialize_comment(comment, request_user, include_replies=True):
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

    def get(self, request, pk):
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        comments = (
            alert.community_comments.filter(
                parent__isnull=True, status=EmergencyCommunityComment.Status.VISIBLE
            )
            .select_related("author", "author__resident_profile")
            .prefetch_related("replies__author__resident_profile")
        )
        return Response(
            [serialize_comment(comment, request.user) for comment in comments]
        )

    def post(self, request, pk):
        alert = get_object_or_404(EmergencyAlert, pk=pk)
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
        comment = EmergencyCommunityComment.objects.create(
            alert=alert,
            author=request.user,
            parent=parent,
            body=serializer.validated_data["body"],
            is_official_update=official,
            verified_by=request.user if official else None,
        )
        return Response(
            serialize_comment(comment, request.user), status=status.HTTP_201_CREATED
        )


class EmergencyCommunityCommentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk, comment_id):
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
