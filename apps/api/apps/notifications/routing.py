"""
WebSocket routing for E-Boses notifications.

Planned channels:
    - notifications/{user_id} — Real-time notification stream
    - emergencies/{barangay}  — Emergency alert broadcasts
"""

from django.urls import path

from .consumers import (
    ConcernTrackingConsumer,
    EmergencyTrackingConsumer,
    NotificationConsumer,
    OfficialLiveMapConsumer,
    ResidentLiveMapConsumer,
    VerificationQueueConsumer,
)


websocket_urlpatterns = [
    path("ws/notifications/", NotificationConsumer.as_asgi()),
    path("ws/emergencies/<int:alert_id>/tracking/", EmergencyTrackingConsumer.as_asgi()),
    path("ws/concerns/<int:concern_id>/tracking/", ConcernTrackingConsumer.as_asgi()),
    path("ws/dashboard/live-map/", OfficialLiveMapConsumer.as_asgi()),
    path("ws/dashboard/resident-live-map/", ResidentLiveMapConsumer.as_asgi()),
    path("ws/ocr/verification-queue/", VerificationQueueConsumer.as_asgi()),
]
