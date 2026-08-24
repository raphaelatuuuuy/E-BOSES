from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import timedelta

from django.utils import timezone

from apps.geo_services import active_communities_for_point, point_in_geojson_inclusive

from .models import Community, MapGeometry, MapServicePoi

RECENT_LOCATION_MINUTES = 15


def _key(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or "").casefold())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _community_payload(community):
    return {"id": community.pk, "name": community.name} if community else None


def _boundary_payload(community):
    boundary = getattr(community, "boundary", None)
    return boundary.geometry if boundary and boundary.is_active else None


def _geometry_points(geometry):
    stack = [(geometry or {}).get("coordinates") or []]
    while stack:
        item = stack.pop()
        if isinstance(item, (list, tuple)) and len(item) >= 2 and all(
            isinstance(value, (int, float)) for value in item[:2]
        ):
            yield float(item[0]), float(item[1])
        elif isinstance(item, (list, tuple)):
            stack.extend(item)


def _street_communities(street):
    communities = list(
        Community.objects.filter(status=Community.Status.ACTIVE, boundary__is_active=True)
        .select_related("boundary")
        .order_by("name")
    )
    locality = _key(street.locality)
    matched = []
    for community in communities:
        if locality and locality == _key(community.name):
            matched.append(community)
            continue
        if any(
            point_in_geojson_inclusive(lng, lat, community.boundary.geometry)
            for lng, lat in _geometry_points(street.geometry)
        ):
            matched.append(community)
    return matched


def _named_communities(text):
    key = _key(text)
    if not key:
        return []
    return [
        community
        for community in Community.objects.filter(status=Community.Status.ACTIVE)
        .select_related("boundary")
        .order_by("name")
        if _key(community.name) in key or _key(community.code) in key
    ]


def _matching_streets(text):
    key = _key(text)
    if not key:
        return []
    rows = MapGeometry.objects.filter(kind=MapGeometry.Kind.STREET, is_active=True).order_by("name", "id")
    return [row for row in rows if _key(row.name) and _key(row.name) in key]


def _landmark_communities(text):
    key = _key(text)
    if not key:
        return []
    communities = []
    for poi in MapServicePoi.objects.filter(is_active=True, community__status=Community.Status.ACTIVE).select_related("community"):
        if len(_key(poi.name)) >= 3 and _key(poi.name) in key and poi.community not in communities:
            communities.append(poi.community)
    return communities


@dataclass(frozen=True)
class LocationResolution:
    source: str = "none"
    freshness: str = "not_available"
    state: str = "unknown"
    community: object | None = None
    area_label: str = ""
    age_seconds: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    canonical_street: str = ""
    candidates: tuple = field(default_factory=tuple)
    reason: str = ""

    @property
    def has_destination(self):
        return self.latitude is not None and self.longitude is not None

    def payload(self):
        return {
            "source": self.source,
            "freshness": self.freshness,
            "state": self.state,
            "community": _community_payload(self.community),
            "area_label": self.area_label,
            "age_seconds": self.age_seconds,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "canonical_street": self.canonical_street,
            "candidate_communities": [_community_payload(item) for item in self.candidates],
            "boundary": _boundary_payload(self.community),
            "has_destination": self.has_destination,
            "reason": self.reason,
        }


