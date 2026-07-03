"""Query helpers for concern list/detail endpoints."""

from .models import Category, Concern


def active_category_queryset():
    """Return active concern categories for API dropdowns."""
    return Category.objects.filter(is_active=True)


def concern_queryset():
    """Return the default concern queryset with related review data preloaded."""
    return Concern.objects.select_related("category", "reviewer_category", "reviewer").prefetch_related("media")


def concern_list_queryset(base_queryset=None, *, status=None, category=None):
    """Apply common concern filters to a base queryset."""
    queryset = concern_queryset() if base_queryset is None else base_queryset
    if status:
        queryset = queryset.filter(status=status)
    if category:
        queryset = queryset.filter(category=category)
    return queryset
