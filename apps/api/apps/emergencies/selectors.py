"""Query helpers for emergency list/detail endpoints."""


def emergency_alert_queryset(base_queryset, *, status=None, severity=None, barangay=None):
    queryset = base_queryset
    if status:
        queryset = queryset.filter(status=status)
    if severity:
        queryset = queryset.filter(severity=severity)
    if barangay:
        queryset = queryset.filter(barangay=barangay)
    return queryset
