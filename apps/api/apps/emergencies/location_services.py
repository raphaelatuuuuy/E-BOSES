"""Turn an emergency's coordinates into something an official can read.

Strictly a post-dispatch concern. `resolve_alert_location` is scheduled with
`transaction.on_commit` after the alert is saved and `auto_route_alert` has
already picked a responder, because reverse geocoding calls an external service
and an emergency must never wait on the network for a street name.
"""

from __future__ import annotations

import logging
import re

from django.db import transaction

from apps.geo_services import (
    REVERSE_STATUS_FAILED,
    REVERSE_STATUS_SKIPPED,
    REVERSE_STATUS_SUCCESS,
    is_inside_barangay_boundary,
    point_is_in_acceptance_zone,
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
    # A forward-geocoded street/landmark is useful for routing and map display,
    # but it is an inferred point (often a road or POI centroid), not the
    # resident phone's GPS position. Keep that distinction visible.
    if alert.location_source == "sms_geocoded":
        community = getattr(alert, "community", None)
        boundary = getattr(community, "boundary", None)
        if boundary and boundary.geometry:
            from apps.geo_services import point_in_geojson_inclusive

            return (
                EmergencyAlert.LocationConfidence.REPORTED
                if point_in_geojson_inclusive(alert.longitude, alert.latitude, boundary.geometry)
                else EmergencyAlert.LocationConfidence.OUTSIDE_AREA
            )
        return EmergencyAlert.LocationConfidence.REPORTED
    community = getattr(alert, "community", None)
    boundary = getattr(community, "boundary", None)
    if community is None:
        return EmergencyAlert.LocationConfidence.UNKNOWN
    if boundary and boundary.geometry:
        from apps.geo_services import point_in_geojson_inclusive

        if point_in_geojson_inclusive(alert.longitude, alert.latitude, boundary.geometry):
            return EmergencyAlert.LocationConfidence.CONFIRMED
        # Inside the configured acceptance radius/shape but not the polygon: a
        # real accepted location, just not boundary-confirmed.
        return (
            EmergencyAlert.LocationConfidence.REPORTED
            if point_is_in_acceptance_zone(alert.latitude, alert.longitude, community)
            else EmergencyAlert.LocationConfidence.OUTSIDE_AREA
        )
    try:
        if not is_inside_barangay_boundary(alert.latitude, alert.longitude):
            return (
                EmergencyAlert.LocationConfidence.REPORTED
                if point_is_in_acceptance_zone(alert.latitude, alert.longitude, community)
                else EmergencyAlert.LocationConfidence.OUTSIDE_AREA
            )
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
        if (candidate or "").strip() and "pinned" not in candidate.lower():
            return candidate.strip()
    return "Pinned location · Address unavailable" if alert.latitude is not None and alert.longitude is not None else "Location needs confirmation"


# Values the SOS picker, the geocoder, and older records store when no street
# was ever resolved. Read back to a resident they look like an address, so they
# count as "no street yet".
_UNKNOWN_STREET_MARKERS = (
    "pinned location",
    "pinned coordinates",
    "sms fallback coordinates",
    "needs confirmation",
    "pending confirmation",
    "location pending",
    "location unavailable",
    "address unavailable",
    "selected location",
    "move the map",
    "unknown",
)
_COORDINATES_ONLY_RE = re.compile(r"^-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}$")
# "99 Champaca Street" -> "Champaca Street". The public wording names the street
# a neighbour has to avoid, never the house that reported the emergency.
_HOUSE_NUMBER_PREFIX_RE = re.compile(r"^\d+[A-Za-z]?(?:\s*[-/]\s*[\dA-Za-z]+)?\s+")
# "malapit sa Champaca Street" and "near Champaca Street" both already mean
# "near", which the sentence around the phrase says out loud.
_LEADING_NEAR_PHRASE_RE = re.compile(r"^(?:near|beside|malapit(?:\s+sa)?|sa)\s+", re.IGNORECASE)
# Nominatim, the offline street index, and the resident all mix the barangay and
# the city into the same string. Those segments name the area, not the street.
_AREA_ONLY_SEGMENTS = ("marikina heights", "marikina", "marikina city", "metro manila")


def _street_segment(value: str) -> str:
    """The street part of a stored location string, or "" when it is only an area."""
    text = str(value or "").strip()
    if not text or _COORDINATES_ONLY_RE.match(text):
        return ""
    lowered = text.casefold()
    if any(marker in lowered for marker in _UNKNOWN_STREET_MARKERS):
        return ""
    for part in text.split(","):
        segment = part.strip().strip(",").strip()
        if not segment or segment.casefold() in _AREA_ONLY_SEGMENTS:
            continue
        segment = _LEADING_NEAR_PHRASE_RE.sub("", segment)
        return _HOUSE_NUMBER_PREFIX_RE.sub("", segment).strip(" ,.")
    return ""


def alert_street_address(alert) -> str:
    """The street a community alert should name, or "" when none is known yet.

    A resident deciding whether to stay or leave needs a street; "near the
    area" only tells them what they already know. The candidates are ordered
    like ``display_location``: a geocoded street beats what the resident typed,
    and what the resident typed beats the pin the SOS picker stored. The
    barangay is deliberately not appended - neighbours reading the alert
    already know which barangay they are in, so the street is the whole answer.
    """
    for candidate in (
        getattr(alert, "canonical_street", ""),
        getattr(alert, "resolved_location", ""),
        getattr(alert, "reported_area", ""),
        getattr(alert, "address", ""),
    ):
        street = _street_segment(candidate)
        if street:
            return street
    return ""


def resolve_alert_location(alert_id: int) -> dict:
    """Reverse-geocode one alert and store the result.

    Idempotent: re-running it on an alert that already resolved is a no-op, so
    a Celery retry cannot overwrite a good street name with a failed lookup.
    """
    alert = EmergencyAlert.objects.filter(pk=alert_id).first()
    if not alert:
        return {"status": "missing"}

    if alert.reverse_geocoding_status == EmergencyAlert.ReverseGeocodingStatus.SUCCESS:
        _finish_sms_location_pipeline(alert)
        return {"status": "already_resolved", "location": alert.resolved_location}

    if alert.latitude is None or alert.longitude is None:
        alert.reverse_geocoding_status = EmergencyAlert.ReverseGeocodingStatus.SKIPPED
        alert.location_confidence = classify_location_confidence(alert)
        alert.save(update_fields=["reverse_geocoding_status", "location_confidence", "updated_at"])
        _finish_sms_location_pipeline(alert)
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
    _finish_sms_location_pipeline(alert)
    return {"status": result["status"], "location": alert.resolved_location}


def _finish_sms_location_pipeline(alert) -> None:
    """Publish an accepted SMS alert, then notify its active mapped unit."""
    if alert.reporter_verification == EmergencyAlert.ReporterVerification.ACCOUNT:
        return
    if alert.status == EmergencyAlert.Status.INVALID:
        return
    try:
        from apps.emergencies.sms_intake import _broadcast_created

        _broadcast_created(alert)
    except Exception:
        logger.debug("Could not broadcast SMS alert %s after location resolution.", alert.pk, exc_info=True)
    try:
        from apps.sms.notify import notify_active_unit

        notify_active_unit(alert)
    except Exception:
        logger.warning("Could not queue resolved-location unit SMS for alert %s.", alert.pk, exc_info=True)


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
