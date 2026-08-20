"""Unauthenticated endpoints for the public "Active Communities" page.

Nothing here is personal: only community-level counts, the boundary centroid
and the geography a stranger on the landing page is allowed to see.
"""

import html
import logging

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Min, Q
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import ResidentProfile, User
from apps.concerns.models import Concern
from apps.emergencies.models import EmergencyAlert, MapDispatchPolicy, MapGeometry


logger = logging.getLogger(__name__)

CACHE_KEY = "public:communities:v1"
CACHE_SECONDS = 300
COMMUNITY_REQUEST_RECIPIENT = "eboses@gmail.com"

CLOSED_EMERGENCY_STATUSES = (
    EmergencyAlert.Status.RESOLVED,
    EmergencyAlert.Status.CLOSED,
)

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
    served = set(
        User.objects.filter(
            status=User.Status.VERIFIED, resident_profile__isnull=False
        ).values_list("resident_profile__barangay", flat=True)
    )
    served |= set(Concern.objects.values_list("barangay", flat=True))
    served |= set(EmergencyAlert.objects.values_list("barangay", flat=True))
    policy = MapDispatchPolicy.objects.first()
    if policy:
        served.update(policy.covered.values_list("name", flat=True))
        served.add(policy.barangay)
    return {name for name in served if name}


def build_communities_payload():
    role_rows = (
        User.objects.filter(status=User.Status.VERIFIED, resident_profile__isnull=False)
        .values("resident_profile__barangay", "role")
        .annotate(total=Count("id"))
    )
    concern_rows = Concern.objects.values("barangay").annotate(
        total=Count("id"),
        resolved=Count("id", filter=Q(status=Concern.Status.RESOLVED)),
    )
    emergency_rows = EmergencyAlert.objects.values("barangay").annotate(
        total=Count("id"),
        closed=Count("id", filter=Q(status__in=CLOSED_EMERGENCY_STATUSES)),
    )
    since_rows = ResidentProfile.objects.values("barangay").annotate(first=Min("created_at"))

    roles = {}
    for row in role_rows:
        roles.setdefault(row["resident_profile__barangay"], {})[row["role"]] = row["total"]
    concerns = {row["barangay"]: row for row in concern_rows}
    emergencies = {row["barangay"]: row for row in emergency_rows}
    since = {row["barangay"]: row["first"] for row in since_rows if row["first"]}

    # A boundary row alone is only geography — the PSGC import holds every
    # barangay in the country. A community is one this station actually serves:
    # its own, one an official put under the dispatch policy, or one with real
    # people and real records behind it.
    served = set(roles) | set(concerns) | set(emergencies)
    policy = MapDispatchPolicy.objects.first()
    if policy:
        served.update(policy.covered.values_list("name", flat=True))
        served.add(policy.barangay)

    boundaries = MapGeometry.objects.filter(
        kind=MapGeometry.Kind.BOUNDARY, is_active=True
    ).filter(Q(is_home=True) | Q(name__in=served))

    communities = []
    seen = set()
    for boundary in boundaries.order_by("-is_home", "name", "pk"):
        key = (boundary.name.strip().lower(), normalize_locality(boundary.locality))
        if key in seen:
            continue
        seen.add(key)
        role_counts = roles.get(boundary.name, {})
        concern_counts = concerns.get(boundary.name, {})
        emergency_counts = emergencies.get(boundary.name, {})
        started = since.get(boundary.name)
        communities.append(
            {
                "id": boundary.pk,
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
    kind = serializers.ChoiceField(choices=["community", "demo"])
    name = serializers.CharField(max_length=120)
    email = serializers.EmailField(max_length=254)
    organization = serializers.CharField(max_length=160)
    role = serializers.CharField(max_length=120)
    message = serializers.CharField(max_length=2000)
    preferred_date = serializers.DateField(required=False, allow_null=True)


def _request_email_html(data):
    label = "Demo request" if data["kind"] == "demo" else "Community request"
    rows = [
        ("Name", data["name"]),
        ("Email", data["email"]),
        ("Organization", data["organization"]),
        ("Role", data["role"]),
        ("Preferred date", data["preferred_date"].isoformat() if data.get("preferred_date") else "—"),
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
    label = "Demo request" if data["kind"] == "demo" else "Community request"
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
                f"Preferred date: {data['preferred_date'].isoformat() if data.get('preferred_date') else '-'}",
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
    """A stranger asking to join E-Boses or to see a demo."""

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
