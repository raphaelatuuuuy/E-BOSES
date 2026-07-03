"""Query helpers for notification endpoints."""


def notification_queryset(base_queryset, *, recipient=None, unread_only=False, notification_type=None):
    queryset = base_queryset
    if recipient is not None:
        queryset = queryset.filter(recipient=recipient)
    if unread_only:
        queryset = queryset.filter(read_at__isnull=True)
    if notification_type:
        queryset = queryset.filter(type=notification_type)
    return queryset
