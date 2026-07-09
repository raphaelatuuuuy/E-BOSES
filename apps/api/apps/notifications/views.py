from django.conf import settings
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import BrowserPushSubscription, Notification
from .serializers import BrowserPushSubscriptionSerializer, NotificationSerializer


def notification_alerts_enabled(user):
    settings_obj = getattr(user, "resident_settings", None)
    return settings_obj is None or settings_obj.push_alerts


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not notification_alerts_enabled(request.user):
            return Response([])

        unread_only = request.query_params.get("unread_only", "").lower() in ("true", "1")
        qs = Notification.objects.filter(recipient=request.user)
        if unread_only:
            qs = qs.filter(is_read=False)
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))
        start = (page - 1) * page_size
        end = start + page_size
        qs = qs.order_by("-created_at")[start:end]
        return Response(NotificationSerializer(qs, many=True).data)


class NotificationUnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not notification_alerts_enabled(request.user):
            return Response({"count": 0})

        count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return Response({"count": count})


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        notification = Notification.objects.filter(pk=pk, recipient=request.user).first()
        if not notification:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return Response({"detail": "All notifications marked as read."})

class BrowserPushPublicKeyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"public_key": getattr(settings, "WEB_PUSH_PUBLIC_KEY", "")})

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
