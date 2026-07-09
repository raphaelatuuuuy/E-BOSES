from django.urls import path

from .views import (
    ConcernCommentCreateView,
    ConcernDetailView,
    ConcernFeedView,
    ConcernListCreateView,
    ConcernMediaPreviewView,
    ConcernMediaRawView,
    ConcernStatusUpdateView,
    ConcernSummaryView,
    ConcernVoteView,
    ContentFlagCreateView,
    ContentFlagListView,
    ManagedConcernListView,
    MyConcernListView,
)

urlpatterns = [
    path("", ConcernListCreateView.as_view(), name="concern-create"),
    path("mine/", MyConcernListView.as_view(), name="concern-mine"),
    path("manage/", ManagedConcernListView.as_view(), name="concern-manage"),
    path("flags/", ContentFlagListView.as_view(), name="content-flag-list"),
    path("feed/", ConcernFeedView.as_view(), name="concern-feed"),
    path("summary/", ConcernSummaryView.as_view(), name="concern-summary"),
    path("<int:pk>/", ConcernDetailView.as_view(), name="concern-detail"),
    path("<int:pk>/status/", ConcernStatusUpdateView.as_view(), name="concern-status-update"),
    path("<int:pk>/vote/", ConcernVoteView.as_view(), name="concern-vote"),
    path("<int:pk>/comments/", ConcernCommentCreateView.as_view(), name="concern-comment-create"),
    path("<int:pk>/flags/", ContentFlagCreateView.as_view(), name="content-flag-create"),
    path("media/<int:pk>/raw/", ConcernMediaRawView.as_view(), name="concern-media-raw"),
    path("media/<int:pk>/preview/", ConcernMediaPreviewView.as_view(), name="concern-media-preview"),
]
