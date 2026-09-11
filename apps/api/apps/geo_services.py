"""
Community geo helpers: boundary checks, soft/hard buffers, POIs, search bias.

Services layer:
  - Live OpenStreetMap amenities via Overpass (real names/coords)
  - Admin-managed MapServicePoi rows (add / override / hide OSM features)
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from django.core.cache import cache
from django.core.exceptions import ValidationError
from apps.community_scope import PRIMARY_COMMUNITY_CODE

logger = logging.getLogger(__name__)

# Last-good Overpass result (real OSM names/coords) for when mirrors time out
OSM_POI_SNAPSHOT_PATH = Path(__file__).resolve().parent / "data" / "marikina_heights_service_pois.json"

# Tight operational bounds (fallback when GeoJSON boundary missing)
MARIKINA_HEIGHTS_BOUNDS = {
    "min_latitude": 14.62,
    "max_latitude": 14.68,
    "min_longitude": 121.08,
    "max_longitude": 121.15,
}

# Marikina City rough extent — hard reject beyond this
MARIKINA_CITY_BOUNDS = {
    "min_latitude": 14.61,
    "max_latitude": 14.70,
    "min_longitude": 121.07,
    "max_longitude": 121.16,
}

MARIKINA_HEIGHTS_CENTER = {"latitude": 14.6507, "longitude": 121.1133, "zoom": 15}
MARIKINA_HEIGHTS_OSM_RELATION_ID = 371327

# Soft edge buffer (~250–300 m) — GPS / road edge cases
SOFT_BUFFER_METERS = 280
# Hard reject beyond ~1.2 km of Heights bbox (or outside Marikina City)
HARD_REJECT_METERS = 1200
# Services layer: keep real OSM amenities near Heights (not all of Marikina)
SERVICE_POI_MAX_DISTANCE_M = 1600
# Cap map markers so the picker stays usable
SERVICE_POI_MAP_LIMIT = 80
# Search suggestions: drop same-named streets in QC / other cities (e.g. Katipunan)
SEARCH_MAX_DISTANCE_M = 1800

OVERPASS_URLS = (
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
)
# Cache raw OSM results (names change slowly)
OSM_POI_CACHE_KEY = "locations-osm-pois:v2"
OSM_POI_CACHE_TTL = 60 * 60 * 6  # 6 hours
OSM_POI_FAIL_TTL = 90  # brief empty so map still loads; retries soon
# Circuit breaker: after every mirror fails, skip live Overpass for a while and
# serve the on-disk snapshot so map requests never stall on a dead mirror.
OVERPASS_BREAKER_KEY = "locations-osm-pois:breaker"
OVERPASS_BREAKER_TTL = 10 * 60
# Short budgets: Overpass mirrors either answer or 504. A 17-second block per
# request (measured 2026-08) made the alerts map unusable whenever the public
# mirrors were slow. Mirrors are tried in parallel and one success is enough.
OVERPASS_CONNECT_TIMEOUT = 3.0
OVERPASS_READ_TIMEOUT = 8.0
MAP_CONTEXT_CACHE_KEY = "locations-map-context:v4"
MAP_CONTEXT_CACHE_TTL = 300

POI_TYPE_META: list[dict[str, str]] = [
    {"type": "barangay_hall", "label": "Barangay Hall", "sector": "public"},
    {"type": "health_center", "label": "Health Center", "sector": "public"},
    {"type": "hospital", "label": "Hospital", "sector": "public"},
    {"type": "police", "label": "Police", "sector": "public"},
    {"type": "fire", "label": "Fire Station", "sector": "public"},
    {"type": "tanod", "label": "Tanod", "sector": "public"},
    {"type": "bdrrmo", "label": "BDRRMO", "sector": "public"},
    {"type": "evacuation", "label": "Evacuation", "sector": "public"},
    {"type": "school", "label": "School", "sector": "public"},
    {"type": "pharmacy", "label": "Pharmacy", "sector": "private"},
    {"type": "clinic", "label": "Clinic", "sector": "private"},
    {"type": "dentist", "label": "Dentist", "sector": "private"},
    {"type": "veterinary", "label": "Veterinary", "sector": "private"},
    {"type": "ambulance", "label": "Ambulance", "sector": "private"},
    {"type": "security", "label": "Security", "sector": "private"},
    {"type": "community", "label": "Community", "sector": "public"},
    {"type": "other", "label": "Service", "sector": "public"},
]

# Backward-compatible name used by older imports/tests
EMERGENCY_POIS: list[dict[str, Any]] = []


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def point_in_bbox(lat: float, lng: float, bounds: dict) -> bool:
    return (
        bounds["min_latitude"] <= lat <= bounds["max_latitude"]
        and bounds["min_longitude"] <= lng <= bounds["max_longitude"]
    )


def meters_outside_bbox(lat: float, lng: float, bounds: dict) -> float:
    """0 if inside bbox; otherwise approximate distance to nearest edge/corner."""
    if point_in_bbox(lat, lng, bounds):
        return 0.0
    clamped_lat = min(max(lat, bounds["min_latitude"]), bounds["max_latitude"])
    clamped_lng = min(max(lng, bounds["min_longitude"]), bounds["max_longitude"])
    return haversine_meters(lat, lng, clamped_lat, clamped_lng)


def _point_in_ring(longitude: float, latitude: float, ring: list) -> bool:
    # Coordinates loaded from Django DecimalFields can be Decimal instances,
    # while GeoJSON coordinates are normally floats. Keep all polygon math in
    # one numeric type so Decimal/float subtraction and multiplication do not
    # raise TypeError.
    longitude = float(longitude)
    latitude = float(latitude)
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = (float(value) for value in previous[:2])
        x2, y2 = (float(value) for value in current[:2])
        crosses = (y1 > latitude) != (y2 > latitude)
        if crosses:
            edge_x = (x2 - x1) * (latitude - y1) / ((y2 - y1) or 1e-12) + x1
            if longitude < edge_x:
                inside = not inside
        previous = current
    return inside


def _point_in_polygon(longitude: float, latitude: float, polygon: list) -> bool:
    if not polygon or not _point_in_ring(longitude, latitude, polygon[0]):
        return False
    return not any(_point_in_ring(longitude, latitude, hole) for hole in polygon[1:])


def point_in_geojson(longitude: float, latitude: float, geometry: dict | None) -> bool | None:
    """True/False if geometry usable; None if no geometry."""
    if not geometry:
        return None
    coordinates = geometry.get("coordinates") or []
    gtype = geometry.get("type")
    if gtype == "Polygon":
        return _point_in_polygon(longitude, latitude, coordinates)
    if gtype == "MultiPolygon":
        return any(_point_in_polygon(longitude, latitude, polygon) for polygon in coordinates)
    return None


def point_in_geojson_inclusive(
    longitude: float,
    latitude: float,
    geometry: dict | None,
    *,
    edge_tolerance_meters: float = 0.001,
) -> bool | None:
    inside = point_in_geojson(longitude, latitude, geometry)
    if inside is not False or not geometry:
        return inside
    coordinates = geometry.get("coordinates") or []
    polygons = [coordinates] if geometry.get("type") == "Polygon" else coordinates
    if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        return None
    for polygon in polygons:
        if not polygon:
            continue
        distance = _distance_to_ring_meters(longitude, latitude, polygon[0])
        if distance is not None and distance <= edge_tolerance_meters:
            return True
    return False


def active_communities_for_point(latitude, longitude):
    from apps.emergencies.models import Community
    from apps.community_scope import PRIMARY_COMMUNITY_CODE

    latitude = float(latitude)
    longitude = float(longitude)
    candidates = Community.objects.filter(
        status=Community.Status.ACTIVE,
        code=PRIMARY_COMMUNITY_CODE,
        boundary__is_active=True,
        boundary__kind="boundary",
    ).select_related("boundary")
    matches = []
    for community in candidates:
        bbox = (community.bbox_min_latitude, community.bbox_min_longitude, community.bbox_max_latitude, community.bbox_max_longitude)
        if all(value is not None for value in bbox) and not (
            float(bbox[0]) <= latitude <= float(bbox[2])
            and float(bbox[1]) <= longitude <= float(bbox[3])
        ):
            continue
        if point_in_geojson_inclusive(longitude, latitude, community.boundary.geometry):
            matches.append(community)
    return matches


def active_community_for_point(latitude, longitude):
    matches = active_communities_for_point(latitude, longitude)
    return matches[0] if len(matches) == 1 else None


def _distance_to_ring_meters(longitude: float, latitude: float, ring: list) -> float | None:
    """Return the approximate shortest distance from a point to a GeoJSON ring."""
    if not ring or len(ring) < 2:
        return None
    longitude = float(longitude)
    latitude = float(latitude)
    # A local equirectangular projection is accurate enough for a barangay-sized
    # boundary and avoids a GIS runtime dependency for the JSON map geometry.
    lat_scale = 110_540.0
    lng_scale = 111_320.0 * math.cos(math.radians(latitude))
    px, py = longitude * lng_scale, latitude * lat_scale
    shortest = float("inf")
    for first, second in zip(ring, ring[1:]):
        if len(first) < 2 or len(second) < 2:
            continue
        ax, ay = float(first[0]) * lng_scale, float(first[1]) * lat_scale
        bx, by = float(second[0]) * lng_scale, float(second[1]) * lat_scale
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        if length_sq:
            projection = ((px - ax) * dx + (py - ay) * dy) / length_sq
            projection = min(1.0, max(0.0, projection))
        else:
            projection = 0.0
        distance = math.hypot(px - (ax + projection * dx), py - (ay + projection * dy))
        shortest = min(shortest, distance)
    return None if shortest == float("inf") else shortest


def distance_to_geojson_boundary_meters(longitude: float, latitude: float, geometry: dict | None) -> float | None:
    """Return the shortest distance to a Polygon/MultiPolygon boundary in meters."""
    if not geometry:
        return None
    polygons = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        polygons = [polygons]
    if geometry.get("type") != "MultiPolygon" and not polygons:
        return None
    distances = []
    for polygon in polygons:
        for ring in polygon or []:
            distance = _distance_to_ring_meters(longitude, latitude, ring)
            if distance is not None:
                distances.append(distance)
    return min(distances) if distances else None


def get_active_boundary_geometry() -> dict | None:
    active_places = set()
    try:
        from apps.emergencies.models import Community, MapGeometry

        community = (
            Community.objects.filter(
                status=Community.Status.ACTIVE,
                code=PRIMARY_COMMUNITY_CODE,
                boundary__is_active=True,
            )
            .select_related("boundary")
            .order_by("name", "id")
            .first()
        )
        if community and community.boundary and community.boundary.geometry:
            return community.boundary.geometry

        boundary = (
            MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY, is_active=True)
            .order_by("-is_home", "name", "id")
            .first()
        )
        if boundary and boundary.geometry:
            return boundary.geometry
    except Exception:
        pass
    return None


def dispatch_policy_payload(community) -> dict[str, Any]:
    if community is None:
        return {
            "id": None,
            "barangay": "",
            "acceptance_center_latitude": None,
            "acceptance_center_longitude": None,
            "acceptance_radius_meters": 0,
            "acceptance_geometry": None,
            "out_of_zone_action": "review",
            "witness_radius_meters": 0,
            "nearby_distance_meters": 0,
            "hotlines": [],
        }
    try:
        from apps.emergencies.models import MapDispatchPolicy

        policy = MapDispatchPolicy.current(community)
        if policy:
            return policy.as_payload()
        raise LookupError("No dispatch policy configured")
    except Exception:
        return {
            "id": None,
            "barangay": community.name,
            "acceptance_center_latitude": float(community.center_latitude),
            "acceptance_center_longitude": float(community.center_longitude),
            "acceptance_radius_meters": 800,
            "acceptance_geometry": None,
            "out_of_zone_action": "review",
            "witness_radius_meters": 250,
            "responder_nearby_radius_meters": 100,
            "duty_hours_start": None,
            "duty_hours_end": None,
            "hotlines": [],
            "updated_at": None,
        }


def _point_is_in_acceptance_zone(latitude: float, longitude: float, community) -> bool:
    """Check the configured radius/shape without requiring boundary membership."""
    policy = dispatch_policy_payload(community)
    geometry = policy.get("acceptance_geometry")
    inside_geometry = point_in_geojson_inclusive(
        float(longitude), float(latitude), geometry
    )
    if inside_geometry is not None:
        return bool(inside_geometry)

    try:
        radius = float(policy.get("acceptance_radius_meters") or 0)
        center_lat = float(policy["acceptance_center_latitude"])
        center_lng = float(policy["acceptance_center_longitude"])
    except (KeyError, TypeError, ValueError):
        return False
    return radius > 0 and haversine_meters(
        float(latitude), float(longitude), center_lat, center_lng
    ) <= radius


def active_communities_for_coverage_point(latitude: float, longitude: float):
    """Return communities covered by their boundary OR acceptance zone."""
    boundary_matches = active_communities_for_point(latitude, longitude)
    if boundary_matches:
        # Preserve the existing ambiguity protection when boundaries overlap.
        return boundary_matches

    from apps.emergencies.models import Community

    candidates = Community.objects.filter(
        status=Community.Status.ACTIVE,
        code=PRIMARY_COMMUNITY_CODE,
    ).select_related("boundary")
    return [
        community
        for community in candidates
        if _point_is_in_acceptance_zone(latitude, longitude, community)
    ]


def active_community_for_coverage_point(latitude: float, longitude: float):
    matches = active_communities_for_coverage_point(latitude, longitude)
    return matches[0] if len(matches) == 1 else None


def acceptance_zone_result(
    latitude: float, longitude: float, community=None
) -> dict[str, Any]:
    communities = (
        [community]
        if community is not None
        else active_communities_for_coverage_point(latitude, longitude)
    )
    if len(communities) != 1:
        raise ValueError("A location covered by one active community is required.")
    policy = dispatch_policy_payload(communities[0])
    distance = haversine_meters(
        float(latitude),
        float(longitude),
        float(policy["acceptance_center_latitude"]),
        float(policy["acceptance_center_longitude"]),
    )
    radius = int(policy["acceptance_radius_meters"])
    # A drawn zone replaces the circle when one has been saved.
    geometry = policy.get("acceptance_geometry")
    inside_drawn = point_in_geojson_inclusive(float(longitude), float(latitude), geometry)
    return {
        "center_latitude": policy["acceptance_center_latitude"],
        "center_longitude": policy["acceptance_center_longitude"],
        "radius_meters": radius,
        "distance_meters": round(distance),
        "within": inside_drawn if inside_drawn is not None else distance <= radius,
        "action": policy["out_of_zone_action"],
    }


def is_inside_barangay_boundary(latitude: float, longitude: float) -> bool:
    lat = float(latitude)
    lng = float(longitude)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return False
    return len(active_communities_for_point(lat, lng)) == 1


def classify_location(latitude: float, longitude: float) -> dict[str, Any]:
    """
    Returns acceptance classification for a pin:
    - inside: accept
    - edge: accept with warning (soft buffer outside polygon/bounds)
    - far: reject
    """
    lat = float(latitude)
    lng = float(longitude)

    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return {
            "status": "far",
            "zone": "invalid",
            "accepted": False,
            "warning": None,
            "message": "Invalid coordinates.",
            "distance_meters": None,
        }

    boundary_communities = active_communities_for_point(lat, lng)
    communities = active_communities_for_coverage_point(lat, lng)
    if len(communities) == 1:
        community = communities[0]
        inside_boundary = len(boundary_communities) == 1 and boundary_communities[0].pk == community.pk
        result = {
            "status": "inside",
            "zone": "barangay" if inside_boundary else "acceptance_zone",
            "accepted": True,
            "warning": None,
            "message": (
                f"Location is inside {community.name}."
                if inside_boundary
                else f"Location is within the official acceptance zone for {community.name}."
            ),
            "distance_meters": (
                0
                if inside_boundary
                else round(
                    haversine_meters(
                        lat,
                        lng,
                        float(community.center_latitude),
                        float(community.center_longitude),
                    )
                )
            ),
            "community": {
                "id": str(community.public_id),
                "code": community.code,
                "name": community.name,
            },
        }
        try:
            zone = acceptance_zone_result(lat, lng, community=community)
        except ValueError:
            zone = None
        if zone is not None:
            result["acceptance_zone"] = zone
        return result

    from apps.emergencies.models import Community

    nearest_distance = None
    nearest_community = None
    candidates = Community.objects.filter(
        status=Community.Status.ACTIVE,
        code=PRIMARY_COMMUNITY_CODE,
        boundary__is_active=True,
    ).select_related("boundary")
    for candidate in candidates:
        boundary = candidate.boundary
        distance = distance_to_geojson_boundary_meters(
            lng, lat, boundary.geometry if boundary else None
        )
        if distance is None:
            bounds = {
                "min_latitude": float(candidate.bbox_min_latitude or lat),
                "max_latitude": float(candidate.bbox_max_latitude or lat),
                "min_longitude": float(candidate.bbox_min_longitude or lng),
                "max_longitude": float(candidate.bbox_max_longitude or lng),
            }
            distance = meters_outside_bbox(lat, lng, bounds)
        if nearest_distance is None or distance < nearest_distance:
            nearest_distance = distance
            nearest_community = candidate

    distance_outside = nearest_distance if nearest_distance is not None else float("inf")
    community_name = nearest_community.name if nearest_community else "an active community"

    if distance_outside <= SOFT_BUFFER_METERS:
        result = {
            "status": "edge",
            "zone": "edge_buffer",
            "accepted": True,
            "warning": (
                f"This pin is just outside the {community_name} boundary "
                f"(~{round(distance_outside)} m). Continue only if the concern is on the edge."
            ),
            "message": f"Near the {community_name} boundary.",
            "distance_meters": round(distance_outside),
        }
        try:
            zone = acceptance_zone_result(lat, lng, community=nearest_community)
        except ValueError:
            zone = None
        if zone is not None:
            result["acceptance_zone"] = zone
        if zone is not None and not zone["within"] and zone["action"] == "block":
            result.update({
                "status": "far",
                "zone": "outside_acceptance_zone",
                "accepted": False,
                "warning": None,
                "message": "Location is outside the official acceptance zone.",
            })
        return result

    return {
        "status": "far",
        "zone": "outside_community",
        "accepted": False,
        "warning": None,
        "message": f"Location is outside an active community. Choose a place inside {community_name}.",
        "distance_meters": None if math.isinf(distance_outside) else round(distance_outside),
    }


def score_search_result(lat: float, lng: float) -> float:
    """Lower is better. Prefer inside Heights, then closer to center."""
    classification = classify_location(lat, lng)
    from apps.emergencies.models import Community

    centers = Community.objects.filter(
        status=Community.Status.ACTIVE,
        code=PRIMARY_COMMUNITY_CODE,
    ).values_list(
        "center_latitude", "center_longitude"
    )
    distances = [haversine_meters(lat, lng, float(c_lat), float(c_lng)) for c_lat, c_lng in centers if c_lat is not None and c_lng is not None]
    dist_center = min(distances) if distances else float("inf")
    if classification["status"] == "inside":
        return dist_center
    if classification["status"] == "edge":
        return 50_000 + dist_center
    if classification.get("zone") == "outside_barangay":
        return 200_000 + dist_center
    return 1_000_000 + dist_center


def address_looks_outside_marikina(text: str) -> bool:
    """
    True when display text clearly points at another metro city
    (e.g. Katipunan, Quezon City) even if coords/viewbox are noisy.
    """
    t = f" {text.casefold()} "
    active_places = set()
    try:
        from apps.emergencies.models import Community

        active_places = {
            value.casefold()
            for row in Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).values("name", "boundary__locality")
            for value in (row.get("name") or "", row.get("boundary__locality") or "")
            if value
        }
        if any(f" {place} " in t for place in active_places):
            return False
    except Exception:
        pass
    # Explicit foreign LGUs / districts
    hard_foreign = (
        "quezon city",
        "quezon cty",
        " q.c.",
        " q.c ",
        " diliman",
        "loyola heights",
        "san juan city",
        "city of san juan",
        "pasig city",
        "cainta",
        "antipolo",
        "mandaluyong",
        "makati",
        "city of manila",
        "caloocan",
        "taguig",
        "pateros",
        "muntinlupa",
        "paranaque",
        "parañaque",
        "las piñas",
        "las pinas",
        "valenzuela",
        "malabon",
        "navotas",
        "san mateo, rizal",
        "cubao",
        "ortigas",
        "bonifacio global",
        "pasay",
        "baguio",
        "cebu",
    )
    if any(m in t for m in hard_foreign):
        return True
    # "Quezon" alone without Marikina is almost always QC noise for PH streets
    if "quezon" in t and not any(place in t for place in active_places):
        return True
    return False


def search_location_allowed(lat: float, lng: float, text: str = "") -> bool:
    """
    Search suggestions must be near Heights AND look local.
    Fixes same street names in QC (Katipunan) leaking through loose bbox 'edge' status.
    """
    if text and address_looks_outside_marikina(text):
        return False

    from apps.emergencies.models import Community

    centers = Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).values_list(
        "center_latitude", "center_longitude"
    )
    dist = min(
        (
            haversine_meters(lat, lng, float(c_lat), float(c_lng))
            for c_lat, c_lng in centers
            if c_lat is not None and c_lng is not None
        ),
        default=float("inf"),
    )
    if dist > SEARCH_MAX_DISTANCE_M:
        return False

    classification = classify_location(lat, lng)
    if classification["status"] not in {"inside", "edge"}:
        return False
    if not classification.get("accepted"):
        return False

    # "edge" with dist_bbox≈0 often means inside the huge operational bbox but
    # outside the real polygon — require near-center for those.
    if classification["status"] == "edge" and dist > (SOFT_BUFFER_METERS + 500):
        return False

    return True


def filter_and_rank_search_results(items: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    """Keep only places near Marikina Heights (not same-named streets in QC, etc.)."""
    ranked = []
    seen: set[tuple[float, float, str]] = set()
    for item in items:
        try:
            lat = float(item["lat"])
            lng = float(item["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        text_bits = " ".join(
            str(item.get(k) or "")
            for k in ("label", "primary", "secondary", "display_name")
        )
        if not search_location_allowed(lat, lng, text_bits):
            continue
        classification = classify_location(lat, lng)
        key = (round(lat, 5), round(lng, 5), (item.get("primary") or item.get("label") or "").casefold())
        if key in seen:
            continue
        seen.add(key)
        ranked.append(
            {
                **item,
                "lat": lat,
                "lng": lng,
                "score": score_search_result(lat, lng),
                "zone": classification["zone"],
                "accepted": True,
                "status": classification["status"],
            }
        )
    ranked.sort(key=lambda row: row["score"])
    return ranked[:limit]


def search_viewbox_with_buffer() -> str:
    """
    Tight Nominatim viewbox around Heights center (~1.6 km half-span).
    Format: left,top,right,bottom (min_lon,max_lat,max_lon,min_lat).
    Do NOT use the loose MARIKINA_HEIGHTS_BOUNDS — it reaches toward QC and
    lets Katipunan (Quezon City) match.
    """
    # ~1.6 km ≈ 0.0144° lat; slightly wider lng pad
    half_lat = 0.015
    half_lng = 0.015
    from apps.emergencies.models import Community

    center = Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).order_by("name").values(
        "center_latitude", "center_longitude"
    ).first() or {"center_latitude": 14.5995, "center_longitude": 120.9842}
    c_lat = float(center["center_latitude"])
    c_lng = float(center["center_longitude"])
    return (
        f"{c_lng - half_lng},{c_lat + half_lat},"
        f"{c_lng + half_lng},{c_lat - half_lat}"
    )


def _overpass_bbox_pad(pad_deg: float = 0.003) -> tuple[float, float, float, float]:
    """south, west, north, east for Overpass (Heights + soft edge pad)."""
    from apps.emergencies.models import Community

    rows = list(
        Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).values(
            "bbox_min_latitude", "bbox_min_longitude", "bbox_max_latitude", "bbox_max_longitude"
        )
    )
    if rows:
        b = {
            "min_latitude": min(float(row["bbox_min_latitude"]) for row in rows if row["bbox_min_latitude"] is not None),
            "min_longitude": min(float(row["bbox_min_longitude"]) for row in rows if row["bbox_min_longitude"] is not None),
            "max_latitude": max(float(row["bbox_max_latitude"]) for row in rows if row["bbox_max_latitude"] is not None),
            "max_longitude": max(float(row["bbox_max_longitude"]) for row in rows if row["bbox_max_longitude"] is not None),
        }
    else:
        b = MARIKINA_HEIGHTS_BOUNDS
    return (
        b["min_latitude"] - pad_deg,
        b["min_longitude"] - pad_deg,
        b["max_latitude"] + pad_deg,
        b["max_longitude"] + pad_deg,
    )


def _osm_element_coords(el: dict[str, Any]) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def _is_public_operator(tags: dict[str, str]) -> bool:
    bits = " ".join(
        str(tags.get(k) or "")
        for k in ("operator:type", "ownership", "operator", "government", "name")
    ).casefold()
    public_markers = (
        "public",
        "government",
        "gov",
        "city",
        "barangay",
        "municipal",
        "doh",
        "philippine",
        "police",
        "bfp",
        "pnp",
        "lgu",
    )
    return any(m in bits for m in public_markers)


def classify_osm_tags(tags: dict[str, str]) -> tuple[str, str, str] | None:
    """
    Map OSM tags → (poi_type, label, sector).
    Returns None if amenity is not a service we surface.
    """
    amenity = (tags.get("amenity") or "").casefold()
    healthcare = (tags.get("healthcare") or "").casefold()
    emergency = (tags.get("emergency") or "").casefold()
    office = (tags.get("office") or "").casefold()
    name = (tags.get("name") or "").casefold()

    if amenity == "pharmacy" or healthcare == "pharmacy":
        return "pharmacy", "Pharmacy", "private"
    if amenity == "hospital" or healthcare == "hospital":
        sector = "public" if _is_public_operator(tags) else "private"
        return "hospital", "Hospital", sector
    if amenity in {"clinic", "doctors"} or healthcare in {
        "clinic",
        "centre",
        "center",
        "doctor",
        "yes",
    }:
        if "health center" in name or "health centre" in name or "rhu" in name:
            return "health_center", "Health Center", "public"
        sector = "public" if _is_public_operator(tags) else "private"
        return "clinic", "Clinic", sector
    if amenity == "dentist" or healthcare == "dentist":
        return "dentist", "Dentist", "private"
    if amenity == "veterinary" or healthcare == "veterinary":
        return "veterinary", "Veterinary", "private"
    if amenity == "police":
        return "police", "Police", "public"
    if amenity == "fire_station":
        return "fire", "Fire Station", "public"
    if amenity == "ambulance_station" or emergency == "ambulance_station":
        sector = "public" if _is_public_operator(tags) else "private"
        return "ambulance", "Ambulance", sector
    if amenity == "townhall" or (office == "government" and "barangay" in name):
        return "barangay_hall", "Barangay Hall", "public"
    if amenity == "community_centre" or amenity == "community_center":
        if "barangay" in name or "hall" in name:
            return "barangay_hall", "Barangay Hall", "public"
        return "community", "Community", "public"
    if amenity == "school" or amenity in {"college", "kindergarten"}:
        return "school", "School", "public"
    if amenity == "social_facility" and healthcare:
        return "clinic", "Clinic", "public" if _is_public_operator(tags) else "private"
    if office == "government":
        return "community", "Government", "public"
    return None


def _overpass_query() -> str:
    """Compact Overpass QL — nodes first (fast), ways with center for buildings."""
    south, west, north, east = _overpass_bbox_pad()
    bbox = f"({south},{west},{north},{east})"
    # Split regex groups to keep query small; schools help as evacuation landmarks
    return f"""
