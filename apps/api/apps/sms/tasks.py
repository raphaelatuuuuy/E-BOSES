from celery import shared_task


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=20,
    time_limit=60,
    soft_time_limit=45,
)
def send_outbound_sms_task(self, message_id, destination, body):
    """Deliver one queued SMS, retrying transient gateway failures.

    Arguments carry the destination and body rather than reading them back from
    the row, because OTP bodies are deliberately not persisted.
    """
    from .gateway import SmsDeliveryError, deliver

    try:
        return deliver(message_id, destination, body)
    except SmsDeliveryError as exc:
        raise self.retry(exc=exc) from exc


@shared_task(time_limit=120, soft_time_limit=90)
def reverse_geocode_alert_task(alert_id):
    """Resolve an alert's coordinates to a readable area after dispatch.

    Deliberately a separate task: reverse geocoding calls an external service
    and must never sit between a resident pressing SOS and a responder being
    assigned.
    """
    from apps.emergencies.location_services import resolve_alert_location

    return resolve_alert_location(alert_id)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=5,
    time_limit=45,
    soft_time_limit=30,
)
def sms_ai_assist_task(self, alert_id):
    """One AI pass on an SMS alert the parser could not fully read.

    Runs after the alert is saved, routed and acknowledged, so a slow or
    failing model call can never delay dispatch. A timeout gets one retry;
    anything else is recorded in the alert's ``ai_assist`` field and dropped.
    """
    from apps.emergencies.models import EmergencyAlert

    from .ai_assist import run_rescue

    alert = EmergencyAlert.objects.filter(pk=alert_id).first()
    if not alert:
        return None
    try:
        result = run_rescue(alert, propagate_timeout=True)
        # Rebuild prose using the corrected category and location. This task
        # runs after dispatch and does not send an SMS.
        from apps.emergencies.tasks import enqueue_emergency_description

        enqueue_emergency_description(alert_id)
        return result
    except TimeoutError as exc:
        raise self.retry(exc=exc) from exc


@shared_task(time_limit=90, soft_time_limit=75)
def recover_stuck_inbound_sms_task():
    """Replay only recent orphaned inbound rows; expire old rows safely."""
    from .router import recover_stuck_inbound_messages

    return recover_stuck_inbound_messages()
