from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated
from apps.emergencies.services import mark_witness_notifications_read

from .models import BrowserPushSubscription, Notification
from .serializers import BrowserPushSubscriptionSerializer, NotificationSerializer
from .services import broadcast_notification, send_browser_push, web_push_config_health
from .tickets import issue_websocket_ticket


class RealtimeTicketView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        return Response({"ticket": issue_websocket_ticket(request.user), "expires_in": 60})


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        unread_only = request.query_params.get("unread_only", "").lower() in ("true", "1")
        include_archived = request.query_params.get("include_archived", "").lower() in ("true", "1")
        qs = Notification.objects.filter(recipient=request.user).select_related("recipient", "concern", "emergency")
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
        from django.core.cache import cache

        key = f"notifications:unread-count:v1:{request.user.pk}"
        try:
            cached = cache.get(key)
        except Exception:
            cached = None
        if cached is not None:
            return Response({"count": cached})
        count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        try:
            cache.set(key, count, 5)
        except Exception:
            pass
        return Response({"count": count})


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        notification = Notification.objects.filter(pk=pk, recipient=request.user).first()
        if not notification:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        try:
            from django.core.cache import cache
            cache.delete(f"notifications:unread-count:v1:{request.user.pk}")
        except Exception:
            pass
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


class BrowserPushTestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        subscriptions = request.user.browser_push_subscriptions.filter(is_active=True)
        notification = Notification.objects.create(
            recipient=request.user,
            type=Notification.Type.ANNOUNCEMENT,
            title="E-Boses test notification",
            body="If you can see this, browser push is working on this device.",
            metadata={
                "display_title": "E-Boses test notification",
                "display_body": "Browser push is connected. Closed-browser notifications should work after this device is subscribed.",
                "tag_key": "test",  # fixed tag so new test notifications replace old ones
                "urgency": "important",
                "icon_url": "/contents/notification-bell.png",
                "icon_url": "/contents/notification-bell.png",
                "action_url": "/dashboard/notifications",
                "actions": [
                    {
                        "action": "open",
                        "title": "Open notifications",
                        "url": "/dashboard/notifications",
                    }
                ],
            },
        )
        # Only push — skip WebSocket broadcast so the test doesn't ping the in-app toast too.
        push_result = send_browser_push(notification)
        return Response(
            {
                "notification": NotificationSerializer(notification).data,
                "push_result": push_result,
                "active_subscriptions": subscriptions.count(),
            },
            status=status.HTTP_201_CREATED,
        )

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
        return Response({"id": subscription.pk, "is_active": subscription.is_active}, status=status.HTTP_201_CREATED)

    def delete(self, request):
        endpoint = request.data.get("endpoint")
        if not endpoint:
            return Response({"endpoint": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        BrowserPushSubscription.objects.filter(user=request.user, endpoint=endpoint).update(is_active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)
