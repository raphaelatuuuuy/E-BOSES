"""
URL configuration for the E-Boses API backend.
"""

from django.contrib import admin
from django.urls import include, path
from config.health import health_check
from apps.concerns.views import (
    ActiveResponderListView,
    AnnouncementListView,
    AnnouncementManageDetailView,
    AnnouncementManageListCreateView,
    BarangayEventManageDetailView,
    BarangayEventManageListCreateView,
    BarangayEventTodayView,
)
from apps.dashboard_views import OfficialDashboardSummaryView, ResidentDashboardSummaryView, ResponderDashboardSummaryView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/concerns/", include("apps.concerns.urls")),
    path("api/announcements/", AnnouncementListView.as_view(), name="announcement-list"),
    path("api/announcements/manage/", AnnouncementManageListCreateView.as_view(), name="announcement-manage"),
    path("api/announcements/manage/<int:pk>/", AnnouncementManageDetailView.as_view(), name="announcement-manage-detail"),
    path("api/barangay-events/today/", BarangayEventTodayView.as_view(), name="barangay-event-today"),
    path("api/barangay-events/manage/", BarangayEventManageListCreateView.as_view(), name="barangay-event-manage"),
    path("api/barangay-events/manage/<int:pk>/", BarangayEventManageDetailView.as_view(), name="barangay-event-manage-detail"),
    path("api/responders/active/", ActiveResponderListView.as_view(), name="active-responders"),
    path("api/emergencies/", include("apps.emergencies.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/dashboard/resident/summary/", ResidentDashboardSummaryView.as_view(), name="dashboard-resident-summary"),
    path("api/dashboard/official/summary/", OfficialDashboardSummaryView.as_view(), name="dashboard-official-summary"),
    path("api/dashboard/responder/summary/", ResponderDashboardSummaryView.as_view(), name="dashboard-responder-summary"),
]
