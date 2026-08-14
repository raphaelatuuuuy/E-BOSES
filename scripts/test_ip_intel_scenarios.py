"""Run the full IP-intel scenario matrix against a running dev server.

Setup:
  1. Start the mock:      python scripts/mock_iplogs.py
  2. In settings.py:      IP_INTEL_URL = "http://127.0.0.1:5000/check"
  3. Start the API:       python manage.py runserver
  4. Run this script with a real account:

     python scripts/test_ip_intel_scenarios.py --email you@example.com --password secret

How it works:
  - Logs in once from the mock "PLDT" IP to get a token (login allowed).
  - For every scenario IP: re-tests login with that X-Forwarded-For header,
    then (using the token) hits concern + emergency creation with the same
    header and a minimal body.
  - Blocked scenarios must return 403 with the expected reason.
  - Allowed scenarios must NOT return 403 (a 400 serializer error means the
    gate passed — the body is intentionally invalid).
  - Registration is not covered here: OTP codes + proof upload make it
    script-hostile; test it with a VPN toggle in the real app instead.

IMPORTANT: --email must be a VERIFIED + ONBOARDED account (not
status=pending_otp), otherwise concern/emergency reject the user with a plain
403 before the IP gate ever runs.
"""

import argparse
import json
import sys

import requests

ALLOWED = "allowed"
BLOCKED = "blocked"
FAIL_OPEN = "fail-open"

# ip -> (expectation, expected_reason_for_403)
SCENARIOS = [
    # --- allowed ---
    ("124.217.98.133", ALLOWED, None, "PLDT home fiber (allowlisted)"),
    ("1.37.93.8", ALLOWED, None, "Globe (allowlisted)"),
    ("131.226.68.242", ALLOWED, None, "DITO (allowlisted)"),
    ("14.1.64.1", ALLOWED, None, "Starlink PH - suspicious verdict overridden by allowlist"),
    ("192.0.2.14", ALLOWED, None, "PLDT line mislabeled as datacenter - allowlist wins"),
    ("192.0.2.10", ALLOWED, None, "Office network, unrecognized ASN, clean verdict"),
    ("192.0.2.18", ALLOWED, None, "Cellular connection, unknown ASN"),
    # --- blocked ---
    ("8.8.8.8", BLOCKED, "outside_philippines", "Google DNS (US)"),
    ("45.82.245.81", BLOCKED, "vpn_or_proxy", "VPN provider"),
    ("103.3.61.10", BLOCKED, "datacenter_or_hosting", "PH datacenter (VITRO, not allowlisted)"),
    ("192.0.2.11", BLOCKED, "unknown_isp", "Unrecognized network type"),
    ("192.0.2.12", BLOCKED, "suspicious_network", "Suspicious verdict, unrecognized ASN"),
    ("192.0.2.13", BLOCKED, "vpn_or_proxy", "Proxy signal"),
    # --- fail-open (must NOT be blocked) ---
    ("192.0.2.15", FAIL_OPEN, None, "Malformed lookup response"),
    ("192.0.2.16", FAIL_OPEN, None, "Lookup response missing ip_info"),
]

BASE = "http://127.0.0.1:8000"
EMAIL = None
PASSWORD = None


def call(endpoint, method="post", token=None, ip=None, data=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if ip:
        headers["X-Forwarded-For"] = ip
    url = f"{BASE}{endpoint}"
    try:
        response = requests.request(method, url, headers=headers, json=data or {}, timeout=15)
        payload = None
        try:
            payload = response.json()
        except json.JSONDecodeError:
            pass
        return response.status_code, payload
    except requests.RequestException as error:
        return None, {"error": str(error)}


def check(endpoint, status, payload, ip, expectation, reason):
    if expectation == BLOCKED:
        ok = status == 403 and payload and payload.get("code") == "ip_blocked" and payload.get("reason") == reason
        detail = f"{status} {payload.get('reason') if isinstance(payload, dict) else ''}" if payload else str(status)
    else:
        ok = status != 403
        detail = str(status)
    return ok, detail


def main():
    global BASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    BASE = args.base
    EMAIL = args.email
    PASSWORD = args.password

    status, payload = call("/api/auth/login/", ip="124.217.98.133", data={"identifier": EMAIL, "password": PASSWORD})
    if status != 200 or not payload or not payload.get("access"):
        print(f"[setup] Login from mock PLDT IP failed: {status} {payload}")
        sys.exit(1)
    token = payload["access"]
    print(f"[setup] Logged in as {EMAIL} (token acquired)\n")

    print(f"{'SCENARIO':<58} {'EXPECT':<10} {'LOGIN':<28} {'CONCERN':<30} {'EMERGENCY':<30} RESULT")
    failed = 0
    for ip, expectation, reason, label in SCENARIOS:
        login_ok, login_detail = check(None, None, None, ip, expectation, reason)
        if expectation == BLOCKED:
            lstatus, lpayload = call("/api/auth/login/", ip=ip, data={"identifier": EMAIL, "password": PASSWORD})
            login_ok, login_detail = check("/login", lstatus, lpayload, ip, expectation, reason)
            cstatus, cpayload = call("/api/concerns/", token=token, ip=ip)
            c_ok, c_detail = check("/concerns", cstatus, cpayload, ip, expectation, reason)
            estatus, epayload = call("/api/emergencies/", token=token, ip=ip)
            e_ok, e_detail = check("/emergencies", estatus, epayload, ip, expectation, reason)
        else:
            lstatus, lpayload = call("/api/auth/login/", ip=ip, data={"identifier": EMAIL, "password": PASSWORD})
            login_ok, login_detail = check("/login", lstatus, lpayload, ip, expectation, reason)
            cstatus, cpayload = call("/api/concerns/", token=token, ip=ip)
            c_ok, c_detail = check("/concerns", cstatus, cpayload, ip, expectation, reason)
            estatus, epayload = call("/api/emergencies/", token=token, ip=ip)
            e_ok, e_detail = check("/emergencies", estatus, epayload, ip, expectation, reason)

        ok = login_ok and c_ok and e_ok
        failed += 0 if ok else 1
        print(
            f"{label[:58]:<58} "
            f"{expectation:<10} "
            f"{login_detail:<28} {c_detail:<30} {e_detail:<30} "
            f"{'PASS' if ok else 'FAIL'}"
        )

    print(f"\n{len(SCENARIOS) - failed}/{len(SCENARIOS)} scenarios passed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()