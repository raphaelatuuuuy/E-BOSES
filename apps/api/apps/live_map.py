from decimal import Decimal

import httpx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.services import validate_location_pair
from apps.accounts.views import touch_last_seen
from apps.concerns.models import Announcement, Concern
from apps.emergencies.models import EmergencyAlert, EmergencyCategory, MapGeometry
from apps.media_urls import concern_media_preview_url, emergency_media_preview_url
from apps.notifications.services import broadcast_live_map_event

MARIKINA_HEIGHTS_OSM_RELATION_ID = 371327
MARIKINA_HEIGHTS_CENTER = {"latitude": 14.6507, "longitude": 121.1133, "zoom": 15}

MAP_CONCERN_LIMIT = 300

CONCERN_ACTIVE = {
    Concern.Status.SUBMITTED,
    Concern.Status.UNDER_REVIEW,
    Concern.Status.IN_PROGRESS,
    Concern.Status.APPEALED,
}

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
    return bool(user and user.is_authenticated and (user.is_staff or user.is_superuser or user.role == User.Role.BARANGAY_OFFICIAL))


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
        community = Community.objects.filter(pk=community, status=Community.Status.ACTIVE).select_related("boundary").first()
    if community is None:
        community = Community.objects.filter(status=Community.Status.ACTIVE).select_related("boundary").order_by("name").first()
    cache_key = f"{STATIC_MAP_CACHE_KEY}:{community.pk}:{community.boundary_revision}" if community else f"{STATIC_MAP_CACHE_KEY}:none"
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
        streets = street_catalog_payload() if community and community.code == "marikina-heights" else _group_streets([])
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


def decimal_string(value):
    if value is None:
        return None
    return str(value.quantize(Decimal("0.0000001")) if isinstance(value, Decimal) else value)


def person_payload(user):
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
    return {
        "id": concern.pk,
        "preview_url": concern_media_preview_url(media[0].pk) if media else None,
        "media_count": len(media),
        "tracking_id": f"RPT-{concern.created_at.year}-{concern.pk:06d}" if concern.created_at else f"RPT-0-{concern.pk:06d}",
        "title": concern.title,
        "description": concern.description,
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
        "priority": "high" if concern.category == Concern.Category.PUBLIC_SAFETY else "normal",
    }


def assignment_last_location(assignment):
    ping = assignment.location_pings.order_by("-created_at", "-id").first()
    if ping:
        return {
            "latitude": decimal_string(ping.latitude),
            "longitude": decimal_string(ping.longitude),
            "accuracy": ping.accuracy,
            "created_at": ping.created_at,
        }
    responder = assignment.responder
    if responder.current_latitude is None or responder.current_longitude is None:
        return None
    return {
        "latitude": decimal_string(responder.current_latitude),
        "longitude": decimal_string(responder.current_longitude),
        "accuracy": None,
        "created_at": responder.location_updated_at,
    }


