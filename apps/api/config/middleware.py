import logging
import time

from django.conf import settings
from django.db import connection

logger = logging.getLogger("eboses.slow_requests")


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
    hand-run benchmarks. The query count is included under DEBUG where the
    connection records it for free.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = time.perf_counter()
        try:
            response = self.get_response(request)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            if elapsed_ms >= getattr(settings, "SLOW_REQUEST_LOG_MS", 500):
                query_note = ""
                if settings.DEBUG and connection.queries_log:
                    query_note = f" queries={len(connection.queries_log)}"
                logger.warning(
                    "slow request %s %s took %.0fms%s",
                    request.method,
                    request.get_full_path(),
                    elapsed_ms,
                    query_note,
                )
        return response
