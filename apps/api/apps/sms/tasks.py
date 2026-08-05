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
