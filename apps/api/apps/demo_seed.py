"""Shared helpers for the demo seeding commands.

Everything here writes through plain ``objects.create``. The service layer would
enqueue Gemma, SAM3 and push fan-out — and those enqueue helpers fall back to
running inline when no broker is up, so "no Celery" is not a safety net.
"""

import hashlib
import random
from datetime import timedelta
from io import BytesIO
from pathlib import Path

from django.core.files.base import ContentFile
from django.utils import timezone

from PIL import Image


MARIKINA_HEIGHTS_CENTER = (14.6507, 121.1133)

# Fallback only. streets() below prefers the barangay's own imported catalogue,
# so demo data never names a street that does not exist in Marikina Heights.
STREETS = [
    "Champaca Street",
    "Ipil Street",
    "Narra Street",
    "Dao Street",
    "Apitong Street",
    "Jasmin Street",
    "Katipunan Street",
    "Bayan-Bayanan Avenue",
]


def streets():
    """Real street names, from the imported OSM catalogue when available."""
    try:
        from apps.emergencies.models import MapGeometry

        names = list(
            MapGeometry.objects.filter(kind=MapGeometry.Kind.STREET, is_active=True)
            .exclude(name__startswith="Alley")
            .exclude(name__startswith="Unnamed")
            .values_list("name", flat=True)
            .distinct()
        )
        usable = sorted({n for n in names if n and n.isascii()})
        if usable:
            return usable
    except Exception:
        pass
    return STREETS

PALETTE = [
    (198, 122, 84),
    (96, 128, 160),
    (140, 150, 110),
    (170, 110, 120),
    (110, 140, 140),
    (150, 130, 90),
    (120, 120, 160),
    (160, 140, 130),
]


PHOTO_CACHE = Path("_demo_photo_cache")
COMMONS_API = "https://commons.wikimedia.org/w/api.php"


def _user_agent():
    """Wikimedia rejects requests without a contactable User-Agent."""
    from django.conf import settings

    contact = getattr(settings, "SUPPORT_EMAIL", "") or "noreply@e-boses.local"
    return f"EBosesDemoSeeder/1.0 (barangay capstone; contact {contact})"


class NoPhotoAvailable(RuntimeError):
    pass


def _commons_urls(query, limit=6):
    import httpx

    response = httpx.get(
        COMMONS_API,
        params={
            "action": "query",
            "generator": "search",
            "gsrsearch": query,
            "gsrnamespace": "6",
            "gsrlimit": str(limit),
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "iiurlwidth": "1400",
            "format": "json",
        },
        headers={"User-Agent": _user_agent()},
        timeout=30,
        follow_redirects=True,
    )
    response.raise_for_status()
    from urllib.parse import urlsplit

    pages = (response.json().get("query") or {}).get("pages") or {}
    urls = []
    for page in sorted(pages.values(), key=lambda p: p.get("index", 0)):
        for info in page.get("imageinfo") or []:
            url = info.get("thumburl") or info.get("url")
            if not url:
                continue
            # thumburl carries ?utm_source=..., so test the path, not the query.
            suffix = urlsplit(url).path.lower().rsplit(".", 1)[-1]
            if suffix in {"jpg", "jpeg", "png"}:
                urls.append((page.get("title", ""), url))
    return urls


def real_photo(query, *, slot=0):
    """A real, freely licensed photograph from Wikimedia Commons.

    `query` may be a single search term or an ordered list of them; the first
    that returns anything wins, so callers can put the most local term first.
    Cached on disk so re-seeding does not re-download.
    """
    import httpx

    terms = [query] if isinstance(query, str) else list(query)
    PHOTO_CACHE.mkdir(exist_ok=True)
    stamp = hashlib.sha256(f"{terms[0]}:{slot}".encode("utf-8")).hexdigest()[:20]
    cached = PHOTO_CACHE / f"{stamp}.jpg"

    if not cached.exists():
        candidates = []
        for term in terms:
            candidates = _commons_urls(term)
            if candidates:
                break
        if not candidates:
            raise NoPhotoAvailable(f"Commons returned no usable image for {terms!r}")
        _, url = candidates[slot % len(candidates)]
        image_bytes = httpx.get(
            url, headers={"User-Agent": _user_agent()}, timeout=60, follow_redirects=True
        ).content
        image = Image.open(BytesIO(image_bytes))
        image = image.convert("RGB")
        image.thumbnail((1400, 1400))
        image.save(cached, format="JPEG", quality=86)

    return ContentFile(cached.read_bytes(), name=cached.name)



def commons_file_url(title):
    """Direct URL for one exact Commons file title.

    Searching returns whatever matches the words; pinning a title returns the
    photograph that was actually reviewed. Demo images must show the thing they
    are captioned as.
    """
    import httpx

    if not title.startswith("File:"):
        title = f"File:{title}"
    response = httpx.get(
        COMMONS_API,
        params={
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url",
            "iiurlwidth": "1400",
            "format": "json",
        },
        headers={"User-Agent": _user_agent()},
        timeout=30,
        follow_redirects=True,
    )
    response.raise_for_status()
    pages = (response.json().get("query") or {}).get("pages") or {}
    for page in pages.values():
        for info in page.get("imageinfo") or []:
            url = info.get("thumburl") or info.get("url")
            if url:
                return url
    return None