def emergency_payload(alert):
    assignments = list(alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder", "responder__resident_profile").order_by("assigned_at", "id"))
    assignment_payloads = [
        {
            "id": assignment.pk,
            "responder": person_payload(assignment.responder),
            "status": assignment.status,
            "last_location": assignment_last_location(assignment),
        }
        for assignment in assignments
    ]
    media = list(alert.media.all()) if hasattr(alert, "media") else []
    return {
        "id": alert.pk,
        "preview_url": emergency_media_preview_url(media[0].pk) if media else None,
        "type": alert.type,
        "note": alert.note,
        "status": alert.status,
        "address": alert.resolved_location or alert.address or "",
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
    origin = assignment_last_location(assignment)
    if not origin:
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
    from apps.emergencies.models import EmergencyAssignmentRoute

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
    assignment = alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder").order_by("assigned_at", "id").first()
    return route_for_responder_assignment(alert, assignment)


def routes_for_alert(alert):
    assignments = alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder").prefetch_related("location_pings").order_by("assigned_at", "id")
    return [route for route in (route_for_responder_assignment(alert, item) for item in assignments) if route]


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
    community_ids = community_ids_for_user(user)
    department_ids = department_ids_for_user(user)
    requested_community = request.query_params.get("community_id") if request else None
    community = selected_community(user, requested_community)
    if not community and community_ids:
        community = Community.objects.filter(pk__in=community_ids, status=Community.Status.ACTIVE).order_by("name").first()
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
            | models.Q(is_on_duty=True, designations__is_active=True, designations__department__community_id__in=community_ids)
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
            ).filter(models.Q(reporter=user) | models.Q(category_ref__department_id__in=department_ids))
            .select_related("reporter", "reporter__resident_profile", "category_ref")
            .prefetch_related("media")
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
    ).filter(models.Q(reporter=user) | models.Q(category_ref__department_id__in=department_ids)).count()
    # Active alerts plus recently settled ones (resolved, closed, cancelled,
    # false alarm, invalid) — the same "last 7 days" window the resident map
    # uses, so an official can still see how a just-closed incident wrapped up
    # instead of it vanishing from the map the instant it's marked done.
    from datetime import timedelta

    recently_settled_cutoff = timezone.now() - timedelta(days=7)
    alerts = list(
        scope_emergency_queryset(EmergencyAlert.objects.all(), user).filter(community=community).filter(
            models.Q(status__in=EMERGENCY_ACTIVE)
            | models.Q(
                status__in={"resolved", "closed", "cancelled", "false_alarm", "invalid"},
                updated_at__gte=recently_settled_cutoff,
            )
        )
        .select_related("reporter", "reporter__resident_profile")
        .prefetch_related("assignments__responder", "assignments__responder__resident_profile", "assignments__location_pings", "media")
    )
    emergencies = [emergency_payload(alert) for alert in alerts]
    routes = [route for alert in alerts for route in routes_for_alert(alert)]
    active_emergency_count = scope_emergency_queryset(
        EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE, community=community), user
    ).count()

    from apps.concerns.announcement_services import announcement_is_active

    street_index = {
        street["name"].casefold(): street
        for street in static_map["streets"]["streets"]
        if street.get("geometries")
    }
    announcement_rows = list(
        Announcement.objects.filter(is_published=True, community_id__in=community_ids)
        .filter(models.Q(target_departments__isnull=True) | models.Q(target_departments__id__in=department_ids))
        .distinct()
        .order_by("-is_pinned", "-published_at", "-created_at")[:50]
    )
    advisories = [
        advisory_payload(item, street_index)
        for item in announcement_rows
        if announcement_is_active(item)
    ]
    return {
        "map": {
            "provider": "OpenStreetMap",
            "center": {
                "latitude": float(community.center_latitude),
                "longitude": float(community.center_longitude),
                "zoom": 15,
            } if community else MARIKINA_HEIGHTS_CENTER,
            "boundary": static_map["boundary"],
            "streets": static_map["streets"],
            "dispatch_policy": dispatch_policy_payload(community),
        },
        "people": people,
        "concerns": concerns,
        "emergencies": emergencies,
        "routes": routes,
        "advisories": advisories,
        "summary": {
            "active_alerts": active_concern_count + active_emergency_count,
            "concerns": active_concern_count,
            "emergencies": active_emergency_count,
            "residents": User.objects.filter(role=User.Role.RESIDENT, status=User.Status.VERIFIED, resident_profile__community_id__in=community_ids).count(),
            # On duty only. This used to count every verified responder, so the
            # overview reported a full roster as "on duty" even at 3am with
            # nobody on shift. Matches dashboard_views.responders_on_duty.
            "responders": User.objects.filter(
                role=User.Role.FIRST_RESPONDER,
                status=User.Status.VERIFIED,
                is_on_duty=True,
            ).count(),
            "officials": User.objects.filter(role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED).count(),
        },
        "generated_at": timezone.now(),
    }


class LocationPingSerializer(serializers.Serializer):
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    accuracy = serializers.FloatField(required=False, allow_null=True, max_value=10000)
    source = serializers.ChoiceField(choices=["active_session", "pwa_background", "manual", "incident"], default="active_session")

    def validate(self, attrs):
        try:
            validate_location_pair(attrs.get("latitude"), attrs.get("longitude"), required=True)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc) from exc
        return attrs


class OfficialLiveMapView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not is_official(request.user):
            return Response({"detail": "You do not have permission to view the official live map."}, status=status.HTTP_403_FORBIDDEN)
        return Response(live_map_snapshot(request=request))


