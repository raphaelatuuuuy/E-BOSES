import logging
import time
from importlib import import_module

from django.conf import settings
from django.core.cache import cache
from rest_framework import status
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.emergencies.services import mark_witness_notifications_read

from .models import BrowserPushSubscription, NativePushDevice, Notification
from .presence import are_users_online, is_user_online
from .serializers import BrowserPushSubscriptionSerializer, NativePushDeviceSerializer, NotificationSerializer
from .services import web_push_config_health
from .tickets import issue_websocket_ticket


class RealtimeTicketView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        return Response({"ticket": issue_websocket_ticket(request.user), "expires_in": 60})


class PresenceStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        started = time.perf_counter()
        raw_ids = request.query_params.get("ids", "")
        try:
            ids = list(dict.fromkeys(int(value) for value in raw_ids.split(",") if value.strip()))
        except ValueError:
            return Response({"detail": "Presence ids must be whole numbers."}, status=status.HTTP_400_BAD_REQUEST)
        if len(ids) > 100:
            return Response({"detail": "A maximum of 100 presence ids may be requested."}, status=status.HTTP_400_BAD_REQUEST)
        cache_started = time.perf_counter()
        try:
            # One Redis round-trip regardless of ID count (was N sequential
            # GETs), with a hard sub-second deadline — presence is
            # non-critical and must never hold a worker slot for seconds.
            statuses = {
                str(uid): value for uid, value in are_users_online(ids).items()
            }
            statuses.update({str(uid): False for uid in ids if str(uid) not in statuses})
        except Exception:
            statuses = {str(uid): False for uid in ids}
        cache_ms = (time.perf_counter() - cache_started) * 1000
        total_ms = (time.perf_counter() - started) * 1000
        logger = logging.getLogger(__name__)
        if total_ms >= 500:
            logger.warning(
                "slow presence ids=%d cache_ms=%.0f total_ms=%.0f",
                len(ids),
                cache_ms,
                total_ms,
            )
        return Response({"statuses": statuses})


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Inbox",
        description=(
            "The authenticated account's notifications, newest first, capped at "
            "50 per page. Includes announcement posts, report status changes and "
            "emergency updates."
        ),
        request=None,
        responses={200: OpenApiResponse(
            response=NotificationSerializer(many=True),
            description="Newest-first page of at most 50 rows (manual pagination).",
        )},
        tags=["notifications"],
    )
    def get(self, request):
        unread_only = request.query_params.get("unread_only", "").lower() in ("true", "1")
        include_archived = request.query_params.get("include_archived", "").lower() in ("true", "1")
        qs = (
            Notification.objects.filter(recipient=request.user)
            .select_related(
                "recipient",
                "concern",
                "concern__community",
                "concern__assigned_department",
                "emergency",
                "emergency__community",
                "community",
                "department",
            )
            .prefetch_related(
                "concern__media",
                "concern__assignments__department",
                "concern__assignments__assignee",
                "concern__assignments__assignee__resident_profile",
                "emergency__media",
                "emergency__assignments__role_map__department",
                "emergency__assignments__responding_community",
                "emergency__assignments__responder",
                "emergency__assignments__responder__resident_profile",
            )
        )
        if not include_archived:
            qs = qs.filter(is_archived=False)
        if unread_only:
            qs = qs.filter(is_read=False)
        notification_type = request.query_params.get("type", "").strip()
        if notification_type:
            qs = qs.filter(type=notification_type)
        try:
            page = max(1, int(request.query_params.get("page", 1)))
            page_size = min(50, max(1, int(request.query_params.get("page_size", 20))))
        except (TypeError, ValueError):
            return Response(
                {"detail": "Page and page size must be whole numbers."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        start = (page - 1) * page_size
        end = start + page_size
        qs = qs.order_by("-created_at")[start:end]
        return Response(NotificationSerializer(qs, many=True).data)


class NotificationUnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = Notification.objects.filter(
            recipient=request.user,
            is_read=False,
            is_archived=False,
        ).count()
        return Response({"count": count})


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        notification = Notification.objects.filter(pk=pk, recipient=request.user).first()
        if not notification:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        if notification.type == Notification.Type.WITNESS_ALERT and notification.emergency_id:
            mark_witness_notifications_read(request.user, alert_id=notification.emergency_id)
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        mark_witness_notifications_read(request.user)
        return Response({"detail": "All notifications marked as read."})


class NotificationArchiveView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        notification = Notification.objects.filter(pk=pk, recipient=request.user).first()
        if not notification:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        notification.is_archived = True
        notification.save(update_fields=["is_archived"])
        return Response(NotificationSerializer(notification).data)


class NotificationDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        notification = Notification.objects.filter(pk=pk, recipient=request.user).first()
        if not notification:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        notification.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationArchiveAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        count = Notification.objects.filter(recipient=request.user, is_read=True, is_archived=False).update(is_archived=True)
        return Response({"detail": f"{count} notifications archived."})


class BrowserPushPublicKeyView(APIView):
    permission_classes = [AllowAny]  # Public — VAPID key is not sensitive.

    def get(self, request):
        return Response(
            {
                "public_key": getattr(settings, "WEB_PUSH_PUBLIC_KEY", ""),
                "config": web_push_config_health(),
            }
        )

class BrowserPushSubscriptionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = BrowserPushSubscriptionSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        subscription = serializer.save()
        # Subscribing from the notifications panel is an explicit opt-in. If a
        # resident previously disabled push, turn the preference back on so a
        # valid browser subscription is not silently ignored by delivery.
        ResidentSettings = import_module("apps.accounts.models").ResidentSettings

        ResidentSettings.objects.filter(user=request.user).update(push_alerts=True)
        return Response({"id": subscription.pk, "is_active": subscription.is_active}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        endpoint = request.data.get("endpoint")
        if not endpoint:
            return Response({"endpoint": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        BrowserPushSubscription.objects.filter(user=request.user, endpoint=endpoint).update(is_active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)

class NativePushDeviceView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = NativePushDeviceSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        device = serializer.save()
        return Response({"id": device.pk, "is_active": device.is_active}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        token = request.data.get("token", "")
        if not token:
            return Response({"token": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        NativePushDevice.objects.filter(user=request.user, token=token).update(is_active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)
