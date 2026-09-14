from decimal import Decimal

import httpx
from datetime import timedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from apps.throttling import LocalScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.services import validate_location_pair
from apps.accounts.views import touch_last_seen
from apps.community_scope import PRIMARY_COMMUNITY_CODE
from apps.concerns.models import Announcement, Concern
from apps.emergencies.models import (
    EmergencyAlert,
    EmergencyCategory,
    EmergencyResponderAssignment,
    MapGeometry,
)
from apps.media_urls import concern_media_preview_url, emergency_media_preview_url
from apps.notifications.services import broadcast_live_map_event

NETWORK_FALLBACK_CENTER = {"latitude": 14.5995, "longitude": 120.9842, "zoom": 12}

MAP_CONCERN_LIMIT = 300
GPS_FIX_MAX_AGE_MS = 60_000
GPS_CLOCK_SKEW_MS = 5_000

CONCERN_ACTIVE = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.IN_PROGRESS,
    Concern.Status.APPEALED,
}

def validate_client_gps_timestamp(timestamp):
    if timestamp is None:
        return
    age_ms = timezone.now().timestamp() * 1000 - float(timestamp)
    if age_ms > GPS_FIX_MAX_AGE_MS or age_ms < -GPS_CLOCK_SKEW_MS:
        raise DjangoValidationError("The GPS fix is stale. Request a new fix.")

def _emergency_active_statuses():
    """Single source of truth, so a new status cannot silently drop pins.

    This set used to be duplicated here; when statuses were added the map
    started treating live emergencies as closed and hiding them.
    """
    from apps.emergencies.views import ACTIVE_STATUSES

    return ACTIVE_STATUSES


class _LazyActiveStatuses:
    def __iter__(self):
        return iter(_emergency_active_statuses())

    def __contains__(self, value):
        return value in _emergency_active_statuses()


EMERGENCY_ACTIVE = _LazyActiveStatuses()

SETTLED_EMERGENCY_STATUSES = {
    EmergencyAlert.Status.RESOLVED,
    EmergencyAlert.Status.CLOSED,
    EmergencyAlert.Status.CANCELLED,
    EmergencyAlert.Status.FALSE_ALARM,
    EmergencyAlert.Status.INVALID,
}

ACTIVE_ASSIGNMENT_STATUSES = {
    EmergencyResponderAssignment.Status.ASSIGNED,
    EmergencyResponderAssignment.Status.ACKNOWLEDGED,
    EmergencyResponderAssignment.Status.EN_ROUTE,
    EmergencyResponderAssignment.Status.ARRIVED,
    EmergencyResponderAssignment.Status.ASSISTING,
}

SETTLED_ASSIGNMENT_STATUSES = {
    EmergencyResponderAssignment.Status.RESOLVED,
    EmergencyResponderAssignment.Status.CANCELLED,
}

STREET_CATALOG = [
    {"name": "10th Avenue"}, {"name": "11th Avenue"}, {"name": "2nd Street"}, {"name": "3rd Street"},
    {"name": "4th Street"}, {"name": "5th Avenue"}, {"name": "8th Avenue"}, {"name": "9th Avenue"},
    {"name": "Aba Street"}, {"name": "Apitong Street"}, {"name": "Aquarius Street"}, {"name": "Ariane Road"},
    {"name": "Bamboo Palm Street"}, {"name": "Bayan-Bayanan Avenue", "type": "secondary"}, {"name": "Bayan-Bayanan Extension"},
    {"name": "Betel Nut Street"}, {"name": "Bethlehem Street"}, {"name": "Big Bird Street"}, {"name": "Bob White Street"},
    {"name": "Bonanza Street", "type": "tertiary"}, {"name": "Bougainvillea Lane"}, {"name": "Branding Iron Street"}, {"name": "Buffallo Street"},
    {"name": "Cacharel Street"}, {"name": "Capricorn Street"}, {"name": "Champagnat Street", "type": "tertiary"},
    {"name": "Coco Palm Street"}, {"name": "Colt Street"}, {"name": "Corral Street"},
    {"name": "Dao Street"}, {"name": "Date Palm Street"}, {"name": "Daylight Street"}, {"name": "Diamond Street"},
    {"name": "E. Rodriguez Street", "type": "service"}, {"name": "East Drive Street", "type": "tertiary"}, {"name": "Emerald Street"},
    {"name": "F. Balagtas Street", "type": "secondary"}, {"name": "Fall Street"}, {"name": "Fatima Lane Street"},
    {"name": "G. del Pilar Street", "type": "tertiary"}, {"name": "Gardenia Drive"}, {"name": "Gardenia Lane"}, {"name": "Gemini Street"},
    {"name": "General B. G. Molina Street", "type": "tertiary"}, {"name": "General Meñez Street"}, {"name": "General Ordoñez Street", "type": "secondary"},
    {"name": "Givenchy Street"}, {"name": "Gomez Street"}, {"name": "Gucci Street"},
    {"name": "Halston Street"}, {"name": "Hereford Street"}, {"name": "Hornbill Street"},
    {"name": "Ipil Street"}, {"name": "Ivory Palm Street"},
    {"name": "J. J. Carlos Circle"}, {"name": "J. Molina Street", "type": "tertiary"}, {"name": "Jade Street"}, {"name": "Jasmin Street"}, {"name": "Jerusalem Street"},
    {"name": "Kaginhawahan Street"}, {"name": "Kapayapaan Street"}, {"name": "Kasaganaan Street"}, {"name": "Katarungan Street"}, {"name": "Katipunan Street", "type": "tertiary"},
    {"name": "Ladislao Diwa Street"}, {"name": "Lakandula Extension"}, {"name": "Lakandula Street"}, {"name": "Lauren Street"}, {"name": "Leo Street"},
    {"name": "Libra Street"}, {"name": "Liwasang Kalayaan Street", "type": "tertiary"}, {"name": "Long Horn Street"}, {"name": "Lope K. Santos Street", "type": "tertiary"},
    {"name": "Lopez Jaena Street"}, {"name": "Lourdes Drive Street"}, {"name": "Lourdes Street"}, {"name": "Lower Paraiso", "type": "service"},
    {"name": "M. L. Quezon Street"}, {"name": "M. Tuazon Street"}, {"name": "Mañacop Street"}, {"name": "Malipajo Street"}, {"name": "Mansanas Street"},
    {"name": "Mansanitas Street"}, {"name": "Merino Street"}, {"name": "Mohair Street"}, {"name": "Mohawk Street"}, {"name": "Monserrat Hill Street"},
    {"name": "N. Sevilla Street", "type": "tertiary"}, {"name": "Narra Street", "type": "tertiary"}, {"name": "Northwest Street"},
    {"name": "Opal Street"},
    {"name": "P. Burgos Street"}, {"name": "P. Lopez Street"}, {"name": "P. Paterno Street"}, {"name": "P. Valenzuela Street"}, {"name": "Paddock Street"},
    {"name": "Padre Gomez Street"}, {"name": "Palm Drive"}, {"name": "Palomino Street"}, {"name": "Paraiso Street", "type": "tertiary"}, {"name": "Pisces Street"},
    {"name": "Pony Street"}, {"name": "Puffin Street"}, {"name": "Queen Palm Street"},
    {"name": "R. Magsaysay Street"}, {"name": "Rajah Matanda Street"}, {"name": "Ramdale Homes", "type": "service"}, {"name": "Rancho Avenue"},
    {"name": "Remuda Street"}, {"name": "Rodeanna Ⅲ Street"}, {"name": "Rodeo Street"}, {"name": "Royal Palm Street"}, {"name": "Ruby Street"},
    {"name": "Saguittarius Street"}, {"name": "Saint Joseph Street"}, {"name": "Saint Jude Street"}, {"name": "Sampaguita Lane"}, {"name": "Santa Bernardita"},
    {"name": "Santa Elena Street"}, {"name": "Santa Isabel Street"}, {"name": "Santa Monica Street"}, {"name": "Santa Veronica Street"}, {"name": "Sapphire Street"},
    {"name": "Spring Street"}, {"name": "Spur Street"}, {"name": "Stallion Street"}, {"name": "Sumulong Street"},
    {"name": "T. Bugallon Extension"}, {"name": "Tanguile Street"}, {"name": "Tatiana Street"}, {"name": "Teodora Park"}, {"name": "Torres Bugallon Street"},
    {"name": "Virgo Street"}, {"name": "West Drive Street", "type": "tertiary"}, {"name": "Winter Street"}, {"name": "Wrangler Street"}, {"name": "Zamora Street"},
]


