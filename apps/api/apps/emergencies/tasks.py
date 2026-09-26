from celery import shared_task
from django.conf import settings


def enqueue_emergency_created_broadcast(alert_id):
    """Queue the emergency.created live-map broadcast off the request thread.

    Building the payload plus its OSRM route can block for seconds; when the
    broker is unreachable, local development still broadcasts inline.
    """
    from .tasks import broadcast_emergency_created_task

    try:
        broadcast_emergency_created_task.delay(alert_id)
    except Exception:
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
            broadcast_emergency_created_task.run(alert_id)


def enqueue_emergency_media_preview(kind: str, media_id: int):
    """Generate an emergency photo's SAM3-blurred preview in a worker.

    Without this, the first person to open an alert eats the whole Roboflow
    round trip synchronously. When the broker is unreachable, local development
    still renders inline; production falls back to first-viewer rendering,
    which the preview endpoints already handle.
    """
    from .tasks import generate_emergency_media_preview_task

    try:
        generate_emergency_media_preview_task.delay(kind, media_id)
    except Exception:
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
            generate_emergency_media_preview_task.run(kind, media_id)


def enqueue_emergency_media_integrity(alert_id: int):
    """Check the alert's photos for signs of manipulation, after dispatch.

    Ordering is the whole point. Responders are already moving by the time
    this runs, and nothing it finds can recall them. A fabricated-looking
    photo is a reason to warn the responder, never a reason to make somebody
    in trouble wait for a model to finish thinking.
    """
    from .tasks import check_emergency_media_integrity_task

    try:
        check_emergency_media_integrity_task.delay(alert_id)
    except Exception:
        # No inline fallback, even in development: running it here would put
        # the vision call back on the dispatch path, which is exactly what
        # this indirection exists to prevent.
        pass


def enqueue_emergency_description(alert_id: int):
    """Generate the responder-facing description after routing/media save."""
    try:
        generate_emergency_description_task.delay(alert_id)
    except Exception:
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
            generate_emergency_description_task.run(alert_id)


@shared_task(time_limit=180, soft_time_limit=150)
def generate_emergency_description_task(alert_id: int):
    from .description import generate_description, generate_title
    from .models import EmergencyAlert

    alert = EmergencyAlert.objects.filter(pk=alert_id).prefetch_related("media").first()
    if alert is None:
        return {"alert_id": alert_id, "status": "missing"}
    description = generate_description(alert)
    title = generate_title(alert)
    from django.db import transaction

    with transaction.atomic():
        alert = EmergencyAlert.objects.select_for_update().filter(pk=alert_id).first()
        if alert is None:
            return {"alert_id": alert_id, "status": "missing"}
        assist = dict(alert.ai_assist or {})
        assist.update({"description": description, "description_status": "ready", "title": title, "title_status": "ready"})
        alert.ai_assist = assist
        alert.save(update_fields=["ai_assist", "updated_at"])
    try:
        from apps.notifications.services import broadcast_emergency_update

        broadcast_emergency_update(alert)
    except Exception:
        # The queue refresh still picks up the saved description if realtime
        # delivery is unavailable.
        pass
    return {"alert_id": alert_id, "status": "ready"}


