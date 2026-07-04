from django.urls import path

from .views import (
    ConcernCommentCreateView,
    ConcernDetailView,
    ConcernFeedView,
    ConcernListCreateView,
    ConcernMediaPreviewView,
    ConcernMediaRawView,
    ConcernSummaryView,
    ConcernVoteView,
    MyConcernListView,
)

urlpatterns = [
    path("", ConcernListCreateView.as_view(), name="concern-create"),
    path("mine/", MyConcernListView.as_view(), name="concern-mine"),
    path("feed/", ConcernFeedView.as_view(), name="concern-feed"),
    path("summary/", ConcernSummaryView.as_view(), name="concern-summary"),
    path("<int:pk>/", ConcernDetailView.as_view(), name="concern-detail"),
    path("<int:pk>/vote/", ConcernVoteView.as_view(), name="concern-vote"),
    path("<int:pk>/comments/", ConcernCommentCreateView.as_view(), name="concern-comment-create"),
    path("media/<int:pk>/raw/", ConcernMediaRawView.as_view(), name="concern-media-raw"),
    path("media/<int:pk>/preview/", ConcernMediaPreviewView.as_view(), name="concern-media-preview"),
]