def is_official(user):
    User = get_user_model()
    return bool(user and user.is_authenticated and (user.is_superuser or user.role == User.Role.BARANGAY_OFFICIAL))


def _group_streets(streets):
    grouped = {}
    for street in streets:
        first = street["name"][0].upper() if street["name"][:1].isalpha() else "0-9"
        grouped.setdefault(first, []).append(street)
    return {"streets": streets, "groups": grouped}


def street_catalog_payload():
    seen = set()
    streets = []
    for item in STREET_CATALOG:
        key = f"{item['name']}::{item.get('type', '')}"
        if key in seen:
            continue
        seen.add(key)
        streets.append({"id": key.lower().replace(" ", "-"), "name": item["name"], "type": item.get("type", ""), "geometries": []})
    return _group_streets(streets)


STATIC_MAP_CACHE_KEY = "live-map-static-geometry:v3"


def static_map_payload(community=None):
    from apps.emergencies.models import Community

    if community is not None and not isinstance(community, Community):
        community = Community.objects.filter(pk=community, status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).select_related("boundary").first()
    if community is None:
        community = Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).select_related("boundary").order_by("name").first()
    map_version = cache.get(f"community-map-cache-version:{community.pk}", 1) if community else 1
    cache_key = f"{STATIC_MAP_CACHE_KEY}:{community.pk}:{community.boundary_revision}:{map_version}" if community else f"{STATIC_MAP_CACHE_KEY}:none"
    cached = cache.get(cache_key)
    if cached:
        return cached
    boundary = community.boundary if community and community.boundary and community.boundary.is_active else None
    street_rows = list(
        MapGeometry.objects.filter(kind=MapGeometry.Kind.STREET, is_active=True)
        .order_by("name", "osm_id")
        .values("name", "osm_type", "osm_id", "street_type", "geometry", "locality")
    )
    if community and boundary:
        from apps.geo_services import point_in_geojson_inclusive

        def belongs_to_community(row):
            if (row.get("locality") or "").casefold() == community.name.casefold():
                return True
            coordinates = (row.get("geometry") or {}).get("coordinates") or []
            stack = [coordinates]
            while stack:
                item = stack.pop()
                if isinstance(item, (list, tuple)) and len(item) >= 2 and all(isinstance(value, (int, float)) for value in item[:2]):
                    if point_in_geojson_inclusive(item[0], item[1], boundary.geometry):
                        return True
                elif isinstance(item, (list, tuple)):
                    stack.extend(item)
            return False

        street_rows = [row for row in street_rows if belongs_to_community(row)]
    boundary_payload = {"osm_relation_id": None, "name": community.name if community else "Community", "geometry": None}
    if boundary:
        boundary_payload = {
            "osm_relation_id": boundary.osm_id if boundary.osm_type == "R" else None,
            "name": boundary.name,
            "geometry": boundary.geometry,
        }
    if not street_rows:
        streets = _group_streets([])
        payload = {"boundary": boundary_payload, "streets": streets}
        cache.set(cache_key, payload, 300)
        return payload
    by_name = {}
    for row in street_rows:
        street = by_name.setdefault(row["name"], {
            "id": row["name"].lower().replace(" ", "-"),
            "name": row["name"],
            "type": row["street_type"] or "",
            "geometries": [],
            "osm_ids": [],
        })
        if not street["type"] and row["street_type"]:
            street["type"] = row["street_type"]
        street["osm_ids"].append(f"{row['osm_type']}{row['osm_id']}")
        if row["geometry"]:
            street["geometries"].append(row["geometry"])
    streets = sorted(by_name.values(), key=lambda item: item["name"].casefold())
    payload = {"boundary": boundary_payload, "streets": _group_streets(streets)}
    cache.set(cache_key, payload, 300)
    return payload


def active_community_map_payloads():
    from apps.community_access import community_summary
    from apps.emergencies.models import Community

    rows = []
    for community in Community.objects.filter(
        status=Community.Status.ACTIVE,
        code=PRIMARY_COMMUNITY_CODE,
        boundary__isnull=False,
        boundary__is_active=True,
    ).select_related("boundary").order_by("name"):
        payload = static_map_payload(community)
        rows.append({
            **community_summary(community),
            "center": {
                "latitude": float(community.center_latitude),
                "longitude": float(community.center_longitude),
            },
            "bbox": {
                "min_latitude": community.bbox_min_latitude,
                "max_latitude": community.bbox_max_latitude,
                "min_longitude": community.bbox_min_longitude,
                "max_longitude": community.bbox_max_longitude,
            },
            "boundary": payload["boundary"],
        })
    return rows


def _representative_street_point(geometries, boundary_geometry):
    """First vertex of a street that falls inside the community outline."""
    from apps.geo_services import point_in_geojson_inclusive

    for geometry in geometries or []:
        stack = [(geometry or {}).get("coordinates") or []]
        while stack:
            item = stack.pop()
            if (
                isinstance(item, (list, tuple))
                and len(item) >= 2
                and all(isinstance(value, (int, float)) for value in item[:2])
            ):
                if point_in_geojson_inclusive(item[0], item[1], boundary_geometry):
                    return float(item[1]), float(item[0])
            elif isinstance(item, (list, tuple)):
                stack.extend(item)
    return None


def registration_street_matches(query, limit=8):
    """
    Streets a registering resident can pick, drawn from each active community's
    own catalog rather than a hardcoded list.

    Every hit carries a coordinate that already sits inside that community's
    boundary, so confirming the address resolves instead of landing on a
    same-named street in another city.
    """
    from apps.emergencies.models import Community

    needle = (query or "").strip().casefold()
    if len(needle) < 2:
        return []
    results = []
    communities = (
        Community.objects.filter(
            status=Community.Status.ACTIVE,
            code=PRIMARY_COMMUNITY_CODE,
            boundary__isnull=False,
            boundary__is_active=True,
        )
        .select_related("boundary")
        .order_by("name")
    )
    for community in communities:
        payload = static_map_payload(community)
        boundary_geometry = (payload.get("boundary") or {}).get("geometry")
        center = (float(community.center_latitude), float(community.center_longitude))
        for street in (payload.get("streets") or {}).get("streets") or []:
            name = street.get("name") or ""
            if needle not in name.casefold():
                continue
            geometries = street.get("geometries") or []
            if geometries and boundary_geometry:
                point = _representative_street_point(geometries, boundary_geometry)
                if point is None:
                    continue
            else:
                point = center
            results.append(
                {
                    "name": name,
                    "community": community.name,
                    "community_id": str(community.public_id),
                    "latitude": point[0],
                    "longitude": point[1],
                }
            )
            if len(results) >= limit:
                return results
    return results


def _line_strings(geometry):
    """Flatten a street geometry into plain [[lng, lat], ...] polylines."""
    coordinates = (geometry or {}).get("coordinates") or []
    kind = (geometry or {}).get("type")
    if kind == "LineString":
        return [coordinates]
    if kind == "MultiLineString":
        return [line for line in coordinates if line]
    if kind == "Point":
        return [[coordinates, coordinates]] if len(coordinates) >= 2 else []
    lines = []
    stack = [coordinates]
    while stack:
        item = stack.pop()
        if not isinstance(item, (list, tuple)) or not item:
            continue
        first = item[0]
        if isinstance(first, (int, float)):
            continue
        if (
            isinstance(first, (list, tuple))
            and len(first) >= 2
            and all(isinstance(value, (int, float)) for value in first[:2])
        ):
            lines.append(item)
        else:
            stack.extend(item)
    return lines


def nearest_community_street(latitude, longitude, community):
    """Closest catalog street to a dropped pin, with its distance in meters."""
    from apps.geo_services import _distance_to_ring_meters

    payload = static_map_payload(community)
    best_name = ""
    best_distance = None
    for street in (payload.get("streets") or {}).get("streets") or []:
        for geometry in street.get("geometries") or []:
            for line in _line_strings(geometry):
                distance = _distance_to_ring_meters(longitude, latitude, line)
                if distance is None:
                    continue
                if best_distance is None or distance < best_distance:
                    best_distance = distance
                    best_name = street.get("name") or ""
    if not best_name:
        return None
    return {"name": best_name, "distance_meters": best_distance}


