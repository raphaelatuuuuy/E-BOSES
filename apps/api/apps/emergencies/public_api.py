"""Unauthenticated endpoints for the public "Active Communities" page.

Nothing here is personal: only community-level counts, the boundary centroid
and the geography a stranger on the landing page is allowed to see.
"""

import html
import logging
from datetime import timedelta

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Min, Prefetch, Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import ResidentProfile, User
from apps.concerns.models import Concern, ConcernMedia
from apps.media_urls import concern_media_preview_url
from apps.emergencies.description import description_for_display
from apps.emergencies.models import Community, EmergencyAlert, EmergencyCategory, MapGeometry


logger = logging.getLogger(__name__)

CACHE_KEY = "public:communities:v1"
CACHE_SECONDS = 300
COMMUNITY_REQUEST_RECIPIENT = "eboses@gmail.com"
NETWORK_FALLBACK_CENTER = {"latitude": 14.5995, "longitude": 120.9842, "zoom": 12}

CLOSED_EMERGENCY_STATUSES = (
    EmergencyAlert.Status.RESOLVED,
    EmergencyAlert.Status.CLOSED,
)


def _public_map_coordinates(geometry):
    """Yield GeoJSON longitude/latitude pairs without exposing any metadata."""
    if not isinstance(geometry, dict):
        return
    stack = [geometry.get("coordinates") or []]
    while stack:
        item = stack.pop()
        if isinstance(item, (list, tuple)) and len(item) >= 2 and all(
            isinstance(value, (int, float)) for value in item[:2]
        ):
            yield float(item[1]), float(item[0])
        elif isinstance(item, (list, tuple)):
            stack.extend(item)


def _public_community_payload(community):
    boundary = community.boundary
    bounds = {
        "min_latitude": community.bbox_min_latitude,
        "max_latitude": community.bbox_max_latitude,
        "min_longitude": community.bbox_min_longitude,
        "max_longitude": community.bbox_max_longitude,
    }
    points = list(_public_map_coordinates(boundary.geometry if boundary else None))
    if any(value is None for value in bounds.values()) and points:
        lats = [point[0] for point in points]
        lngs = [point[1] for point in points]
        bounds = {
            "min_latitude": min(lats),
            "max_latitude": max(lats),
            "min_longitude": min(lngs),
            "max_longitude": max(lngs),
        }
    return {
        "id": str(community.public_id),
        "public_id": str(community.public_id),
        "code": community.code,
        "name": community.name,
        "center": {
            "latitude": float(community.center_latitude),
            "longitude": float(community.center_longitude),
        },
        "bbox": {key: float(value) if value is not None else None for key, value in bounds.items()},
        "boundary": {
            "osm_relation_id": boundary.osm_id if boundary and boundary.osm_type == "R" else None,
            "name": boundary.name if boundary else community.name,
            "geometry": boundary.geometry if boundary else None,
        },
    }


