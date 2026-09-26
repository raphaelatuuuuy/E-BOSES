"""Unauthenticated endpoints for the public "Active Communities" page.

Nothing here is personal: only community-level counts, the boundary centroid
and the geography a stranger on the landing page is allowed to see.
"""

import html
import logging
import math
from datetime import timedelta

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Min, Prefetch, Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from apps.throttling import LocalAnonRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import ResidentProfile, User
from apps.concerns.ai.street_imagery import fetch_latest_street_imagery, nearest_street_panorama
from apps.concerns.models import Announcement, Concern, ConcernComment, ConcernMedia, ConcernResolutionEvidence, ConcernStatusEvent
from apps.community_scope import PRIMARY_COMMUNITY_CODE
from apps.media_urls import concern_media_preview_url
from apps.emergencies.description import description_for_display
from apps.emergencies.models import Community, EmergencyAlert, EmergencyCategory, MapDispatchPolicy, MapGeometry


logger = logging.getLogger(__name__)

CACHE_KEY = "public:communities:v1"
CACHE_SECONDS = 300
COMMUNITY_REQUEST_RECIPIENT = "eboses@gmail.com"
NETWORK_FALLBACK_CENTER = {"latitude": 14.5995, "longitude": 120.9842, "zoom": 12}
SOS_SMS_NUMBER = "09640746068"
OFFLINE_SOS_CONFIG_VERSION = 3

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
    from apps.concerns.severity import severity_label, severity_level
    from apps.emergencies.views import ACTIVE_STATUSES

    active_communities = list(
        Community.objects.filter(
            status=Community.Status.ACTIVE,
            code=PRIMARY_COMMUNITY_CODE,
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
        .filter(
            # Guest submissions are community-visible by policy once accepted,
            # even when their configured category is not resident-feed enabled.
            Q(category_ref__isnull=True)
            | Q(category_ref__public_feed_allowed=True)
            | Q(is_anonymous=True)
        )
        .select_related(
            "community",
            "category_ref",
            "reporter",
            "reporter__resident_profile",
            "ai_assessment",
        )
        .prefetch_related(
            Prefetch(
                "media",
                queryset=ConcernMedia.objects.filter(
                    public_visible=True,
                    validation_status="accepted",
                    mime_type__startswith="image/",
                ).order_by("uploaded_at", "pk"),
                to_attr="public_preview_media",
            ),
            Prefetch(
                "comments",
                queryset=ConcernComment.objects.filter(
                    status=ConcernComment.Status.VISIBLE,
                    parent__isnull=True,
                )
                .select_related("author", "author__resident_profile", "attachment")
                .prefetch_related(
                    Prefetch(
                        "replies",
                        queryset=ConcernComment.objects.filter(
                            status=ConcernComment.Status.VISIBLE,
                        ).select_related("author", "author__resident_profile", "attachment"),
                    )
                ),
                to_attr="public_comments",
            ),
            Prefetch(
                "resolution_evidence",
                queryset=ConcernResolutionEvidence.objects.filter(
                    mime_type__startswith="image/",
                ).order_by("created_at", "pk"),
                to_attr="public_resolution_evidence",
            ),
            Prefetch(
                "status_events",
                queryset=ConcernStatusEvent.objects.filter(
                    status=Concern.Status.RESOLVED,
                ).order_by("-created_at", "-pk"),
                to_attr="public_resolved_events",
            ),
        )
        .order_by("-updated_at", "-pk")[:300]
    )
    for concern in concern_rows:
        from apps.concerns.serializers import ConcernCommentSerializer, PublicUserSerializer

        category = concern.category_ref
        summary = (concern.summary or concern.description or "").strip()[:280]
        preview_media = next(iter(concern.public_preview_media), None)
        public_reporter = PublicUserSerializer(concern.reporter).data
        reporter_label = "Community Reporter" if concern.is_anonymous else (
            public_reporter["full_name"]
            if getattr(concern.reporter, "resident_profile", None)
            or concern.reporter.get_full_name().strip()
            else "Community resident"
        )
        comments = ConcernCommentSerializer(concern.public_comments, many=True).data
        if concern.is_anonymous:
            anonymous_author = {
                "id": 0,
                "full_name": "Community Reporter",
                "initials": "CR",
                "role": "resident",
                "last_seen_at": None,
                "street": "",
                "barangay": concern.community.name,
            }
            for comment, serialized in zip(concern.public_comments, comments):
                if comment.author_id == concern.reporter_id:
                    serialized["author"] = anonymous_author
                for reply, serialized_reply in zip(comment.replies.all(), serialized["replies"]):
                    if reply.author_id == concern.reporter_id:
                        serialized_reply["author"] = anonymous_author
        is_resolved = concern.status == Concern.Status.RESOLVED
        severity = severity_label(concern)
        _severity_level, severity_assessed = severity_level(concern)
        resolution_items = (
            [
                {
                    "preview_url": f"/api/concerns/resolution-evidence/{item.pk}/preview/",
                    "original_filename": item.original_filename,
                    "mime_type": item.mime_type,
                }
                for item in concern.public_resolution_evidence
            ]
            if is_resolved
            else []
        )
        resolved_event = next(iter(concern.public_resolved_events), None)
        concerns.append(
            {
                "id": concern.pk,
                "community": by_id[concern.community_id],
                "title": concern.official_title.strip() or concern.title,
                # The accepted public map may show the resident's original
                # words separately from the generated summary in the client.
                "description": (concern.description or "").strip()[:2000],
                "summary": summary,
                "severity": severity,
                "severity_assessed": severity_assessed,
                "category": category.code if category else concern.category,
                "category_label": category.name if category else concern.get_category_display(),
                "icon_key": category.icon_key if category else "tag",
                "status": concern.status,
                "address": public_street_address(concern.address, concern.barangay),
                # Four decimals keeps a public marker useful without returning
                # the resident's original seven-decimal pin.
                "latitude": round(float(concern.latitude), 4),
                "longitude": round(float(concern.longitude), 4),
                "reporter_label": reporter_label,
                "reporter": (
                    {
                        **public_reporter,
                        "full_name": reporter_label,
                        "avatar": "",
                    }
                    if not concern.is_anonymous
                    else {
                        "id": 0,
                        "full_name": "Community Reporter",
                        "initials": "CR",
                        "role": "resident",
                        "last_seen_at": None,
                        "avatar": "",
                        "street": "",
                        "barangay": concern.community.name,
                    }
                ),
                "comments": comments,
                "comment_count": sum(1 + len(comment.replies.all()) for comment in concern.public_comments),
                "preview_url": concern_media_preview_url(preview_media.pk) if preview_media else None,
                "resolution_evidence": resolution_items,
                "resolved_at": resolved_event.created_at if resolved_event else None,
                "created_at": concern.created_at,
                "updated_at": concern.updated_at,
                "kind": "concern",
            }
        )

    from apps.concerns.serializers import AnnouncementSerializer

    announcement_rows = (
        Announcement.objects.filter(
            community_id__in=community_ids,
            is_published=True,
            audience__in={Announcement.Audience.ALL, Announcement.Audience.RESIDENTS},
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()))
        .select_related("community")
        .order_by("-is_pinned", "-published_at", "-pk")[:100]
    )
    announcements = []
    for announcement in announcement_rows:
        serialized = AnnouncementSerializer(announcement).data
        announcements.append(
            {
                **serialized,
                "community": by_id[announcement.community_id],
                "latitude": round(float(announcement.latitude), 4)
                if announcement.latitude is not None
                else None,
                "longitude": round(float(announcement.longitude), 4)
                if announcement.longitude is not None
                else None,
                "kind": "announcement",
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
                "address": public_street_address(
                    alert.resolved_location or alert.address or alert.reported_area,
                    alert.barangay,
                ),
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
        "announcements": announcements,
        "emergencies": emergencies,
        "summary": {
            "public_concerns": len(concerns),
            "public_emergencies": len(emergencies),
            "public_announcements": len(announcements),
            "alerts": len(concerns) + len(emergencies) + len(announcements),
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


class PublicStreetViewCoverageThrottle(LocalAnonRateThrottle):
    """Keep anonymous panorama lookups bounded and cacheable."""

    scope = "public_street_view_coverage"
    rate = "60/minute"


class PublicStreetViewCoverageView(APIView):
    """Resolve whether a public map point has nearby Street View coverage."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PublicStreetViewCoverageThrottle]

    def get(self, request):
        try:
            latitude = round(float(request.query_params.get("latitude", "")), 6)
            longitude = round(float(request.query_params.get("longitude", "")), 6)
        except (TypeError, ValueError):
            return Response(
                {"detail": "A valid latitude and longitude are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and -90 <= latitude <= 90
            and -180 <= longitude <= 180
        ):
            return Response(
                {"detail": "A valid latitude and longitude are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cache_key = f"public:street-view-coverage:v2:{latitude:.4f}:{longitude:.4f}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        panorama = nearest_street_panorama(
            latitude=latitude,
            longitude=longitude,
            radius_meters=100,
        )
        payload = (
            {
                "status": "available",
                "latitude": panorama["latitude"],
                "longitude": panorama["longitude"],
                "distance_meters": panorama["distance_meters"],
            }
            if panorama
            else {"status": "no_coverage"}
        )
        cache.set(cache_key, payload, 600)
        return Response(payload)


class PublicStreetViewImageThrottle(LocalAnonRateThrottle):
    """Keep the more expensive panorama image endpoint bounded."""

    scope = "public_street_view_image"
    rate = "20/minute"


def _upload_street_imagery_to_storage(imagery) -> str | None:
    """Store a fetched panorama in object storage, returning its URL.

    Returns None when storage is local or the upload fails — callers fall
    back to the inline data URL. The bytes stay out of the shared Redis
    cache either way (URL string vs 3MB base64).
    """
    try:
        from apps.accounts.storage import BACKEND as _STORAGE_BACKEND
    except Exception:
        return None
    if _STORAGE_BACKEND != "cloudinary":
        return None
    try:
        import cloudinary.uploader

        result = cloudinary.uploader.upload(
            f"data:{imagery.mime_type};base64,{imagery.image_b64}",
            public_id=f"street-view/{imagery.pano_id}",
            resource_type="image",
            overwrite=False,
            invalidate=False,
        )
        url = (result or {}).get("secure_url") or (result or {}).get("url")
        return url or None
    except Exception as exc:
        import logging as _logging

        _logging.getLogger(__name__).warning(
            "Street imagery storage upload failed: %s", exc.__class__.__name__
        )
        return None


def get_or_fetch_street_view_image(latitude: float, longitude: float) -> dict:
    """Shared fetch used by the public endpoint and the cache warmer.

    Returns the response payload (cached, fetched, or no_coverage). Nearby
    pins share 4dp cache entries; the payload records the true panorama
    coordinates so consumers see the real distance.
    """
    cache_key = f"public:street-view-image:v5:{latitude:.4f}:{longitude:.4f}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Distributed generation lock: concurrent misses for the same rounded
    # coordinate share one upstream fetch instead of stampeding Google.
    import time as _time

    lock_key = f"{cache_key}:lock"
    locked = cache.add(lock_key, True, 60)
    started = _time.perf_counter()
    try:
        imagery = fetch_latest_street_imagery(
            latitude=latitude,
            longitude=longitude,
            radius_meters=100,
        )
    finally:
        if locked:
            cache.delete(lock_key)
    elapsed_ms = (_time.perf_counter() - started) * 1000
    if elapsed_ms >= 2000:
        import logging as _logging

        _logging.getLogger(__name__).warning(
            "slow street-view-image lat=%.5f lng=%.5f ms=%.0f locked=%s",
            latitude,
            longitude,
            elapsed_ms,
            locked,
        )
    if not imagery:
        payload: dict = {"status": "no_coverage"}
    else:
        image_ref = _upload_street_imagery_to_storage(imagery)
        payload = {
            "status": "available",
            "latitude": imagery.latitude,
            "longitude": imagery.longitude,
            "distance_meters": imagery.distance_meters,
            # https URL when object storage accepted it (web <img> compatible),
            # data URL fallback otherwise.
            "image": image_ref or f"data:{imagery.mime_type};base64,{imagery.image_b64}",
        }
    # Negative caching keeps no-coverage pins cheap. Positive entries hold a
    # short URL string once stored remotely, so a longer TTL is safe there.
    cache.set(cache_key, payload, 3600 if payload.get("status") == "available" and str(payload.get("image", "")).startswith("http") else 600)
    return payload


class PublicStreetViewImageView(APIView):
    """Return the actual nearby panorama image without a Maps API key."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PublicStreetViewImageThrottle]

    def get(self, request):
        try:
            latitude = round(float(request.query_params.get("latitude", "")), 5)
            longitude = round(float(request.query_params.get("longitude", "")), 5)
        except (TypeError, ValueError):
            return Response(
                {"detail": "A valid latitude and longitude are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and -90 <= latitude <= 90
            and -180 <= longitude <= 180
        ):
            return Response(
                {"detail": "A valid latitude and longitude are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(get_or_fetch_street_view_image(latitude, longitude))


def _offline_path(geometry, bounds):
    coordinates = (geometry or {}).get("coordinates") or []
    if (geometry or {}).get("type") == "MultiPolygon":
        ring = coordinates[0][0] if coordinates and coordinates[0] else []
    else:
        ring = coordinates[0] if coordinates else []
    if not ring:
        return ""
    width, height = 1040, 929
    lng_span = bounds["max_longitude"] - bounds["min_longitude"] or 1
    lat_span = bounds["max_latitude"] - bounds["min_latitude"] or 1
    commands = []
    for index, point in enumerate(ring):
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        x = (float(point[0]) - bounds["min_longitude"]) / lng_span * width
        y = (bounds["max_latitude"] - float(point[1])) / lat_span * height
        commands.append(f"{'M' if not commands else 'L'}{x:.1f} {y:.1f}")
    return "".join(commands) + ("Z" if commands else "")


def build_offline_sos_config(_community=None):
    """Privacy-safe, cacheable geography used by the signed-out SOS screen."""
    from apps.live_map import static_map_payload

    if _community is None:
        communities = list(Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE, boundary__isnull=False, boundary__is_active=True).select_related("boundary").order_by("name", "pk"))
        packages = [build_offline_sos_config(item)["community"] for item in communities]
        return {"version": OFFLINE_SOS_CONFIG_VERSION, "smsNumber": SOS_SMS_NUMBER, "community": packages[0] if packages else None, "communities": packages}

    community = _community or (
        Community.objects.filter(
            status=Community.Status.ACTIVE,
            code=PRIMARY_COMMUNITY_CODE,
            boundary__isnull=False,
            boundary__is_active=True,
        )
        .select_related("boundary")
        .order_by("name", "pk")
        .first()
    )
    if not community:
        return {"version": OFFLINE_SOS_CONFIG_VERSION, "smsNumber": SOS_SMS_NUMBER, "community": None}
    points = list(_public_map_coordinates(community.boundary.geometry))
    bounds = {
        "min_latitude": float(community.bbox_min_latitude) if community.bbox_min_latitude is not None else min(point[0] for point in points),
        "max_latitude": float(community.bbox_max_latitude) if community.bbox_max_latitude is not None else max(point[0] for point in points),
        "min_longitude": float(community.bbox_min_longitude) if community.bbox_min_longitude is not None else min(point[1] for point in points),
        "max_longitude": float(community.bbox_max_longitude) if community.bbox_max_longitude is not None else max(point[1] for point in points),
    }
    policy = MapDispatchPolicy.current(community)
    map_payload = static_map_payload(community)
    streets = []
    for street in (map_payload.get("streets") or {}).get("streets", []):
        street_paths = []
        for geometry in street.get("geometries") or []:
            geometry_type = geometry.get("type")
            raw = geometry.get("coordinates") or []
            if geometry_type == "LineString":
                raw_paths = [raw]
            elif geometry_type == "MultiLineString":
                raw_paths = raw
            else:
                continue
            for path in raw_paths:
                step = 1
                sampled = [
                    [float(point[1]), float(point[0])]
                    for point in path[::step]
                    if isinstance(point, (list, tuple)) and len(point) >= 2
                ]
                if path and sampled and sampled[-1] != [float(path[-1][1]), float(path[-1][0])]:
                    sampled.append([float(path[-1][1]), float(path[-1][0])])
                if sampled:
                    street_paths.append(sampled)
        if street_paths:
            streets.append({
                "name": street["name"],
                "points": street_paths[0],
                "paths": street_paths,
            })
    categories = list(
        EmergencyCategory.objects.filter(
            community=community, is_active=True
        ).order_by("sort_order", "label").values(
            "code",
            "label",
            "subtext",
            "icon_key",
            "custom_icon_label",
            "quick_questions",
        )
    )
    return {
        "version": OFFLINE_SOS_CONFIG_VERSION,
        "smsNumber": SOS_SMS_NUMBER,
        "community": {
            "name": community.name,
            "bounds": {
                "minLatitude": bounds["min_latitude"],
                "maxLatitude": bounds["max_latitude"],
                "minLongitude": bounds["min_longitude"],
                "maxLongitude": bounds["max_longitude"],
            },
            "boundaryPath": _offline_path(community.boundary.geometry, bounds),
            "boundaryGeometry": community.boundary.geometry,
            "acceptance": {
                "centerLatitude": float(policy.acceptance_center_latitude),
                "centerLongitude": float(policy.acceptance_center_longitude),
                "radiusMeters": int(policy.acceptance_radius_meters),
                "geometry": policy.acceptance_geometry,
                "outOfZoneAction": policy.out_of_zone_action,
            },
            "streets": streets,
            "categories": categories,
            "boundaryRevision": community.boundary_revision,
        },
    }


class PublicOfflineSosConfigView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        payload = cache.get("public:offline-sos-config:v3")
        if payload is None:
            payload = build_offline_sos_config()
            cache.set("public:offline-sos-config:v3", payload, 300)
        return Response(payload)

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

    A barangay counts as running once it holds records - a verified resident, a
    report, an emergency - even while its own Community row is still a draft.
    That is the only evidence the coverage editor has that a neighbour is
    already dispatching for itself.
    """
    names = set(
        Community.objects.filter(status=Community.Status.ACTIVE).values_list("name", flat=True)
    )
    for queryset in (
        ResidentProfile.objects.exclude(barangay=""),
        Concern.objects.exclude(barangay=""),
        EmergencyAlert.objects.exclude(barangay=""),
    ):
        names.update(
            name.strip()
            for name in queryset.values_list("barangay", flat=True)
            if name and name.strip()
        )
    return names


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

    active = Community.objects.filter(status=Community.Status.ACTIVE, code=PRIMARY_COMMUNITY_CODE, boundary__is_active=True).select_related("boundary")

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


class CommunityRequestThrottle(LocalAnonRateThrottle):
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
