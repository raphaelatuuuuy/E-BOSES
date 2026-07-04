"""
URL configuration for the E-Boses API backend.
"""

from django.contrib import admin
from django.urls import include, path
from apps.concerns.views import AnnouncementListView, ActiveResponderListView, BarangayEventTodayView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/concerns/", include("apps.concerns.urls")),
    path("api/announcements/", AnnouncementListView.as_view(), name="announcement-list"),
    path("api/barangay-events/today/", BarangayEventTodayView.as_view(), name="barangay-event-today"),
    path("api/responders/active/", ActiveResponderListView.as_view(), name="active-responders"),
    path("api/emergencies/", include("apps.emergencies.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
]
