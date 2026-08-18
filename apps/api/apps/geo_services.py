"""
Marikina Heights geo helpers: boundary checks, soft/hard buffers, POIs, search bias.

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
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous[:2]
        x2, y2 = current[:2]
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


def _distance_to_ring_meters(longitude: float, latitude: float, ring: list) -> float | None:
    """Return the approximate shortest distance from a point to a GeoJSON ring."""
    if not ring or len(ring) < 2:
        return None
    # A local equirectangular projection is accurate enough for a barangay-sized
    # boundary and avoids a GIS runtime dependency for the JSON map geometry.
    lat_scale = 110_540.0
    lng_scale = 111_320.0 * math.cos(math.radians(latitude))
    px, py = longitude * lng_scale, latitude * lat_scale
    shortest = float("inf")
    for first, second in zip(ring, ring[1:]):
        if len(first) < 2 or len(second) < 2:
            continue
        ax, ay = first[0] * lng_scale, first[1] * lat_scale
        bx, by = second[0] * lng_scale, second[1] * lat_scale
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
    try:
        from apps.emergencies.models import MapGeometry

        boundary = (
            MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY, is_active=True)
            .order_by("name", "id")
            .first()
        )
        if boundary and boundary.geometry:
            return boundary.geometry
    except Exception:
        pass
    return None


def dispatch_policy_payload() -> dict[str, Any]:
    try:
        from apps.emergencies.models import MapDispatchPolicy

        return MapDispatchPolicy.current().as_payload()
    except Exception:
        return {
            "id": None,
            "barangay": "Marikina Heights",
            "covered": [],
            "acceptance_center_latitude": MARIKINA_HEIGHTS_CENTER["latitude"],
            "acceptance_center_longitude": MARIKINA_HEIGHTS_CENTER["longitude"],
            "acceptance_radius_meters": 800,
            "out_of_zone_action": "review",
            "witness_radius_meters": 250,
            "responder_nearby_radius_meters": 100,
            "duty_hours_start": None,
            "duty_hours_end": None,
            "hotlines": [
                {"label": "Marikina Rescue", "number": "161"},
                {"label": "Emergency", "number": "911"},
            ],
            "updated_at": None,
        }


COVERAGE_CACHE_KEY = "coverage-boundaries:v1"
COVERAGE_CACHE_TTL = 300


def covered_boundaries() -> list[dict[str, Any]]:
    """The barangay boundaries this station answers for.

    Cached because classify_location runs once per POI and per search result;
    an uncached read would put a query behind every marker on the map.
    """
    cached = cache.get(COVERAGE_CACHE_KEY)
    if cached is not None:
        return cached

    rows: list[dict[str, Any]] = []
    try:
        from apps.emergencies.models import MapDispatchPolicy

        for row in MapDispatchPolicy.current().covered_geometries():
            if row.geometry:
                rows.append(
                    {
                        "id": row.pk,
                        "name": row.name,
                        "locality": row.locality,
                        "is_home": row.is_home,
                        "geometry": row.geometry,
                    }
                )
    except Exception as exc:  # noqa: BLE001 — migrations / empty DB
        logger.debug("Coverage boundary load skipped: %s", exc)

    if not rows:
        geometry = get_active_boundary_geometry()
        if geometry:
            rows = [
                {
                    "id": None,
                    "name": "Marikina Heights",
                    "locality": "Marikina",
                    "is_home": True,
                    "geometry": geometry,
                }
            ]

    cache.set(COVERAGE_CACHE_KEY, rows, COVERAGE_CACHE_TTL)
    return rows


def invalidate_coverage_cache() -> None:
    cache.delete(COVERAGE_CACHE_KEY)
    cache.delete(MAP_CONTEXT_CACHE_KEY)


def coverage_label() -> str:
    names = [row["name"] for row in covered_boundaries()]
    if not names:
        return "Barangay Marikina Heights"
    if len(names) == 1:
        return f"Barangay {names[0]}"
    return f"your coverage area ({len(names)} barangays)"


def coverage_result(latitude: float, longitude: float) -> dict[str, Any]:
    """Where a pin sits relative to the configured coverage area."""
    lat = float(latitude)
    lng = float(longitude)
    action = dispatch_policy_payload().get("out_of_zone_action") or "review"

    nearest_name = ""
    nearest_distance: float | None = None
    for row in covered_boundaries():
        if point_in_geojson(lng, lat, row["geometry"]) is True:
            return {
                "within": True,
                "barangay": row["name"],
                "locality": row["locality"],
                "distance_meters": 0,
                "action": action,
            }
        distance = distance_to_geojson_boundary_meters(lng, lat, row["geometry"])
        if distance is not None and (nearest_distance is None or distance < nearest_distance):
            nearest_distance = distance
            nearest_name = row["name"]

    return {
        "within": False,
        "barangay": None,
        "nearest": nearest_name,
        "distance_meters": round(nearest_distance) if nearest_distance is not None else None,
        "action": action,
    }


def acceptance_zone_result(latitude: float, longitude: float) -> dict[str, Any]:
    """Back-compatible shape for callers written against the old radius zone."""
    result = coverage_result(latitude, longitude)
    return {
        "center_latitude": MARIKINA_HEIGHTS_CENTER["latitude"],
        "center_longitude": MARIKINA_HEIGHTS_CENTER["longitude"],
        "radius_meters": None,
        "barangay": result.get("barangay"),
        "distance_meters": result.get("distance_meters") or 0,
        "within": result["within"],
        "action": result["action"],
    }


def is_inside_barangay_boundary(latitude: float, longitude: float) -> bool:
    lat = float(latitude)
    lng = float(longitude)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return False
    boundaries = covered_boundaries()
    if boundaries:
        return coverage_result(lat, lng)["within"]
    return point_in_bbox(lat, lng, MARIKINA_HEIGHTS_BOUNDS)


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

    boundaries = covered_boundaries()
    in_city = point_in_bbox(lat, lng, MARIKINA_CITY_BOUNDS)
    dist_bbox = meters_outside_bbox(lat, lng, MARIKINA_HEIGHTS_BOUNDS)

    if not boundaries:
        # No geometry loaded yet: fall back to the operational bbox so location
        # checks stay usable on a fresh database.
        if point_in_bbox(lat, lng, MARIKINA_HEIGHTS_BOUNDS):
            return {
                "status": "inside",
                "zone": "barangay",
                "accepted": True,
                "warning": None,
                "message": "Location is inside Barangay Marikina Heights.",
                "distance_meters": 0,
            }
        return {
            "status": "far",
            "zone": "far",
            "accepted": False,
            "warning": None,
            "message": "Location is outside Barangay Marikina Heights.",
            "distance_meters": round(dist_bbox),
        }

    coverage = coverage_result(lat, lng)
    label = coverage_label()

    if coverage["within"]:
        return {
            "status": "inside",
            "zone": "barangay",
            "accepted": True,
            "warning": None,
            "message": f"Location is inside Barangay {coverage['barangay']}.",
            "distance_meters": 0,
            "coverage": coverage,
            "acceptance_zone": acceptance_zone_result(lat, lng),
        }

    distance_outside = coverage["distance_meters"]
    if distance_outside is None:
        distance_outside = dist_bbox

    if not in_city and distance_outside > HARD_REJECT_METERS:
        return {
            "status": "far",
            "zone": "outside_city",
            "accepted": False,
            "warning": None,
            "message": f"Location is too far from {label}. Choose a place in or near Marikina.",
            "distance_meters": round(distance_outside),
            "coverage": coverage,
        }

    if distance_outside <= SOFT_BUFFER_METERS:
        if coverage["action"] == "block":
            return {
                "status": "far",
                "zone": "outside_coverage",
                "accepted": False,
                "warning": None,
                "message": f"Location is outside {label}.",
                "distance_meters": round(distance_outside),
                "coverage": coverage,
                "acceptance_zone": acceptance_zone_result(lat, lng),
            }
        return {
            "status": "edge",
            "zone": "edge_buffer",
            "accepted": True,
            "warning": (
                f"This pin is just outside {coverage['nearest'] or 'the barangay'} "
                f"(~{round(distance_outside)} m). Continue only if the concern is on the edge."
            ),
            "message": "Near the edge of your coverage area.",
            "distance_meters": round(distance_outside),
            "coverage": coverage,
            "acceptance_zone": acceptance_zone_result(lat, lng),
        }

    if distance_outside <= HARD_REJECT_METERS and in_city:
        return {
            "status": "far",
            "zone": "outside_coverage",
            "accepted": False,
            "warning": None,
            "message": (
                f"Location is outside {label}. "
                "Please pin a place inside a covered barangay (or within a few hundred meters of the edge)."
            ),
            "distance_meters": round(distance_outside),
            "coverage": coverage,
        }

    return {
        "status": "far",
        "zone": "far",
        "accepted": False,
        "warning": None,
        "message": f"Location is too far from {label}.",
        "distance_meters": round(distance_outside),
        "coverage": coverage,
    }


def score_search_result(lat: float, lng: float) -> float:
    """Lower is better. Prefer inside Heights, then closer to center."""
    classification = classify_location(lat, lng)
    dist_center = haversine_meters(
        lat, lng, MARIKINA_HEIGHTS_CENTER["latitude"], MARIKINA_HEIGHTS_CENTER["longitude"]
    )
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
    if "quezon" in t and "marikina" not in t:
        return True
    return False


def search_location_allowed(lat: float, lng: float, text: str = "") -> bool:
    """
    Search suggestions must be near Heights AND look local.
    Fixes same street names in QC (Katipunan) leaking through loose bbox 'edge' status.
    """
    if text and address_looks_outside_marikina(text):
        return False

    dist = haversine_meters(
        lat, lng, MARIKINA_HEIGHTS_CENTER["latitude"], MARIKINA_HEIGHTS_CENTER["longitude"]
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
    c_lat = MARIKINA_HEIGHTS_CENTER["latitude"]
    c_lng = MARIKINA_HEIGHTS_CENTER["longitude"]
    return (
        f"{c_lng - half_lng},{c_lat + half_lat},"
        f"{c_lng + half_lng},{c_lat - half_lat}"
    )


def _overpass_bbox_pad(pad_deg: float = 0.003) -> tuple[float, float, float, float]:
    """south, west, north, east for Overpass (Heights + soft edge pad)."""
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


def _admin_service_pois() -> tuple[list[dict[str, Any]], set[tuple[str, int]]]:
    """
    Returns (active admin POIs, suppressed OSM keys).
    Suppressed = inactive admin rows with osm_type + osm_id.
    Active rows with osm_type + osm_id also replace that OSM feature.
    """
    active: list[dict[str, Any]] = []
    suppressed: set[tuple[str, int]] = set()
    try:
        from apps.emergencies.models import MapServicePoi

        for row in MapServicePoi.objects.all().only(
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
    dist = haversine_meters(
        float(poi["latitude"]),
        float(poi["longitude"]),
        MARIKINA_HEIGHTS_CENTER["latitude"],
        MARIKINA_HEIGHTS_CENTER["longitude"],
    )
    src_rank = 0 if poi.get("source") in {"admin", "curated"} else 1
    return (src_rank, type_rank, dist, (poi.get("name") or "").casefold())


def service_location_allowed(lat: float, lng: float) -> bool:
    """
    Services: inside/edge for pin policy, and within ~2 km of Heights center.
    Prevents the loose city bbox from flooding the map with San Mateo / city-wide schools.
    """
    classification = classify_location(lat, lng)
    if classification["status"] not in {"inside", "edge"}:
        return False
    dist = haversine_meters(
        lat, lng, MARIKINA_HEIGHTS_CENTER["latitude"], MARIKINA_HEIGHTS_CENTER["longitude"]
    )
    return dist <= SERVICE_POI_MAX_DISTANCE_M


def collect_service_pois(*, force_refresh: bool = False) -> list[dict[str, Any]]:
    """Merge real OSM amenities with admin-managed POIs for the Services layer."""
    osm = fetch_osm_service_pois(force_refresh=force_refresh)
    admin_pois, suppressed = _admin_service_pois()

    merged: list[dict[str, Any]] = []
    for poi in osm:
        key = (str(poi.get("osm_type") or "N").upper()[:1], int(poi.get("osm_id") or 0))
        if key in suppressed:
            continue
        if not service_location_allowed(poi["latitude"], poi["longitude"]):
            continue
        merged.append(poi)

    for poi in admin_pois:
        # Admin pins: allow slightly looser — same inside/edge + distance policy
        if not service_location_allowed(poi["latitude"], poi["longitude"]):
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
    Accept pins inside Marikina Heights or within a small edge buffer (~280 m).
    Reject locations that are far outside the barangay / Marikina City.
    """
    if latitude is None or longitude is None:
        raise ValidationError("Latitude and longitude must be provided together.")
    result = classify_location(latitude, longitude)
    if not result.get("accepted"):
        raise ValidationError("Location must be inside Barangay Marikina Heights.")


