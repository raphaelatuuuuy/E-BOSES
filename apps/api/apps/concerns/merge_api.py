from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.accounts.permissions import user_has_role_permission
from apps.capabilities import RESOLVE_CONCERNS, user_has_capability

from . import merge_services
from .merge_serializers import (
    MergeDecisionSerializer,
    MergeEventSerializer,
    MergeRequestSerializer,
    MergeSuggestionSerializer,
    UnmergeRequestSerializer,
)
from .models import Concern, ConcernMergeSuggestion


def can_manage_merges(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_staff
            or user.is_superuser
            or user_has_role_permission(user, "concerns.manage")
        )
        and user_has_capability(user, RESOLVE_CONCERNS)
    )


class MergeManagementView(APIView):
    permission_classes = [IsAuthenticated]

    def deny(self):
        return Response(
            {"detail": "You do not have permission to manage duplicate reports."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def conflict(self, exc):
        return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

    def concerns(self, request):
        from .views import operational_concerns

        return operational_concerns(request.user)


class MergeSuggestionListView(MergeManagementView):
    def get(self, request):
        if not can_manage_merges(request.user):
            return self.deny()
        allowed = self.concerns(request)
        suggestions = merge_services.pending_suggestions().filter(
            concern__in=allowed,
            primary__in=allowed,
        )
        return Response(MergeSuggestionSerializer(suggestions, many=True).data)


class MergeSuggestionDecideView(MergeManagementView):
    def post(self, request, pk):
        if not can_manage_merges(request.user):
            return self.deny()
        allowed = self.concerns(request)
        suggestion = get_object_or_404(
            ConcernMergeSuggestion.objects.filter(concern__in=allowed, primary__in=allowed),
            pk=pk,
        )
        serializer = MergeDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            suggestion = merge_services.decide_suggestion(
                suggestion,
                serializer.validated_data["decision"],
                actor=request.user,
                note=serializer.validated_data.get("note", ""),
            )
        except merge_services.MergeConflict as exc:
            return self.conflict(exc)
        return Response(MergeSuggestionSerializer(suggestion).data)


class ConcernMergeView(MergeManagementView):
    def post(self, request, pk):
        if not can_manage_merges(request.user):
            return self.deny()
        allowed = self.concerns(request)
        concern = get_object_or_404(allowed, pk=pk)
        serializer = MergeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        primary = get_object_or_404(allowed, pk=serializer.validated_data["primary_id"])
        try:
            merge_services.merge_concern(
                concern,
                primary,
                actor=request.user,
                reason=serializer.validated_data.get("reason", ""),
                method="official",
            )
        except merge_services.MergeConflict as exc:
            return self.conflict(exc)
        return Response({"detail": f"Merged into {primary.tracking_id}."})


class ConcernUnmergeView(MergeManagementView):
    def post(self, request, pk):
        if not can_manage_merges(request.user):
            return self.deny()
        concern = get_object_or_404(self.concerns(request), pk=pk)
        serializer = UnmergeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            merge_services.unmerge_concern(
                concern,
                actor=request.user,
                reason=serializer.validated_data.get("reason", ""),
            )
        except merge_services.MergeConflict as exc:
            return self.conflict(exc)
        return Response({"detail": "Separated from its group."})


class ConcernSetPrimaryView(MergeManagementView):
    def post(self, request, pk):
        if not can_manage_merges(request.user):
            return self.deny()
        concern = get_object_or_404(self.concerns(request), pk=pk)
        try:
            merge_services.set_primary(concern, actor=request.user)
        except merge_services.MergeConflict as exc:
            return self.conflict(exc)
        return Response({"detail": f"{concern.tracking_id} is now the primary report."})


class ConcernMergeHistoryView(MergeManagementView):
    def get(self, request, pk):
        if not can_manage_merges(request.user):
            return self.deny()
        concern = get_object_or_404(self.concerns(request), pk=pk)
        events = concern.merge_events.select_related("actor", "primary", "concern")
        return Response(MergeEventSerializer(events, many=True).data)
