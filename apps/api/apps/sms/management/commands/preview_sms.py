from types import SimpleNamespace

from django.core.management.base import BaseCommand

from apps.sms import templates
from apps.sms.gateway import count_segments


def sample_alert():
    profile = SimpleNamespace(first_name="Rosario")
    return SimpleNamespace(
        pk=None, type="flood", reporter=SimpleNamespace(resident_profile=profile),
        canonical_street="Mayon Street, Hacienda Heights, Marikina",
        resolved_location="Mayon Street, Hacienda Heights, Marikina",
        reported_area="", address="", note="",
        triage={"detail": "waist", "people_affected": "one", "injuries": "yes"},
    )


def alert_templates(alert):
    return {
        "unit_dispatch": templates.responder_dispatch(alert, recipient_name="Latoy", unit_name="BDRRMC", reporter_name="Rosario Katigbak", contact="[resident phone]"),
        "resident_confirmation": templates.emergency_ack(alert, unit_name="BDRRMC"),
        "resident_en_route": templates.resident_progress(alert, "en_route", unit_name="BDRRMC"),
        "resident_nearby": templates.resident_progress(alert, "nearby", unit_name="BDRRMC"),
        "resident_arrived": templates.resident_progress(alert, "arrived", unit_name="BDRRMC"),
        "resident_resolved": templates.resident_progress(alert, "resolved", unit_name="BDRRMC"),
        "resident_exception": templates.pending_response(alert),
    }


class Command(BaseCommand):
    help = "Preview the six outbound emergency messages without sending anything."

    def add_arguments(self, parser):
        parser.add_argument("--name", default="")
        parser.add_argument("--emergency-only", action="store_true")

    def handle(self, *args, **options):
        for name, body in alert_templates(sample_alert()).items():
            if options["name"] and options["name"] not in name:
                continue
            self.stdout.write(f"\n{name} ({count_segments(body)} SMS segments)\n{body}")
        self.stdout.write("\nPreview only. Nothing was sent.")
