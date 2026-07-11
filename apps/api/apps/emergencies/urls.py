from django.urls import path

from .views import (
    EmergencyAcknowledgeView,
    EmergencyAppealCreateView,
    EmergencyAppealListView,
    EmergencyAppealReviewView,
    EmergencyArrivedView,
    EmergencyAssignView,
    EmergencyCancelView,
    EmergencyCreateView,
    EmergencyDetailView,
    EmergencyDutyView,
    EmergencyEscalateOverdueView,
    EmergencyQueueView,
    EmergencyLocationPingView,
    EmergencyResolveView,
    MyAssignedEmergencyView,
    MyActiveEmergencyView,
)

urlpatterns = [
    path("", EmergencyCreateView.as_view(), name="emergency-create"),
    path("mine/active/", MyActiveEmergencyView.as_view(), name="emergency-mine-active"),
    path("queue/", EmergencyQueueView.as_view(), name="emergency-queue"),
    path("appeals/", EmergencyAppealListView.as_view(), name="emergency-appeal-list"),
    path("appeals/<int:appeal_id>/review/", EmergencyAppealReviewView.as_view(), name="emergency-appeal-review"),
    path("escalate-overdue/", EmergencyEscalateOverdueView.as_view(), name="emergency-escalate-overdue"),
    path("assigned/", MyAssignedEmergencyView.as_view(), name="emergency-assigned"),
    path("duty/", EmergencyDutyView.as_view(), name="emergency-duty"),
    path("<int:pk>/", EmergencyDetailView.as_view(), name="emergency-detail"),
    path("<int:pk>/assign/", EmergencyAssignView.as_view(), name="emergency-assign"),
    path("<int:pk>/appeals/", EmergencyAppealCreateView.as_view(), name="emergency-appeal-create"),
    path("<int:pk>/cancel/", EmergencyCancelView.as_view(), name="emergency-cancel"),
    path("<int:pk>/location-pings/", EmergencyLocationPingView.as_view(), name="emergency-location-ping"),
    path("<int:pk>/acknowledge/", EmergencyAcknowledgeView.as_view(), name="emergency-acknowledge"),
    path("<int:pk>/arrived/", EmergencyArrivedView.as_view(), name="emergency-arrived"),
    path("<int:pk>/resolve/", EmergencyResolveView.as_view(), name="emergency-resolve"),
]
