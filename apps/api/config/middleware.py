import logging
import threading
import time

from contextvars import ContextVar

from django.conf import settings
from django.db import connection

logger = logging.getLogger("eboses.slow_requests")

# Per-request SQL counter. connection.queries is only populated under
# DEBUG=True, so production always reported queries=0. This wrapper counts
# executions without storing SQL text (storing it would itself grow memory
# per request — the thing we are trying to observe). ContextVar-based so
# counts stay correct when sync ORM work hops threads under ASGI.
_query_count_var: ContextVar[int] = ContextVar("eboses_query_count", default=0)
_query_wrapper_installed = False
_query_wrapper_lock = threading.Lock()


def _counting_wrapper(execute, sql, params, many, context):
    _query_count_var.set(_query_count_var.get() + 1)
    return execute(sql, params, many, context)


def _ensure_query_counter():
    global _query_wrapper_installed
    if _query_wrapper_installed:
        return
    with _query_wrapper_lock:
        if _query_wrapper_installed:
            return
        try:
            connection.execute_wrappers.append(_counting_wrapper)
        except Exception:
            pass
        _query_wrapper_installed = True


def _rss_mb():
    """Current process RSS in MB, or None where unavailable. Never raises.

    NOTE: resource.getrusage().ru_maxrss is the peak since process start and
    can never decrease — it must NOT be used here, or every log line shows a
    pinned high value that looks like a stuck leak. Read current resident
    pages from /proc on Linux (Render) instead.
    """
    try:
        import os

        if os.path.exists("/proc/self/statm"):
            with open("/proc/self/statm", "rb") as handle:
                resident_pages = int(handle.read().split()[1])
            page_bytes = os.sysconf("SC_PAGE_SIZE")
            return round(resident_pages * page_bytes / (1024 * 1024), 1)
    except Exception:
        pass
    try:
        import resource
        import sys

        # Last resort: peak-ever (monotonic — before/after deltas from this
        # are meaningless, but a rising value still signals growth).
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
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
        "/api/concerns/classification/test-submission/",
    )

    # Prefix matches for parameterized heavy POSTs (e.g. per-log retries).
    SHED_PREFIXES = (
        "/api/concerns/classification/log/",
    )

    SHED_GET_PREFIXES = (
        "/api/dashboard/official/summary/",
        "/api/dashboard/official/analytics/",
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if getattr(settings, "LOAD_SHEDDING_ENABLED", False):
            limit = float(getattr(settings, "LOAD_SHEDDING_RSS_MB", 450))
            shed_post = request.method == "POST" and (
                request.path in self.SHED_PATHS or request.path.startswith(self.SHED_PREFIXES)
            )
            shed_get = request.method == "GET" and request.path.startswith(self.SHED_GET_PREFIXES)
            if shed_post or shed_get:
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
        _ensure_query_counter()

    def __call__(self, request):
        started = time.perf_counter()
        rss_before = _rss_mb()
        type(self)._active_requests(1)
        token = _query_count_var.set(0)
        try:
            response = self.get_response(request)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            active = type(self)._active_requests(-1)
            try:
                query_count = _query_count_var.get()
            except Exception:
                query_count = -1
            finally:
                _query_count_var.reset(token)
            if elapsed_ms >= getattr(settings, "SLOW_REQUEST_LOG_MS", 500):
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
