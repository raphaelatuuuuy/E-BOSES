import logging
import threading
import time

from django.conf import settings
from django.db import connection

logger = logging.getLogger("eboses.slow_requests")


def _rss_mb():
    """Process RSS in MB, or None where unavailable. Never raises."""
    try:
        import resource

        # ru_maxrss is kilobytes on Linux, bytes on macOS — normalize.
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        import sys

        if sys.platform == "darwin":
            rss = rss / (1024 * 1024)
        else:
            rss = rss / 1024
        return round(rss, 1)
    except Exception:
        return None


class LoadSheddingMiddleware:
    """Friendly 503s for heavy endpoints when process memory runs hot.

    Disabled by default (LOAD_SHEDDING_ENABLED): enable only if memory logs
    show sustained peaks near the limit after the bounding fixes. Never sheds
    emergencies, auth, feed, notifications, health or status — only
    non-critical heavy work (media checks, prechecks), which clients retry
    after Retry-After seconds. A shed 503 on these paths never triggers a
    Render restart (only the liveness path does that).
    """

    SHED_PATHS = (
        "/api/concerns/media/check/",
        "/api/concerns/classification/precheck/",
        "/api/public/concerns/guest/media-check/",
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if getattr(settings, "LOAD_SHEDDING_ENABLED", False):
            limit = float(getattr(settings, "LOAD_SHEDDING_RSS_MB", 450))
            if request.method == "POST" and request.path in self.SHED_PATHS:
                rss = _rss_mb()
                if rss is not None and rss >= limit:
                    logger.warning(
                        "load shed %s %s at rss=%.0fMB",
                        request.method,
                        request.get_full_path(),
                        rss,
                    )
                    from django.http import JsonResponse

                    response = JsonResponse(
                        {"detail": "Please wait a bit before trying again."},
                        status=503,
                    )
                    response["Retry-After"] = "30"
                    return response
        return self.get_response(request)


class SecurityHeadersMiddleware:
    """Adds Content-Security-Policy and Permissions-Policy to API responses.

    Both settings are empty in local development so LAN/HTTP demos stay simple.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        csp = getattr(settings, "CONTENT_SECURITY_POLICY", "")
        if csp:
            response.headers.setdefault("Content-Security-Policy", csp)
        policy = getattr(settings, "PERMISSIONS_POLICY", "")
        if policy:
            response.headers.setdefault("Permissions-Policy", policy)
        return response


class SlowRequestLoggingMiddleware:
    """Logs any request slower than SLOW_REQUEST_LOG_MS (default 500).

    Placed first so the measured time covers the whole stack. Performance
    regressions then surface in the log every day instead of being found by
    hand-run benchmarks. The entry carries memory (RSS before/after),
    response size, query count and approximate in-flight concurrency so the
    next spike can be attributed to its endpoint. Never logs bodies, tokens
    or personal data — route and numbers only.
    """

    _lock = threading.Lock()
    _active = 0

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = time.perf_counter()
        rss_before = _rss_mb()
        type(self)._active_requests(1)
        try:
            response = self.get_response(request)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            active = type(self)._active_requests(-1)
            if elapsed_ms >= getattr(settings, "SLOW_REQUEST_LOG_MS", 500):
                try:
                    query_count = len(connection.queries)
                except Exception:
                    query_count = -1
                rss_after = _rss_mb()
                try:
                    response_bytes = len(getattr(response, "content", b"") or b"")
                except Exception:
                    response_bytes = -1
                logger.warning(
                    "slow request %s %s took %.0fms queries=%d rss=%s->%sMB bytes=%d active=%d",
                    request.method,
                    request.get_full_path(),
                    elapsed_ms,
                    query_count,
                    rss_before,
                    rss_after,
                    response_bytes,
                    active,
                )
        return response

    @classmethod
    def _active_requests(cls, delta):
        with cls._lock:
            cls._active = max(0, cls._active + delta)
            return cls._active
