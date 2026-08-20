"""
Import Philippine barangay outlines from the PSGC/NAMRIA hierarchical dataset.

Nominatim only answers for barangays somebody has drawn as an administrative
relation, which leaves whole cities unsearchable — Manila's numbered barangays
have no OSM polygon at all. This dataset is the PSA's own boundary set, so the
coverage picker can search real outlines locally and fall back to OSM only for
whatever is missing.

    python manage.py import_psgc_barangays --city Marikina
    python manage.py import_psgc_barangays --province "Metro Manila"
    python manage.py import_psgc_barangays            # all 42,026, ~67 MB

Source: https://data.bettergov.ph/datasets/23 (MIT), derived from PSA PSGC
2023-10-24 and NAMRIA administrative boundaries v2023-11-06.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.emergencies.models import MapGeometry

DEFAULT_URL = (
    "https://github.com/bendlikeabamboo/barangay-boundaries-repository"
    "/releases/download/v2026.4.13.0/barangays.geojson"
)
# PSGC rows are told apart from OSM rows by their osm_type, so the two sources
# can share the table without colliding on the (kind, osm_type, osm_id) key.
PSGC_OSM_TYPE = "p"
BATCH = 500


class Command(BaseCommand):
    help = "Import barangay boundaries from the PSGC/NAMRIA GeoJSON dataset."

    def add_arguments(self, parser):
        parser.add_argument("--url", default=DEFAULT_URL, help="GeoJSON download URL.")
        parser.add_argument("--path", help="Read a local GeoJSON file instead of downloading.")
        parser.add_argument("--city", help="Only barangays whose city/municipality contains this.")
        parser.add_argument("--province", help="Only barangays whose province contains this.")
        parser.add_argument("--limit", type=int, help="Stop after this many features.")
        parser.add_argument("--dry-run", action="store_true", help="Report without writing.")

    def handle(self, *args, **options):
        source = Path(options["path"]) if options.get("path") else self._download(options["url"])

        self.stdout.write("Reading the boundary file…")
        try:
            with source.open(encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, ValueError) as exc:
            raise CommandError(f"Could not read {source}: {exc}") from exc

        features = payload.get("features") or []
        if not features:
            raise CommandError("That file holds no features.")
        self.stdout.write(f"{len(features):,} features in the file.")

        city = (options.get("city") or "").strip().lower()
        province = (options.get("province") or "").strip().lower()
        limit = options.get("limit")

        rows: list[MapGeometry] = []
        seen: set[int] = set()
        skipped = 0

        for feature in features:
            properties = feature.get("properties") or {}
            geometry = feature.get("geometry") or None
            if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
                skipped += 1
                continue

            municipality = (properties.get("ADM3_EN") or "").strip()
            region_province = (properties.get("ADM2_EN") or "").strip()
            if city and city not in municipality.lower():
                continue
            if province and province not in region_province.lower():
                continue

            name = (properties.get("psgc_name") or properties.get("ADM4_EN") or "").strip()
            code = (properties.get("psgc_code") or "").strip()
            if not name or not code.isdigit():
                skipped += 1
                continue
            osm_id = int(code)
            if osm_id in seen:
                continue
            seen.add(osm_id)

            rows.append(
                MapGeometry(
                    kind=MapGeometry.Kind.BOUNDARY,
                    name=name,
                    osm_type=PSGC_OSM_TYPE,
                    osm_id=osm_id,
                    geometry=geometry,
                    is_active=True,
                    locality=municipality or region_province,
                )
            )
            if limit and len(rows) >= limit:
                break

        self.stdout.write(f"{len(rows):,} barangays selected, {skipped:,} skipped.")
        if options["dry_run"]:
            for row in rows[:10]:
                self.stdout.write(f"  {row.name} — {row.locality} ({row.osm_id})")
            self.stdout.write(self.style.WARNING("Dry run: nothing written."))
            return
        if not rows:
            raise CommandError("Nothing matched those filters.")

        created, updated = self._save(rows)
        self.stdout.write(
            self.style.SUCCESS(f"Imported {created:,} new and refreshed {updated:,} barangays.")
        )

    def _download(self, url: str) -> Path:
        import httpx

        self.stdout.write(f"Downloading {url}")
        target = Path(tempfile.gettempdir()) / "psgc-barangays.geojson"
        if target.exists() and target.stat().st_size > 1_000_000:
            self.stdout.write(f"Reusing the copy already at {target}")
            return target
        try:
            with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as response:
                response.raise_for_status()
                with target.open("wb") as handle:
                    for chunk in response.iter_bytes(1024 * 256):
                        handle.write(chunk)
        except Exception as exc:
            raise CommandError(f"Download failed: {exc}") from exc
        return target

    def _save(self, rows: list[MapGeometry]) -> tuple[int, int]:
        existing = dict(
            MapGeometry.objects.filter(
                kind=MapGeometry.Kind.BOUNDARY, osm_type=PSGC_OSM_TYPE
            ).values_list("osm_id", "id")
        )
        fresh = [row for row in rows if row.osm_id not in existing]
        stale = [row for row in rows if row.osm_id in existing]

        with transaction.atomic():
            for start in range(0, len(fresh), BATCH):
                MapGeometry.objects.bulk_create(fresh[start : start + BATCH])
            for row in stale:
                MapGeometry.objects.filter(pk=existing[row.osm_id]).update(
                    name=row.name,
                    geometry=row.geometry,
                    locality=row.locality,
                    is_active=True,
                )
        return len(fresh), len(stale)