def build_public_report_map_payload():
    """Return only accepted, resident-safe map records across active areas."""
    from apps.concerns.serializers import public_street_address
    from apps.emergencies.views import ACTIVE_STATUSES

    active_communities = list(
        Community.objects.filter(
            status=Community.Status.ACTIVE,
            boundary__isnull=False,
            boundary__is_active=True,
            boundary__kind=MapGeometry.Kind.BOUNDARY,
        )
        .select_related("boundary")
        .order_by("name", "pk")
    )
    community_ids = [community.pk for community in active_communities]
    community_payloads = [_public_community_payload(community) for community in active_communities]
    by_id = {community.pk: payload for community, payload in zip(active_communities, community_payloads)}

    concerns = []
    concern_rows = (
        Concern.objects.filter(
            community_id__in=community_ids,
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
        .filter(Q(category_ref__isnull=True) | Q(category_ref__public_feed_allowed=True))
        .select_related("community", "category_ref")
        .prefetch_related(
            Prefetch(
                "media",
                queryset=ConcernMedia.objects.filter(
                    public_visible=True,
                    validation_status="accepted",
                    mime_type__startswith="image/",
                ).order_by("uploaded_at", "pk"),
                to_attr="public_preview_media",
            )
        )
        .order_by("-updated_at", "-pk")[:300]
    )
    for concern in concern_rows:
        category = concern.category_ref
        summary = (concern.summary or concern.description or "").strip()[:280]
        preview_media = next(iter(concern.public_preview_media), None)
        concerns.append(
            {
                "id": concern.pk,
                "community": by_id[concern.community_id],
                "title": concern.official_title.strip() or concern.title,
                "summary": summary,
                "category": category.code if category else concern.category,
                "category_label": category.name if category else concern.get_category_display(),
                "status": concern.status,
                "address": public_street_address(concern.address, concern.barangay),
                # Four decimals keeps a public marker useful without returning
                # the resident's original seven-decimal pin.
                "latitude": round(float(concern.latitude), 4),
                "longitude": round(float(concern.longitude), 4),
                "reporter_label": "Anonymous" if concern.is_anonymous else "Community resident",
                "preview_url": concern_media_preview_url(preview_media.pk) if preview_media else None,
                "created_at": concern.created_at,
                "updated_at": concern.updated_at,
                "kind": "concern",
            }
        )

    visible_types = list(
        EmergencyCategory.objects.filter(
            Q(community_id__in=community_ids) | Q(community__isnull=True),
            is_active=True,
            visible_to_residents=True,
        ).values_list("community_id", "code")
    )
    visible_rule = Q(pk__in=[])
    global_types = {code for community_id, code in visible_types if community_id is None}
    for community_id in community_ids:
        codes = global_types | {
            code for configured_community_id, code in visible_types if configured_community_id == community_id
        }
        for code in codes:
            visible_rule |= Q(community_id=community_id, type=code)
    cutoff = timezone.now() - timedelta(days=7)
    emergency_rows = (
        EmergencyAlert.objects.filter(
            community_id__in=community_ids,
            latitude__isnull=False,
            longitude__isnull=False,
        )
        .filter(
            Q(status__in=ACTIVE_STATUSES)
            | Q(status__in={"resolved", "closed", "cancelled"}, updated_at__gte=cutoff)
        )
        .filter(visible_rule)
        .select_related("community")
        .order_by("-updated_at", "-pk")[:100]
    )
    emergencies = []
    for alert in emergency_rows:
        display_description = description_for_display(alert)
        emergencies.append(
            {
                "id": alert.pk,
                "community": by_id[alert.community_id],
                "type": alert.type,
                "type_label": alert.get_type_display(),
                "display_description": display_description,
                "address": public_street_address(alert.resolved_location or alert.address, alert.barangay),
                "latitude": round(float(alert.latitude), 4),
                "longitude": round(float(alert.longitude), 4),
                "status": alert.status,
                "created_at": alert.created_at,
                "updated_at": alert.updated_at,
                "kind": "emergency",
            }
        )

    bounds = [payload["bbox"] for payload in community_payloads if all(value is not None for value in payload["bbox"].values())]
    if bounds:
        combined_bounds = {
            "min_latitude": min(item["min_latitude"] for item in bounds),
            "max_latitude": max(item["max_latitude"] for item in bounds),
            "min_longitude": min(item["min_longitude"] for item in bounds),
            "max_longitude": max(item["max_longitude"] for item in bounds),
        }
        map_center = {
            "latitude": round((combined_bounds["min_latitude"] + combined_bounds["max_latitude"]) / 2, 5),
            "longitude": round((combined_bounds["min_longitude"] + combined_bounds["max_longitude"]) / 2, 5),
            "zoom": 12,
        }
    else:
        combined_bounds = None
        map_center = {**NETWORK_FALLBACK_CENTER}

    return {
        "communities": community_payloads,
        "map": {
            "provider": "OpenStreetMap",
            "center": map_center,
            "bounds": combined_bounds,
        },
        "concerns": concerns,
        "emergencies": emergencies,
        "summary": {
            "public_concerns": len(concerns),
            "public_emergencies": len(emergencies),
            "alerts": len(concerns) + len(emergencies),
            "communities": len(community_payloads),
        },
        "generated_at": timezone.now(),
    }


class PublicReportMapView(APIView):
    """Unauthenticated, privacy-safe alert map for the report entry point."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response(build_public_report_map_payload())

# PSA geography, not a business rule: these seventeen local government units
# are the National Capital Region. Anything else resolves to "" until the
# system actually covers it, because guessing a region would be inventing data.
NCR_LOCALITIES = frozenset(
    {
        "manila",
        "quezon",
        "caloocan",
        "las pinas",
        "las piñas",
        "makati",
        "malabon",
        "mandaluyong",
        "marikina",
        "muntinlupa",
        "navotas",
        "paranaque",
        "parañaque",
        "pasay",
        "pasig",
        "san juan",
        "taguig",
        "valenzuela",
        "pateros",
    }
)


def normalize_locality(locality):
    place = (locality or "").strip().lower()
    for prefix in ("city of ", "municipality of ", "the municipality of "):
        if place.startswith(prefix):
            place = place[len(prefix) :]
    return place.removesuffix(" city").strip()


def region_for(locality):
    return "National Capital Region" if normalize_locality(locality) in NCR_LOCALITIES else ""


def city_label(locality):
    place = normalize_locality(locality)
    if not place:
        return ""
    return " ".join(word.capitalize() for word in place.split()) + " City"


def centroid(geometry):
    if not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    ring = coordinates
    for _ in range(3):
        if isinstance(ring, list) and ring and isinstance(ring[0], list) and ring[0] and isinstance(ring[0][0], list):
            ring = ring[0]
        else:
            break
    if not isinstance(ring, list) or len(ring) < 3:
        return None
    points = [p for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
    if not points:
        return None
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    try:
        longitude = sum(float(p[0]) for p in points) / len(points)
        latitude = sum(float(p[1]) for p in points) / len(points)
    except (TypeError, ValueError):
        return None
    return {"latitude": round(latitude, 5), "longitude": round(longitude, 5)}


def served_barangay_names():
    """
    Barangays this deployment actually runs, not every barangay it holds a
    boundary for. The PSGC import stores the whole country, so "has an active
    boundary row" would answer forty thousand.
    """
    return set(Community.objects.filter(status=Community.Status.ACTIVE).values_list("name", flat=True))


def build_communities_payload():
    role_rows = (
        User.objects.filter(status=User.Status.VERIFIED, resident_profile__isnull=False)
        .values("resident_profile__community_id", "resident_profile__barangay", "role")
        .annotate(total=Count("id"))
    )
    concern_rows = Concern.objects.values("community_id", "barangay").annotate(
        total=Count("id"),
        resolved=Count("id", filter=Q(status=Concern.Status.RESOLVED)),
    )
    emergency_rows = EmergencyAlert.objects.values("community_id", "barangay").annotate(
        total=Count("id"),
        closed=Count("id", filter=Q(status__in=CLOSED_EMERGENCY_STATUSES)),
    )
    since_rows = ResidentProfile.objects.values("community_id", "barangay").annotate(first=Min("created_at"))

    roles = {}
    for row in role_rows:
        community_key = row["resident_profile__community_id"]
        if community_key is not None:
            roles.setdefault(community_key, {})[row["role"]] = row["total"]
        else:
            roles.setdefault(("barangay", (row["resident_profile__barangay"] or "").casefold()), {})[row["role"]] = row["total"]
    def row_key(row):
        return row["community_id"] or ("barangay", (row["barangay"] or "").casefold())

    concerns = {row_key(row): row for row in concern_rows}
    emergencies = {row_key(row): row for row in emergency_rows}
    since = {row_key(row): row["first"] for row in since_rows if row["first"]}

    active = Community.objects.filter(status=Community.Status.ACTIVE, boundary__is_active=True).select_related("boundary")

    communities = []
    for community in active.order_by("name", "pk"):
        boundary = community.boundary
        role_counts = roles.get(community.pk) or roles.get(("barangay", community.name.casefold()), {})
        fallback_key = ("barangay", community.name.casefold())
        concern_counts = concerns.get(community.pk) or concerns.get(fallback_key, {})
        emergency_counts = emergencies.get(community.pk) or emergencies.get(fallback_key, {})
        started = since.get(community.pk) or since.get(fallback_key)
        communities.append(
            {
                "id": boundary.pk,
                "community_id": str(community.public_id),
                "code": community.code,
                "name": boundary.name,
                "locality": boundary.locality,
                "city": city_label(boundary.locality),
                "region": region_for(boundary.locality),
                "is_home": boundary.is_home,
                "residents": role_counts.get(User.Role.RESIDENT, 0),
                "responders": role_counts.get(User.Role.FIRST_RESPONDER, 0),
                "officials": role_counts.get(User.Role.BARANGAY_OFFICIAL, 0),
                "reports": concern_counts.get("total", 0),
                "resolved_reports": concern_counts.get("resolved", 0),
                "emergencies": emergency_counts.get("total", 0),
                "closed_emergencies": emergency_counts.get("closed", 0),
                "since": started.date().isoformat() if started else None,
                "center": centroid(boundary.geometry),
            }
        )

    def total(field):
        return sum(item[field] for item in communities)

    return {
        "totals": {
            "communities": len(communities),
            "cities": len({item["city"] for item in communities if item["city"]}),
            "residents": total("residents"),
            "responders": total("responders"),
            "officials": total("officials"),
            "reports": total("reports"),
            "resolved_reports": total("resolved_reports"),
            "emergencies": total("emergencies"),
            "closed_emergencies": total("closed_emergencies"),
        },
        "communities": communities,
    }


class PublicCommunitiesView(APIView):
    """Community-level coverage figures for the public landing page."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        payload = cache.get(CACHE_KEY)
        if payload is None:
            payload = build_communities_payload()
            cache.set(CACHE_KEY, payload, CACHE_SECONDS)
        return Response(payload)


class PublicCommunityBoundaryView(APIView):
    """
    One active community's outline, for the public coverage page.

    Only barangays already listed by PublicCommunitiesView qualify — this
    stays a lookup into that same served set, not a door into the full PSGC
    boundary table the site never advertises.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, pk):
        payload = cache.get(CACHE_KEY)
        if payload is None:
            payload = build_communities_payload()
            cache.set(CACHE_KEY, payload, CACHE_SECONDS)
        if not any(item["id"] == pk for item in payload["communities"]):
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            boundary = MapGeometry.objects.get(
                pk=pk, kind=MapGeometry.Kind.BOUNDARY, is_active=True
            )
        except MapGeometry.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "id": boundary.pk,
                "name": boundary.name,
                "locality": boundary.locality,
                "geometry": boundary.geometry,
            }
        )


class CommunityRequestThrottle(AnonRateThrottle):
    """Per-IP ceiling. The rate is pinned here rather than in settings so a
    public write endpoint can never be left unthrottled by a config edit."""

    scope = "public_community_request"
    rate = "5/hour"


class CommunityRequestSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["community"])
    name = serializers.CharField(max_length=120)
    email = serializers.EmailField(max_length=254)
    organization = serializers.CharField(max_length=160)
    role = serializers.CharField(max_length=120)
    message = serializers.CharField(max_length=2000)


def _request_email_html(data):
    label = "Community request"
    rows = [
        ("Name", data["name"]),
        ("Email", data["email"]),
        ("Organization", data["organization"]),
        ("Role", data["role"]),
        ("Message", data["message"]),
    ]
    body = "".join(
        f'<p style="font-size:14px;line-height:1.6;margin:0 0 8px">'
        f"<strong>{html.escape(field)}:</strong> {html.escape(str(value))}</p>"
        for field, value in rows
    )
    return (
        '<div style="font-family:Segoe UI,Arial,sans-serif;color:#1c1c1c;max-width:560px;margin:auto;padding:32px 24px">'
        f'<h1 style="font-size:20px;line-height:1.3;margin:0 0 16px">{html.escape(label)}</h1>'
        f"{body}</div>"
    )


def send_community_request_email(data):
    api_key = getattr(settings, "RESEND_API_KEY", "")
    if not api_key:
        return False
    label = "Community request"
    sender_name = getattr(settings, "RESEND_FROM_NAME", "") or "E-Boses"
    sender_email = getattr(settings, "RESEND_FROM_EMAIL", "") or settings.DEFAULT_FROM_EMAIL
    payload = {
        "from": f"{sender_name} <{sender_email}>",
        "to": [COMMUNITY_REQUEST_RECIPIENT],
        "subject": f"E-Boses {label.lower()}",
        "text": "\n".join(
            [
                f"{label}",
                f"Name: {data['name']}",
                f"Email: {data['email']}",
                f"Organization: {data['organization']}",
                f"Role: {data['role']}",
                "",
                data["message"],
            ]
        ),
        "html": _request_email_html(data),
    }
    payload["reply_to"] = [data["email"]]
    response = httpx.post(
        getattr(settings, "RESEND_API_URL", "https://api.resend.com/emails"),
        json=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=getattr(settings, "RESEND_DELIVERY_TIMEOUT_SECONDS", 20.0),
    )
    if response.status_code >= 400:
        logger.warning("Community request email returned HTTP %s", response.status_code)
        return False
    return True


class PublicCommunityRequestView(APIView):
    """A stranger asking to bring E-Boses to their community."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [CommunityRequestThrottle]

    def post(self, request):
        serializer = CommunityRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            delivered = send_community_request_email(serializer.validated_data)
        except Exception as exc:
            # A lost lead is a problem for us, never a 500 for the stranger.
            logger.warning("Community request email failed: %s", exc.__class__.__name__)
            delivered = False
        return Response({"status": "received", "delivered": delivered}, status=status.HTTP_201_CREATED)
