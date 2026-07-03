"""Concern API routes."""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, ConcernViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="concern-category")
router.register("", ConcernViewSet, basename="concern")

urlpatterns = [path("", include(router.urls))]