def public_reporter_payload(user):
    """Community-safe reporter identity (no home address / live GPS)."""
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
    return {
        "id": concern.pk,
        "tracking_id": concern.tracking_id,
        "title": concern.title,
        "description": concern.description,
        "category": concern.category,
        "category_ref": category_ref_payload(concern, request=request),
        "status": concern.status,
        "address": concern.address,
        "barangay": concern.barangay,
        "latitude": decimal_string(concern.latitude),
        "longitude": decimal_string(concern.longitude),
        "preview_url": preview_url,
        "reporter": public_reporter_payload(concern.reporter),
        "created_at": concern.created_at,
        "updated_at": concern.updated_at,
        "priority": "high" if concern.category == Concern.Category.PUBLIC_SAFETY else "normal",
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
            responder_location = assignment_last_location(assignment)
            route = route_for_assignment(alert)
    type_label = alert.get_type_display() if hasattr(alert, "get_type_display") else alert.type
    return {
        "id": alert.pk,
        "type": alert.type,
        "type_label": type_label,
        "note": (alert.note or "")[:280],
        "status": alert.status,
        "barangay": alert.barangay,
        "latitude": decimal_string(alert.latitude),
        "longitude": decimal_string(alert.longitude),
        "address": alert.resolved_location or alert.address or "",
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
        community = Community.objects.filter(status=Community.Status.ACTIVE).order_by("name").first()
    static_map = static_map_payload(community)

    concerns_qs = (
        Concern.objects.filter(
            community=community,
            visibility=Concern.Visibility.COMMUNITY,
            latitude__isnull=False,
            longitude__isnull=False,
        )
        .exclude(status=Concern.Status.REJECTED)
        .select_related("reporter", "reporter__resident_profile", "category_ref")
        .prefetch_related("media")
        .order_by("-created_at")[:200]
    )
    concerns = [resident_concern_payload(c, request=request) for c in concerns_qs]

    # Categories an official has marked private (e.g. domestic violence, child
    # protection) never reach the resident map, regardless of status.
    hidden_types = set(
        EmergencyCategory.objects.filter(visible_to_residents=False).values_list("code", flat=True)
    )
    # Include active emergencies plus recently resolved/closed (last 7 days)
    from datetime import timedelta
    recently_resolved_cutoff = timezone.now() - timedelta(days=7)
    alerts_qs = (
        EmergencyAlert.objects.filter(
            models.Q(status__in=EMERGENCY_ACTIVE)
            | models.Q(status__in={"resolved", "closed", "cancelled"}, updated_at__gte=recently_resolved_cutoff)
        ).filter(community=community)
        .exclude(type__in=hidden_types)
        .prefetch_related("media")
        .order_by("-created_at")[:100]
    )
    emergencies = [resident_emergency_payload(a, request=request) for a in alerts_qs]

    pois = [
        poi for poi in collect_service_pois()
        if community and active_community_for_point(poi.get("latitude"), poi.get("longitude")) == community
    ]
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
        }
        for p in pois
    ]

    active_concerns = [c for c in concerns if c["status"] in CONCERN_ACTIVE or c["status"] == Concern.Status.ASSIGNED]
    emergency_count = len(emergencies)

    return {
        "map": {
            "provider": "OpenStreetMap",
            "center": {
                "latitude": float(community.center_latitude),
                "longitude": float(community.center_longitude),
                "zoom": 15,
            } if community else MARIKINA_HEIGHTS_CENTER,
            "boundary": {
                "osm_relation_id": static_map["boundary"].get("osm_relation_id", MARIKINA_HEIGHTS_OSM_RELATION_ID),
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
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "location_ping"

    def post(self, request):
        touch_last_seen(request.user)
        serializer = LocationPingSerializer(data=request.data)
        if not serializer.is_valid():
            # Background GPS often reports outside Marikina Heights (VPN, travel,
            # or GPS drift). Treat as soft reject so browsers don't log 400 spam.
            return Response(
                {"accepted": False, "errors": serializer.errors},
                status=status.HTTP_200_OK,
            )
        request.user.current_latitude = serializer.validated_data["latitude"]
        request.user.current_longitude = serializer.validated_data["longitude"]
        request.user.location_updated_at = timezone.now()
        request.user.save(update_fields=["current_latitude", "current_longitude", "location_updated_at", "updated_at"])
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

        payload = map_context_payload()
        policy = MapDispatchPolicy.current()
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

    permission_classes = [IsAuthenticated]

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
            house_number = local.get("house_number") or ""
            head = f"{house_number} {local['street']}".strip()
            address = {
                "road": local["street"],
                "village": "Marikina Heights",
                "city": "Marikina",
            }
            if house_number:
                address["house_number"] = house_number
            return Response({
                "ok": True,
                "source": "local",
                "result": {
                    "display_name": f"{head}, Marikina Heights, Marikina",
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
                pk__in=community_ids_for_user(request.user), status=Community.Status.ACTIVE
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
