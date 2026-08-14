from django.urls import path

from .views import AssistantAskView, AssistantTopicsView

urlpatterns = [
    path("topics/", AssistantTopicsView.as_view(), name="assistant-topics"),
    path("ask/", AssistantAskView.as_view(), name="assistant-ask"),
]
