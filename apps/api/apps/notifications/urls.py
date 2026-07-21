from django.urls import path

from .views import (
    BrowserPushPublicKeyView,
    BrowserPushSubscriptionView,
    BrowserPushTestView,
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
    NotificationUnreadCountView,
    RealtimeTicketView,
)

urlpatterns = [
    path("", NotificationListView.as_view(), name="notification-list"),
    path("realtime-ticket/", RealtimeTicketView.as_view(), name="realtime-ticket"),
    path("unread-count/", NotificationUnreadCountView.as_view(), name="notification-unread-count"),
    path("browser-push/public-key/", BrowserPushPublicKeyView.as_view(), name="browser-push-public-key"),
    path("browser-push/subscriptions/", BrowserPushSubscriptionView.as_view(), name="browser-push-subscriptions"),
    path("browser-push/test/", BrowserPushTestView.as_view(), name="browser-push-test"),
    path("<int:pk>/read/", NotificationReadView.as_view(), name="notification-read"),
    path("read-all/", NotificationReadAllView.as_view(), name="notification-read-all"),
]