@shared_task(time_limit=180, soft_time_limit=150)
def check_emergency_media_integrity_task(alert_id: int):
    from apps.concerns.ai.gemma_analyzer import confirm_media_integrity
    from apps.concerns.ai.image_prep import prepare_image_for_gemma
    from apps.concerns.models import ConcernClassificationConfiguration

    from .models import EmergencyAlert

    alert = EmergencyAlert.objects.filter(pk=alert_id).prefetch_related("media").first()
    if alert is None:
        return {"alert_id": alert_id, "status": "missing"}

    config = ConcernClassificationConfiguration.current(alert.community)
    if not config.media_integrity_enabled:
        return {"alert_id": alert_id, "status": "disabled"}

    photos = [item for item in alert.media.all() if (item.mime_type or "").startswith("image/")]
    if not photos:
        return {"alert_id": alert_id, "status": "no_photo"}

    minimum = float(getattr(config, "media_integrity_min_confidence", None) or 0.70)
    findings = []
    for index, media in enumerate(photos):
        try:
            with media.file.open("rb") as handle:
                prepared = prepare_image_for_gemma(handle.read())
        except Exception:
            prepared = None
        if prepared is None:
            continue
        # Reuses the concern second-opinion prompt directly. There is no first
        # pass to confirm here, so the "claim" it is asked to check is the
        # open question itself.
        verdict = confirm_media_integrity(
            image=prepared,
            verdict="unknown",
            signals=[],
            min_confidence=minimum,
        )
        if verdict is None:
            continue
        findings.append(
            {
                "index": index,
                "media_id": media.pk,
                "verdict": verdict["verdict"],
                "confidence": verdict["confidence"],
                "signals": verdict["signals"],
                "flagged": bool(verdict["agrees"]),
            }
        )

    flagged = [item for item in findings if item["flagged"]]
    alert.media_integrity = {
        "status": "checked" if findings else "skipped",
        "findings": findings,
        "flagged": bool(flagged),
        "action": config.media_integrity_emergency_action,
    }
    alert.save(update_fields=["media_integrity"])
    return {"alert_id": alert_id, "status": "checked", "flagged": bool(flagged)}


@shared_task(time_limit=120, soft_time_limit=90)
def generate_emergency_media_preview_task(kind: str, media_id: int):
    from .media_services import ensure_emergency_media_preview

    if kind == "chat":
        from .models import EmergencyChatAttachment

        media = EmergencyChatAttachment.objects.filter(pk=media_id).first()
        if not media or media.media_type != "image":
            return {"media_id": media_id, "skipped": True}
    elif kind == "resolution_evidence":
        from .models import EmergencyResolutionEvidence

        media = EmergencyResolutionEvidence.objects.filter(pk=media_id).first()
        if not media:
            return {"media_id": media_id, "skipped": True}
    else:
        from .models import EmergencyMedia

        media = EmergencyMedia.objects.filter(pk=media_id).first()
        if not media:
            return {"media_id": media_id, "skipped": True}
    ensure_emergency_media_preview(media)
    return {"media_id": media_id, "preview": True}


@shared_task(time_limit=300, soft_time_limit=240)
def recover_missing_emergency_previews_task(batch_size=50):
    """Re-enqueue previews whose worker died or whose enqueue hit a broker gap.

    The preview endpoints serve a placeholder and re-enqueue on view; this
    sweep is what guarantees the real preview eventually lands even when
    nobody views the alert again.
    """
    from datetime import timedelta

    from django.utils import timezone

    from .models import EmergencyChatAttachment, EmergencyMedia

    cutoff = timezone.now() - timedelta(minutes=5)
    limit = max(1, min(int(batch_size), 200))
    queued = 0
    for media in (
        EmergencyMedia.objects.filter(preview_file="", uploaded_at__lte=cutoff).order_by("pk")[:limit]
    ):
        try:
            enqueue_emergency_media_preview("media", media.pk)
            queued += 1
        except Exception:
            continue
    for attachment in (
        EmergencyChatAttachment.objects.filter(
            media_type="image", preview_file="", uploaded_at__lte=cutoff
        ).order_by("pk")[:limit]
    ):
        try:
            enqueue_emergency_media_preview("chat", attachment.pk)
            queued += 1
        except Exception:
            continue
    return {"queued": queued}


@shared_task(time_limit=60, soft_time_limit=45)
def broadcast_emergency_created_task(alert_id):
    """Broadcast emergency.created with its routing enrichment to the live map."""
    from apps.notifications.services import broadcast_live_map_event

    from .live_map import emergency_payload, route_for_assignment
    from .models import EmergencyAlert

    alert = EmergencyAlert.objects.filter(pk=alert_id).first()
    if not alert:
        return {"alert_id": alert_id, "skipped": True}
    broadcast_live_map_event(
        "emergency.created",
        {"emergency": emergency_payload(alert), "route": route_for_assignment(alert)},
    )
    return {"alert_id": alert_id, "broadcast": True}