def validate_emergency_location(latitude, longitude):
    if latitude is None or longitude is None:
        raise ValidationError("Latitude and longitude must be provided together.")
    if not is_inside_barangay_boundary(latitude, longitude):
        raise ValidationError(f"Emergency location must be inside {coverage_label()}.")


def validate_report_location(latitude, longitude):
    if latitude is None or longitude is None:
        raise ValidationError("Latitude and longitude must be provided together.")

    label = coverage_label()
    result = classify_location(latitude, longitude)

    if result["status"] == "inside":
        return {"action": "accept", "summary": "Required report checks passed. Advanced analysis is pending."}

    # A pin well outside coverage is rejected outright. Only the soft edge — a
    # pin within a few hundred metres of a covered boundary — is left to the
    # configured out-of-zone action, because that is the case GPS drift and
    # roadside addresses actually produce.
    if not result.get("accepted"):
        raise ValidationError(f"Location must be inside {label}.")

    action = (result.get("coverage") or {}).get("action") or "review"
    if action == "warn":
        return {
            "action": "warn",
            "summary": f"Location is just outside {label}.",
        }
    return {
        "action": "review",
        "summary": f"Location is just outside {label} and needs official review.",
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
NOMINATIM_USER_AGENT = "E-Boses/1.0 (Barangay Marikina Heights emergency dispatch)"
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

    if not getattr(settings, "REVERSE_GEOCODE_ENABLED", True):
        return {"status": REVERSE_STATUS_SKIPPED, "location": "", "raw": {}}

    try:
        lat = float(latitude)
        lng = float(longitude)
    except (TypeError, ValueError):
        return {"status": REVERSE_STATUS_SKIPPED, "location": "", "raw": {}}

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
                "User-Agent": "E-Boses/1.0 (Barangay Marikina Heights emergency dispatch)",
                "Accept-Language": "en",
            },
            timeout=REVERSE_GEOCODE_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.warning("Reverse geocode failed for a pin: %s", type(exc).__name__)
        # Cache the failure briefly so a dead mirror does not stall every alert.
        result = {"status": REVERSE_STATUS_FAILED, "location": "", "raw": {}}
        cache.set(cache_key, result, 120)
        return result

    address = payload.get("address") or {}
    location = _compose_readable_area(address) or (payload.get("display_name") or "").split(",")[0].strip()
    result = {
        "status": REVERSE_STATUS_SUCCESS if location else REVERSE_STATUS_FAILED,
        "location": location[:255],
        "raw": {key: address.get(key) for key in ("road", "suburb", "village", "city", "amenity") if address.get(key)},
    }
    cache.set(cache_key, result, REVERSE_GEOCODE_CACHE_TTL if location else 300)
    return result