def address_for_pin(latitude, longitude):
    """
    Turn a dropped pin into a street address using community-owned data first.

    The catalog answers with a street this community actually serves; OSM is the
    fallback so a pin outside every boundary still comes back with a name the
    resident recognises instead of an empty field.
    """
    from apps.emergencies.models import MapAddressPoint
    from apps.geo_services import active_communities_for_point, haversine_meters, nominatim_reverse

    latitude = float(latitude)
    longitude = float(longitude)
    matches = active_communities_for_point(latitude, longitude)
    community = matches[0] if len(matches) == 1 else None

    street = ""
    house_number = ""
    if community is not None:
        nearest = nearest_community_street(latitude, longitude, community)
        if nearest and (nearest["distance_meters"] is None or nearest["distance_meters"] <= 120):
            street = nearest["name"]

    closest_point = None
    closest_distance = None
    for point in MapAddressPoint.objects.filter(
        latitude__gte=latitude - 0.001,
        latitude__lte=latitude + 0.001,
        longitude__gte=longitude - 0.001,
        longitude__lte=longitude + 0.001,
    )[:200]:
        distance = haversine_meters(latitude, longitude, float(point.latitude), float(point.longitude))
        if closest_distance is None or distance < closest_distance:
            closest_distance = distance
            closest_point = point
    if closest_point is not None and closest_distance is not None and closest_distance <= 40:
        house_number = closest_point.house_number or ""
        if not street:
            street = closest_point.street or ""

    if not street:
        payload = nominatim_reverse(latitude, longitude, zoom=18) or {}
        address = payload.get("address") or {}
        street = (
            address.get("road")
            or address.get("pedestrian")
            or address.get("residential")
            or address.get("path")
            or ""
        )
        house_number = house_number or address.get("house_number") or ""

    return {
        "street": street,
        "house_number": house_number,
        "community": community.name if community else "",
        "community_id": str(community.public_id) if community else "",
        "inside_community": community is not None,
        "latitude": latitude,
        "longitude": longitude,
        "label": " ".join(part for part in [house_number, street] if part).strip(),
    }


def decimal_string(value):
    if value is None:
        return None
    return str(value.quantize(Decimal("0.0000001")) if isinstance(value, Decimal) else value)


def person_payload(user):
    if getattr(user, "is_anonymous_intake", False) or str(getattr(user, "email", "")).endswith("@eboses.invalid"):
        return {
            "id": 0,
            "full_name": "Community Reporter",
            "role": "resident",
            "barangay": "",
            "address": "",
            "responder_unit": "",
            "is_on_duty": False,
            "is_online": False,
            "latitude": None,
            "longitude": None,
            "location_updated_at": None,
        }
    profile = getattr(user, "resident_profile", None)
    full_name = f"{profile.first_name} {profile.last_name}".strip() if profile else user.email.split("@")[0]
    return {
        "id": user.pk,
        "full_name": full_name,
        "role": user.role,
        "barangay": getattr(profile, "barangay", "") or getattr(getattr(profile, "community", None), "name", ""),
        "address": getattr(profile, "address", ""),
        "responder_unit": user.responder_unit,
        "is_on_duty": user.is_on_duty,
        "is_online": bool(
            user.role == user.Role.FIRST_RESPONDER
            and user.status == user.Status.VERIFIED
            and user.is_active
        ) or bool(user.last_seen_at and user.last_seen_at >= timezone.now() - timedelta(minutes=5)),
        "latitude": decimal_string(user.current_latitude),
        "longitude": decimal_string(user.current_longitude),
        "location_updated_at": user.location_updated_at,
    }


def category_ref_payload(concern, request=None):
    """
    The map pin needs the same icon a resident's category picker and report
    list already show — this is that data, trimmed to just what a pin needs.
    `None` when the concern predates dynamic categories (falls back to the
    fixed `category` glyph on the client).
    """
    category = concern.category_ref
    if not category:
        return None
    icon_image_url = ""
    if category.icon_image:
        icon_image_url = (
            request.build_absolute_uri(category.icon_image.url) if request else category.icon_image.url
        )
    return {
        "code": category.code,
        "name": category.name,
        "icon_key": category.icon_key,
        "custom_icon_label": category.custom_icon_label,
        "icon_image_url": icon_image_url,
    }


def concern_payload(concern, request=None):
    media = list(concern.media.all()) if hasattr(concern, "media") else []
    evidence = [item for item in concern.resolution_evidence.all() if item.mime_type.startswith("image/")]
    # Keep the map's readable copy and severity in lockstep with the Concerns
    # feed. The previous payload only carried the submitted description and a
    # category-based high/normal flag, so the map looked stale after the LLM
    # produced a summary or a critical assessment.
    from apps.concerns.severity import severity_label, severity_level

    _severity_level, severity_assessed = severity_level(concern)
    return {
        "id": concern.pk,
        "preview_url": concern_media_preview_url(media[0].pk) if media else None,
        "media_count": len(media),
        "resolution_preview_url": (
            f"/api/concerns/resolution-evidence/{evidence[0].pk}/preview/" if evidence else None
        ),
        "resolution_photo_count": len(evidence),
        "tracking_id": f"RPT-{concern.created_at.year}-{concern.pk:06d}" if concern.created_at else f"RPT-0-{concern.pk:06d}",
        # Keep resident alerts aligned with the public Report Issue map. The
        # official title is the generated, location-aware heading; the raw
        # resident title remains the fallback for older reports.
        "title": (concern.official_title or concern.title or "").strip(),
        "notification_subject": (getattr(concern, "notification_subject", "") or "").strip(),
        "description": concern.description,
        "summary": (concern.summary or "").strip(),
        "category": concern.category,
        "category_ref": category_ref_payload(concern, request=request),
        "status": concern.status,
        "address": concern.address,
        "barangay": concern.barangay,
        "latitude": decimal_string(concern.latitude),
        "longitude": decimal_string(concern.longitude),
        "reporter": person_payload(concern.reporter),
        "created_at": concern.created_at,
        "updated_at": concern.updated_at,
        "severity": severity_label(concern),
        "severity_assessed": severity_assessed,
        "priority": severity_label(concern),
    }


def assignment_last_location(assignment, *, fresh_only=False):
    """Return the last known responder point with an explicit freshness flag.

    A historical ping is useful context on a resolved incident, but it must
    never be used to draw a *live* route.  Previously the newest row was used
    unconditionally, which made an old GPS point look like the responder's
    current position (and produced misleading distance/ETA values).
    """
    now = timezone.now()
    max_age = int(getattr(settings, "EMERGENCY_ROUTE_LOCATION_MAX_AGE_SECONDS", 300))
    max_accuracy = float(getattr(settings, "EMERGENCY_ROUTE_MAX_ACCURACY_METERS", 1000))

    ping = assignment.location_pings.order_by("-created_at", "-id").first()
    if ping:
        age = max(0, int((now - ping.created_at).total_seconds()))
        accurate = ping.accuracy is None or float(ping.accuracy) <= max_accuracy
        fresh = age <= max_age and accurate
        if fresh or not fresh_only:
            return {
                "latitude": decimal_string(ping.latitude),
                "longitude": decimal_string(ping.longitude),
                "accuracy": ping.accuracy,
                "created_at": ping.created_at,
                "age_seconds": age,
                "is_fresh": fresh,
            }

    responder = assignment.responder
    updated = getattr(responder, "location_updated_at", None)
    if responder.current_latitude is None or responder.current_longitude is None or not updated:
        return None
    age = max(0, int((now - updated).total_seconds()))
    fresh = age <= max_age
    if fresh_only and not fresh:
        return None
    return {
        "latitude": decimal_string(responder.current_latitude),
        "longitude": decimal_string(responder.current_longitude),
        "accuracy": None,
        "created_at": updated,
        "age_seconds": age,
        "is_fresh": fresh,
    }


