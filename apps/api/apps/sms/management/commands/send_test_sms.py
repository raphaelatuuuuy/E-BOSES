"""Send one SMS through the configured gateway and report exactly what happened.

    python manage.py send_test_sms 09171234821
    python manage.py send_test_sms 09171234821 --message "Custom text"
    python manage.py send_test_sms --check          # show config without sending
"""

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.sms.gateway import count_segments, gateway_is_available, get_driver
from apps.sms.models import OutboundSmsMessage
from apps.sms.normalize import mask_ph_mobile, normalize_ph_mobile

DEFAULT_MESSAGE = "E-BOSES test message. If you received this, the SMS gateway is working."


class Command(BaseCommand):
    help = "Send a test SMS through the configured outbound gateway."

    def add_arguments(self, parser):
        parser.add_argument("number", nargs="?", help="PH mobile number (09..., 639..., or +639...)")
        parser.add_argument("--message", default=DEFAULT_MESSAGE)
        parser.add_argument("--check", action="store_true", help="Show gateway config and exit.")

    def handle(self, *args, **options):
        driver_name = getattr(settings, "OUTBOUND_SMS_DRIVER", "disabled")
        url = getattr(settings, "OUTBOUND_SMS_URL", "") or "(not set)"
        method = getattr(settings, "OUTBOUND_SMS_METHOD", "POST")

        self.stdout.write("Gateway configuration")
        self.stdout.write(f"  OUTBOUND_SMS_DRIVER : {driver_name}")
        self.stdout.write(f"  OUTBOUND_SMS_METHOD : {method}")
        self.stdout.write(f"  OUTBOUND_SMS_URL    : {url}")
        self.stdout.write(f"  SMS_GATEWAY_NUMBER  : {getattr(settings, 'SMS_GATEWAY_NUMBER', '') or '(not set)'}")
        self.stdout.write(f"  reachable           : {gateway_is_available()}")

        if driver_name == "console":
            self.stdout.write(self.style.WARNING(
                "\n  Driver is 'console' - nothing leaves this machine. "
                "Set OUTBOUND_SMS_DRIVER=sms_forwarder (or http_generic) in .env to send for real."
            ))

        if options["check"]:
            return

        raw = options["number"]
        if not raw:
            self.stderr.write(self.style.ERROR(
                "\nGive a number, e.g.  python manage.py send_test_sms 09171234821"
            ))
            return

        number = normalize_ph_mobile(raw)
        if not number:
            self.stderr.write(self.style.ERROR(
                f"\n'{raw}' is not a Philippine mobile number.\n"
                "Use a real 11-digit number: 09171234821, 639171234821 or +639171234821.\n"
                "(Placeholders like +639XXXXXXXXX are rejected on purpose.)"
            ))
            return

        body = options["message"]
        self.stdout.write(f"\nSending to {mask_ph_mobile(number)} ({count_segments(body)} segment(s))")

        message = OutboundSmsMessage(purpose="system", body=body, segments=count_segments(body))
        message.set_destination(number)
        message.idempotency_key = f"cli-test:{number[-4:]}:{OutboundSmsMessage.objects.count()}"
        message.driver = driver_name
        message.save()

        try:
            get_driver().send(number, body)
        except Exception as exc:
            message.status = OutboundSmsMessage.Status.FAILED
            message.last_error = f"{type(exc).__name__}: {exc}"[:255]
            message.save(update_fields=["status", "last_error"])
            self.stderr.write(self.style.ERROR(f"\nFAILED: {type(exc).__name__}: {exc}"))
            self.stderr.write(
                "\nCommon causes:\n"
                "  - OUTBOUND_SMS_URL wrong or the phone is on another network\n"
                "  - the gateway expects different JSON field names\n"
                "      -> set OUTBOUND_SMS_PAYLOAD_TEMPLATE in .env\n"
                "  - the gateway is a GET endpoint\n"
                "      -> set OUTBOUND_SMS_METHOD=GET and put {to} / {body} in the URL"
            )
            return

        from django.utils import timezone

        message.status = OutboundSmsMessage.Status.SENT
        message.sent_at = timezone.now()
        message.save(update_fields=["status", "sent_at"])
        self.stdout.write(self.style.SUCCESS(
            "\nSENT. Check the handset - if no text arrives, the gateway accepted "
            "the request but did not deliver it."
        ))
