from decimal import Decimal

import httpx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
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

EMERGENCY_ACTIVE = {
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTED,
    EmergencyAlert.Status.ACKNOWLEDGED,
    EmergencyAlert.Status.EN_ROUTE,
    EmergencyAlert.Status.NEARBY,
    EmergencyAlert.Status.ARRIVED,
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
    assignment = alert.assignments.select_related("responder", "responder__resident_profile").order_by("-assigned_at", "-id").first()
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
        "current_assignment": {
            "id": assignment.pk,
            "responder": person_payload(assignment.responder),
            "status": assignment.status,
            "last_location": assignment_last_location(assignment),
        } if assignment else None,
        "created_at": alert.created_at,
        "updated_at": alert.updated_at,
        "resolved_at": alert.resolved_at,
    }


def route_for_assignment(alert):
    assignment = alert.assignments.select_related("responder").order_by("-assigned_at", "-id").first()
    if not assignment:
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
        return cached
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


def live_map_snapshot():
    User = get_user_model()
    static_map = static_map_payload()
    people = [
        person_payload(user)
        for user in User.objects.filter(
            status=User.Status.VERIFIED,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
        ).select_related("resident_profile")
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
    routes = [route for route in (route_for_assignment(alert) for alert in alerts) if route]
    return {
        "map": {
            "provider": "OpenStreetMap",
            "center": MARIKINA_HEIGHTS_CENTER,
            "boundary": static_map["boundary"],
            "streets": static_map["streets"],
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
            "responders": User.objects.filter(role=User.Role.FIRST_RESPONDER, status=User.Status.VERIFIED).count(),
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


class LocationPingView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "location_ping"

    def post(self, request):
        touch_last_seen(request.user)
        serializer = LocationPingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request.user.current_latitude = serializer.validated_data["latitude"]
        request.user.current_longitude = serializer.validated_data["longitude"]
        request.user.location_updated_at = timezone.now()
        request.user.save(update_fields=["current_latitude", "current_longitude", "location_updated_at", "updated_at"])
        payload = person_payload(request.user)
        broadcast_live_map_event("location.updated", {"person": payload})
        return Response({"person": payload, "source": serializer.validated_data["source"]})