def emergency_payload(alert):
    active = alert.status in _emergency_active_statuses()
    assignments = list(alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder", "responder__resident_profile").order_by("assigned_at", "id"))
    assignment_payloads = [
        {
            "id": assignment.pk,
            "responder": person_payload(assignment.responder),
            "status": assignment.status,
            "last_location": assignment_last_location(assignment, fresh_only=active),
        }
        for assignment in assignments
    ]
    media = list(alert.media.all()) if hasattr(alert, "media") else []
    from apps.emergencies.description import fallback_description
    ai_assist = alert.ai_assist or {}
    display_description = str(ai_assist.get("description") or "").strip()[:320] or fallback_description(alert)
    return {
        "id": alert.pk,
        "preview_url": emergency_media_preview_url(media[0].pk) if media else None,
        "type": alert.type,
        "note": alert.note,
        "display_description": display_description,
        # Compatibility for older clients; the UI reads display_description
        # and never presents this as an AI-labelled field.
        "ai_summary": display_description,
        "ai_assist_status": str(ai_assist.get("status") or ""),
        "status": alert.status,
        "address": (
            alert.resolved_location
            or alert.address
            or alert.reported_area
            or alert.barangay
            or ""
        ),
        "barangay": alert.barangay,
        "latitude": decimal_string(alert.latitude),
        "longitude": decimal_string(alert.longitude),
        "reporter": person_payload(alert.reporter),
        "active_assignments": assignment_payloads,
        "current_assignment": assignment_payloads[0] if assignment_payloads else None,
        "created_at": alert.created_at,
        "updated_at": alert.updated_at,
        "resolved_at": alert.resolved_at,
    }


def _osrm_route(*, origin_lat, origin_lng, dest_lat, dest_lng, profile="car", cache_key, refresh=False):
    """The actual OSRM request plus its 60s cache and status/geometry parsing.

    Shared by `route_for_responder_assignment` (a real assignment's live route)
    and `route_preview_for_responder` (a hypothetical preview with no alert or
    assignment at all), so both go through the exact same OSRM call, timeout
    and caching behavior instead of two copies drifting apart.
    """
    cached = None if refresh else cache.get(cache_key)
    if cached:
        return dict(cached)
    route = {
        "status": "unavailable",
        "profile": profile,
        "distance_meters": None,
        "eta_seconds": None,
        "geometry": None,
        "summary": "",
        "origin_snap": None,
        "destination_snap": None,
        "approach": None,
        "steps": [],
    }
    try:
        profile_name = {"car": "driving", "bike": "cycling", "foot": "walking"}.get(profile, "driving")
        configured_url = getattr(settings, "OSM_ROUTE_URL", "https://router.project-osrm.org/route/v1/driving")
        base_url = configured_url.rsplit("/", 1)[0] + f"/{profile_name}"
        url = f"{base_url}/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
        response = httpx.get(
            url,
            params={"overview": "full", "geometries": "geojson", "steps": "true"},
            timeout=getattr(settings, "OSM_ROUTE_TIMEOUT_SECONDS", 4),
        )
        response.raise_for_status()
        data = response.json()
        best = (data.get("routes") or [None])[0]
        waypoints = data.get("waypoints") or []
        if best:
            raw_steps = [step for leg in best.get("legs") or [] for step in leg.get("steps") or []]
            steps = []
            for step in raw_steps:
                maneuver = step.get("maneuver") or {}
                location = maneuver.get("location") or []
                steps.append({
                    "type": maneuver.get("type") or "",
                    "modifier": maneuver.get("modifier") or "",
                    "bearing_after": maneuver.get("bearing_after"),
                    "exit": maneuver.get("exit"),
                    "name": step.get("name") or "",
                    "ref": step.get("ref") or "",
                    "distance": step.get("distance"),
                    "duration": step.get("duration"),
                    "latitude": location[1] if len(location) > 1 else None,
                    "longitude": location[0] if len(location) > 1 else None,
                })
            destination_snap = ({"latitude": waypoints[1]["location"][1], "longitude": waypoints[1]["location"][0], "meters": waypoints[1].get("distance")} if len(waypoints) > 1 and waypoints[1].get("location") else None)
            approach = None
            if destination_snap and destination_snap.get("meters"):
                approach = {
                    "geometry": {"type": "LineString", "coordinates": [[destination_snap["longitude"], destination_snap["latitude"]], [dest_lng, dest_lat]]},
                    "distance_meters": destination_snap["meters"],
                    "residual_meters": destination_snap["meters"],
                }
            route.update({
                "status": "ok",
                "profile": profile,
                "distance_meters": best.get("distance"),
                "eta_seconds": best.get("duration"),
                "geometry": best.get("geometry"),
                "summary": ", ".join(filter(None, [leg.get("summary") for leg in best.get("legs") or []])),
                "origin_snap": ({"latitude": waypoints[0]["location"][1], "longitude": waypoints[0]["location"][0], "meters": waypoints[0].get("distance")} if len(waypoints) > 0 and waypoints[0].get("location") else None),
                "destination_snap": destination_snap,
                "approach": approach,
                "steps": steps,
            })
    except Exception:
        pass
    cache.set(cache_key, route, 60)
    return route


def route_for_responder_assignment(alert, assignment, *, refresh=False, include_steps=True):
    if not assignment:
        return None
    # An SMS emergency may carry a readable area but no pin. There is nothing to
    # route to until reverse geocoding or the reporter supplies coordinates.
    if alert.latitude is None or alert.longitude is None:
        return None
    # Once an emergency is resolved, never ask the routing provider for a new
    # route from a responder's current position.  Reuse the route captured for
    # the assignment so public history can describe the route that was used at
    # dispatch time without turning a settled incident back into live tracking.
    if alert.status in SETTLED_EMERGENCY_STATUSES or assignment.status in SETTLED_ASSIGNMENT_STATUSES:
        from apps.emergencies.models import EmergencyAssignmentRoute

        stored = getattr(assignment, "stored_route", None)
        if stored is None:
            try:
                stored = EmergencyAssignmentRoute.objects.get(assignment=assignment)
            except EmergencyAssignmentRoute.DoesNotExist:
                stored = None
        if stored is None:
            return None
        return {
            "status": stored.status,
            "profile": stored.profile,
            "distance_meters": stored.distance_meters,
            "eta_seconds": stored.eta_seconds,
            "geometry": stored.geometry,
            "summary": stored.summary,
            "origin_snap": stored.origin_snap,
            "destination_snap": stored.destination_snap,
            "approach": stored.approach,
            "steps": stored.steps if include_steps else [],
            "alert_id": alert.pk,
            "assignment_id": assignment.pk,
            "responder_id": assignment.responder_id,
            "assignment_status": assignment.status,
            "route_revision": stored.route_revision,
            "updated_at": stored.updated_at,
        }
    # Only fresh, reasonably accurate GPS can drive a new live route. A stored
    # route remains usable for map display while the responder sends a fresh
    # location.
    from apps.emergencies.models import EmergencyAssignmentRoute

    origin = assignment_last_location(assignment, fresh_only=True)
    if not origin:
        stored = getattr(assignment, "stored_route", None)
        if stored is None:
            try:
                stored = EmergencyAssignmentRoute.objects.get(assignment=assignment)
            except EmergencyAssignmentRoute.DoesNotExist:
                stored = None
        if stored is not None and stored.geometry:
            return {
                "status": "ok",
                "profile": stored.profile,
                "distance_meters": stored.distance_meters,
                "eta_seconds": stored.eta_seconds,
                "geometry": stored.geometry,
                "summary": stored.summary,
                "origin_snap": stored.origin_snap,
                "destination_snap": stored.destination_snap,
                "approach": stored.approach,
                "steps": stored.steps if include_steps else [],
                "alert_id": alert.pk,
                "assignment_id": assignment.pk,
                "responder_id": assignment.responder_id,
                "assignment_status": assignment.status,
                "route_revision": stored.route_revision,
                "updated_at": stored.updated_at,
            }
        return None
    profile = assignment.travel_profile or "car"
    cache_key = "live-map-route:%s:%s:%s:%s:%s" % (
        profile,
        round(float(origin["latitude"]), 5),
        round(float(origin["longitude"]), 5),
        round(float(alert.latitude), 5),
        round(float(alert.longitude), 5),
    )
    route = _osrm_route(
        origin_lat=float(origin["latitude"]),
        origin_lng=float(origin["longitude"]),
        dest_lat=float(alert.latitude),
        dest_lng=float(alert.longitude),
        profile=profile,
        cache_key=cache_key,
        refresh=refresh,
    )
    stored, created = EmergencyAssignmentRoute.objects.get_or_create(assignment=assignment)
    use_stale = (
        route["status"] != "ok"
        and not created
        and stored.profile == profile
        and stored.status in {"ok", "stale"}
        and stored.geometry
    )
    if use_stale:
        route = {
            "status": "stale",
            "profile": profile,
            "distance_meters": stored.distance_meters,
            "eta_seconds": stored.eta_seconds,
            "geometry": stored.geometry,
            "summary": stored.summary,
            "origin_snap": stored.origin_snap,
            "destination_snap": stored.destination_snap,
            "approach": stored.approach,
            "steps": stored.steps,
        }
    stored.status = route["status"]
    stored.profile = assignment.travel_profile or "car"
    stored.distance_meters = route.get("distance_meters")
    stored.eta_seconds = route.get("eta_seconds")
    stored.geometry = route.get("geometry")
    stored.summary = route.get("summary") or ""
    stored.origin_snap = route.get("origin_snap")
    stored.destination_snap = route.get("destination_snap")
    stored.approach = route.get("approach")
    stored.steps = route.get("steps") or []
    stored.error_code = "" if route["status"] == "ok" else "provider_unavailable"
    if not use_stale:
        stored.generated_at = timezone.now()
    if not created:
        stored.route_revision += 1
    stored.save()
    payload = {
        **route,
        "profile": profile,
        "alert_id": alert.pk,
        "assignment_id": assignment.pk,
        "responder_id": assignment.responder_id,
        "assignment_status": assignment.status,
        "route_revision": stored.route_revision,
        "updated_at": stored.updated_at,
    }
    if not include_steps:
        payload["steps"] = []
    return payload


def route_preview_for_responder(responder, *, latitude, longitude):
    """Hypothetical route/ETA preview from a responder's current live position
    to an arbitrary (lat, lng) — no real EmergencyAlert or assignment involved.

    Used by the emergency-domain simulation endpoint to preview what routing a
    candidate responder would look like, without ever creating a real
    EmergencyResponderAssignment row.
    """
    if responder.current_latitude is None or responder.current_longitude is None:
        return {"status": "unavailable"}
    origin_lat = float(responder.current_latitude)
    origin_lng = float(responder.current_longitude)
    dest_lat = float(latitude)
    dest_lng = float(longitude)
    cache_key = "live-map-route-preview:%s:%s:%s:%s:%s" % (
        responder.pk,
        round(origin_lat, 5),
        round(origin_lng, 5),
        round(dest_lat, 5),
        round(dest_lng, 5),
    )
    return _osrm_route(
        origin_lat=origin_lat,
        origin_lng=origin_lng,
        dest_lat=dest_lat,
        dest_lng=dest_lng,
        cache_key=cache_key,
    )


def route_for_assignment(alert):
    assignment_statuses = ACTIVE_ASSIGNMENT_STATUSES
    if alert.status in SETTLED_EMERGENCY_STATUSES:
        assignment_statuses = ACTIVE_ASSIGNMENT_STATUSES | SETTLED_ASSIGNMENT_STATUSES
    assignment = alert.assignments.filter(
        status__in=assignment_statuses
    ).select_related("responder").order_by("assigned_at", "id").first()
    return route_for_responder_assignment(alert, assignment)


def routes_for_alert(alert):
    assignment_statuses = ACTIVE_ASSIGNMENT_STATUSES
    if alert.status in SETTLED_EMERGENCY_STATUSES:
        assignment_statuses = ACTIVE_ASSIGNMENT_STATUSES | SETTLED_ASSIGNMENT_STATUSES
    assignments = alert.assignments.filter(
        status__in=assignment_statuses
    ).select_related("responder").prefetch_related("location_pings").order_by("assigned_at", "id")
    routes = []
    for assignment in assignments:
        route = route_for_responder_assignment(alert, assignment)
        if route:
            routes.append({**route, "responder": person_payload(assignment.responder)})
    return routes


def advisory_payload(announcement, street_index):
    affected = announcement.affected_streets if isinstance(announcement.affected_streets, list) else []
    names = []
    geometries = []
    for entry in affected:
        name = entry.get("name") if isinstance(entry, dict) else str(entry)
        if not name:
            continue
        names.append(str(name))
        street = street_index.get(str(name).casefold())
        if street:
            geometries.extend(street["geometries"])
    image_url = ""
    try:
        image_url = announcement.image.url if announcement.image else ""
    except ValueError:
        image_url = ""
    return {
        "id": announcement.pk,
        "title": announcement.title,
        "body": announcement.body,
        "llm_summary": announcement.llm_summary,
        "tag": announcement.tag,
        "urgency": announcement.urgency,
        "is_pinned": announcement.is_pinned,
        "affected_streets": names,
        "area_geometry": announcement.area_geometry,
        "street_geometries": [] if announcement.area_geometry else geometries,
        "starts_at": announcement.starts_at,
        "expires_at": announcement.expires_at,
        "image_url": image_url or None,
    }


def live_map_snapshot(request=None):
    from apps.geo_services import dispatch_policy_payload

    from apps.community_scope import community_ids_for_user, department_ids_for_user, scope_emergency_queryset, selected_community
    from apps.emergencies.models import Community

    User = get_user_model()
    user = getattr(request, "user", None)
    is_responder = bool(user and getattr(user, "role", "") == User.Role.FIRST_RESPONDER)
    community_ids = community_ids_for_user(user)
    department_ids = department_ids_for_user(user)
    requested_community = request.query_params.get("community_id") if request else None
    community = selected_community(user, requested_community)
    if not community and community_ids:
        community = Community.objects.filter(pk__in=community_ids, status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).order_by("name").first()
    if community:
        community_ids = {community.pk}
        from apps.concerns.models import Department

        department_ids &= set(Department.objects.filter(community=community).values_list("id", flat=True))
    static_map = static_map_payload(community)
    people = [
        person_payload(user)
        for user in User.objects.filter(
            status=User.Status.VERIFIED,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
        ).filter(
            models.Q(role=User.Role.RESIDENT, resident_profile__community_id__in=community_ids)
            | models.Q(
                role=User.Role.FIRST_RESPONDER,
                designations__is_active=True,
                designations__department__community_id__in=community_ids,
            )
        ).select_related("resident_profile").distinct()
    ]
    # Only what the map can actually draw, newest first and capped. This used to
    # serialise every concern ever filed that has coordinates -- reporter payload
    # and full description included -- so the snapshot grew without bound and the
    # map spent its first seconds parsing records it would never pin.
    #
    # The drawable set mirrors the client: active pins for under_review /
    # assigned / in_progress (status-vocabulary ACTIVE_CONCERN_STATUSES) and
    # resolved pins behind the resolved layer toggle. Active rows get the full
    # budget first so closed reports can never evict open incidents from the
    # map while summary.concerns still counts them.
    map_active_statuses = {
        Concern.Status.UNDER_REVIEW,
        Concern.Status.ASSIGNED,
        Concern.Status.IN_PROGRESS,
    }

    def concern_rows(statuses, limit):
        return list(
            Concern.objects.filter(
                community_id__in=community_ids,
                latitude__isnull=False,
                longitude__isnull=False,
                status__in=statuses,
            ).filter(
                models.Q(assignments__assignee=user)
                if is_responder
                else models.Q(reporter=user) | models.Q(category_ref__department_id__in=department_ids)
            )
            .select_related("reporter", "reporter__resident_profile", "category_ref", "ai_assessment")
            .prefetch_related("media", "resolution_evidence")
            .order_by("-created_at")[:limit]
        )

    active_rows = concern_rows(map_active_statuses, MAP_CONCERN_LIMIT)
    resolved_rows = concern_rows({Concern.Status.RESOLVED}, max(0, MAP_CONCERN_LIMIT - len(active_rows)))
    concerns = [concern_payload(concern, request=request) for concern in active_rows + resolved_rows]
    active_concern_count = Concern.objects.filter(
        community_id__in=community_ids,
        latitude__isnull=False,
        longitude__isnull=False,
        status__in=map_active_statuses,
    ).filter(
        models.Q(assignments__assignee=user)
        if is_responder
        else models.Q(reporter=user) | models.Q(category_ref__department_id__in=department_ids)
    ).count()
    # Active alerts plus recently settled ones (resolved, closed, cancelled,
    # false alarm) — invalid/out-of-area audits never become map pins.
    # uses, so an official can still see how a just-closed incident wrapped up
    # instead of it vanishing from the map the instant it's marked done.
    recently_settled_cutoff = timezone.now() - timedelta(days=7)
    emergency_scope = scope_emergency_queryset(EmergencyAlert.objects.all(), user).filter(community=community)
    if is_responder:
        emergency_scope = emergency_scope.filter(assignments__responder=user).distinct()
    alerts = list(
        emergency_scope.filter(
            models.Q(status__in=EMERGENCY_ACTIVE)
            | models.Q(
                status__in={"resolved", "closed", "cancelled", "false_alarm"},
                updated_at__gte=recently_settled_cutoff,
            )
        )
        .select_related("reporter", "reporter__resident_profile")
        .prefetch_related("assignments__responder", "assignments__responder__resident_profile", "assignments__location_pings", "media")
    )
    emergencies = [emergency_payload(alert) for alert in alerts]
    routes = [route for alert in alerts for route in routes_for_alert(alert)]
    active_emergency_scope = scope_emergency_queryset(
        EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE, community=community), user
    )
    if is_responder:
        active_emergency_scope = active_emergency_scope.filter(assignments__responder=user).distinct()
    active_emergency_count = active_emergency_scope.count()

    from apps.concerns.announcement_services import announcement_is_active

    street_index = {
        street["name"].casefold(): street
        for street in static_map["streets"]["streets"]
        if street.get("geometries")
    }
    announcement_rows = list(
        Announcement.objects.filter(is_published=True, community=community)
        .filter(models.Q(target_departments__isnull=True) | models.Q(target_departments__id__in=department_ids))
        .distinct()
        .order_by("-is_pinned", "-published_at", "-created_at")[:50]
    )
    advisories = [
        advisory_payload(item, street_index)
        for item in announcement_rows
        if announcement_is_active(item)
    ]
    public_snapshot = resident_alerts_map_snapshot(request=request)
    return {
        "home_community_id": str(community.public_id) if community else None,
        "communities": public_snapshot["communities"],
        "map": {
            "provider": "OpenStreetMap",
            "center": {
                "latitude": float(community.center_latitude),
                "longitude": float(community.center_longitude),
                "zoom": 15,
            } if community else NETWORK_FALLBACK_CENTER,
            "boundary": static_map["boundary"],
            "streets": static_map["streets"],
            "dispatch_policy": dispatch_policy_payload(community),
        },
        "people": people,
        "concerns": concerns,
        "emergencies": emergencies,
        "public_concerns": public_snapshot["concerns"],
        "public_emergencies": public_snapshot["emergencies"],
        "operational": {
            "community_id": str(community.public_id) if community else None,
            "concerns": concerns,
            "emergencies": emergencies,
            "routes": routes,
        },
        "routes": routes,
        "advisories": advisories,
        "summary": {
            "active_alerts": active_concern_count + active_emergency_count,
            "concerns": active_concern_count,
            "emergencies": active_emergency_count,
            "residents": User.objects.filter(role=User.Role.RESIDENT, status=User.Status.VERIFIED, resident_profile__community_id__in=community_ids).count(),
            # A responder is counted when their verified account belongs to a
            # configured response unit in the selected communities.
            "responders": User.objects.filter(
                role=User.Role.FIRST_RESPONDER,
                status=User.Status.VERIFIED,
                designations__is_active=True,
                designations__department__community_id__in=community_ids,
            ).distinct().count(),
            "officials": User.objects.filter(
                role=User.Role.BARANGAY_OFFICIAL,
                status=User.Status.VERIFIED,
                designations__is_active=True,
                designations__department__community_id__in=community_ids,
            ).distinct().count(),
        },
        "generated_at": timezone.now(),
    }


class LocationPingSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    accuracy = serializers.FloatField(required=False, allow_null=True, max_value=10000)
    source = serializers.ChoiceField(choices=["active_session", "pwa_background", "manual", "incident"], default="active_session")
    timestamp = serializers.IntegerField(required=False, min_value=1)

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        allow_outside = bool(
            user
            and user.is_authenticated
            and user.role == user.Role.FIRST_RESPONDER
        )
        try:
            validate_client_gps_timestamp(attrs.get("timestamp"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"timestamp": exc.messages}) from exc
        try:
            validate_location_pair(
                attrs.get("latitude"),
                attrs.get("longitude"),
                required=True,
                allow_outside_service_area=allow_outside,
            )
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class OfficialLiveMapView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not (is_official(request.user) or request.user.role == request.user.Role.FIRST_RESPONDER):
            return Response({"detail": "You do not have permission to view the staff live map."}, status=status.HTTP_403_FORBIDDEN)
        return Response(live_map_snapshot(request=request))


def public_reporter_payload(user):
    """Community-safe reporter identity (no home address / live GPS)."""
    if str(getattr(user, "email", "")).endswith("@eboses.invalid"):
        return {"id": 0, "full_name": "Community Reporter", "role": "resident", "barangay": ""}
    profile = getattr(user, "resident_profile", None)
    if profile:
        first_name = (profile.first_name or "").strip()
        last_initial = (profile.last_name or "").strip()[:1]
        full_name = f"{first_name} {last_initial}.".strip() if last_initial else first_name
    else:
        full_name = "Neighbor"
    return {
        "id": user.pk,
        "full_name": full_name or "Neighbor",
        "role": user.role,
        "barangay": getattr(profile, "barangay", "") or getattr(getattr(profile, "community", None), "name", ""),
    }


