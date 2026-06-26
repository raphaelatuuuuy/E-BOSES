"""
URL configuration for the E-Boses API backend.
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/concerns/", include("apps.concerns.urls")),
    path("api/emergencies/", include("apps.emergencies.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
]
