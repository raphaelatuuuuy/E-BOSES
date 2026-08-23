"""IP intelligence gating for E-Boses.

Queries the configured IPLogs-style service for each client IP and decides,
per the scenario matrix in ``scripts/test_ip_intel_scenarios.py``, whether the
request may proceed. Fail-open by design: an unreachable or malformed lookup
never denies a resident service, it only loses the enrichment fields.
"""

import ipaddress

import requests
from django.conf import settings
from rest_framework import status
from rest_framework.response import Response

DEFAULT_ALLOWLIST_ASNS = {"AS9299", "AS4775", "AS139831", "AS14593"}  # PLDT, Globe, DITO, Starlink PH
KNOWN_TYPES = {"isp", "cellular"}
BLOCKED_REASONS = (
    "outside_philippines",
    "vpn_or_proxy",
    "datacenter_or_hosting",
    "suspicious_network",
    "unknown_isp",
)


def _allowed_asns():
    return frozenset(getattr(settings, "IP_INTEL_ALLOWED_ASNS", None) or DEFAULT_ALLOWLIST_ASNS)


def enabled() -> bool:
    return bool(getattr(settings, "IP_INTEL_URL", ""))


def _trusted_proxies():
    return set(getattr(settings, "IP_INTEL_TRUSTED_PROXIES", ["127.0.0.1"]))


def _in_networks(ip: str, networks) -> bool:
    for candidate in networks:
        try:
            if ipaddress.ip_address(ip) in ipaddress.ip_network(candidate, strict=False):
                return True
        except ValueError:
            continue
    return False


def get_client_ip(request) -> str:
    """Client IP; X-Forwarded-For is honored only from a trusted proxy."""
    remote = request.META.get("REMOTE_ADDR", "") or ""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "") or ""
    if forwarded and remote and _in_networks(remote, _trusted_proxies()):
        return forwarded.split(",")[0].strip()
    return remote


LOOPBACK = ("127.0.0.0/8", "::1/128")
# Addresses that cannot be geolocated. Looking one up returns nonsense — the
# provider reports loopback as a proxy — so an unroutable client must always be
# allowed rather than blocked on a guess.
UNROUTABLE = (
    "127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12",
    "192.168.0.0/16", "169.254.0.0/16", "fc00::/7", "fe80::/10",
)


def is_unroutable(ip: str) -> bool:
    if not ip:
        return True
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        return True
    return _in_networks(ip, UNROUTABLE)


def _cacheable(ip: str) -> bool:
    """Loopback is never cached: dev and tests reuse it for every scenario."""
    return bool(ip) and not _in_networks(ip, LOOPBACK)


def _provider():
    configured = getattr(settings, "IP_INTEL_PROVIDER", "") or ""
    if configured:
        return configured
    return "ip2geoapi" if "ip2geoapi" in getattr(settings, "IP_INTEL_URL", "") else "iplogs"


def _fetch(ip: str):
    url = getattr(settings, "IP_INTEL_URL", "")
    timeout = getattr(settings, "IP_INTEL_TIMEOUT_SECONDS", 2.5)
    if _provider() == "ip2geoapi":
        return requests.get(
            f"{url.rstrip('/')}/{ip}",
            params={"key": getattr(settings, "IP_INTEL_API_KEY", "")},
            timeout=timeout,
        )
    return requests.post(url, json={"ip": ip}, timeout=timeout)


def _usable(payload) -> bool:
    if not isinstance(payload, dict):
        return False
    if isinstance(payload.get("ip_info"), dict):
        return True
    return bool(payload.get("success")) and isinstance(payload.get("geo"), dict)


def lookup(ip: str):
    """Ask the intel service about this IP. Returns the payload dict or None.

    Cached per IP: without it every login, report and SOS pays the provider's
    latency, and an emergency is the worst place to spend it.
    """
    if not ip:
        return None

    from django.core.cache import cache

    key = f"ipintel:{ip}"
    if _cacheable(ip):
        cached = cache.get(key)
        if cached is not None:
            return cached or None

    response = _fetch(ip)
    response.raise_for_status()
    payload = response.json()
    valid = _usable(payload)
    if _cacheable(ip):
        cache.set(key, payload if valid else {}, getattr(settings, "IP_INTEL_CACHE_SECONDS", 900))
    return payload if valid else None


