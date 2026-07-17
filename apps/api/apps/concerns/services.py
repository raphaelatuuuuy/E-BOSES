from django.core.files.base import ContentFile

from apps.accounts.media_services import build_sanitized_preview_bytes
from apps.accounts.services import validate_location_pair
from apps.emergencies.models import MapGeometry


def _point_in_ring(longitude, latitude, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous[:2]
        x2, y2 = current[:2]
        crosses = (y1 > latitude) != (y2 > latitude)
        if crosses:
            edge_x = (x2 - x1) * (latitude - y1) / (y2 - y1) + x1
            if longitude < edge_x:
                inside = not inside
        previous = current
    return inside


def _point_in_polygon(longitude, latitude, polygon):
    if not polygon or not _point_in_ring(longitude, latitude, polygon[0]):
        return False
    return not any(_point_in_ring(longitude, latitude, hole) for hole in polygon[1:])


def validate_barangay_location(latitude, longitude):
    """Validate against the active GeoJSON boundary, with bounds as a safe fallback."""
    validate_location_pair(latitude, longitude, required=True)
    boundary = (
        MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY, is_active=True)
        .order_by("name", "id")
        .first()
    )
    if not boundary:
        return
    geometry = boundary.geometry or {}
    coordinates = geometry.get("coordinates") or []
    longitude = float(longitude)
    latitude = float(latitude)
    if geometry.get("type") == "Polygon":
        inside = _point_in_polygon(longitude, latitude, coordinates)
    elif geometry.get("type") == "MultiPolygon":
        inside = any(_point_in_polygon(longitude, latitude, polygon) for polygon in coordinates)
    else:
        inside = False
    if not inside:
        from django.core.exceptions import ValidationError

        raise ValidationError("Location must be inside Barangay Marikina Heights.")


def ensure_concern_media_preview(media):
    if media.preview_file and media.preview_file.name.lower().endswith(
        (".jpg", ".jpeg", ".png", ".webp")
    ):
        return media.preview_file
    if media.preview_file:
        media.preview_file.delete(save=False)
    media.preview_file.save(
        f"preview-{media.pk}.jpg",
        ContentFile(build_sanitized_preview_bytes(media.file, media.mime_type)),
        save=True,
    )
    return media.preview_file


def user_can_access_concern_media_raw(user, media):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff or user.role == user.Role.BARANGAY_OFFICIAL:
        return True
    return user.pk == media.concern.reporter_id