def resident_concern_payload(concern, request=None):
    """Public community concern for resident alerts map (no private coords of people)."""
    preview_url = None
    media = list(concern.media.all()) if hasattr(concern, "media") else []
    if media:
        path = concern_media_preview_url(media[0].pk)
        preview_url = request.build_absolute_uri(path) if request else path
    evidence = [item for item in concern.resolution_evidence.all() if item.mime_type.startswith("image/")]
    resolution_preview_url = None
    if evidence:
        path = f"/api/concerns/resolution-evidence/{evidence[0].pk}/preview/"
        resolution_preview_url = request.build_absolute_uri(path) if request else path
    from apps.concerns.severity import severity_label, severity_level

    _severity_level, severity_assessed = severity_level(concern)
    return {
        "id": concern.pk,
        "community": __import__(
            "apps.community_access", fromlist=["community_summary"]
        ).community_summary(concern.community),
        "tracking_id": "" if concern.is_anonymous else concern.tracking_id,
        # Use the same generated, location-aware heading shown by the public
        # Report Issue map; older records fall back to the submitted title.
        "title": (concern.official_title or concern.title or "").strip(),
        "notification_subject": (getattr(concern, "notification_subject", "") or "").strip(),
        "description": concern.description,
        "summary": (concern.summary or "").strip(),
        "category": concern.category,
        "category_ref": category_ref_payload(concern, request=request),
        "status": concern.status,
        "address": concern.address,
        "barangay": concern.barangay,
        "latitude": decimal_string(concern.latitude),
        "longitude": decimal_string(concern.longitude),
        "preview_url": preview_url,
        "resolution_preview_url": resolution_preview_url,
        "resolution_photo_count": len(evidence),
        "reporter": public_reporter_payload(concern.reporter),
        "created_at": concern.created_at,
        "updated_at": concern.updated_at,
        "severity": severity_label(concern),
        "severity_assessed": severity_assessed,
        "priority": severity_label(concern),
        "kind": "concern",
    }


