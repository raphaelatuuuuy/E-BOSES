"""Turn an emergency's coordinates into something an official can read.

Strictly a post-dispatch concern. `resolve_alert_location` is scheduled with
`transaction.on_commit` after the alert is saved and `auto_route_alert` has
already picked a responder, because reverse geocoding calls an external service
and an emergency must never wait on the network for a street name.
"""

from __future__ import annotations

import logging

from django.db import transaction

from apps.geo_services import (
    REVERSE_STATUS_FAILED,
    REVERSE_STATUS_SKIPPED,
    REVERSE_STATUS_SUCCESS,
    is_inside_barangay_boundary,
    reverse_geocode,
)

from .models import EmergencyAlert

logger = logging.getLogger(__name__)


def classify_location_confidence(alert) -> str:
    """How much the stored location can be trusted, for the dashboard badge."""
    if alert.latitude is None or alert.longitude is None:
        return (
            EmergencyAlert.LocationConfidence.REPORTED
            if (alert.reported_area or "").strip()
            else EmergencyAlert.LocationConfidence.UNKNOWN
        )
    try:
        if not is_inside_barangay_boundary(alert.latitude, alert.longitude):
            return EmergencyAlert.LocationConfidence.OUTSIDE_AREA
    except Exception:
        logger.warning("Boundary check failed for alert %s; treating as confirmed.", alert.pk)
    return EmergencyAlert.LocationConfidence.CONFIRMED


def display_location(alert) -> str:
    """The one location string officials and SMS replies should use.

    Order matters: a geocoded street beats what the resident typed, what the
    resident typed beats a stored address, and anything beats a bare barangay
    name. Raw coordinates are never part of this string.
    """
    for candidate in (
        alert.resolved_location,
        alert.reported_area,
        alert.address,
        alert.barangay,
    ):
        if (candidate or "").strip():
            return candidate.strip()
    return "Location needs confirmation"


def resolve_alert_location(alert_id: int) -> dict:
    """Reverse-geocode one alert and store the result.

    Idempotent: re-running it on an alert that already resolved is a no-op, so
    a Celery retry cannot overwrite a good street name with a failed lookup.
    """
    alert = EmergencyAlert.objects.filter(pk=alert_id).first()
    if not alert:
        return {"status": "missing"}

    if alert.reverse_geocoding_status == EmergencyAlert.ReverseGeocodingStatus.SUCCESS:
        return {"status": "already_resolved", "location": alert.resolved_location}

    if alert.latitude is None or alert.longitude is None:
        alert.reverse_geocoding_status = EmergencyAlert.ReverseGeocodingStatus.SKIPPED
        alert.location_confidence = classify_location_confidence(alert)
        alert.save(update_fields=["reverse_geocoding_status", "location_confidence", "updated_at"])
        return {"status": REVERSE_STATUS_SKIPPED, "location": ""}

    result = reverse_geocode(alert.latitude, alert.longitude)
    status_map = {
        REVERSE_STATUS_SUCCESS: EmergencyAlert.ReverseGeocodingStatus.SUCCESS,
        REVERSE_STATUS_FAILED: EmergencyAlert.ReverseGeocodingStatus.FAILED,
        REVERSE_STATUS_SKIPPED: EmergencyAlert.ReverseGeocodingStatus.SKIPPED,
    }
    alert.reverse_geocoding_status = status_map.get(
        result["status"], EmergencyAlert.ReverseGeocodingStatus.FAILED
    )
    if result["location"]:
        alert.resolved_location = result["location"]
        # Fill `address` when empty or generic — never silently replace a real
        # street the resident typed or confirmed on the map.
        _GENERIC = {"", "sms fallback coordinates", "pinned location on map", "marikina heights"}
        if (alert.address or "").strip().lower() in _GENERIC or "pinned location" in (alert.address or "").lower():
            alert.address = result["location"]
    alert.location_confidence = classify_location_confidence(alert)
    alert.save(
        update_fields=[
            "resolved_location",
            "address",
            "reverse_geocoding_status",
            "location_confidence",
            "updated_at",
        ]
    )

    _broadcast_location_update(alert)
    return {"status": result["status"], "location": alert.resolved_location}


def _broadcast_location_update(alert) -> None:
    """Push the resolved street to any dashboard already showing this alert."""
    try:
        from apps.live_map import emergency_payload
        from apps.notifications.services import broadcast_live_map_event

        broadcast_live_map_event("emergency.updated", {"emergency": emergency_payload(alert)})
    except Exception:
        logger.debug("Could not broadcast resolved location for alert %s.", alert.pk, exc_info=True)


def schedule_location_resolution(alert) -> None:
    """Queue reverse geocoding for after the current transaction commits."""
    alert_id = alert.pk

    def _enqueue():
        from apps.sms.tasks import reverse_geocode_alert_task

        try:
            reverse_geocode_alert_task.delay(alert_id)
        except Exception:
            # No broker available (local dev, tests). Resolve inline; the alert
            # is already saved and routed, so this only delays the street name.
            logger.info("Celery unavailable; resolving location inline for alert %s.", alert_id)
            try:
                resolve_alert_location(alert_id)
            except Exception:
                logger.warning("Inline location resolution failed for alert %s.", alert_id, exc_info=True)

    transaction.on_commit(_enqueue)
