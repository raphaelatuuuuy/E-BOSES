"""Cache-backed async jobs for media authenticity checks.

Raw bytes are staged briefly (not prepared images: forensics needs the
original file). The 3MB-per-file / 3-files-per-check caps bound the worst
case to ~9MB per job with a 10-minute TTL; the per-owner in-flight lock
allows only one active job each, so concurrent duplicate taps collapse.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

from django.core.cache import cache

JOB_TTL_SECONDS = 3600
JOB_KEY_PREFIX = "mediacheck-job:"
STAGED_TTL_SECONDS = 600
LOCK_TTL_SECONDS = 180


def _job_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}{job_id}"


def _staged_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}files:{job_id}"


def _lock_key(owner: str) -> str:
    return f"{JOB_KEY_PREFIX}lock:{owner}"


def check_job_rate_limit(owner: str, *, limit: int, window_seconds: int = 60) -> bool:
    """Allow at most `limit` job creations per window for one owner.

    Local counters would be per-process; these live in the shared cache so
    the ceiling holds across workers. Returns False when throttled.
    """
    key = f"{JOB_KEY_PREFIX}rate:{owner}"
    try:
        count = cache.get(key)
        if count is None:
            cache.set(key, 1, window_seconds)
            return True
        if int(count) >= limit:
            return False
        try:
            cache.incr(key)
        except Exception:
            cache.set(key, int(count) + 1, window_seconds)
        return True
    except Exception:
        return True


def _file_hash(files: list[dict]) -> str:
    digest = hashlib.sha256()
    for item in files:
        digest.update(str(item.get("name", "")).encode())
        digest.update(str(item.get("size", 0)).encode())
        content = item.get("content", b"")
        if isinstance(content, str):
            content = content.encode()
        digest.update(hashlib.sha256(content).digest())
    return digest.hexdigest()[:24]


def create_media_check_job(*, owner: str, files: list[dict],
                           forensics_only: bool, community_id: int | None,
                           rate_limit: int) -> tuple[dict | None, bool, bool]:
    """Create a job, return the in-flight duplicate, or throttle.

    Returns (job, created, throttled). Duplicate taps (same owner + same
    bytes) get the same job back for free — only genuinely new jobs consume
    the per-minute rate budget.
    """
    now = time.time()
    idem_key = (
        f"{JOB_KEY_PREFIX}idem:{owner}:{_file_hash(files)}"
        f":{1 if forensics_only else 0}"
    )
    existing_id = cache.get(idem_key)
    if existing_id:
        existing = get_media_check_job(existing_id, owner=owner)
        if existing and existing.get("status") in {"queued", "processing"}:
            return existing, False, False
    if not check_job_rate_limit(owner, limit=rate_limit):
        return None, False, True
    if not cache.add(_lock_key(owner), True, LOCK_TTL_SECONDS):
        active_id = cache.get(f"{JOB_KEY_PREFIX}active:{owner}")
        if active_id:
            active = get_media_check_job(active_id, owner=owner)
            if active and active.get("status") in {"queued", "processing"}:
                return active, False, False
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "status": "queued",
        "result": None,
        "error_code": None,
        "created_at": now,
        "expires_at": now + JOB_TTL_SECONDS,
        "owner": owner,
    }
    params = {
        "forensics_only": forensics_only,
        "community_id": community_id,
        "photo_count": len(files),
    }
    cache.set(_job_key(job_id), {**job, "_params": params}, JOB_TTL_SECONDS)
    cache.set(idem_key, job_id, 600)
    cache.set(f"{JOB_KEY_PREFIX}active:{owner}", job_id, LOCK_TTL_SECONDS)
    staged = [
        {"name": item.get("name", ""), "content_type": item.get("content_type", ""),
         "size": item.get("size", 0), "content": item.get("content", b"")}
        for item in files
    ]
    try:
        cache.set(_staged_key(job_id), staged, STAGED_TTL_SECONDS)
    except Exception:
        pass
    return job, True, False


def get_media_check_job(job_id: str, *, owner: str | None = None) -> dict | None:
    try:
        stored = cache.get(_job_key(job_id))
    except Exception:
        return None
    if not stored:
        return None
    if owner is not None and stored.get("owner") != owner:
        return None
    return {k: v for k, v in stored.items() if not k.startswith("_")}


def take_staged_files(job_id: str) -> list[dict]:
    try:
        payload = cache.get(_staged_key(job_id)) or []
        cache.delete(_staged_key(job_id))
    except Exception:
        return []
    return [item for item in payload if isinstance(item, dict)]


def _update_job(job_id: str, **fields: Any) -> None:
    try:
        stored = cache.get(_job_key(job_id)) or {}
    except Exception:
        return
    owner = stored.get("owner")
    stored.update(fields)
    try:
        ttl = max(60, int(stored.get("expires_at", time.time() + 300) - time.time()))
    except Exception:
        ttl = 300
    try:
        cache.set(_job_key(job_id), stored, ttl)
    except Exception:
        pass
    if fields.get("status") in {"completed", "failed"} and owner:
        try:
            cache.delete(_lock_key(owner))
        except Exception:
            pass


def mark_processing(job_id: str) -> None:
    _update_job(job_id, status="processing")


def mark_completed(job_id: str, result: dict) -> None:
    _update_job(job_id, status="completed", result=result, error_code=None)


def mark_failed(job_id: str, error_code: str) -> None:
    _update_job(job_id, status="failed", result={
        "files": [],
        "automated_check_completed": False,
        "requires_review": True,
    }, error_code=error_code)
