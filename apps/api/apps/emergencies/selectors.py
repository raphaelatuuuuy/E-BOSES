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


def active_responder_shift_for_update(responder):
    """Return and lock a responder's active shift for account administration."""
    from .models import ResponderShift

    return (
        ResponderShift.objects.select_for_update()
        .filter(responder=responder, status=ResponderShift.Status.ACTIVE)
        .order_by("-started_at", "-id")
        .first()
    )
