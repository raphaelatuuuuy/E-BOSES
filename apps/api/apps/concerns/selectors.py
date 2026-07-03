"""Query helpers for concern list/detail endpoints."""


def concern_list_queryset(base_queryset, *, status=None, category=None, barangay=None):
    """Apply common concern filters to a base queryset."""
    queryset = base_queryset
    if status:
        queryset = queryset.filter(status=status)
    if category:
        queryset = queryset.filter(category=category)
    if barangay:
        queryset = queryset.filter(barangay=barangay)
    return queryset
