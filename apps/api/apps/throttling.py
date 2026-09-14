import hashlib
import ipaddress

from django.conf import settings
from django.core.cache import caches
from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, ScopedRateThrottle, UserRateThrottle


def client_ip(request):
    remote = request.META.get("REMOTE_ADDR", "") or ""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "") or ""
    trusted = getattr(settings, "TRUSTED_PROXY_IPS", ["127.0.0.1", "::1"])
    try:
        remote_ip = ipaddress.ip_address(remote)
        trusted_remote = any(remote_ip in ipaddress.ip_network(value, strict=False) for value in trusted)
    except ValueError:
        trusted_remote = False
    if trusted_remote and forwarded:
        values = [value.strip() for value in forwarded.split(",") if value.strip()]
        if values:
            return values[0]
    return remote or "unknown"


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()[:32]


class LocalCacheRateThrottle(SimpleRateThrottle):
    """Rate limiting on the process-local cache, never the shared Redis.

    Every request consults anon/user/scoped throttles; against the hosted
    Upstash Redis that is 3-6 WAN round trips per API call. Throttle counters
    are per-process state anyway, so they live in CACHES["throttling"].
    """

    def __init__(self):
        self.cache = caches["throttling"]
        super().__init__()

    def allow_request(self, request, view):
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False):
            return True
        return super().allow_request(request, view)


class LocalAnonRateThrottle(LocalCacheRateThrottle, AnonRateThrottle):
    pass


class LocalUserRateThrottle(LocalCacheRateThrottle, UserRateThrottle):
    pass


class LocalScopedRateThrottle(LocalCacheRateThrottle, ScopedRateThrottle):
    # ScopedRateThrottle resolves scope/rate per view inside allow_request();
    # its own empty __init__ must win over the base one.
    def __init__(self):
        self.cache = caches["throttling"]


class ClientIPThrottle(LocalCacheRateThrottle):
    scope = "client_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": _digest(client_ip(request))}


class LoginIdentifierThrottle(LocalCacheRateThrottle):
    scope = "login_identifier"

    def get_cache_key(self, request, view):
        identifier = str(request.data.get("identifier", "")).strip().casefold()
        return self.cache_format % {"scope": self.scope, "ident": _digest(identifier or client_ip(request))}


class LoginIPThrottle(ClientIPThrottle):
    scope = "login_ip"


class RefreshSessionThrottle(LocalCacheRateThrottle):
    scope = "refresh_session"

    def get_cache_key(self, request, view):
        raw = next((value for key, value in request.COOKIES.items() if "refresh" in key.casefold()), "")
        return self.cache_format % {"scope": self.scope, "ident": _digest(raw or client_ip(request))}


class SystemStatusThrottle(ClientIPThrottle):
    scope = "system_status"
