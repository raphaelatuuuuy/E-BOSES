from django.urls import path

from .views import (
    BrowserPushPublicKeyView,
    BrowserPushSubscriptionView,
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
    NotificationUnreadCountView,
)

urlpatterns = [
    path("", NotificationListView.as_view(), name="notification-list"),
    path("unread-count/", NotificationUnreadCountView.as_view(), name="notification-unread-count"),
    path("browser-push/public-key/", BrowserPushPublicKeyView.as_view(), name="browser-push-public-key"),
    path("browser-push/subscriptions/", BrowserPushSubscriptionView.as_view(), name="browser-push-subscriptions"),
    path("<int:pk>/read/", NotificationReadView.as_view(), name="notification-read"),
    path("read-all/", NotificationReadAllView.as_view(), name="notification-read-all"),
]
