from django.urls import path

from .views import ConcernMediaPreviewView, ConcernMediaRawView

urlpatterns = [
    path("media/<int:pk>/raw/", ConcernMediaRawView.as_view(), name="concern-media-raw"),
    path("media/<int:pk>/preview/", ConcernMediaPreviewView.as_view(), name="concern-media-preview"),
]