def photo_by_title(title):
    """A specific, pre-verified Commons photograph, cached on disk."""
    import httpx

    PHOTO_CACHE.mkdir(exist_ok=True)
    stamp = hashlib.sha256(title.encode("utf-8")).hexdigest()[:20]
    cached = PHOTO_CACHE / f"{stamp}.jpg"

    if not cached.exists():
        url = commons_file_url(title)
        if not url:
            raise NoPhotoAvailable(f"Commons has no file named {title!r}")
        raw = httpx.get(
            url, headers={"User-Agent": _user_agent()}, timeout=60, follow_redirects=True
        ).content
        image = Image.open(BytesIO(raw)).convert("RGB")
        image.thumbnail((1400, 1400))
        image.save(cached, format="JPEG", quality=86)

    return ContentFile(cached.read_bytes(), name=cached.name)


def image_hashes(content_file):
    from apps.media_utils import phash_blocks_file, phash_file

    content_file.seek(0)
    raw = content_file.read()
    content_file.seek(0)
    sha = hashlib.sha256(raw).hexdigest()
    try:
        phash = phash_file(raw)
        blocks = phash_blocks_file(raw)
    except Exception:
        phash, blocks = "", []
    return sha, phash, blocks



def acceptance_zone():
    """The barangay's configured acceptance zone. Never hardcoded."""
    from apps.emergencies.models import Community, MapDispatchPolicy

    community = Community.objects.filter(code="marikina-heights", status=Community.Status.ACTIVE).first()
    if not community:
        raise RuntimeError("The Marikina Heights demo community is not active.")
    policy = MapDispatchPolicy.current(community)
    return {
        "latitude": float(policy.acceptance_center_latitude),
        "longitude": float(policy.acceptance_center_longitude),
        "radius_m": int(policy.acceptance_radius_meters),
        "out_of_zone_action": policy.out_of_zone_action,
    }


def _street_points():
    """(name, latitude, longitude) for every configured street, from its geometry."""
    from apps.emergencies.models import MapGeometry

    points = []
    rows = MapGeometry.objects.filter(
        kind=MapGeometry.Kind.STREET, is_active=True
    ).exclude(name__startswith="Alley").exclude(name__startswith="Unnamed")
    for row in rows:
        geometry = row.geometry or {}
        coords = geometry.get("coordinates") or []
        flat = []
        stack = [coords]
        while stack:
            item = stack.pop()
            if (
                isinstance(item, (list, tuple))
                and len(item) == 2
                and all(isinstance(v, (int, float)) for v in item)
            ):
                flat.append(item)
            elif isinstance(item, (list, tuple)):
                stack.extend(item)
        if not flat:
            continue
        longitude = sum(pair[0] for pair in flat) / len(flat)
        latitude = sum(pair[1] for pair in flat) / len(flat)
        if row.name and row.name.isascii():
            points.append((row.name, latitude, longitude))
    return points


def streets_by_zone():
    """Real streets split by the configured acceptance radius.

    Lets a demo exercise the out-of-zone path the barangay actually configured
    (block / warn / review) instead of pretending every report lands inside.
    """
    from apps.geo_services import haversine_meters

    zone = acceptance_zone()
    inside, outside = [], []
    for name, latitude, longitude in _street_points():
        distance = haversine_meters(
            zone["latitude"], zone["longitude"], latitude, longitude
        )
        target = inside if distance <= zone["radius_m"] else outside
        target.append({"name": name, "latitude": latitude, "longitude": longitude, "distance_m": round(distance)})
    inside.sort(key=lambda s: s["distance_m"])
    outside.sort(key=lambda s: s["distance_m"])
    return {"inside": inside, "outside": outside, "zone": zone}


def jitter_point(rng, spread=0.006):
    lat, lng = MARIKINA_HEIGHTS_CENTER
    return (
        round(lat + rng.uniform(-spread, spread), 7),
        round(lng + rng.uniform(-spread, spread), 7),
    )


def backdate(instance, field, when):
    """auto_now_add ignores an assigned value, so rewrite it after insert."""
    type(instance).objects.filter(pk=instance.pk).update(**{field: when})
    setattr(instance, field, when)


def ago(**kwargs):
    return timezone.now() - timedelta(**kwargs)


def ensure_tracking_number(concern):
    if concern.tracking_number:
        return concern.tracking_number
    year = concern.created_at.year if concern.created_at else timezone.now().year
    concern.tracking_number = f"RPT-{year}-{concern.pk:06d}"
    concern.save(update_fields=["tracking_number"])
    return concern.tracking_number
