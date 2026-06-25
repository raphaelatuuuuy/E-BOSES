"""
E-Boses API — URL Configuration.
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

api_prefix = "api/v1/"

urlpatterns = [
    path("admin/", admin.site.urls),
    path(f"{api_prefix}auth/", include("modules.accounts.urls")),
    path(f"{api_prefix}barangays/", include("modules.barangays.urls")),
    path(f"{api_prefix}concerns/", include("modules.concerns.urls")),
    path(f"{api_prefix}emergencies/", include("modules.emergencies.urls")),
    path(f"{api_prefix}notifications/", include("modules.notifications.urls")),
    path(f"{api_prefix}audit/", include("modules.audit.urls")),
    path(f"{api_prefix}ai/", include("modules.ai.urls")),
    path(f"{api_prefix}", include("modules.common.urls")),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
