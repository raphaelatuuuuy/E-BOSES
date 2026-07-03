"""Concerns views for E-Boses."""

from rest_framework import permissions, viewsets

from .selectors import active_category_queryset, concern_list_queryset
from .serializers import CategorySerializer, ConcernSerializer
from .services import create_concern


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return active_category_queryset()


class ConcernViewSet(viewsets.ModelViewSet):
    serializer_class = ConcernSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return concern_list_queryset(
            status=self.request.query_params.get("status"),
            category=self.request.query_params.get("category"),
        )

    def perform_create(self, serializer):
        create_concern(reporter=self.request.user, validated_data=serializer.validated_data)