[out:json][timeout:20];
(
  nwr["amenity"="pharmacy"]{bbox};
  nwr["amenity"="hospital"]{bbox};
  nwr["amenity"="clinic"]{bbox};
  nwr["amenity"="doctors"]{bbox};
  nwr["amenity"="dentist"]{bbox};
  nwr["amenity"="veterinary"]{bbox};
  nwr["amenity"="police"]{bbox};
  nwr["amenity"="fire_station"]{bbox};
  nwr["amenity"="ambulance_station"]{bbox};
  nwr["amenity"="townhall"]{bbox};
  nwr["amenity"="community_centre"]{bbox};
  nwr["amenity"="school"]{bbox};
  nwr["healthcare"]{bbox};
  nwr["emergency"="ambulance_station"]{bbox};
  nwr["office"="government"]{bbox};
);
out center tags;
""".strip()


def _load_osm_snapshot() -> list[dict[str, Any]]:
    try:
        if not OSM_POI_SNAPSHOT_PATH.is_file():
            return []
        raw = json.loads(OSM_POI_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return []
        return [p for p in raw if isinstance(p, dict) and "latitude" in p and "longitude" in p]
    except Exception as exc:  # noqa: BLE001
        logger.warning("OSM POI snapshot load failed: %s", exc)
        return []


def _save_osm_snapshot(pois: list[dict[str, Any]]) -> None:
    try:
        OSM_POI_SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OSM_POI_SNAPSHOT_PATH.write_text(
            json.dumps(pois, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("OSM POI snapshot save failed: %s", exc)


def _elements_to_pois(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pois: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for el in elements:
        tags = el.get("tags") or {}
        if not isinstance(tags, dict):
            continue
        classified = classify_osm_tags({str(k): str(v) for k, v in tags.items()})
        if not classified:
            continue
        coords = _osm_element_coords(el)
        if not coords:
            continue
        lat, lng = coords
        if not service_location_allowed(lat, lng):
            continue

        poi_type, label, sector = classified
        osm_type = str(el.get("type") or "node")[0].upper()
        if osm_type not in {"N", "W", "R"}:
            osm_type = "N"
        osm_id = int(el.get("id") or 0)
        if osm_id <= 0:
            continue
        poi_id = f"osm-{osm_type.lower()}{osm_id}"
        if poi_id in seen_ids:
            continue
        seen_ids.add(poi_id)

        name = (
            tags.get("name")
            or tags.get("name:en")
            or tags.get("official_name")
            or tags.get("brand")
            or label
        )
        pois.append(
            {
                "id": poi_id,
                "name": name,
                "type": poi_type,
                "label": label,
                "sector": sector,
                "latitude": round(lat, 7),
                "longitude": round(lng, 7),
                "source": "osm",
                "osm_type": osm_type,
                "osm_id": osm_id,
            }
        )
    return pois


def fetch_osm_service_pois(*, force_refresh: bool = False) -> list[dict[str, Any]]:
    """Live OpenStreetMap amenities in / near Heights (cached + on-disk snapshot).

    Never blocks map requests on a dead mirror: mirrors are queried in parallel
    with short timeouts, one success is enough, and after a full failure the
    circuit breaker serves the on-disk snapshot for OVERPASS_BREAKER_TTL.
    """
    if not force_refresh:
        cached = cache.get(OSM_POI_CACHE_KEY)
        if cached is not None:
            return cached
        # Never block map requests on the public Overpass mirrors: the on-disk
        # snapshot is the served source of truth. A live refresh only happens
        # on an explicit force (refresh_map_service_pois command) or on a first
        # ever run with no snapshot at all.
        snapshot = _load_osm_snapshot()
        if snapshot:
            cache.set(OSM_POI_CACHE_KEY, snapshot, OSM_POI_CACHE_TTL)
            return snapshot
        if cache.get(OVERPASS_BREAKER_KEY):
            return []

    import httpx

    query = _overpass_query()
    timeout = httpx.Timeout(OVERPASS_READ_TIMEOUT, connect=OVERPASS_CONNECT_TIMEOUT)
    headers = {"User-Agent": "E-Boses/1.0 (barangay-map-pois; educational)"}

    elements: list[dict[str, Any]] = []
    errors: list[str] = []

    def _try_mirror(url: str) -> list[dict[str, Any]] | None:
        try:
            with httpx.Client(timeout=timeout, headers=headers) as client:
                response = client.post(url, data={"data": query})
                response.raise_for_status()
                payload = response.json()
            return list(payload.get("elements") or [])
        except Exception as exc:  # noqa: BLE001 — try next mirror
            logger.warning("Overpass fetch failed via %s: %s", url, exc)
            errors.append(f"{url}: {type(exc).__name__}: {exc}")
            return None

    # Query every mirror at once; the first that answers wins. One slow mirror
    # can no longer serialize every other mirror behind it.
    pool = ThreadPoolExecutor(max_workers=len(OVERPASS_URLS))
    try:
        futures = [pool.submit(_try_mirror, url) for url in OVERPASS_URLS]
        for future in as_completed(futures):
            result = future.result()
            if result:
                elements = result
                for other in futures:
                    other.cancel()
                break
    finally:
        # Never block the request on mirrors that are still timing out; they
        # finish on their own in the background.
        pool.shutdown(wait=False)

    if not elements:
        # Every mirror failed (or returned nothing). Trip the breaker so the
        # next requests serve the snapshot immediately instead of re-stalling.
        if errors:
            logger.error("All Overpass mirrors failed: %s", "; ".join(errors[:3]))
        cache.set(OVERPASS_BREAKER_KEY, True, OVERPASS_BREAKER_TTL)
        snapshot = _load_osm_snapshot()
        if snapshot:
            logger.info("Overpass unavailable; using OSM POI snapshot (%s places)", len(snapshot))
            cache.set(OSM_POI_CACHE_KEY, snapshot, OSM_POI_CACHE_TTL)
            return snapshot
        logger.error("Overpass mirrors failed and no POI snapshot is available.")
        cache.set(OSM_POI_CACHE_KEY, [], OSM_POI_FAIL_TTL)
        return []

    pois = _elements_to_pois(elements)
    if pois:
        _save_osm_snapshot(pois)
    else:
        # Live returned empty (rare) — keep last good snapshot if any
        snapshot = _load_osm_snapshot()
        if snapshot:
            pois = snapshot

    cache.set(OSM_POI_CACHE_KEY, pois, OSM_POI_CACHE_TTL if pois else OSM_POI_FAIL_TTL)
    return pois


def _admin_service_pois(community=None) -> tuple[list[dict[str, Any]], set[tuple[str, int]]]:
    """
    Returns (active admin POIs, suppressed OSM keys).
    Suppressed = inactive admin rows with osm_type + osm_id.
    Active rows with osm_type + osm_id also replace that OSM feature.
    """
    active: list[dict[str, Any]] = []
    suppressed: set[tuple[str, int]] = set()
    try:
        from apps.emergencies.models import MapServicePoi

        rows = MapServicePoi.objects.all()
        if community is not None:
            rows = rows.filter(community=community)
        for row in rows.only(
            "id",
            "name",
            "poi_type",
            "label",
            "sector",
            "latitude",
            "longitude",
            "source",
            "osm_type",
            "osm_id",
            "is_active",
            "priority",
        ):
            osm_key: tuple[str, int] | None = None
            if row.osm_type and row.osm_id:
                osm_key = (row.osm_type.upper()[:1], int(row.osm_id))

            if not row.is_active:
                if osm_key:
                    suppressed.add(osm_key)
                continue

            if osm_key:
                suppressed.add(osm_key)  # replace OSM copy with admin version

            active.append(
                {
                    "id": f"admin-{row.id}",
                    "name": row.name,
                    "type": row.poi_type,
                    "label": row.resolved_label(),
                    "sector": row.sector,
                    "latitude": float(row.latitude),
                    "longitude": float(row.longitude),
                    "source": row.source or "admin",
                    "osm_type": (row.osm_type or "").upper()[:1] or None,
                    "osm_id": int(row.osm_id) if row.osm_id else None,
                    "priority": int(row.priority or 0),
                }
            )
    except Exception as exc:  # noqa: BLE001 — migrations / empty DB
        logger.debug("Admin MapServicePoi load skipped: %s", exc)

    active.sort(key=lambda p: (-int(p.get("priority") or 0), p.get("name") or ""))
    return active, suppressed


def _service_poi_rank(poi: dict[str, Any]) -> tuple:
    """Prefer emergency/health services over dense school clusters; nearer first."""
    type_rank = {
        "barangay_hall": 0,
        "police": 1,
        "fire": 1,
        "hospital": 2,
        "health_center": 2,
        "ambulance": 2,
        "pharmacy": 3,
        "clinic": 3,
        "dentist": 4,
        "veterinary": 4,
        "bdrrmo": 2,
        "tanod": 2,
        "evacuation": 3,
        "security": 5,
        "community": 5,
        "school": 8,
        "other": 6,
    }.get(poi.get("type") or "", 7)
    try:
        from apps.emergencies.models import Community

        dist = min(
            (
                haversine_meters(
                    float(poi["latitude"]),
                    float(poi["longitude"]),
                    float(lat),
                    float(lng),
                )
                for lat, lng in Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE).values_list(
                    "center_latitude", "center_longitude"
                )
                if lat is not None and lng is not None
            ),
            default=float("inf"),
        )
    except Exception:
        dist = float("inf")
    src_rank = 0 if poi.get("source") in {"admin", "curated"} else 1
    return (src_rank, type_rank, dist, (poi.get("name") or "").casefold())


def service_location_allowed(lat: float, lng: float, community=None) -> bool:
    """
    Services: inside/edge for pin policy, and within ~2 km of Heights center.
    Prevents the loose city bbox from flooding the map with San Mateo / city-wide schools.
    """
    communities = active_communities_for_point(lat, lng)
    if community is not None and not any(item.pk == community.pk for item in communities):
        return False
    if community is None and not communities:
        return False
    center = community or communities[0]
    dist = haversine_meters(
        lat, lng, float(center.center_latitude), float(center.center_longitude)
    )
    return dist <= SERVICE_POI_MAX_DISTANCE_M


def collect_service_pois(*, force_refresh: bool = False, community=None) -> list[dict[str, Any]]:
    """Merge real OSM amenities with admin-managed POIs for the Services layer."""
    osm = fetch_osm_service_pois(force_refresh=force_refresh)
    admin_pois, suppressed = _admin_service_pois(community)

    merged: list[dict[str, Any]] = []
    for poi in osm:
        key = (str(poi.get("osm_type") or "N").upper()[:1], int(poi.get("osm_id") or 0))
        if key in suppressed:
            continue
        if not service_location_allowed(poi["latitude"], poi["longitude"], community):
            continue
        merged.append(poi)

    for poi in admin_pois:
        # Admin pins: allow slightly looser — same inside/edge + distance policy
        if not service_location_allowed(poi["latitude"], poi["longitude"], community):
            continue
        clean = {k: v for k, v in poi.items() if k != "priority"}
        merged.append(clean)

    merged.sort(key=_service_poi_rank)
    if len(merged) > SERVICE_POI_MAP_LIMIT:
        # Always keep all admin pins; trim OSM surplus by rank
        admin_kept = [p for p in merged if p.get("source") in {"admin", "curated"}]
        osm_kept = [p for p in merged if p.get("source") == "osm"]
        room = max(0, SERVICE_POI_MAP_LIMIT - len(admin_kept))
        merged = admin_kept + osm_kept[:room]
        merged.sort(key=_service_poi_rank)
    return merged


def validate_barangay_location(latitude, longitude):
    """
    Accept pins inside an active community or its configured edge buffer.
    """
    if latitude is None or longitude is None:
        raise ValidationError("Latitude and longitude must be provided together.")
    result = classify_location(latitude, longitude)
    if not result.get("accepted"):
        raise ValidationError(result.get("message") or "Location must be inside an active community.")


def validate_emergency_location(latitude, longitude):
    if latitude is None or longitude is None:
        raise ValidationError("Latitude and longitude must be provided together.")
    community = active_community_for_coverage_point(latitude, longitude)
    if not community:
        raise ValidationError("Emergency location must be inside an active community boundary or acceptance radius.")
    return community


def validate_report_location(latitude, longitude):
    if latitude is None or longitude is None:
        raise ValidationError("Latitude and longitude must be provided together.")
    community = active_community_for_coverage_point(latitude, longitude)
    if not community:
        from apps.emergencies.models import Community

        active = list(Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE))
        nearest = min(
            active,
            key=lambda item: haversine_meters(
                float(latitude),
                float(longitude),
                float(item.center_latitude),
                float(item.center_longitude),
            ),
            default=None,
        )
        if nearest:
            raise ValidationError(
                f"Location is too far from Barangay {nearest.name}. Choose a place inside the active boundary or acceptance radius."
            )
        raise ValidationError("Location must be inside an active community boundary or acceptance radius.")
    return {
        "action": "accept",
        "community_id": community.pk,
        "summary": "Required report checks passed. Advanced analysis is pending.",
    }


# ---------------------------------------------------------------------------
# Reverse geocoding
# ---------------------------------------------------------------------------
# Until now the only reverse geocoding in E-Boses ran in the browser (the SOS
# map step calls Nominatim directly). An emergency that arrives by SMS has no
# browser, so its address was stored as the literal string "SMS fallback
# coordinates" and an official saw no street name at all.
#
# This never runs inline with dispatch. Callers schedule it after the alert is
# saved and routed - see apps.emergencies.location_services.

NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

# Nominatim's usage policy wants an identifying User-Agent and at most one
# request per second. A browser cannot set User-Agent at all, so calling it
# directly from the SOS map gets the whole barangay's public IP rate-limited to
# 429 - and a 429 carries no CORS headers, which surfaces as a confusing CORS
# error rather than "you are being throttled". Everything goes through here.
NOMINATIM_USER_AGENT = "E-Boses/1.0 (community emergency dispatch)"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_LOOKUP_URL = "https://nominatim.openstreetmap.org/lookup"
NOMINATIM_MIN_INTERVAL_SECONDS = 1.1
NOMINATIM_PACE_KEY = "nominatim-last-call"
NOMINATIM_PACE_LOCK_KEY = "nominatim-pace-lock"
NOMINATIM_RAW_CACHE_TTL = 60 * 60 * 24 * 30
NOMINATIM_FAIL_CACHE_TTL = 120
NOMINATIM_STALE_CACHE_TTL = 60 * 60 * 24 * 90
NOMINATIM_LOCK_TTL = 15


def _pace_nominatim() -> None:
    """Keep outbound starts 1.1s apart across workers and hosts."""
    import time

    while not cache.add(NOMINATIM_PACE_LOCK_KEY, True, NOMINATIM_LOCK_TTL):
        time.sleep(0.05)
    try:
        now = time.time()
        last = cache.get(NOMINATIM_PACE_KEY)
        try:
            elapsed = now - float(last)
        except (TypeError, ValueError):
            elapsed = NOMINATIM_MIN_INTERVAL_SECONDS
        if 0 <= elapsed < NOMINATIM_MIN_INTERVAL_SECONDS:
            time.sleep(NOMINATIM_MIN_INTERVAL_SECONDS - elapsed)
        cache.set(NOMINATIM_PACE_KEY, time.time(), 60)
    finally:
        cache.delete(NOMINATIM_PACE_LOCK_KEY)


def _nominatim_get(url: str, params: dict, cache_key: str):
    """Cached, paced, identified GET against Nominatim. Never raises."""
    import time

    cached = cache.get(cache_key)
    if cached is not None:
        if isinstance(cached, dict) and cached.get("_nominatim_failed"):
            return None
        return cached

    lock_key = f"{cache_key}:lock"
    if not cache.add(lock_key, True, NOMINATIM_LOCK_TTL):
        # Let the request holding the lock publish a result. Do not let a
        # burst of page loads become a burst of Nominatim calls.
        for _ in range(15):
            time.sleep(0.1)
            cached = cache.get(cache_key)
            if cached is not None:
                if isinstance(cached, dict) and cached.get("_nominatim_failed"):
                    return None
                return cached
        return cache.get(f"{cache_key}:stale")

    try:
        cached = cache.get(cache_key)
        if cached is not None:
            return None if isinstance(cached, dict) and cached.get("_nominatim_failed") else cached
        import httpx

        _pace_nominatim()
        response = httpx.get(
            url,
            params=params,
            headers={"User-Agent": NOMINATIM_USER_AGENT, "Accept-Language": "en"},
            timeout=REVERSE_GEOCODE_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.warning("Nominatim request failed: %s", type(exc).__name__)
        cache.set(cache_key, {"_nominatim_failed": True}, NOMINATIM_FAIL_CACHE_TTL)
        return cache.get(f"{cache_key}:stale")
    else:
        cache.set(cache_key, payload, NOMINATIM_RAW_CACHE_TTL)
        cache.set(f"{cache_key}:stale", payload, NOMINATIM_STALE_CACHE_TTL)
        return payload
    finally:
        cache.delete(lock_key)


NEAREST_STREET_CACHE_KEY = "map-street-index:v1"
NEAREST_STREET_CACHE_TTL = 60 * 30
NEAREST_STREET_MAX_METERS = 120


def _street_index():
    """(name, [(lng, lat), ...]) for every active street geometry."""
    cached = cache.get(NEAREST_STREET_CACHE_KEY)
    if cached is not None:
        return cached

    from apps.emergencies.models import MapGeometry

    index = []
    rows = MapGeometry.objects.filter(
        kind=MapGeometry.Kind.STREET, is_active=True
    ).values_list("name", "geometry")
    for name, geometry in rows:
        if not name or not isinstance(geometry, dict):
            continue
        coordinates = geometry.get("coordinates") or []
        gtype = geometry.get("type")
        lines = [coordinates] if gtype == "LineString" else coordinates if gtype == "MultiLineString" else []
        points = [
            (float(point[0]), float(point[1]))
            for line in lines
            for point in line
            if isinstance(point, (list, tuple)) and len(point) >= 2
        ]
        if points:
            index.append((name, points))

    cache.set(NEAREST_STREET_CACHE_KEY, index, NEAREST_STREET_CACHE_TTL)
    return index


def nearest_known_street(latitude: float, longitude: float) -> dict[str, Any]:
    """Closest barangay street from local geometry, no external call.

    The barangay's own street data answers the question Nominatim was being
    asked, without a network round trip, a rate limit, or a dependency that can
    be down during an emergency. Nominatim is only consulted when the pin is
    too far from any known street.
    """
    best_name = ""
    best_distance = float("inf")
    for name, points in _street_index():
        for lng, lat in points:
            distance = haversine_meters(latitude, longitude, lat, lng)
            if distance < best_distance:
                best_distance = distance
                best_name = name
    if not best_name or best_distance > NEAREST_STREET_MAX_METERS:
        return {"street": "", "distance_meters": None, "house_number": ""}

    return {
        "street": best_name,
        "distance_meters": round(best_distance, 1),
        "house_number": _nearest_house_number(latitude, longitude, best_name),
    }


NEAREST_HOUSE_MAX_METERS = 35


def _nearest_house_number(latitude: float, longitude: float, street: str) -> str:
    """House number within a few metres of the pin, if OSM knows one.

    Deliberately tight: a house number 30 m away is a different house, and a
    confidently wrong address sends responders to the wrong gate.
    """
    from apps.emergencies.models import MapAddressPoint

    # A small bounding box first so this stays an indexed lookup rather than a
    # scan of every address in the barangay.
    delta = 0.0005  # ~55 m
    candidates = MapAddressPoint.objects.filter(
        latitude__gte=latitude - delta,
        latitude__lte=latitude + delta,
        longitude__gte=longitude - delta,
        longitude__lte=longitude + delta,
    ).values_list("house_number", "street", "latitude", "longitude")

    best_number = ""
    best_distance = float("inf")
    for house_number, house_street, lat, lng in candidates:
        if not house_number:
            continue
        # Prefer a point that agrees with the street we already matched.
        if house_street and street and house_street.lower() != street.lower():
            continue
        distance = haversine_meters(latitude, longitude, float(lat), float(lng))
        if distance < best_distance:
            best_distance = distance
            best_number = house_number
    return best_number if best_distance <= NEAREST_HOUSE_MAX_METERS else ""


def nominatim_reverse(latitude: float, longitude: float, zoom: int = 18):
    """Raw reverse-geocode payload, cached at ~11 m resolution."""
    key = f"nominatim-rev:v1:{latitude:.4f},{longitude:.4f}:{zoom}"
    return _nominatim_get(
        NOMINATIM_REVERSE_URL,
        {
            "lat": f"{latitude:.7f}",
            "lon": f"{longitude:.7f}",
            "format": "jsonv2",
            "addressdetails": 1,
            "zoom": zoom,
        },
        key,
    )


def nominatim_search(query: str, limit: int = 1):
    """Raw forward-geocode payload for a place name."""
    normalized = " ".join((query or "").split()).lower()
    if not normalized:
        return None
    key = f"nominatim-fwd:v1:{hashlib.sha256(normalized.encode()).hexdigest()[:24]}:{limit}"
    return _nominatim_get(
        NOMINATIM_SEARCH_URL,
        {
            "q": query,
            "format": "jsonv2",
            "limit": limit,
            "countrycodes": "ph",
            "addressdetails": 1,
        },
        key,
    )


def search_boundaries_online(query: str, limit: int = 12) -> list[dict[str, Any]]:
    """
    Administrative outlines matching a name, straight from OSM.

    The saved MapGeometry rows only cover barangays this deployment has already
    imported, so a station configuring coverage for a barangay nobody has
    touched would search an empty table. This asks Nominatim for the real
    polygon instead of inventing one.
    """
    # Pasted addresses arrive with newlines and commas; collapse them so the
    # upstream query is one line.
    normalized = " ".join((query or "").replace(",", " ").split())
    if len(normalized) < 3:
        return []

    # Nominatim ranks place *nodes* above the administrative *relation* that
    # actually carries the outline, so a small limit returns points only. Ask
    # for a wide page and keep the polygons out of it.
    upstream_limit = max(limit * 2, 25)
    key = (
        "nominatim-boundary:v2:"
        f"{hashlib.sha256(normalized.lower().encode()).hexdigest()[:24]}:{upstream_limit}"
    )
    payload = _nominatim_get(
        NOMINATIM_SEARCH_URL,
        {
            "q": normalized,
            "format": "jsonv2",
            "limit": upstream_limit,
            "countrycodes": "ph",
            "addressdetails": 1,
            "polygon_geojson": 1,
        },
        key,
    )
    if not isinstance(payload, list):
        return []

    found: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        geometry = item.get("geojson")
        if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        address = item.get("address") or {}
        display = item.get("display_name") or ""
        found.append(
            {
                "id": None,
                "source": "osm",
                "name": item.get("name") or display.split(",")[0].strip(),
                "locality": address.get("city")
                or address.get("town")
                or address.get("municipality")
                or address.get("province")
                or "",
                "osm_id": item.get("osm_id"),
                "is_home": False,
                "geometry": geometry,
            }
        )
        if len(found) >= limit:
            break
    return found


REVERSE_GEOCODE_CACHE_PREFIX = "reverse-geocode:v1:"
REVERSE_GEOCODE_CACHE_TTL = 60 * 60 * 24 * 30  # street names change slowly
REVERSE_GEOCODE_TIMEOUT = 6.0

REVERSE_STATUS_SUCCESS = "success"
REVERSE_STATUS_FAILED = "failed"
REVERSE_STATUS_SKIPPED = "skipped"


def _reverse_cache_key(latitude: float, longitude: float) -> str:
    # ~11 m of precision. Two pins on the same stretch of street share a cache
    # entry, which keeps us well inside Nominatim's usage policy during a
    # multi-casualty incident that produces a burst of alerts.
    return f"{REVERSE_GEOCODE_CACHE_PREFIX}{latitude:.4f},{longitude:.4f}"


def _compose_readable_area(address: dict[str, Any]) -> str:
    """Build "Champaca Street, Marikina Heights" from Nominatim address parts.

    Prefers the most specific thing a responder can actually navigate to, and
    always appends the barangay so the string reads like a local address rather
    than a postal one.
    """
    street = (
        address.get("road")
        or address.get("pedestrian")
        or address.get("footway")
        or address.get("residential")
        or ""
    ).strip()
    landmark = (address.get("amenity") or address.get("building") or "").strip()
    village = (
        address.get("village")
        or address.get("suburb")
        or address.get("neighbourhood")
        or address.get("quarter")
        or ""
    ).strip()

    head = landmark or street
    parts = [part for part in (head, village) if part]
    if not parts:
        city = (address.get("city") or address.get("town") or address.get("municipality") or "").strip()
        return city
    # Avoid "Marikina Heights, Marikina Heights" when the road IS the village.
    deduped: list[str] = []
    for part in parts:
        if part.lower() not in {existing.lower() for existing in deduped}:
            deduped.append(part)
    return ", ".join(deduped)


def reverse_geocode(latitude, longitude) -> dict[str, Any]:
    """Resolve coordinates to a readable area.

    Returns ``{"status", "location", "raw"}``. Never raises: a failed lookup
    must degrade to "we do not know the street yet", never break dispatch.
    """
    if latitude is None or longitude is None:
        return {"status": REVERSE_STATUS_SKIPPED, "location": "", "raw": {}}

    from django.conf import settings

    try:
        lat = float(latitude)
        lng = float(longitude)
    except (TypeError, ValueError):
        return {"status": REVERSE_STATUS_SKIPPED, "location": "", "raw": {}}

    def local_fallback(status=REVERSE_STATUS_FAILED):
        known = nearest_known_street(lat, lng)
        street = (known.get("street") or "").strip()
        if not street:
            return {"status": status, "location": "", "raw": {}}
        house = (known.get("house_number") or "").strip()
        location = " ".join(part for part in (house, street) if part)
        return {
            "status": REVERSE_STATUS_SUCCESS,
            "location": location[:255],
            "raw": {"road": street, "source": "local_street_geometry"},
        }

    if not getattr(settings, "REVERSE_GEOCODE_ENABLED", True):
        return local_fallback(REVERSE_STATUS_SKIPPED)

    cache_key = _reverse_cache_key(lat, lng)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        import httpx

        response = httpx.get(
            NOMINATIM_REVERSE_URL,
            params={
                "lat": f"{lat:.7f}",
                "lon": f"{lng:.7f}",
                "format": "jsonv2",
                "addressdetails": 1,
                "zoom": 17,
            },
            headers={
                # Nominatim's usage policy requires a real identifying UA.
                "User-Agent": NOMINATIM_USER_AGENT,
                "Accept-Language": "en",
            },
            timeout=REVERSE_GEOCODE_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.warning("Reverse geocode failed for a pin: %s", type(exc).__name__)
        # Cache the failure briefly so a dead mirror does not stall every alert.
        result = local_fallback()
        cache.set(cache_key, result, 120)
        return result

    address = payload.get("address") or {}
    location = _compose_readable_area(address) or (payload.get("display_name") or "").split(",")[0].strip()
    result = {
        "status": REVERSE_STATUS_SUCCESS if location else REVERSE_STATUS_FAILED,
        "location": location[:255],
        "raw": {key: address.get(key) for key in ("road", "suburb", "village", "city", "amenity") if address.get(key)},
    }
    if not location:
        result = local_fallback()
    cache.set(cache_key, result, REVERSE_GEOCODE_CACHE_TTL if location else 300)
    return result


def map_context_payload(community) -> dict[str, Any]:
    # v3: real OSM POIs + admin MapServicePoi merge
    map_version = cache.get(f"community-map-cache-version:{community.pk}", 1)
    cache_key = f"{MAP_CONTEXT_CACHE_KEY}:{community.pk}:{community.boundary_revision}:{map_version}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    geometry = community.boundary.geometry if community.boundary and community.boundary.is_active else None
    streets = []
    try:
        from apps.live_map import static_map_payload

        static = static_map_payload(community)
        boundary = static.get("boundary") or {}
        if boundary.get("geometry"):
            geometry = boundary["geometry"]
        street_groups = static.get("streets") or {}
        streets = street_groups.get("streets") or []
    except Exception:
        pass

    pois = collect_service_pois(community=community)

    bounds = {
        "min_latitude": float(community.bbox_min_latitude),
        "max_latitude": float(community.bbox_max_latitude),
        "min_longitude": float(community.bbox_min_longitude),
        "max_longitude": float(community.bbox_max_longitude),
    }
    payload = {
        "center": {"latitude": float(community.center_latitude), "longitude": float(community.center_longitude)},
        "bounds": bounds,
        "city_bounds": bounds,
        "soft_buffer_meters": SOFT_BUFFER_METERS,
        "hard_reject_meters": HARD_REJECT_METERS,
        "dispatch_policy": dispatch_policy_payload(community),
        "boundary": {
            "name": boundary.get("name") or community.name,
            "osm_relation_id": getattr(community.boundary, "osm_id", None),
            "geometry": geometry,
        },
        "streets": streets[:80],  # keep payload light
        "pois": pois,
        "poi_types": POI_TYPE_META,
        "poi_sources": {
            "osm": sum(1 for p in pois if p.get("source") == "osm"),
            "admin": sum(1 for p in pois if p.get("source") in {"admin", "curated"}),
            "total": len(pois),
        },
    }
    cache.set(cache_key, payload, MAP_CONTEXT_CACHE_TTL)
    return payload
