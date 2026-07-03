from django.db.models import F
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User
from .models import ConcernCategory, ConcernMedia, ConcernReport, ConcernStatusHistory, ConcernVote
from .serializers import ConcernCategorySerializer, ConcernMediaSerializer, ConcernReportSerializer, ConcernStatusHistorySerializer, ConcernStatusUpdateSerializer


class IsBarangayStaff(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_staff or request.user.role == User.Role.BARANGAY_OFFICIAL


class ConcernCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ConcernCategory.objects.filter(is_active=True)
    serializer_class = ConcernCategorySerializer


class ConcernReportViewSet(viewsets.ModelViewSet):
    serializer_class = ConcernReportSerializer

    def get_queryset(self):
        qs = ConcernReport.objects.select_related("resident", "category").prefetch_related("media", "status_history")
        user = self.request.user
        if self.action in ["review_queue", "update_status"] or user.is_staff or user.role == User.Role.BARANGAY_OFFICIAL:
            return qs
        return qs.filter(resident=user)

    @action(detail=False, methods=["get"], url_path="mine")
    def mine(self, request):
        serializer = self.get_serializer(self.get_queryset().filter(resident=request.user), many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], permission_classes=[IsBarangayStaff], url_path="review")
    def review_queue(self, request):
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], permission_classes=[IsBarangayStaff], url_path="status")
    def update_status(self, request, pk=None):
        report = self.get_object()
        serializer = ConcernStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        old_status = report.status
        report.status = serializer.validated_data["status"]
        if "severity_override" in serializer.validated_data:
            report.severity_override = serializer.validated_data["severity_override"]
        report.save(update_fields=["status", "severity_override", "updated_at"])
        ConcernStatusHistory.objects.create(report=report, updated_by=request.user, old_status=old_status, new_status=report.status, resolution_note=serializer.validated_data.get("resolution_note", ""))
        return Response(self.get_serializer(report).data)

    @action(detail=True, methods=["post", "delete"], url_path="support")
    def support(self, request, pk=None):
        report = self.get_object()
        if request.method == "POST":
            vote, created = ConcernVote.objects.get_or_create(report=report, resident=request.user)
            if created:
                ConcernReport.objects.filter(pk=report.pk).update(vote_count=F("vote_count") + 1)
            report.refresh_from_db()
            return Response({"supported": True, "vote_count": report.vote_count}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
        deleted, _ = ConcernVote.objects.filter(report=report, resident=request.user).delete()
        if deleted:
            ConcernReport.objects.filter(pk=report.pk, vote_count__gt=0).update(vote_count=F("vote_count") - 1)
        report.refresh_from_db()
        return Response({"supported": False, "vote_count": report.vote_count})

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        return Response(ConcernStatusHistorySerializer(self.get_object().status_history.all(), many=True).data)


class ConcernMediaViewSet(viewsets.ModelViewSet):
    queryset = ConcernMedia.objects.select_related("report", "uploaded_by")
    serializer_class = ConcernMediaSerializer
