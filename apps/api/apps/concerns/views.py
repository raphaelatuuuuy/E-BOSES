from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
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
from apps.accounts.services import validate_concern_media_file
from apps.accounts.views import request_meta, touch_last_seen

from .models import (
    Announcement,
    BarangayEvent,
    Concern,
    ConcernComment,
    ConcernMedia,
    ConcernStatusEvent,
    ConcernVote,
)
from .serializers import (
    ActiveResponderSerializer,
    AnnouncementSerializer,
    BarangayEventSerializer,
    ConcernCommentCreateSerializer,
    ConcernCommentSerializer,
    ConcernCreateSerializer,
    ConcernMediaSerializer,
    ConcernSerializer,
    ConcernVoteSerializer,
)
from .services import ensure_concern_media_preview, user_can_access_concern_media_raw


ACTIVE_STATUSES = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.IN_PROGRESS,
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


def decorate_concerns(queryset, user):
    concerns = list(
        queryset
        .select_related("reporter", "reporter__resident_profile")
        .prefetch_related(
            "media",
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
    return concerns


class ConcernListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        touch_last_seen(request.user)
        serializer = ConcernCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        concern = Concern.objects.create(
            reporter=request.user,
            title=serializer.validated_data["title"],
            description=serializer.validated_data.get("description", ""),
            category=serializer.validated_data["category"],
            visibility=serializer.validated_data["visibility"],
            address=serializer.validated_data.get("address", ""),
            barangay=getattr(getattr(request.user, "resident_profile", None), "barangay", "") or "Marikina Heights",
            update_text="Submitted for barangay review.",
        )
        ConcernStatusEvent.objects.create(
            concern=concern,
            status=Concern.Status.SUBMITTED,
            note="Report submitted.",
            actor=request.user,
        )
        for uploaded_file in request.FILES.getlist("media"):
            try:
                validated_file = validate_concern_media_file(uploaded_file)
            except ValidationError as exc:
                return Response({"media": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
            ConcernMedia.objects.create(
                concern=concern,
                file=validated_file,
                original_filename=uploaded_file.name,
                mime_type=getattr(validated_file, "content_type", "") or "",
                file_size=validated_file.size,
            )
        decorated = decorate_concerns(Concern.objects.filter(pk=concern.pk), request.user)[0]
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
        concerns = decorate_concerns(queryset, request.user)
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
        queryset = Concern.objects.filter(visibility=Concern.Visibility.COMMUNITY)
        category = request.query_params.get("category")
        if category and category != "all":
            queryset = queryset.filter(category=category)
        concerns = decorate_concerns(queryset, request.user)
        return Response(ConcernSerializer(concerns, many=True, context={"request": request}).data)


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


class ActiveResponderListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        cutoff = timezone.now() - timedelta(minutes=5)
        User = get_user_model()
        responders = User.objects.filter(
            role__in=[User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL],
            status=User.Status.VERIFIED,
            last_seen_at__gte=cutoff,
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
        preview = ensure_concern_media_preview(media)
        return FileResponse(preview.open("rb"), content_type="text/plain")
