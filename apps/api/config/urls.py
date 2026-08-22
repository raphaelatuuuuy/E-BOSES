"""
URL configuration for the E-Boses API backend.
"""

from django.contrib import admin
from django.urls import include, path
from config.health import health_check
from apps.concerns.community_api import (
    AnnouncementAreaContextView,
    AnnouncementCommentDetailView,
    AnnouncementCommentFlagCreateView,
    AnnouncementCommentListCreateView,
    BarangayEventCalendarView,
)
from apps.concerns.views import (
    ActiveResponderListView,
    AnnouncementListView,
    AnnouncementManageDetailView,
    AnnouncementManageListCreateView,
    BarangayEventManageDetailView,
    BarangayEventManageListCreateView,
    BarangayEventTodayView,
)
from apps.config_summary import ConfigurationSummaryView
from apps.concerns.system_api import (
    SystemBannerDetailView,
    SystemBannerManageView,
    SystemStatusView,
)
from apps.audit_log import AuditLogView
from apps.emergencies.public_api import (
    PublicCommunitiesView,
    PublicCommunityBoundaryView,
    PublicCommunityRequestView,
)
from apps.emergencies.views import (
    ActiveCommunityBoundariesView,
    BoundaryDetailView,
    BoundarySearchView,
)
from apps.service_status import ResendHealthWebhookView, ServiceStatusView, WeatherHealthReportView
from apps.dashboard_views import OfficialDashboardSummaryView, ResidentDashboardSummaryView, ResponderDashboardSummaryView
from apps.live_map import (
    GeocodeReverseView,
    GeocodeSearchView,
    LocationMapContextView,
    LocationPingView,
    LocationSearchView,
    LocationValidateView,
    OfficialLiveMapView,
    ResidentAlertsMapView,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/assistant/", include("apps.assistant.urls")),
    path("api/concerns/", include("apps.concerns.urls")),
    path("api/announcements/", AnnouncementListView.as_view(), name="announcement-list"),
    path("api/announcements/area-context/", AnnouncementAreaContextView.as_view(), name="announcement-area-context"),
    path(
        "api/announcements/<int:announcement_id>/comments/",
        AnnouncementCommentListCreateView.as_view(),
        name="announcement-comments",
    ),
    path(
        "api/announcements/<int:announcement_id>/comments/<int:comment_id>/",
        AnnouncementCommentDetailView.as_view(),
        name="announcement-comment-detail",
    ),
    path(
        "api/announcements/comments/<int:comment_id>/flags/",
        AnnouncementCommentFlagCreateView.as_view(),
        name="announcement-comment-flag-create",
    ),
    path("api/barangay-events/calendar/", BarangayEventCalendarView.as_view(), name="barangay-event-calendar"),
    path("api/announcements/manage/", AnnouncementManageListCreateView.as_view(), name="announcement-manage"),
    path("api/announcements/manage/<int:pk>/", AnnouncementManageDetailView.as_view(), name="announcement-manage-detail"),
    path("api/barangay-events/today/", BarangayEventTodayView.as_view(), name="barangay-event-today"),
    path("api/barangay-events/manage/", BarangayEventManageListCreateView.as_view(), name="barangay-event-manage"),
    path("api/barangay-events/manage/<int:pk>/", BarangayEventManageDetailView.as_view(), name="barangay-event-manage-detail"),
    path("api/responders/active/", ActiveResponderListView.as_view(), name="active-responders"),
    path("api/config/summary/", ConfigurationSummaryView.as_view(), name="config-summary"),
    path("api/config/service-status/", ServiceStatusView.as_view(), name="config-service-status"),
    path("api/config/audit-log/", AuditLogView.as_view(), name="config-audit-log"),
    path("api/config/weather-health/", WeatherHealthReportView.as_view(), name="config-weather-health"),
    path("api/config/resend-health/", ResendHealthWebhookView.as_view(), name="config-resend-health"),
    path("api/system/status/", SystemStatusView.as_view(), name="system-status"),
    path("api/system/banners/", SystemBannerManageView.as_view(), name="system-banners"),
    path("api/system/banners/<int:pk>/", SystemBannerDetailView.as_view(), name="system-banner-detail"),
    path("api/emergencies/", include("apps.emergencies.urls")),
    path("api/sms/", include("apps.sms.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/dashboard/resident/summary/", ResidentDashboardSummaryView.as_view(), name="dashboard-resident-summary"),
    path("api/dashboard/official/summary/", OfficialDashboardSummaryView.as_view(), name="dashboard-official-summary"),
    path("api/dashboard/official/live-map/", OfficialLiveMapView.as_view(), name="dashboard-official-live-map"),
    path("api/dashboard/responder/summary/", ResponderDashboardSummaryView.as_view(), name="dashboard-responder-summary"),
    path("api/locations/ping/", LocationPingView.as_view(), name="location-ping"),
    path("api/locations/map-context/", LocationMapContextView.as_view(), name="location-map-context"),
    path("api/locations/validate/", LocationValidateView.as_view(), name="location-validate"),
    path("api/locations/search/", LocationSearchView.as_view(), name="location-search"),
    path("api/locations/geocode/reverse/", GeocodeReverseView.as_view(), name="geocode-reverse"),
    path("api/locations/geocode/search/", GeocodeSearchView.as_view(), name="geocode-search"),
    path("api/locations/resident-alerts-map/", ResidentAlertsMapView.as_view(), name="locations-resident-alerts-map"),
    # Barangay outlines are geography, not an emergency concern — the view
    # lives in the emergencies app only because the coverage policy does.
    path("api/locations/boundaries/", BoundarySearchView.as_view(), name="location-boundaries"),
    path("api/locations/boundaries/<int:pk>/", BoundaryDetailView.as_view(), name="location-boundary-detail"),
    path("api/locations/active-communities/", ActiveCommunityBoundariesView.as_view(), name="location-active-communities"),
    path("api/public/communities/", PublicCommunitiesView.as_view(), name="public-communities"),
    path(
        "api/public/communities/<int:pk>/boundary/",
        PublicCommunityBoundaryView.as_view(),
        name="public-community-boundary",
    ),
    path("api/public/community-requests/", PublicCommunityRequestView.as_view(), name="public-community-requests"),
]