def resolve_incident_location(*, latitude=None, longitude=None, message_area="", match=None, user=None):
    if latitude is not None and longitude is not None:
        lat, lng = float(latitude), float(longitude)
        communities = active_communities_for_point(lat, lng)
        if len(communities) == 1:
            community = communities[0]
            return LocationResolution(
                source="sms_gps" if match is not None else "web_gps",
                freshness="fresh",
                state="confirmed",
                community=community,
                area_label=message_area or community.name,
                latitude=lat,
                longitude=lng,
            )
        return LocationResolution(
            source="sms_gps" if match is not None else "web_gps",
            freshness="fresh",
            state="ambiguous" if communities else "unknown",
            area_label=message_area,
            latitude=lat,
            longitude=lng,
            candidates=tuple(communities),
            reason="overlapping_boundaries" if communities else "outside_active_community",
        )

    named = _named_communities(message_area)
    if len(named) == 1:
        community = named[0]
        streets = [street for street in _matching_streets(message_area) if community in _street_communities(street)]
        street = streets[0].name if len({item.name.casefold() for item in streets}) == 1 else ""
        return LocationResolution(
            source="message_area",
            freshness="not_available",
            state="fallback",
            community=community,
            area_label=street or message_area or community.name,
            canonical_street=street,
        )
    if len(named) > 1:
        return LocationResolution(
            source="message_area",
            freshness="not_available",
            state="ambiguous",
            area_label=message_area,
            candidates=tuple(named),
            reason="multiple_named_communities",
        )

    streets = _matching_streets(message_area)
    street_communities = []
    for street in streets:
        for community in _street_communities(street):
            if community not in street_communities:
                street_communities.append(community)
    if streets:
        landmark_communities = _landmark_communities(message_area)
        combined = [community for community in street_communities if community in landmark_communities]
        if len(combined) == 1:
            return LocationResolution(
                source="message_area",
                freshness="not_available",
                state="fallback",
                community=combined[0],
                area_label=message_area,
                canonical_street=streets[0].name if len({item.name.casefold() for item in streets}) == 1 else "",
            )
        return LocationResolution(
            source="message_area",
            freshness="not_available",
            state="ambiguous" if len(street_communities) > 1 else "unknown",
            area_label=message_area,
            canonical_street=streets[0].name if len({item.name.casefold() for item in streets}) == 1 else "",
            candidates=tuple(street_communities),
            reason="street_requires_community",
        )

    registered = bool(match and getattr(match, "is_registered", False) and getattr(match, "user", None))
    account = match.user if registered else user if match is None else None
    if account and (registered or match is None):
        settings_obj = getattr(account, "resident_settings", None)
        sharing = bool(
            getattr(account, "_simulation_location_sharing_enabled", None)
            if hasattr(account, "_simulation_location_sharing_enabled")
            else settings_obj and getattr(settings_obj, "location_sharing_enabled", False)
        )
        updated = getattr(account, "location_updated_at", None)
        age = max(0, int((timezone.now() - updated).total_seconds())) if updated else None
        has_point = account.current_latitude is not None and account.current_longitude is not None
        if sharing and has_point and age is not None and age <= RECENT_LOCATION_MINUTES * 60:
            communities = active_communities_for_point(account.current_latitude, account.current_longitude)
            if len(communities) == 1:
                return LocationResolution(
                    source="recent_account_location",
                    freshness="fresh",
                    state="fallback",
                    community=communities[0],
                    area_label=communities[0].name,
                    age_seconds=age,
                    latitude=float(account.current_latitude),
                    longitude=float(account.current_longitude),
                )
            if len(communities) > 1:
                return LocationResolution(
                    source="recent_account_location",
                    freshness="fresh",
                    state="ambiguous",
                    age_seconds=age,
                    candidates=tuple(communities),
                    reason="overlapping_boundaries",
                )

        profile = getattr(account, "resident_profile", None)
        community = getattr(profile, "community", None)
        if community and community.status == Community.Status.ACTIVE:
            return LocationResolution(
                source="profile_community",
                freshness="stale" if has_point and age is not None else "not_available",
                state="fallback",
                community=community,
                area_label=community.name,
                age_seconds=age if has_point else None,
                reason="exact_incident_location_needed",
            )
        home_matches = _named_communities(getattr(profile, "barangay", "")) if profile else []
        if not home_matches and profile and profile.home_latitude is not None and profile.home_longitude is not None:
            home_matches = active_communities_for_point(profile.home_latitude, profile.home_longitude)
        if len(home_matches) == 1:
            return LocationResolution(
                source="home_context",
                freshness="not_available",
                state="fallback",
                community=home_matches[0],
                area_label=home_matches[0].name,
                reason="exact_incident_location_needed",
            )

    return LocationResolution(area_label=message_area, reason="manual_dispatch_required")
