"""Concerns views for E-Boses."""

from rest_framework import permissions, viewsets

from apps.ai_validation.tasks import enqueue_concern_validation

from .models import Category, Concern
from .serializers import CategorySerializer, ConcernSerializer


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Category.objects.filter(is_active=True)
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticated]


class ConcernViewSet(viewsets.ModelViewSet):
    queryset = Concern.objects.select_related("category", "reviewer_category", "reviewer").prefetch_related("media")
    serializer_class = ConcernSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        concern = serializer.save(reporter=self.request.user)
        enqueue_concern_validation(concern.id)
