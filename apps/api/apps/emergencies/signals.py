from django.core.cache import cache
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import MapGeometry, MapServicePoi


def _bust_map_poi_caches() -> None:
    """Admin edits should show on the next map-context request."""
    try:
        from apps.geo_services import MAP_CONTEXT_CACHE_KEY, OSM_POI_CACHE_KEY

        cache.delete(MAP_CONTEXT_CACHE_KEY)
        # Keep OSM cache; only admin merge changes. Clear map-context is enough.
        # Also clear legacy keys if any process still used them.
        cache.delete("locations-map-context:v1")
        cache.delete("locations-map-context:v2")
        _ = OSM_POI_CACHE_KEY  # documented companion key
    except Exception:
        pass


def _bust_map_geometry_caches() -> None:
    """An edited barangay outline should reach every map on the next request.

    The outline is cached twice over: the live-map static payload holds it, and
    the map context is built from that payload. Dropping only one leaves the
    resident Home map drawing the old edge.
    """
    try:
        from apps.geo_services import MAP_CONTEXT_CACHE_KEY
        from apps.live_map import STATIC_MAP_CACHE_KEY

        cache.delete(STATIC_MAP_CACHE_KEY)
        cache.delete(MAP_CONTEXT_CACHE_KEY)
    except Exception:
        pass


@receiver(post_save, sender=MapServicePoi)
@receiver(post_delete, sender=MapServicePoi)
def map_service_poi_changed(sender, **kwargs):  # noqa: ARG001
    _bust_map_poi_caches()


@receiver(post_save, sender=MapGeometry)
@receiver(post_delete, sender=MapGeometry)
def map_geometry_changed(sender, **kwargs):  # noqa: ARG001
    _bust_map_geometry_caches()