def _normalise(payload: dict):
    """One shape from either provider.

    ip2geoapi (production) reports geo/network/security; the IPLogs mock used
    by scripts/mock_iplogs.py reports a flat ip_info. Both end up here.
    """
    if isinstance(payload.get("ip_info"), dict):
        info = payload["ip_info"]
        verdict = str(payload.get("verdict", "") or "").lower()
        return {
            "asn": str(info.get("asn", "") or ""),
            "country": str(info.get("country_code", "") or "").upper(),
            "org": str(info.get("org", "") or ""),
            "score": payload.get("score"),
            "verdict": verdict,
            "is_vpn": bool(payload.get("is_vpn") or info.get("is_vpn")),
            "is_proxy": bool(info.get("is_proxy")),
            "is_hosting": str(info.get("type", "") or "").lower() in {"datacenter", "hosting"},
            "conn_type": str(info.get("type", "") or "").lower(),
            "strict_types": True,
        }

    geo = payload.get("geo") or {}
    network = payload.get("network") or {}
    security = payload.get("security") or {}
    trust = security.get("trustScore")
    return {
        "asn": str(network.get("asFormatted") or (f"AS{network['asn']}" if network.get("asn") else "")),
        "country": str(geo.get("countryCode", "") or "").upper(),
        "org": str(network.get("isp") or network.get("organization") or ""),
        # trustScore is 0-100 with higher meaning safer; ip_score stores risk.
        "score": (100 - trust) / 100 if isinstance(trust, (int, float)) else None,
        "verdict": str(security.get("riskLevel", "") or "").lower(),
        "is_vpn": bool(security.get("isVpn") or security.get("isTor") or security.get("isAnonymous")),
        "is_proxy": bool(security.get("isProxy")),
        "is_hosting": bool(security.get("isHosting")),
        "conn_type": str(network.get("connectionType", "") or "").lower(),
        # Real connection types include Corporate and Dialup, which are ordinary
        # resident connections. Only the mock's closed enum is safe to reject on.
        "strict_types": False,
        "trust_score": trust,
    }


def evaluate(payload: dict):
    """(allowed, reason, meta). Meta carries the ip_* enrichment fields."""
    facts = _normalise(payload)
    asn = facts["asn"]
    country = facts["country"]
    is_vpn = facts["is_vpn"]
    is_proxy = facts["is_proxy"]
    verdict = facts["verdict"]
    meta = {
        "asn": asn,
        "country": country,
        "org": facts["org"],
        "score": facts["score"],
        "verdict": verdict or "clean",
    }
    ip_type = facts["conn_type"]

    if asn in _allowed_asns():
        return True, None, {**meta, "verdict": "allowlisted"}
    if country and country != "PH":
        return False, "outside_philippines", meta
    if is_vpn or is_proxy:
        return False, "vpn_or_proxy", meta
    if facts["is_hosting"]:
        return False, "datacenter_or_hosting", meta
    if verdict == "suspicious":
        return False, "suspicious_network", meta

    trust = facts.get("trust_score")
    floor = getattr(settings, "IP_INTEL_MIN_TRUST_SCORE", 30)
    if isinstance(trust, (int, float)) and trust < floor:
        return False, "suspicious_network", meta

    if facts["strict_types"] and ip_type and ip_type not in KNOWN_TYPES:
        return False, "unknown_isp", meta
    return True, None, meta


def evaluate_request(request):
    """(ip, meta, reason). reason is None when the request may proceed."""
    if not enabled():
        return "", {}, None
    ip = get_client_ip(request)
    if is_unroutable(ip):
        # LAN, loopback or a malformed address: nothing to geolocate, so never block.
        return ip, {}, None
    try:
        payload = lookup(ip)
    except Exception:
        return ip, {}, None  # fail-open on network errors and timeouts
    if payload is None:
        return ip, {}, None  # fail-open on malformed or incomplete responses
    allowed, reason, meta = evaluate(payload)
    return ip, meta, None if allowed else reason


# What a resident is told, and what they can do about it. The reason code stays
# in the payload for logs and support; it is never what the person reads.
BLOCK_MESSAGES = {
    "outside_philippines": (
        "This service is only available inside the Philippines. If you are using a "
        "VPN, turn it off and try again."
    ),
    "vpn_or_proxy": (
        "Please turn off your VPN or proxy and try again. E-Boses needs your real "
        "connection so the barangay can reach you in an emergency."
    ),
    "datacenter_or_hosting": (
        "This connection looks like a server rather than a home or mobile network. "
        "Please connect through your home Wi-Fi or mobile data."
    ),
    "unknown_isp": (
        "We could not recognise this network. Please try your home Wi-Fi or mobile "
        "data, or contact the barangay office if this keeps happening."
    ),
    "suspicious_network": (
        "This connection was flagged as unsafe. Please try your home Wi-Fi or mobile "
        "data, or contact the barangay office."
    ),
}

DEFAULT_BLOCK_MESSAGE = (
    "We could not verify your internet connection. Please try your home Wi-Fi or "
    "mobile data, or contact the barangay office."
)


def ip_blocked_response(reason: str):
    return Response(
        {
            "code": "ip_blocked",
            "reason": reason,
            "detail": BLOCK_MESSAGES.get(reason, DEFAULT_BLOCK_MESSAGE),
            # An emergency must never be lost to a network check.
            "hotlines": [
                {"label": "Marikina Rescue", "number": "161"},
                {"label": "Emergency", "number": "911"},
            ],
        },
        status=status.HTTP_403_FORBIDDEN,
    )
