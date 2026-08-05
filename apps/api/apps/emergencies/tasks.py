from celery import shared_task


@shared_task(time_limit=60, soft_time_limit=45)
def escalate_overdue_emergencies_task(minutes=None):
    """Sweep for unacknowledged assignments.

    The deadline comes from each emergency's routing rule; `minutes` is only a
    floor for callers that want a coarser sweep.
    """
    from .views import escalate_overdue_assignments

    escalations = escalate_overdue_assignments(minutes=minutes)
    return {"escalated": len(escalations), "minutes": minutes}
