from decimal import Decimal

import httpx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.services import validate_location_pair
from apps.accounts.views import touch_last_seen
from apps.concerns.models import Concern
from apps.emergencies.models import EmergencyAlert, MapGeometry
from apps.notifications.services import broadcast_live_map_event

MARIKINA_HEIGHTS_OSM_RELATION_ID = 371327
MARIKINA_HEIGHTS_CENTER = {"latitude": 14.6507, "longitude": 121.1133, "zoom": 15}

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


def static_map_payload():
    cached = cache.get("live-map-static-geometry:v2")
    if cached:
        return cached
    boundary = MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY, is_active=True).order_by("name", "id").first()
    street_rows = list(
        MapGeometry.objects.filter(kind=MapGeometry.Kind.STREET, is_active=True)
        .order_by("name", "osm_id")
        .values("name", "osm_type", "osm_id", "street_type", "geometry")
    )
    boundary_payload = {"osm_relation_id": MARIKINA_HEIGHTS_OSM_RELATION_ID, "name": "Marikina Heights", "geometry": None}
    if boundary:
        boundary_payload = {
            "osm_relation_id": boundary.osm_id if boundary.osm_type == "R" else MARIKINA_HEIGHTS_OSM_RELATION_ID,
            "name": boundary.name,
            "geometry": boundary.geometry,
        }
    if not street_rows:
        payload = {"boundary": boundary_payload, "streets": street_catalog_payload()}
        cache.set("live-map-static-geometry:v2", payload, 300)
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
    cache.set("live-map-static-geometry:v2", payload, 300)
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
        "barangay": getattr(profile, "barangay", "") or "Marikina Heights",
        "address": getattr(profile, "address", ""),
        "responder_unit": user.responder_unit,
        "is_on_duty": user.is_on_duty,
        "latitude": decimal_string(user.current_latitude),
        "longitude": decimal_string(user.current_longitude),
        "location_updated_at": user.location_updated_at,
    }