def resident_emergency_payload(alert, request=None):
    """
    Active emergency for residents — operational facts only.
    No reporter identity, no responder GPS, no routes.
    """
    # Media for emergencies is private/ops-only; residents get type + note +
    # location. Only the reporter may see the live position of their assigned
    # responder; other residents receive no responder GPS.
    viewer = getattr(request, "user", None) if request else None
    is_owner = bool(viewer and viewer.is_authenticated and alert.reporter_id == viewer.pk)
    responder_location = None
    route = None
    if request and getattr(request, "user", None) and request.user.is_authenticated and alert.reporter_id == request.user.pk:
        assignment = (
            alert.assignments.filter(
                status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
            )
            .select_related("responder")
            .prefetch_related("location_pings")
            .order_by("assigned_at", "id")
            .first()
        )
        if assignment:
            responder_location = assignment_last_location(
                assignment,
                fresh_only=alert.status in _emergency_active_statuses(),
            )
            route = route_for_assignment(alert)
    type_label = alert.get_type_display() if hasattr(alert, "get_type_display") else alert.type
    from apps.emergencies.description import fallback_description
    ai_assist = alert.ai_assist or {}
    display_description = ""
    if is_owner:
        display_description = str(ai_assist.get("description") or "").strip()[:320] or fallback_description(alert)
    return {
        "id": alert.pk,
        "community": __import__(
            "apps.community_access", fromlist=["community_summary"]
        ).community_summary(alert.community),
        "type": alert.type,
        "type_label": type_label,
        "note": (alert.note or "")[:280] if is_owner else "",
        "display_description": display_description,
        "ai_summary": display_description,
        "ai_assist_status": str(ai_assist.get("status") or ""),
        "status": alert.status,
        "barangay": alert.barangay,
        "latitude": decimal_string(alert.latitude),
        "longitude": decimal_string(alert.longitude),
        "address": (
            alert.resolved_location
            or alert.address
            or alert.reported_area
            or alert.barangay
            or ""
        ),
        "preview_url": None,
        "created_at": alert.created_at,
        "updated_at": alert.updated_at,
        "kind": "emergency",
        "source": "resident",  # resident-reported operational alert (not weather feed)
        "responder_location": responder_location,
        "route": route,
    }


def barangay_active_emergencies_count() -> int:
    return EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE).count()


def resident_alerts_map_snapshot(request=None):
    """
    Resident-safe map payload:
    - community-visible concerns with coordinates
    - active emergencies (minimized PII)
    - service POIs (OSM + admin)
    - boundary / center for map framing
    Does NOT include people tracking, responder routes, or private reports.
    """
    from apps.community_scope import selected_community
    from apps.emergencies.models import Community
    from apps.geo_services import active_community_for_point, collect_service_pois, dispatch_policy_payload

    user = getattr(request, "user", None)
    requested_community = request.query_params.get("community_id") if request else None
    community = selected_community(user, requested_community)
    if not community:
        profile = getattr(user, "resident_profile", None)
        community = getattr(profile, "community", None)
    if not community:
        community = Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).order_by("name").first()
    static_map = static_map_payload(community)

    communities = active_community_map_payloads()
    active_ids = [
        row.pk for row in Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE)
    ]
    concerns_qs = (
        Concern.objects.filter(
            community_id__in=active_ids,
            visibility=Concern.Visibility.COMMUNITY,
            validation_status=Concern.ValidationStatus.ACCEPTED,
            status__in={
                Concern.Status.SUBMITTED,
                Concern.Status.UNDER_REVIEW,
                Concern.Status.ASSIGNED,
                Concern.Status.IN_PROGRESS,
                Concern.Status.RESOLVED,
            },
            latitude__isnull=False,
            longitude__isnull=False,
        )
        .select_related("community", "reporter", "reporter__resident_profile", "category_ref", "ai_assessment")
            .prefetch_related("media", "resolution_evidence")
        .order_by("-created_at")[:200]
    )
    concerns = [resident_concern_payload(c, request=request) for c in concerns_qs]

    # Categories an official has marked private (e.g. domestic violence, child
    # protection) never reach the resident map, regardless of status.
    visible_types = list(
        EmergencyCategory.objects.filter(
            community_id__in=active_ids,
            is_active=True,
            visible_to_residents=True,
        ).values_list("community_id", "code")
    )
    visible_rule = models.Q(pk__in=[])
    for community_id, category_code in visible_types:
        visible_rule |= models.Q(community_id=community_id, type=category_code)
    # Include active emergencies plus recently resolved/closed (last 7 days)
    recently_resolved_cutoff = timezone.now() - timedelta(days=7)
    alerts_qs = (
        EmergencyAlert.objects.filter(
            models.Q(status__in=EMERGENCY_ACTIVE)
            | models.Q(status__in={"resolved", "closed", "cancelled"}, updated_at__gte=recently_resolved_cutoff)
        ).filter(visible_rule)
        .select_related("community")
        .prefetch_related("media")
        .order_by("-created_at")[:100]
    )
    emergencies = [resident_emergency_payload(a, request=request) for a in alerts_qs]

    pois = []
    for poi in collect_service_pois():
        located = active_community_for_point(poi.get("latitude"), poi.get("longitude"))
        if located:
            pois.append({**poi, "community": located})
    services = [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "type": p.get("type"),
            "label": p.get("label") or p.get("type"),
            "sector": p.get("sector") or "public",
            "latitude": p.get("latitude"),
            "longitude": p.get("longitude"),
            "source": p.get("source") or "osm",
            "kind": "service",
            "community": __import__(
                "apps.community_access", fromlist=["community_summary"]
            ).community_summary(p.get("community")),
        }
        for p in pois
    ]

    active_concerns = [c for c in concerns if c["status"] in CONCERN_ACTIVE or c["status"] == Concern.Status.ASSIGNED]
    emergency_count = len(emergencies)

    return {
        "home_community_id": str(community.public_id) if community else None,
        "communities": communities,
        "map": {
            "provider": "OpenStreetMap",
            "center": {
                "latitude": float(community.center_latitude),
                "longitude": float(community.center_longitude),
                "zoom": 15,
            } if community else NETWORK_FALLBACK_CENTER,
            "boundary": {
                "osm_relation_id": static_map["boundary"].get("osm_relation_id"),
                "name": static_map["boundary"].get("name") or "Community",
                "geometry": static_map["boundary"].get("geometry"),
            },
            "dispatch_policy": dispatch_policy_payload(community),
        },
        "concerns": concerns,
        "emergencies": emergencies,
        "services": services,
        "poi_types": sorted({service["type"] for service in services if service.get("type")}),
        "summary": {
            "public_concerns": len(concerns),
            "active_concerns": len(active_concerns),
            "active_emergencies": emergency_count,
            "services": len(services),
            "has_ongoing_emergencies": emergency_count > 0,
        },
        "generated_at": timezone.now(),
    }


class ResidentAlertsMapView(APIView):
    """Resident alerts map: public concerns, active emergencies, service POIs."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        return Response(resident_alerts_map_snapshot(request=request))


class LocationPingView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [LocalScopedRateThrottle]
    throttle_scope = "location_ping"

    def post(self, request):
        touch_last_seen(request.user)
        serializer = LocationPingSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            # Background GPS often reports outside the current community (VPN, travel,
            # or GPS drift). Treat as soft reject so browsers don't log 400 spam.
            return Response(
                {"accepted": False, "errors": serializer.errors},
                status=status.HTTP_200_OK,
            )
        request.user.current_latitude = serializer.validated_data["latitude"]
        request.user.current_longitude = serializer.validated_data["longitude"]
        request.user.location_updated_at = timezone.now()
        request.user.save(update_fields=["current_latitude", "current_longitude", "location_updated_at", "updated_at"])
        if request.user.role == request.user.Role.FIRST_RESPONDER:
            from apps.emergencies.views import retry_waiting_alerts_for_responder

            retry_waiting_alerts_for_responder(request.user)
        payload = person_payload(request.user)
        # group_send is a synchronous round trip to the remote Redis; keep it
        # off this hot 60/min endpoint's critical path.
        transaction.on_commit(lambda: broadcast_live_map_event("location.updated", {"person": payload}))
        return Response(
            {
                "accepted": True,
                "person": payload,
                "source": serializer.validated_data["source"],
            }
        )


class LocationMapContextView(APIView):
    """Clean map context for resident pin picker: boundary, streets, emergency POIs."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.emergencies.models import MapDispatchPolicy
        from apps.geo_services import map_context_payload
        from apps.community_scope import selected_community

        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        payload = map_context_payload(community)
        policy = MapDispatchPolicy.current(community)
        # The SOS screen needs this to offer an SMS fallback when the resident
        # has no data. Serving it here keeps it barangay-configurable instead of
        # frozen into the build.
        payload["emergency_sms_number"] = policy.emergency_sms_number
        # The SOS screen warns (never blocks) outside barangay duty hours and
        # offers the hotlines instead.
        payload["duty_hours"] = {
            "within_duty_hours": policy.is_within_duty_hours(),
            "start": policy.duty_hours_start.strftime("%H:%M") if policy.duty_hours_start else None,
            "end": policy.duty_hours_end.strftime("%H:%M") if policy.duty_hours_end else None,
        }
        payload["hotlines"] = policy.hotlines or []
        return Response(payload)


