"""Fetch the newest Google Street View panorama near a concern pin.

Ground-truth source for the street-imagery verification step: when a resident
reports something visible from the street, the official car panorama Google
Maps itself shows at that spot is fetched and compared against the submitted
photo.

Google's search endpoint leaves the *current-generation* car panoramas undated
while older camera-car generations carry capture dates, so undated entries are
the latest imagery and win selection. Dated panoramas are only a fallback for
spots Google has not refreshed.

The search endpoint is undocumented. It requires no key but the tile host
answers 403 without `cb_client=maps_sv.tactile` and a browser User-Agent.
Verified working as of 2026-08; if Google changes them this module degrades to
`None` and every caller must treat that as "no coverage", never as evidence
about the report.
"""

import base64
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO

import requests
from PIL import Image

logger = logging.getLogger(__name__)

TILE_TIMEOUT_SECONDS = 6
TILE_ZOOM = 3
TILE_SIZE = 512
OUTPUT_WIDTH = 3072
TILE_WORKERS = 8
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

_TILE_URL = "https://streetviewpixels-pa.googleapis.com/v1/tile"
_PANORAMA_SEARCH_ORIGIN = "https://maps.google.com"
_PANORAMA_SEARCH_TIMEOUT_SECONDS = 10


@dataclass(frozen=True)
class StreetImagery:
    """The newest car panorama found near a pin, ready for review."""

    pano_id: str
    captured_date: str
    latitude: float
    longitude: float
    distance_meters: float
    image_b64: str
    mime_type: str = "image/jpeg"


def fetch_latest_street_imagery(*, latitude: float, longitude: float, radius_meters: int) -> StreetImagery | None:
    """Panorama Google Maps currently shows within `radius_meters` of the pin, or None.

    None means no usable coverage (or the provider failed) — callers must skip
    the verification step rather than treat it as confirmation either way.
    """
    try:
        pano = _newest_pano_near(latitude, longitude, radius_meters)
        if pano is None:
            return None
        pano_id, captured_date, pano_lat, pano_lon, distance = pano
        image_b64 = _download_full_pano(pano_id)
        if not image_b64:
            return None
        return StreetImagery(
            pano_id=pano_id,
            captured_date=captured_date or "unknown",
            latitude=pano_lat,
            longitude=pano_lon,
            distance_meters=round(distance, 1),
            image_b64=image_b64,
        )
    except Exception as exc:
        logger.warning("Street imagery fetch failed: %s", exc.__class__.__name__)
        return None


def nearest_street_panorama(*, latitude: float, longitude: float, radius_meters: int = 100) -> dict | None:
    """Return the closest usable panorama location without downloading tiles."""
    pano = _newest_pano_near(latitude, longitude, radius_meters)
    if pano is None:
        return None
    pano_id, captured_date, pano_lat, pano_lon, distance = pano
    return {
        "pano_id": pano_id,
        "captured_date": captured_date or "unknown",
        "latitude": pano_lat,
        "longitude": pano_lon,
        "distance_meters": round(distance, 1),
    }


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def _newest_pano_near(latitude: float, longitude: float, radius_meters: int):
    """(pano_id, date, lat, lon, distance_m) of the latest panorama near the pin."""
    try:
        from streetview.search import extract_panoramas, make_search_url
    except Exception as exc:
        logger.warning("streetview package unavailable: %s", exc.__class__.__name__)
        return None

    radius = max(radius_meters, 25)
    candidates = []
    try:
        # The package hard-codes maps.googleapis.com, which can be reset by
        # local networks even though the same no-key endpoint is available on
        # maps.google.com. Build and send the request here so we can use the
        # working origin, browser headers, and an actual request timeout.
        search_url = make_search_url(latitude, longitude).replace(
            "https://maps.googleapis.com",
            _PANORAMA_SEARCH_ORIGIN,
            1,
        )
        response = requests.get(
            search_url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.google.com/maps/",
            },
            timeout=_PANORAMA_SEARCH_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        panoramas = extract_panoramas(response.text)
    except Exception as exc:
        logger.warning("Street imagery: panorama search failed: %s", exc.__class__.__name__)
        return None
    for pano in panoramas:
        distance = _haversine_m(latitude, longitude, pano.lat, pano.lon)
        if distance <= radius:
            candidates.append((pano.pano_id, pano.date, pano.lat, pano.lon, distance))
    if not candidates:
        logger.info("Street imagery: no panoramas within %sm of pin", radius)
        return None

    # Undated = current generation (the view Maps serves); nearest to the pin.
    undated = [item for item in candidates if not item[1]]
    if undated:
        return min(undated, key=lambda item: item[4])
    # Fallback: unrefreshed spot — newest generation wins, nearest breaks ties.
    return max(candidates, key=lambda item: (item[1], -item[4]))


def _tile_url(pano_id: str, x: int, y: int, zoom: int) -> str:
    return f"{_TILE_URL}?panoid={pano_id}&x={x}&y={y}&zoom={zoom}&cb_client=maps_sv.tactile&nbt=1&fover=2"


def _download_full_pano(pano_id: str) -> str:
    """Stitch every tile into the full 360° equirectangular panorama.

    Returns raw base64 JPEG, or "" when the tiles could not be fetched.
    """
    width_tiles = 2**TILE_ZOOM
    # The final image keeps only the middle half of the panorama. At zoom 3,
    # that is exactly tile rows 1 and 2, so do not download the sky/ground
    # rows that would be discarded after stitching.
    source_height_tiles = 2 ** (TILE_ZOOM - 1)
    source_top = source_height_tiles // 4
    source_bottom = source_height_tiles - source_top
    kept_height_tiles = source_bottom - source_top
    panorama = Image.new("RGB", (width_tiles * TILE_SIZE, kept_height_tiles * TILE_SIZE))
    positions = [(x, y) for x in range(width_tiles) for y in range(source_top, source_bottom)]

    def fetch_tile(position):
        x, y = position
        response = requests.get(
            _tile_url(pano_id, x, y, TILE_ZOOM),
            headers={"User-Agent": USER_AGENT},
            timeout=TILE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        with Image.open(BytesIO(response.content)) as tile:
            return x, y, tile.convert("RGB").copy()

    with ThreadPoolExecutor(max_workers=TILE_WORKERS) as pool:
        for x, y, tile in pool.map(fetch_tile, positions):
            panorama.paste(tile, (x * TILE_SIZE, (y - source_top) * TILE_SIZE))
            tile.close()

    # Full 360° width kept; the sky/ground rows were omitted above, then
    # downscale so the base64 payload stays practical for review and the
    # vision model.
    band = panorama.resize((OUTPUT_WIDTH, round(panorama.height * OUTPUT_WIDTH / panorama.width)), Image.LANCZOS)

    output = BytesIO()
    band.save(output, "JPEG", quality=85, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")