@shared_task(time_limit=60, soft_time_limit=45)
def escalate_overdue_emergencies_task(minutes=None):
    """Sweep for unacknowledged assignments and retry waiting alerts.

    The deadline comes from each emergency's routing rule; `minutes` is only a
    floor for callers that want a coarser sweep. Overlap-locked: if a run
    takes longer than the 30s beat, the next tick skips instead of
    double-escalating. Handlers underneath must stay idempotent.
    """
    from django.core.cache import cache

    lock_key = "lock:emergency-assignment-escalation"
    if not cache.add(lock_key, True, 55):
        return {"escalated": 0, "routed": 0, "minutes": minutes, "skipped": "overlap"}
    try:
        from apps.db_resilience import retry_on_db_blip

        from .views import escalate_overdue_assignments, retry_waiting_alerts

        # Pooler blips must not fail the sweep: retry once on a fresh
        # connection; the handlers themselves stay idempotent.
        escalations = retry_on_db_blip(
            lambda: escalate_overdue_assignments(minutes=minutes))()
        routed = retry_on_db_blip(retry_waiting_alerts)()
        return {"escalated": len(escalations), "routed": len(routed), "minutes": minutes}
    finally:
        cache.delete(lock_key)


@shared_task(time_limit=120, soft_time_limit=90)
def periodic_housekeeping_task():
    """Flush expired JWT tokens and prune old location pings + audit logs.

    Runs daily via ``CELERY_BEAT_SCHEDULE``. Refresh tokens accumulate in the
    blacklist tables, background GPS pings and audit-log rows accumulate
    quickly; all three are disposable once expired/old.

    Pruning old pings is safe: live-map and tracking lookups read the latest
    ping per assignment and fall back to the responder's current coordinates
    when no ping remains (see ``assignment_last_location``).
    """
    import logging
    from datetime import timedelta

    from django.conf import settings
    from django.core.management import call_command
    from django.utils import timezone

    from apps.accounts.models import AuditLog
    from apps.emergencies.models import EmergencyLocationPing

    logger = logging.getLogger(__name__)

    call_command("flushexpiredtokens")

    # Clamp so a misconfigured 0/negative env value cannot wipe tracking data.
    retention_days = max(1, int(getattr(settings, "LOCATION_PING_RETENTION_DAYS", 30)))
    cutoff = timezone.now() - timedelta(days=retention_days)
    pings_removed, _ = EmergencyLocationPing.objects.filter(created_at__lt=cutoff).delete()

    audit_retention_days = max(30, int(getattr(settings, "AUDIT_LOG_RETENTION_DAYS", 180)))
    audit_cutoff = timezone.now() - timedelta(days=audit_retention_days)
    audit_removed, _ = AuditLog.objects.filter(created_at__lt=audit_cutoff).delete()

    logger.info(
        "Housekeeping: flushed expired tokens; removed %s location pings older than %s days "
        "and %s audit logs older than %s days",
        pings_removed,
        retention_days,
        audit_removed,
        audit_retention_days,
    )
    return {
        "expired_tokens_flushed": True,
        "pings_removed": pings_removed,
        "audit_logs_removed": audit_removed,
    }


@shared_task(time_limit=120, soft_time_limit=90)
def refresh_map_service_pois_task():
    """Refresh OSM service POIs from Overpass into the on-disk snapshot.

    Runs daily via ``CELERY_BEAT_SCHEDULE``. Map requests never block on
    Overpass (they serve the on-disk snapshot), so this background refresh is
    how live OSM data reaches the snapshot file.
    """
    import logging

    from django.core.cache import cache

    from apps.geo_services import (
        MAP_CONTEXT_CACHE_KEY,
        OSM_POI_CACHE_KEY,
        collect_service_pois,
        fetch_osm_service_pois,
    )

    logger = logging.getLogger(__name__)
    cache.delete(OSM_POI_CACHE_KEY)
    cache.delete(MAP_CONTEXT_CACHE_KEY)

    osm = fetch_osm_service_pois(force_refresh=True)
    merged = collect_service_pois(force_refresh=False)
    cache.delete(MAP_CONTEXT_CACHE_KEY)

    logger.info(
        "Refreshed map service POIs: %d OSM rows, %d merged markers",
        len(osm),
        len(merged),
    )
    return {"osm": len(osm), "merged": len(merged)}