class LocationValidateView(APIView):
    """Classify a pin as inside / edge buffer / too far."""

    # The same classifier is used by authenticated SOS/report pickers and by
    # the anonymous sign-up and guest-report maps. It returns only public
    # coverage metadata, so requiring a session here made those maps fall back
    # to an optimistic client state instead of validating the pin.
    permission_classes = [AllowAny]
    authentication_classes = []
    # Use one client-scoped limit instead of stacking the broad anonymous
    # hourly limit on this deterministic, low-cost classifier.
    throttle_classes = [LocalScopedRateThrottle]
    throttle_scope = "location_validate"

    def post(self, request):
        from apps.geo_services import classify_location

        try:
            lat = float(request.data.get("latitude"))
            lng = float(request.data.get("longitude"))
        except (TypeError, ValueError):
            return Response(
                {"accepted": False, "status": "far", "message": "Invalid coordinates."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = classify_location(lat, lng)
        return Response(result)


class GeocodeReverseView(APIView):
    """Server-side reverse geocoding for the map pin.

    The browser used to call Nominatim directly. It cannot set a User-Agent,
    so Nominatim throttled the whole barangay's public IP to 429 - and since a
    429 carries no CORS headers, it surfaced as a CORS error instead of a rate
    limit. Proxying gives us an identified client, a 30-day cache and one
    request per second.

    Open to anonymous callers because address capture happens during sign-up,
    before an account exists. Throttled by scope instead.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LocalScopedRateThrottle]
    throttle_scope = "geocode"

    def get(self, request):
        from apps.geo_services import nominatim_reverse

        try:
            latitude = float(request.query_params.get("lat", ""))
            longitude = float(request.query_params.get("lng") or request.query_params.get("lon") or "")
        except (TypeError, ValueError):
            return Response({"detail": "lat and lng are required."}, status=400)
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return Response({"detail": "Coordinates are out of range."}, status=400)

        try:
            zoom = max(1, min(18, int(request.query_params.get("zoom", 18))))
        except (TypeError, ValueError):
            zoom = 18

        from apps.geo_services import nearest_known_street

        payload = nominatim_reverse(latitude, longitude, zoom=zoom)
        if payload is not None:
            return Response({"ok": True, "result": payload, "source": "nominatim"})

        # Nominatim unavailable or rate-limiting us. The barangay's own street
        # geometry answers the same question offline, so an emergency never
        # depends on a third party being reachable.
        local = nearest_known_street(latitude, longitude)
        if local["street"]:
            from apps.geo_services import active_community_for_point

            community = active_community_for_point(latitude, longitude)
            community_name = community.name if community else "Community"
            locality = getattr(getattr(community, "boundary", None), "locality", "") or ""
            house_number = local.get("house_number") or ""
            head = f"{house_number} {local['street']}".strip()
            address = {
                "road": local["street"],
                "village": community_name,
                "city": locality,
            }
            if house_number:
                address["house_number"] = house_number
            return Response({
                "ok": True,
                "source": "local",
                "result": {
                    "display_name": ", ".join(part for part in (head, community_name, locality) if part),
                    "address": address,
                },
                "distance_meters": local["distance_meters"],
            })

        # 200 with a null result, not an error: the caller falls back to the
        # pinned coordinates and must not treat this as a broken request.
        return Response({"ok": False, "result": None, "source": "unavailable"})


class GeocodeSearchView(APIView):
    """Server-side forward geocoding for street lookup."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LocalScopedRateThrottle]
    throttle_scope = "geocode"

    def get(self, request):
        from apps.geo_services import nominatim_search

        query = (request.query_params.get("q") or "").strip()
        if len(query) < 3:
            return Response({"detail": "q must be at least 3 characters."}, status=400)
        try:
            limit = max(1, min(10, int(request.query_params.get("limit", 1))))
        except (TypeError, ValueError):
            limit = 1

        payload = nominatim_search(query[:200], limit=limit)
        return Response({"ok": payload is not None, "results": payload or []})


class LocationSearchView(APIView):
    """Place search restricted to the user's selected community boundary."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        import urllib.parse

        from apps.community_scope import community_ids_for_user, selected_community
        from apps.emergencies.models import Community
        from apps.geo_services import active_community_for_point

        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"results": []})

        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            community = Community.objects.filter(
                pk__in=community_ids_for_user(request.user), status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE
            ).order_by("name").first()
        if not community:
            return Response({"results": []})
        context = static_map_payload(community)
        area_name = community.name
        center = {"latitude": float(community.center_latitude), "longitude": float(community.center_longitude)}
        q_lower = q.casefold()
        local_hits = []
        for street in context.get("streets") or []:
            name = street.get("name") or ""
            if q_lower not in name.casefold():
                continue
            # Street catalog is barangay-local; pin to center (map still lets user adjust)
            local_hits.append(
                {
                    "lat": center["latitude"],
                    "lng": center["longitude"],
                    "label": f"{name}, {area_name}",
                    "primary": name,
                    "secondary": area_name,
                    "source": "street_catalog",
                }
            )

        remote = []
        try:
            min_lng = float(community.bbox_min_longitude or center["longitude"] - 0.02)
            max_lng = float(community.bbox_max_longitude or center["longitude"] + 0.02)
            min_lat = float(community.bbox_min_latitude or center["latitude"] - 0.02)
            max_lat = float(community.bbox_max_latitude or center["latitude"] + 0.02)
            viewbox = f"{min_lng},{max_lat},{max_lng},{min_lat}"
            queries = [
                f"{q}, {area_name}, Philippines",
                q,
            ]
            seen_remote: set[tuple[float, float, str]] = set()
            with httpx.Client(timeout=8.0, headers={"User-Agent": "E-Boses/1.0 (barangay-map)"}) as client:
                for query in queries:
                    url = (
                        "https://nominatim.openstreetmap.org/search?"
                        + urllib.parse.urlencode(
                            {
                                "q": query,
                                "format": "json",
                                "addressdetails": 1,
                                "limit": 12,
                                "countrycodes": "ph",
                                "viewbox": viewbox,
                                "bounded": 1,
                            }
                        )
                    )
                    try:
                        response = client.get(url)
                        response.raise_for_status()
                        data = response.json()
                    except Exception:
                        continue
                    for item in data:
                        addr = item.get("address") or {}
                        city = (
                            addr.get("city")
                            or addr.get("town")
                            or addr.get("municipality")
                            or addr.get("city_district")
                            or ""
                        )
                        house = addr.get("house_number")
                        road = addr.get("road") or addr.get("pedestrian") or addr.get("residential")
                        primary = (
                            f"{house} {road}".strip()
                            if house and road
                            else road
                            or addr.get("neighbourhood")
                            or addr.get("suburb")
                            or (item.get("display_name") or "").split(",")[0]
                        )
                        secondary_bits = [
                            addr.get("suburb") or addr.get("neighbourhood") or addr.get("village"),
                            city or area_name,
                        ]
                        secondary = ", ".join([b for b in secondary_bits if b])
                        lat = float(item["lat"])
                        lng = float(item["lon"])
                        key = (round(lat, 5), round(lng, 5), str(primary).casefold())
                        if key in seen_remote:
                            continue
                        seen_remote.add(key)
                        remote.append(
                            {
                                "lat": lat,
                                "lng": lng,
                                "label": item.get("display_name") or primary,
                                "primary": primary,
                                "secondary": secondary or area_name,
                                "source": "nominatim",
                            }
                        )
                    # Enough local hits — stop extra queries
                    if len(remote) >= 8:
                        break
        except Exception:
            remote = []

        pool = [
            row for row in remote + local_hits
            if row.get("source") == "street_catalog"
            or active_community_for_point(row["lat"], row["lng"]) == community
        ]
        ranked = sorted(
            pool,
            key=lambda row: (row["lat"] - center["latitude"]) ** 2 + (row["lng"] - center["longitude"]) ** 2,
        )[:8]
        results = [
            {
                "lat": row["lat"],
                "lng": row["lng"],
                "label": row.get("label") or row.get("primary"),
                "primary": row.get("primary") or row.get("label"),
                "secondary": row.get("secondary") or "",
                "zone": row.get("zone"),
                "accepted": True,
            }
            for row in ranked
        ]
        return Response({"results": results})
