"""Register (or list/delete) the inbound webhook on the SMS gateway phone.

    python manage.py register_sms_webhook --list
    python manage.py register_sms_webhook --url "https://example.ngrok-free.dev/api/sms/inbound/"
    python manage.py register_sms_webhook --delete <webhook-id>

Reads OUTBOUND_SMS_URL / OUTBOUND_SMS_USERNAME / OUTBOUND_SMS_PASSWORD so the
phone's address and credentials live in one place.
"""

import base64
from urllib.parse import urlsplit, urlunsplit

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand

# SMSGate serves its API under /3rdparty/v1; older local-server builds used the
# short paths. Probe rather than assume, so either build works.
API_PREFIXES = ("/3rdparty/v1", "")


def _host_root() -> str:
    """scheme://host:port taken from OUTBOUND_SMS_URL."""
    raw = (getattr(settings, "OUTBOUND_SMS_URL", "") or "").strip()
    if not raw:
        return ""
    parts = urlsplit(raw)
    return urlunsplit((parts.scheme, parts.netloc, "", "", "")).rstrip("/")


def _auth_header() -> dict:
    username = getattr(settings, "OUTBOUND_SMS_USERNAME", "") or ""
    password = getattr(settings, "OUTBOUND_SMS_PASSWORD", "") or ""
    if not username:
        return {}
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def discover_webhook_endpoint(root: str, headers: dict):
    """Return (endpoint, listing) for whichever API prefix this build answers on."""
    last_error = None
    for prefix in API_PREFIXES:
        endpoint = f"{root}{prefix}/webhooks"
        try:
            response = httpx.get(endpoint, headers=headers, timeout=10)
        except httpx.HTTPError as exc:
            last_error = exc
            continue
        if response.status_code == 404:
            continue
        response.raise_for_status()
        return endpoint, (response.json() or [])
    if last_error:
        raise last_error
    raise httpx.HTTPError("No /webhooks endpoint under any known API prefix.")


class Command(BaseCommand):
    help = "Register the E-Boses inbound webhook on the SMS gateway phone."

    def add_arguments(self, parser):
        parser.add_argument("--url", help="URL of /api/sms/inbound/ as the phone can reach it.")
        parser.add_argument("--list", action="store_true", help="List registered webhooks.")
        parser.add_argument("--delete", help="Delete a webhook by id.")
        parser.add_argument("--event", default="sms:received")

    def handle(self, *args, **options):
        root = _host_root()
        if not root:
            self.stderr.write(self.style.ERROR(
                "OUTBOUND_SMS_URL is not set. Add it to .env, e.g.\n"
                "  OUTBOUND_SMS_URL=http://10.118.12.5:8080/3rdparty/v1/messages"
            ))
            return

        headers = {**_auth_header(), "Content-Type": "application/json"}
        if "Authorization" not in headers:
            self.stderr.write(self.style.ERROR(
                "OUTBOUND_SMS_USERNAME / OUTBOUND_SMS_PASSWORD are not set in .env."
            ))
            return

        try:
            endpoint, hooks = discover_webhook_endpoint(root, headers)
        except httpx.HTTPStatusError as exc:
            self.stderr.write(self.style.ERROR(
                f"Gateway returned HTTP {exc.response.status_code}: {exc.response.text[:200]}"
            ))
            return
        except httpx.HTTPError as exc:
            self.stderr.write(self.style.ERROR(
                f"Could not reach the phone ({type(exc).__name__}).\n"
                "Check Local server is ON, the phone is on this network, and that\n"
                f"OUTBOUND_SMS_URL points at it. Tried: {root}"
            ))
            return

        self.stdout.write(f"API: {endpoint}")

        try:
            if options["delete"]:
                response = httpx.delete(f"{endpoint}/{options['delete']}", headers=headers, timeout=15)
                response.raise_for_status()
                self.stdout.write(self.style.SUCCESS(f"Deleted webhook {options['delete']}."))
                return

            if options["list"] or not options["url"]:
                if not hooks:
                    self.stdout.write("No webhooks registered.")
                for hook in hooks:
                    self.stdout.write(f"  {hook.get('id')}  {hook.get('event')}  {hook.get('url')}")
                    if "token=" in (hook.get("url") or ""):
                        self.stdout.write(self.style.WARNING(
                            "    ^ remove the query token from this URL. SMSGate signs webhook\n"
                            "      bodies with SMS_WEBHOOK_SIGNING_KEY; URL tokens leak into logs."
                        ))
                if not options["url"]:
                    self.stdout.write(
                        "\nRegister one with:\n"
                        "  python manage.py register_sms_webhook --url "
                        '"https://<your-domain>/api/sms/inbound/"'
                    )
                return

            self.stdout.write(f"Registering: {options['url']}")
            response = httpx.post(
                endpoint,
                json={"url": options["url"], "event": options["event"]},
                headers=headers,
                timeout=15,
            )
            response.raise_for_status()
            self.stdout.write(self.style.SUCCESS(f"Registered {options['event']}"))
        except httpx.HTTPStatusError as exc:
            self.stderr.write(self.style.ERROR(
                f"Gateway returned HTTP {exc.response.status_code}: {exc.response.text[:300]}"
            ))
            if "https" in exc.response.text.lower():
                self.stderr.write(self.style.WARNING(
                    "\nThe app only accepts an HTTPS webhook URL, or http://127.0.0.1.\n"
                    "Serve Django over HTTPS:\n"
                    "  python manage.py make_dev_cert --ip <your-pc-ip>\n"
                    "  uvicorn config.asgi:application --host 0.0.0.0 --port 8443 \\\n"
                    "      --ssl-keyfile certs/dev-key.pem --ssl-certfile certs/dev-cert.pem"
                ))
        except httpx.HTTPError as exc:
            self.stderr.write(self.style.ERROR(f"Request failed ({type(exc).__name__})."))