@shared_task(time_limit=300, soft_time_limit=240)
def generate_street_view_task(latitude: float, longitude: float):
    """Generate one street-view payload in the worker, never in Daphne.

    Tiles, PIL stitching, base64 and Cloudinary upload run here on the
    ``heavy`` queue. Idempotent: pure cache fill. The API only enqueues and
    returns pending; the client polls the same URL until the cache appears.
    """
    import logging
    import socket
    import time

    from django.conf import settings as _settings
    from django.core.cache import cache

    from .public_api import get_or_fetch_street_view_image

    logger = logging.getLogger(__name__)
    try:
        _hostname = socket.gethostname()
    except Exception:
        _hostname = "unknown"
    try:
        _role = getattr(_settings, "SERVICE_ROLE", "prod-heavy")
    except Exception:
        _role = "prod-heavy"
    started = time.monotonic()
    logger.info(
        "Street-view worker start lat=%.5f lng=%.5f hostname=%s service_role=%s",
        float(latitude), float(longitude), _hostname, _role,
    )
    cache_key = f"public:street-view-image:v5:{float(latitude):.4f}:{float(longitude):.4f}"
    try:
        if cache.get(cache_key) is not None:
            return {"status": "already_cached"}
    except Exception:
        pass
    try:
        payload = get_or_fetch_street_view_image(float(latitude), float(longitude))
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "Street-view worker done lat=%.5f lng=%.5f status=%s duration_ms=%d hostname=%s service_role=%s",
            float(latitude), float(longitude), payload.get("status", "unknown"),
            duration_ms, _hostname, _role,
        )
        return {"status": payload.get("status", "unknown")}
    except Exception as exc:
        logger.warning("Street-view generation failed: %s", exc.__class__.__name__)
        return {"status": "failed"}
    finally:
        try:
            cache.delete(f"{cache_key}:queued")
        except Exception:
            pass


@shared_task(time_limit=600, soft_time_limit=540)
def warm_map_cache_task(batch_size=15):
    """Hourly: pre-warm map-context + street-view caches for active areas.

    The first viewer of a cold cache otherwise pays the full compute
    (point-in-polygon street filter, panorama tile downloads). Warming the
    recent report locations plus every active community moves that cost off
    the request path. Each pin is independent — one failure never aborts
    the sweep. Idempotent: pure cache fills.
    """
    import logging
    from datetime import timedelta

    from django.utils import timezone

    logger = logging.getLogger(__name__)
    warmed = {"communities": 0, "street_view": 0, "skipped": 0}

    from apps.geo_services import map_context_payload

    from .models import Community

    for community in Community.objects.filter(status=Community.Status.ACTIVE).select_related("boundary"):
        try:
            map_context_payload(community)
            warmed["communities"] += 1
        except Exception:
            warmed["skipped"] += 1

    from apps.concerns.models import Concern

    from .public_api import get_or_fetch_street_view_image

    cutoff = timezone.now() - timedelta(days=7)
    limit = max(1, min(int(batch_size), 50))
    pins = (
        Concern.objects.filter(
            latitude__isnull=False,
            longitude__isnull=False,
            created_at__gte=cutoff,
        )
        .order_by("-created_at")
        .values_list("latitude", "longitude")[:limit]
    )
    for latitude, longitude in pins:
        try:
            payload = get_or_fetch_street_view_image(float(latitude), float(longitude))
            if payload.get("status") == "available":
                warmed["street_view"] += 1
            else:
                warmed["skipped"] += 1
        except Exception:
            warmed["skipped"] += 1
    logger.info("Warmed map caches: %s", warmed)
    return warmed