def map_context_payload() -> dict[str, Any]:
    # v3: real OSM POIs + admin MapServicePoi merge
    cached = cache.get(MAP_CONTEXT_CACHE_KEY)
    if cached:
        return cached

    geometry = get_active_boundary_geometry()
    streets = []
    try:
        from apps.live_map import static_map_payload

        static = static_map_payload()
        boundary = static.get("boundary") or {}
        if boundary.get("geometry"):
            geometry = boundary["geometry"]
        street_groups = static.get("streets") or {}
        streets = street_groups.get("streets") or []
    except Exception:
        pass

    pois = collect_service_pois()

    payload = {
        "center": MARIKINA_HEIGHTS_CENTER,
        "bounds": MARIKINA_HEIGHTS_BOUNDS,
        "city_bounds": MARIKINA_CITY_BOUNDS,
        "soft_buffer_meters": SOFT_BUFFER_METERS,
        "hard_reject_meters": HARD_REJECT_METERS,
        "dispatch_policy": dispatch_policy_payload(),
        "boundary": {
            "name": "Marikina Heights",
            "osm_relation_id": MARIKINA_HEIGHTS_OSM_RELATION_ID,
            "geometry": geometry,
        },
        "coverage": [
            {
                "id": row["id"],
                "name": row["name"],
                "locality": row["locality"],
                "is_home": row["is_home"],
                "geometry": row["geometry"],
            }
            for row in covered_boundaries()
        ],
        "streets": streets[:80],  # keep payload light
        "pois": pois,
        "poi_types": POI_TYPE_META,
        "poi_sources": {
            "osm": sum(1 for p in pois if p.get("source") == "osm"),
            "admin": sum(1 for p in pois if p.get("source") in {"admin", "curated"}),
            "total": len(pois),
        },
    }
    cache.set(MAP_CONTEXT_CACHE_KEY, payload, MAP_CONTEXT_CACHE_TTL)
    return payload
