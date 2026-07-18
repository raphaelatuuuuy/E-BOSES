"""
Refresh OpenStreetMap service POIs for the location-picker Services layer.

Usage:
  python manage.py refresh_map_service_pois
  python manage.py refresh_map_service_pois --force
"""

from django.core.cache import cache
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Fetch live OSM amenities for Marikina Heights and update the POI snapshot."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Bypass in-memory cache and hit Overpass again.",
        )

    def handle(self, *args, **options):
        from apps.geo_services import (
            MAP_CONTEXT_CACHE_KEY,
            OSM_POI_CACHE_KEY,
            OSM_POI_SNAPSHOT_PATH,
            collect_service_pois,
            fetch_osm_service_pois,
        )

        force = bool(options.get("force"))
        if force:
            cache.delete(OSM_POI_CACHE_KEY)
            cache.delete(MAP_CONTEXT_CACHE_KEY)

        osm = fetch_osm_service_pois(force_refresh=force)
        merged = collect_service_pois(force_refresh=False)
        cache.delete(MAP_CONTEXT_CACHE_KEY)

        self.stdout.write(self.style.SUCCESS(f"OSM amenities kept near Heights: {len(osm)}"))
        self.stdout.write(self.style.SUCCESS(f"Merged map Services markers: {len(merged)}"))
        self.stdout.write(f"Snapshot: {OSM_POI_SNAPSHOT_PATH}")
        if not osm:
            self.stdout.write(
                self.style.WARNING(
                    "No OSM rows (Overpass may be down). Snapshot / admin POIs still apply."
                )
            )
