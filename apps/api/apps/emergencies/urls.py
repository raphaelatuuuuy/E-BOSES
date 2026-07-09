from django.urls import path

from .views import (
    EmergencyAcknowledgeView,
    EmergencyArrivedView,
    EmergencyAssignView,
    EmergencyCancelView,
    EmergencyCreateView,
    EmergencyDetailView,
    EmergencyDutyView,
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
    path("assigned/", MyAssignedEmergencyView.as_view(), name="emergency-assigned"),
    path("duty/", EmergencyDutyView.as_view(), name="emergency-duty"),
    path("<int:pk>/", EmergencyDetailView.as_view(), name="emergency-detail"),
    path("<int:pk>/assign/", EmergencyAssignView.as_view(), name="emergency-assign"),
    path("<int:pk>/cancel/", EmergencyCancelView.as_view(), name="emergency-cancel"),
    path("<int:pk>/location-pings/", EmergencyLocationPingView.as_view(), name="emergency-location-ping"),
    path("<int:pk>/acknowledge/", EmergencyAcknowledgeView.as_view(), name="emergency-acknowledge"),
    path("<int:pk>/arrived/", EmergencyArrivedView.as_view(), name="emergency-arrived"),
    path("<int:pk>/resolve/", EmergencyResolveView.as_view(), name="emergency-resolve"),
]
