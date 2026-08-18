from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.emergencies.models import MapGeometry
from apps.geo_services import (
    OVERPASS_URLS,
    OVERPASS_CONNECT_TIMEOUT,
)

HOME_NAME = "Marikina Heights"

SEED_BBOX = (14.60, 121.05, 14.72, 121.18)

BARANGAY_ADMIN_LEVEL = 10
CITY_ADMIN_LEVELS = (6, 4)

SNAPSHOT_PATH = Path(__file__).resolve().parents[3] / "data" / "barangay_boundaries.json"

OVERPASS_SEED_READ_TIMEOUT = 180.0
ADJACENCY_PRECISION = 7
ADJACENCY_MIN_SHARED_POINTS = 2


def _query(admin_level: int) -> str:
    south, west, north, east = SEED_BBOX
    return (
        f'[out:json][timeout:180];'
        f'relation["boundary"="administrative"]["admin_level"="{admin_level}"]'
        f'({south},{west},{north},{east});'
        f'out geom;'
    )


def _fetch(query: str) -> list[dict]:
    import httpx

    timeout = httpx.Timeout(OVERPASS_SEED_READ_TIMEOUT, connect=OVERPASS_CONNECT_TIMEOUT)
    headers = {"User-Agent": "E-Boses/1.0 (barangay-coverage-boundaries; educational)"}
    last_error = None
    for url in OVERPASS_URLS:
        try:
            with httpx.Client(timeout=timeout, headers=headers) as client:
                response = client.post(url, data={"data": query})
                response.raise_for_status()
                return list(response.json().get("elements") or [])
        except Exception as exc:  # noqa: BLE001
            last_error = f"{url}: {type(exc).__name__}: {exc}"
    raise RuntimeError(last_error or "every Overpass mirror failed")


def _stitch_rings(ways: list[list[tuple[float, float]]]) -> list[list[list[float]]]:
    rings: list[list[list[float]]] = []
    pending = [list(way) for way in ways if len(way) >= 2]

    while pending:
        chain = pending.pop(0)
        closed = chain[0] == chain[-1]
        progressed = True
        while not closed and progressed:
            progressed = False
            for index, candidate in enumerate(pending):
                if candidate[0] == chain[-1]:
                    chain.extend(candidate[1:])
                elif candidate[-1] == chain[-1]:
                    chain.extend(list(reversed(candidate))[1:])
                elif candidate[-1] == chain[0]:
                    chain = candidate[:-1] + chain
                elif candidate[0] == chain[0]:
                    chain = list(reversed(candidate))[:-1] + chain
                else:
                    continue
                pending.pop(index)
                progressed = True
                closed = chain[0] == chain[-1]
                break
        if len(chain) >= 4:
            if chain[0] != chain[-1]:
                chain.append(chain[0])
            rings.append([[lng, lat] for lat, lng in chain])
    return rings


def _relation_geometry(element: dict) -> dict | None:
    outer: list[list[tuple[float, float]]] = []
    inner: list[list[tuple[float, float]]] = []
    for member in element.get("members") or []:
        if member.get("type") != "way":
            continue
        points = [
            (round(float(p["lat"]), ADJACENCY_PRECISION), round(float(p["lon"]), ADJACENCY_PRECISION))
            for p in (member.get("geometry") or [])
            if p and "lat" in p and "lon" in p
        ]
        if len(points) < 2:
            continue
        if member.get("role") == "inner":
            inner.append(points)
        else:
            outer.append(points)

    outer_rings = _stitch_rings(outer)
    if not outer_rings:
        return None
    inner_rings = _stitch_rings(inner)

    if len(outer_rings) == 1:
        return {"type": "Polygon", "coordinates": [outer_rings[0], *inner_rings]}
    return {"type": "MultiPolygon", "coordinates": [[ring] for ring in outer_rings]}


def _ring_points(geometry: dict) -> set[tuple[float, float]]:
    polygons = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        polygons = [polygons]
    points: set[tuple[float, float]] = set()
    for polygon in polygons:
        for ring in polygon or []:
            for point in ring or []:
                if isinstance(point, (list, tuple)) and len(point) >= 2:
                    points.add(
                        (round(float(point[0]), ADJACENCY_PRECISION), round(float(point[1]), ADJACENCY_PRECISION))
                    )
    return points


def _representative_point(geometry: dict) -> tuple[float, float] | None:
    polygons = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        polygons = [polygons]
    for polygon in polygons:
        ring = (polygon or [None])[0]
        if not ring:
            continue
        lngs = [float(p[0]) for p in ring if len(p) >= 2]
        lats = [float(p[1]) for p in ring if len(p) >= 2]
        if lngs and lats:
            return sum(lngs) / len(lngs), sum(lats) / len(lats)
    return None


