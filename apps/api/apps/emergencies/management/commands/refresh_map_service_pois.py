"""
Refresh OpenStreetMap service POIs for the location-picker Services layer.

This command runs the same refresh the daily Celery beat task performs (it
always hits Overpass live - it is the explicit refresh tool). Map requests
never block on Overpass - they serve the on-disk snapshot - so this command is
how fresh OSM data gets in on demand.

Usage:
  python manage.py refresh_map_service_pois
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Fetch live OSM amenities for Marikina Heights and update the POI snapshot."

    def handle(self, *args, **options):
        from apps.emergencies.tasks import refresh_map_service_pois_task
        from apps.geo_services import OSM_POI_SNAPSHOT_PATH

        # Run the shared task body synchronously so command and beat schedule
        # cannot drift apart.
        result = refresh_map_service_pois_task.run()
        osm_count = int(result.get("osm", 0))
        merged_count = int(result.get("merged", 0))

        self.stdout.write(self.style.SUCCESS(f"OSM amenities kept near Heights: {osm_count}"))
        self.stdout.write(self.style.SUCCESS(f"Merged map Services markers: {merged_count}"))
        self.stdout.write(f"Snapshot: {OSM_POI_SNAPSHOT_PATH}")
        if not osm_count:
            self.stdout.write(
                self.style.WARNING(
                    "No OSM rows (Overpass may be down). Snapshot / admin POIs still apply."
                )
            )
