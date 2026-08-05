"""Import every street and house number in the barangay from OpenStreetMap.

    python manage.py import_map_addresses            # streets + house numbers
    python manage.py import_map_addresses --streets-only
    python manage.py import_map_addresses --dry-run

Uses Overpass, not Nominatim. Nominatim's public API is for one-off lookups and
its policy forbids bulk querying; Overpass exists for exactly this. One run
stores the data locally, after which address lookup needs no external service
at all - which is what an emergency system should depend on.

Re-run occasionally (monthly is plenty) to pick up new OSM edits.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.emergencies.models import MapAddressPoint, MapGeometry
from apps.geo_services import (
    MARIKINA_HEIGHTS_BOUNDS,
    OVERPASS_URLS,
    get_active_boundary_geometry,
    point_in_geojson,
)

# A little wider than the barangay so streets on the boundary come through whole.
BBOX_PAD = 0.004


def _bbox() -> str:
    b = MARIKINA_HEIGHTS_BOUNDS
    return (
        f'({b["min_latitude"] - BBOX_PAD},{b["min_longitude"] - BBOX_PAD},'
        f'{b["max_latitude"] + BBOX_PAD},{b["max_longitude"] + BBOX_PAD})'
    )


def _query(streets_only: bool) -> str:
    bbox = _bbox()
    parts = [f'way["highway"]["name"]{bbox};']
    if not streets_only:
        parts.append(f'node["addr:housenumber"]{bbox};')
    body = "\n  ".join(parts)
    # `out geom` gives way coordinates inline, so no second lookup is needed.
    return f"[out:json][timeout:120];\n(\n  {body}\n);\nout geom;"


def _fetch(query: str):
    import httpx

    last_error = None
    for url in OVERPASS_URLS:
        try:
            response = httpx.post(
                url,
                content=query.encode("utf-8"),
                headers={
                    "Content-Type": "text/plain",
                    "User-Agent": "E-Boses/1.0 (Barangay Marikina Heights map import)",
                },
                timeout=150,
            )
            if response.status_code != 200:
                last_error = f"HTTP {response.status_code} from {url}"
                continue
            return response.json().get("elements") or []
        except Exception as exc:
            last_error = f"{type(exc).__name__} from {url}"
            continue
    raise RuntimeError(f"Every Overpass mirror failed. Last: {last_error}")


class Command(BaseCommand):
    help = "Import barangay streets and house numbers from OpenStreetMap via Overpass."

    def add_arguments(self, parser):
        parser.add_argument("--streets-only", action="store_true")
        parser.add_argument("--dry-run", action="store_true", help="Report counts, write nothing.")
        parser.add_argument(
            "--all-in-bbox",
            action="store_true",
            help="Keep everything in the bounding box instead of clipping to the barangay boundary.",
        )

    def handle(self, *args, **options):
        self.stdout.write("Querying Overpass…")
        try:
            elements = _fetch(_query(options["streets_only"]))
        except RuntimeError as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            return

        self.stdout.write(f"Received {len(elements)} elements.")

        boundary = None if options["all_in_bbox"] else get_active_boundary_geometry()
        if boundary:
            self.stdout.write("Clipping to the active barangay boundary.")
        elif not options["all_in_bbox"]:
            self.stdout.write(self.style.WARNING(
                "No boundary geometry stored; keeping everything in the bounding box."
            ))

        def inside(lat, lng) -> bool:
            if not boundary:
                return True
            return point_in_geojson(float(lng), float(lat), boundary) is not False

        streets, addresses = [], []
        for element in elements:
            tags = element.get("tags") or {}
            if element.get("type") == "way" and tags.get("name"):
                geometry = element.get("geometry") or []
                points = [(p["lon"], p["lat"]) for p in geometry if "lat" in p and "lon" in p]
                if not points:
                    continue
                # A street counts as ours if any part of it lies inside.
                if not any(inside(lat, lng) for lng, lat in points):
                    continue
                streets.append((element, tags, points))
            elif element.get("type") == "node" and tags.get("addr:housenumber"):
                lat, lng = element.get("lat"), element.get("lon")
                if lat is None or lng is None or not inside(lat, lng):
                    continue
                addresses.append((element, tags))

        self.stdout.write(f"  streets kept   : {len(streets)}")
        self.stdout.write(f"  addresses kept : {len(addresses)}")

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry run - nothing written."))
            return

        created_streets = updated_streets = 0
        with transaction.atomic():
            for element, tags, points in streets:
                _obj, created = MapGeometry.objects.update_or_create(
                    kind=MapGeometry.Kind.STREET,
                    osm_type="W",
                    osm_id=element["id"],
                    defaults={
                        "name": tags["name"][:160],
                        "street_type": (tags.get("highway") or "")[:40],
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[lng, lat] for lng, lat in points],
                        },
                        "is_active": True,
                    },
                )
                created_streets += created
                updated_streets += not created

        created_addresses = updated_addresses = 0
        if addresses:
            with transaction.atomic():
                for element, tags in addresses:
                    _obj, created = MapAddressPoint.objects.update_or_create(
                        osm_type="N",
                        osm_id=element["id"],
                        defaults={
                            "house_number": (tags.get("addr:housenumber") or "")[:32],
                            "street": (tags.get("addr:street") or "")[:160],
                            "name": (tags.get("name") or "")[:200],
                            "latitude": element["lat"],
                            "longitude": element["lon"],
                        },
                    )
                    created_addresses += created
                    updated_addresses += not created

        from django.core.cache import cache
        from apps.geo_services import NEAREST_STREET_CACHE_KEY

        cache.delete(NEAREST_STREET_CACHE_KEY)

        self.stdout.write(self.style.SUCCESS(
            f"\nStreets   : {created_streets} new, {updated_streets} updated "
            f"({MapGeometry.objects.filter(kind=MapGeometry.Kind.STREET).count()} total)\n"
            f"Addresses : {created_addresses} new, {updated_addresses} updated "
            f"({MapAddressPoint.objects.count()} total)"
        ))
        self.stdout.write("Street lookup now answers from local data.")
