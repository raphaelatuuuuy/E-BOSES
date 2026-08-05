"""Generate a self-signed TLS certificate for the local API.

android-sms-gateway refuses to register a plain-http webhook URL, so the dev
server has to speak HTTPS. This writes a cert whose SAN covers the LAN IP the
phone will actually dial.

    python manage.py make_dev_cert --ip 10.118.12.164
    uvicorn config.asgi:application --host 0.0.0.0 --port 8443 \
        --ssl-keyfile certs/dev-key.pem --ssl-certfile certs/dev-cert.pem
"""

import datetime
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from django.conf import settings
from django.core.management.base import BaseCommand


def local_ip() -> str:
    """Best guess at the LAN address, without needing an internet route."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        sock.close()


class Command(BaseCommand):
    help = "Generate a self-signed TLS certificate for local HTTPS."

    def add_arguments(self, parser):
        parser.add_argument("--ip", help="LAN IP the phone will connect to. Detected if omitted.")
        parser.add_argument("--days", type=int, default=825)
        parser.add_argument("--out", default="certs")

    def handle(self, *args, **options):
        ip = options["ip"] or local_ip()
        out_dir = Path(settings.BASE_DIR) / options["out"]
        out_dir.mkdir(parents=True, exist_ok=True)
        key_path = out_dir / "dev-key.pem"
        cert_path = out_dir / "dev-cert.pem"

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, ip),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "E-Boses Development"),
        ])

        # The phone dials an IP, not a hostname, so the IP must be in the SAN
        # or verification fails before the certificate is even considered.
        alt_names = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(ip)))
        except ValueError:
            alt_names.append(x509.DNSName(ip))

        now = datetime.datetime.now(datetime.timezone.utc)
        certificate = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=5))
            .not_valid_after(now + datetime.timedelta(days=options["days"]))
            .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256())
        )

        key_path.write_bytes(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
        cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))

        self.stdout.write(self.style.SUCCESS(f"Certificate written for {ip}"))
        self.stdout.write(f"  key  : {key_path}")
        self.stdout.write(f"  cert : {cert_path}")
        self.stdout.write(
            "\nServe HTTPS with the uvicorn already in your requirements:\n"
            f"  uvicorn config.asgi:application --host 0.0.0.0 --port 8443 \\\n"
            f"    --ssl-keyfile {key_path.relative_to(settings.BASE_DIR)} \\\n"
            f"    --ssl-certfile {cert_path.relative_to(settings.BASE_DIR)}\n"
            f"\nThen register the webhook:\n"
            f"  python manage.py register_sms_webhook --url https://{ip}:8443/api/sms/inbound/\n"
        )
        self.stdout.write(self.style.WARNING(
            "\nThis certificate is self-signed. If the gateway app refuses it with a\n"
            "TLS error, it is validating the chain - install dev-cert.pem on the phone\n"
            "as a trusted CA, or use a real certificate."
        ))
