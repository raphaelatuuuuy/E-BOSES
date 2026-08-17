import hashlib
import ipaddress

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


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


class ClientIPThrottle(SimpleRateThrottle):
    scope = "client_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": _digest(client_ip(request))}


class LoginIdentifierThrottle(SimpleRateThrottle):
    scope = "login_identifier"

    def get_cache_key(self, request, view):
        identifier = str(request.data.get("identifier", "")).strip().casefold()
        return self.cache_format % {"scope": self.scope, "ident": _digest(identifier or client_ip(request))}


class LoginIPThrottle(ClientIPThrottle):
    scope = "login_ip"


class RefreshSessionThrottle(SimpleRateThrottle):
    scope = "refresh_session"

    def get_cache_key(self, request, view):
        raw = next((value for key, value in request.COOKIES.items() if "refresh" in key.casefold()), "")
        return self.cache_format % {"scope": self.scope, "ident": _digest(raw or client_ip(request))}


class SystemStatusThrottle(ClientIPThrottle):
    scope = "system_status"