def concern_payload(concern):
    return {
        "id": concern.pk,
        "tracking_id": f"RPT-{concern.created_at.year}-{concern.pk:06d}" if concern.created_at else f"RPT-0-{concern.pk:06d}",
        "title": concern.title,
        "description": concern.description,
        "category": concern.category,
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
    return {
        "id": alert.pk,
        "type": alert.type,
        "note": alert.note,
        "status": alert.status,
        "address": alert.address,
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


def route_for_responder_assignment(alert, assignment):
    if not assignment:
        return None
    # An SMS emergency may carry a readable area but no pin. There is nothing to
    # route to until reverse geocoding or the reporter supplies coordinates.
    if alert.latitude is None or alert.longitude is None:
        return None
    origin = assignment_last_location(assignment)
    if not origin:
        return None
    cache_key = "live-map-route:%s:%s:%s:%s" % (
        round(float(origin["latitude"]), 5),
        round(float(origin["longitude"]), 5),
        round(float(alert.latitude), 5),
        round(float(alert.longitude), 5),
    )
    cached = cache.get(cache_key)
    if cached:
        return {**cached, "assignment_id": assignment.pk, "responder_id": assignment.responder_id}
    route = {
        "alert_id": alert.pk,
        "assignment_id": assignment.pk,
        "responder_id": assignment.responder_id,
        "status": "unavailable",
        "distance_meters": None,
        "eta_seconds": None,
        "geometry": None,
    }
    try:
        base_url = getattr(settings, "OSM_ROUTE_URL", "https://router.project-osrm.org/route/v1/driving")
        url = f"{base_url}/{origin['longitude']},{origin['latitude']};{alert.longitude},{alert.latitude}"
        response = httpx.get(
            url,
            params={"overview": "full", "geometries": "geojson", "steps": "false"},
            timeout=getattr(settings, "OSM_ROUTE_TIMEOUT_SECONDS", 4),
        )
        response.raise_for_status()
        data = response.json()
        best = (data.get("routes") or [None])[0]
        if best:
            route.update({
                "status": "ok",
                "distance_meters": best.get("distance"),
                "eta_seconds": best.get("duration"),
                "geometry": best.get("geometry"),
            })
    except Exception:
        pass
    cache.set(cache_key, route, 60)
    return route


def route_for_assignment(alert):
    assignment = alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"]
    ).select_related("responder").order_by("assigned_at", "id").first()
    return route_for_responder_assignment(alert, assignment)


def routes_for_alert(alert):
    assignments = alert.assignments.filter(
        status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting", "resolved"]
    ).select_related("responder").prefetch_related("location_pings").order_by("assigned_at", "id")
    return [route for route in (route_for_responder_assignment(alert, item) for item in assignments) if route]


def live_map_snapshot():
    from apps.geo_services import dispatch_policy_payload

    User = get_user_model()
    static_map = static_map_payload()
    people = [
        person_payload(user)
        for user in User.objects.filter(
            status=User.Status.VERIFIED,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
        ).filter(models.Q(role=User.Role.RESIDENT) | models.Q(is_on_duty=True)).select_related("resident_profile")
    ]
    concerns = [
        concern_payload(concern)
        for concern in Concern.objects.filter(
            latitude__isnull=False,
            longitude__isnull=False,
        ).select_related("reporter", "reporter__resident_profile")
    ]
    alerts = list(
        EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE)
        .select_related("reporter", "reporter__resident_profile")
        .prefetch_related("assignments__responder", "assignments__responder__resident_profile", "assignments__location_pings")
    )
    emergencies = [emergency_payload(alert) for alert in alerts]
    routes = [route for alert in alerts for route in routes_for_alert(alert)]
    return {
        "map": {
            "provider": "OpenStreetMap",
            "center": MARIKINA_HEIGHTS_CENTER,
            "boundary": static_map["boundary"],
            "streets": static_map["streets"],
            "dispatch_policy": dispatch_policy_payload(),
        },
        "people": people,
        "concerns": concerns,
        "emergencies": emergencies,
        "routes": routes,
        "summary": {
            "active_alerts": len([item for item in concerns if item["status"] in CONCERN_ACTIVE]) + len(emergencies),
            "concerns": len([item for item in concerns if item["status"] in CONCERN_ACTIVE]),
            "emergencies": len(emergencies),
            "residents": User.objects.filter(role=User.Role.RESIDENT, status=User.Status.VERIFIED).count(),
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
        return Response(live_map_snapshot())


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
        "barangay": getattr(profile, "barangay", "") or "Marikina Heights",
    }


def resident_concern_payload(concern, request=None):
    """Public community concern for resident alerts map (no private coords of people)."""
    preview_url = None
    media = list(concern.media.all()[:1]) if hasattr(concern, "media") else []
    if media:
        path = f"/api/concerns/media/{media[0].pk}/preview/"
        preview_url = request.build_absolute_uri(path) if request else path
    return {
        "id": concern.pk,
        "tracking_id": concern.tracking_id,
        "title": concern.title,
        "description": concern.description,
        "category": concern.category,
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
        "address": alert.address or "",
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
    from apps.geo_services import collect_service_pois, map_context_payload

    static_map = static_map_payload()
    context = map_context_payload()

    concerns_qs = (
        Concern.objects.filter(
            visibility=Concern.Visibility.COMMUNITY,
            latitude__isnull=False,
            longitude__isnull=False,
        )
        .exclude(status=Concern.Status.REJECTED)
        .select_related("reporter", "reporter__resident_profile")
        .prefetch_related("media")
        .order_by("-created_at")[:200]
    )
    concerns = [resident_concern_payload(c, request=request) for c in concerns_qs]

    alerts_qs = (
        EmergencyAlert.objects.filter(status__in=EMERGENCY_ACTIVE)
        .prefetch_related("media")
        .order_by("-created_at")[:100]
    )
    emergencies = [resident_emergency_payload(a, request=request) for a in alerts_qs]

    pois = collect_service_pois()
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
            "center": MARIKINA_HEIGHTS_CENTER,
            "boundary": {
                "osm_relation_id": static_map["boundary"].get("osm_relation_id", MARIKINA_HEIGHTS_OSM_RELATION_ID),
                "name": static_map["boundary"].get("name") or "Marikina Heights",
                "geometry": static_map["boundary"].get("geometry") or context.get("boundary", {}).get("geometry"),
            },
            "dispatch_policy": context.get("dispatch_policy"),
        },
        "concerns": concerns,
        "emergencies": emergencies,
        "services": services,
        "poi_types": context.get("poi_types") or [],
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
        broadcast_live_map_event("location.updated", {"person": payload})
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
    """Place search biased to Marikina Heights; drops far results."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        import urllib.parse

        from apps.geo_services import (
            MARIKINA_HEIGHTS_CENTER as CENTER,
            filter_and_rank_search_results,
            map_context_payload,
            search_viewbox_with_buffer,
        )

        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"results": []})

        context = map_context_payload()
        q_lower = q.casefold()
        local_hits = []
        for street in context.get("streets") or []:
            name = street.get("name") or ""
            if q_lower not in name.casefold():
                continue
            # Street catalog is Heights-local; pin to center (map still lets user adjust)
            local_hits.append(
                {
                    "lat": CENTER["latitude"],
                    "lng": CENTER["longitude"],
                    "label": f"{name}, Marikina Heights",
                    "primary": name,
                    "secondary": "Marikina Heights, Marikina City",
                    "source": "street_catalog",
                }
            )

        remote = []
        try:
            # Tight viewbox around Heights + query biased to Marikina (blocks QC Katipunan, etc.)
            viewbox = search_viewbox_with_buffer()
            queries = [
                f"{q}, Marikina Heights, Marikina, Philippines",
                f"{q}, Marikina City, Philippines",
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
                        city_l = str(city).casefold()
                        # Hard drop other Metro Manila cities at parse time
                        if city_l and "marikina" not in city_l:
                            # allow empty city; reject known non-Marikina cities
                            if any(
                                bad in city_l
                                for bad in (
                                    "quezon",
                                    "pasig",
                                    "san juan",
                                    "manila",
                                    "makati",
                                    "cainta",
                                    "antipolo",
                                    "mandaluyong",
                                    "san mateo",
                                    "taguig",
                                    "caloocan",
                                )
                            ):
                                continue
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
                            city or "Marikina",
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
                                "secondary": secondary or "Marikina Heights",
                                "source": "nominatim",
                            }
                        )
                    # Enough local hits — stop extra queries
                    if len(remote) >= 8:
                        break
        except Exception:
            remote = []

        # Prefer remote coords; fill with local street names; both re-filtered near Heights
        pool = remote + local_hits
        ranked = filter_and_rank_search_results(pool, limit=8)
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
