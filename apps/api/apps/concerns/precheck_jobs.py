"""Cache-backed async jobs for resident prechecks.

Text-only prechecks can move off the request thread today: the payload is
small and JSON-safe. Image uploads need object-storage staging before true
async (passing multi-MB base64 through Redis would bloat the shared cache),
so multipart requests with files stay synchronous for now and this module
documents the seam.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

from django.core.cache import cache

JOB_TTL_SECONDS = 3600
JOB_KEY_PREFIX = "precheck-job:"
# Staged prepared images live separately with a short TTL: prepared JPEGs are
# ~100-300KB base64 each (shrunk for Gemma), small enough for brief cache
# staging, unlike raw uploads or 3MB street-view panoramas.
STAGED_IMAGES_TTL_SECONDS = 600


def _job_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}{job_id}"


def _payload_hash(*, user_id: int, title: str, description: str, category: str,
                  latitude: str | None, longitude: str | None,
                  has_files: bool) -> str:
    raw = "|".join([
        str(user_id),
        (title or "").strip().lower(),
        (description or "").strip().lower(),
        (category or "").strip().lower(),
        str(latitude or ""),
        str(longitude or ""),
        "1" if has_files else "0",
    ])
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def create_precheck_job(*, user_id: int, title: str, description: str,
                        category: str, latitude: str | None,
                        longitude: str | None, has_files: bool,
                        params: dict[str, Any]) -> dict[str, Any]:
    """Create or reuse a job for idempotent repeated taps."""
    now = time.time()
    idem_key = f"{JOB_KEY_PREFIX}idem:{_payload_hash(user_id=user_id, title=title, description=description, category=category, latitude=latitude, longitude=longitude, has_files=has_files)}"
    existing_id = cache.get(idem_key)
    if existing_id:
        existing = get_precheck_job(existing_id, user_id=user_id)
        if existing and existing.get("status") in {"queued", "processing"}:
            return existing
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "status": "queued",
        "result": None,
        "error_code": None,
        "created_at": now,
        "expires_at": now + JOB_TTL_SECONDS,
        "owner_id": user_id,
    }
    cache.set(_job_key(job_id), {**job, "_params": params}, JOB_TTL_SECONDS)
    cache.set(idem_key, job_id, 300)
    return job


def get_precheck_job(job_id: str, *, user_id: int | None = None) -> dict[str, Any] | None:
    try:
        stored = cache.get(_job_key(job_id))
    except Exception:
        return None
    if not stored:
        return None
    if user_id is not None and stored.get("owner_id") != user_id:
        return None
    return {k: v for k, v in stored.items() if not k.startswith("_")}


def _update_job(job_id: str, **fields: Any) -> None:
    try:
        stored = cache.get(_job_key(job_id)) or {}
    except Exception:
        return
    stored.update(fields)
    try:
        ttl = max(60, int(stored.get("expires_at", time.time() + 300) - time.time()))
    except Exception:
        ttl = 300
    try:
        cache.set(_job_key(job_id), stored, ttl)
    except Exception:
        pass


def mark_processing(job_id: str) -> None:
    _update_job(job_id, status="processing")


def mark_completed(job_id: str, result: dict[str, Any]) -> None:
    _update_job(job_id, status="completed", result=result, error_code=None)


def mark_failed(job_id: str, error_code: str) -> None:
    # Fail-safe: submission stays available but flagged for human review.
    # Never mark security-sensitive checks as passed on model timeout.
    _update_job(job_id, status="failed", result={
        "can_submit": True,
        "automated_check_completed": False,
        "requires_review": True,
    }, error_code=error_code)


def _staged_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}images:{job_id}"


def stage_precheck_images(job_id: str, images: list) -> None:
    """Stage prepared (Gemma-sized, not raw) images for the worker.

    Stored as plain dicts so the cache backend never needs the dataclass.
    Consumed once via take_staged_images; expires quickly on orphan.
    """
    payload = [
        {"data": img.data, "mime_type": img.mime_type, "telemetry": dict(img.telemetry or {})}
        for img in (images or [])
    ]
    try:
        cache.set(_staged_key(job_id), payload, STAGED_IMAGES_TTL_SECONDS)
    except Exception:
        pass


def take_staged_images(job_id: str) -> list:
    """Fetch-and-delete staged images, rebuilt as PreparedImage objects."""
    from apps.concerns.ai.image_prep import PreparedImage

    try:
        payload = cache.get(_staged_key(job_id)) or []
        cache.delete(_staged_key(job_id))
    except Exception:
        return []
    images = []
    for item in payload:
        try:
            images.append(PreparedImage(
                data=item["data"],
                mime_type=item.get("mime_type", "image/jpeg"),
                telemetry=item.get("telemetry") or {},
            ))
        except Exception:
            continue
    return images
