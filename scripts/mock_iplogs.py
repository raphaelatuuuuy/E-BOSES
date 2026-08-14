"""Mock IPLogs server for testing E-Boses IP-intel locally.

Run:  python scripts/mock_iplogs.py            (default port 5000)
Then in config/settings.py (dev only):
      IP_INTEL_URL = "http://127.0.0.1:5000/check"

Each scenario IP below maps to a canned IPLogs response. Point the E-Boses
API's X-Forwarded-For header at one of these IPs to trigger that verdict
(127.0.0.1 is a trusted proxy in dev, so the header is honored).

Test suite:
  python manage.py test apps.test_ip_intel
"""

import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 5000
SLEEP_SECONDS = 10  # for the delay scenario (timeout test)

BASE = {
    "verdict": "clean",
    "score": 0.0,
    "is_vpn": False,
    "confidence": 0.9,
    "signals": [],
}


def ip_info(ip, asn, org, country="PH", type_="isp", is_vpn=False, is_proxy=False):
    return {
        "ip": ip,
        "asn": asn,
        "org": org,
        "isp": org,
        "country": country,
        "country_code": country,
        "type": type_,
        "is_vpn": is_vpn,
        "is_proxy": is_proxy,
    }


def body(ip, info=None, **overrides):
    payload = dict(BASE)
    payload.update(overrides)
    if info is not None:
        payload["ip_info"] = info
    return payload


SCENARIOS = {
    # --- allowed ---
    "124.217.98.133": body("124.217.98.133", ip_info("124.217.98.133", "AS9299", "PLDT")),
    "1.37.93.8": body("1.37.93.8", ip_info("1.37.93.8", "AS4775", "Globe Telecom")),
    "131.226.68.242": body("131.226.68.242", ip_info("131.226.68.242", "AS139831", "DITO")),
    "14.1.64.1": body(
        "14.1.64.1",
        ip_info("14.1.64.1", "AS14593", "SpaceX Starlink", is_vpn=True),
        verdict="suspicious",
        score=0.6,
        is_vpn=True,
    ),
    # PLDT line mislabeled as datacenter: allowlisted ASN still passes
    "192.0.2.14": body(
        "192.0.2.14", ip_info("192.0.2.14", "AS9299", "PLDT", type_="datacenter")
    ),
    # office network on an unrecognized ASN, clean verdict: allowed
    "192.0.2.10": body(
        "192.0.2.10", ip_info("192.0.2.10", "AS64111", "ABC Corporation PH")
    ),
    "192.0.2.18": body(
        "192.0.2.18", ip_info("192.0.2.18", "AS99999", "Roaming carrier", type_="cellular")
    ),
    # --- blocked ---
    "8.8.8.8": body("8.8.8.8", ip_info("8.8.8.8", "AS15169", "Google", country="US")),
    # Philippine VPN (PH country + vpn verdict): exercises the VPN rule itself
    "45.82.245.81": body(
        "45.82.245.81",
        ip_info("45.82.245.81", "AS2121", "Some VPN Co", is_vpn=True),
        verdict="vpn_detected",
        score=0.95,
        is_vpn=True,
    ),
    # Philippine datacenter (VITRO), NOT allowlisted: blocked
    "103.3.61.10": body(
        "103.3.61.10", ip_info("103.3.61.10", "AS7629", "VITRO, Inc.", type_="datacenter")
    ),
    "192.0.2.11": body(
        "192.0.2.11", ip_info("192.0.2.11", "AS64111", "Some Network", type_="business")
    ),
    "192.0.2.12": body(
        "192.0.2.12", ip_info("192.0.2.12", "AS64111", "Unknown PH ISP"), verdict="suspicious", score=0.55
    ),
    "192.0.2.13": body(
        "192.0.2.13",
        ip_info("192.0.2.13", "AS64111", "Proxy Co", is_proxy=True),
        verdict="suspicious",
    ),
    # --- fail-open edge cases ---
    "192.0.2.15": "this is not json",  # malformed response -> allow
    "192.0.2.16": {"verdict": "clean"},  # missing ip_info -> allow
}

DEFAULT = body("unknown", ip_info("unknown", "AS9299", "PLDT"))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {}
        ip = payload.get("ip", "unknown")
        print(f"[mock-iplogs] lookup for {ip}", flush=True)

        if ip == "192.0.2.17":
            time.sleep(SLEEP_SECONDS)

        response = SCENARIOS.get(ip, DEFAULT)
        if isinstance(response, str):
            data = response.encode()
            ctype = "text/plain"
        else:
            data = json.dumps(response).encode()
            ctype = "application/json"

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[mock-iplogs] {self.client_address[0]} -> {fmt % args}")


if __name__ == "__main__":
    print(f"Mock IPLogs listening on http://{HOST}:{PORT}/check")
    print("Scenarios:", ", ".join(sorted(SCENARIOS)))
    HTTPServer((HOST, PORT), Handler).serve_forever()