def _locality_for(geometry: dict, cities: list[dict]) -> str:
    from apps.geo_services import point_in_geojson

    point = _representative_point(geometry)
    if not point:
        return ""
    lng, lat = point
    for city in cities:
        if point_in_geojson(lng, lat, city["geometry"]) is True:
            return city["name"]
    return ""


class Command(BaseCommand):
    help = "Fetch barangay boundaries for Marikina and its neighbouring LGUs, then compute adjacency."

    def add_arguments(self, parser):
        parser.add_argument(
            "--offline",
            action="store_true",
            help="Load from the on-disk snapshot instead of calling Overpass.",
        )

    def handle(self, *args, **options):
        rows = self._load_snapshot() if options["offline"] else self._load_live()
        if not rows:
            self.stderr.write(self.style.ERROR("No barangay boundaries loaded; nothing was changed."))
            return

        created, updated = self._upsert(rows)
        pairs = self._link_neighbors()

        self.stdout.write(self.style.SUCCESS(f"Boundaries: {created} created, {updated} updated"))
        self.stdout.write(self.style.SUCCESS(f"Adjacency: {pairs} neighbouring pairs"))

        home = MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY, is_home=True).first()
        if home:
            self.stdout.write(f"Home: {home.name} ({home.neighbors.count()} neighbours)")
        else:
            self.stderr.write(self.style.WARNING(f"No home barangay is marked. Expected {HOME_NAME}."))

    def _collect(self, admin_level: int) -> list[dict]:
        try:
            elements = _fetch(_query(admin_level))
        except RuntimeError as exc:
            self.stderr.write(self.style.WARNING(f"admin_level {admin_level}: {exc}"))
            return []

        collected = []
        for element in elements:
            if element.get("type") != "relation":
                continue
            name = (element.get("tags") or {}).get("name")
            osm_id = element.get("id")
            if not name or not osm_id:
                continue
            geometry = _relation_geometry(element)
            if not geometry:
                continue
            collected.append({"name": name, "osm_id": int(osm_id), "geometry": geometry})
        return collected

    def _load_live(self) -> list[dict]:
        barangays = self._collect(BARANGAY_ADMIN_LEVEL)
        if not barangays:
            return []

        cities: list[dict] = []
        for level in CITY_ADMIN_LEVELS:
            cities = self._collect(level)
            if cities:
                break

        for row in barangays:
            row["locality"] = _locality_for(row["geometry"], cities)

        counts: dict[str, int] = {}
        for row in barangays:
            counts[row["locality"] or "Unknown"] = counts.get(row["locality"] or "Unknown", 0) + 1
        for locality, count in sorted(counts.items()):
            self.stdout.write(f"{locality}: {count} barangays")

        self._save_snapshot(barangays)
        return barangays

    def _load_snapshot(self) -> list[dict]:
        if not SNAPSHOT_PATH.is_file():
            self.stderr.write(self.style.ERROR(f"No snapshot at {SNAPSHOT_PATH}"))
            return []
        return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))

    def _save_snapshot(self, rows: list[dict]) -> None:
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        self.stdout.write(f"Snapshot: {SNAPSHOT_PATH}")

    @transaction.atomic
    def _upsert(self, rows: list[dict]) -> tuple[int, int]:
        created = updated = 0
        for row in rows:
            obj, was_created = MapGeometry.objects.update_or_create(
                kind=MapGeometry.Kind.BOUNDARY,
                osm_type="R",
                osm_id=row["osm_id"],
                defaults={
                    "name": row["name"],
                    "geometry": row["geometry"],
                    "locality": row["locality"],
                    "is_active": True,
                    "is_home": row["name"] == HOME_NAME,
                },
            )
            created += int(was_created)
            updated += int(not was_created)
        return created, updated

    @transaction.atomic
    def _link_neighbors(self) -> int:
        boundaries = list(
            MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY, is_active=True)
        )
        points = {row.pk: _ring_points(row.geometry or {}) for row in boundaries}

        pairs = 0
        for index, row in enumerate(boundaries):
            matches = []
            for other in boundaries[index + 1:]:
                shared = points[row.pk] & points[other.pk]
                if len(shared) >= ADJACENCY_MIN_SHARED_POINTS:
                    matches.append(other)
                    pairs += 1
            if matches:
                row.neighbors.add(*matches)
        return pairs
