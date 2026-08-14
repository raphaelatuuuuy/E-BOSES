from types import SimpleNamespace

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.sms import templates
from apps.sms.gateway import count_segments


def sample_alert():
    return SimpleNamespace(
        pk=1042,
        type="fire",
        status="routed",
        resolved_location="Champaca Street, Marikina Heights",
        reported_area="",
        address="",
        barangay="Marikina Heights",
        created_at=timezone.now(),
        triage={},
    )


def alert_templates(alert):
    return {
        "emergency_ack (assigned)": templates.emergency_ack(
            alert, surname="Cruz", unit_name="Barangay Tanod", assigned=True
        ),
        "emergency_ack (unassigned)": templates.emergency_ack(
            alert, surname="Cruz", unit_name="", assigned=False
        ),
        "emergency_ack_unregistered": templates.emergency_ack_unregistered(alert),
        "responder_dispatch": templates.responder_dispatch(
            alert,
            priority="high",
            summary="Caller reports smoke from a second-floor window.",
            contact="+639171234567",
        ),
        "official_no_responder": templates.official_no_responder(
            alert, unit_name="Barangay Tanod"
        ),
        "outside_service_area": templates.outside_service_area(alert),
    }


class Command(BaseCommand):
    help = "Print every SMS message the system can send, without sending anything."

    def add_arguments(self, parser):
        parser.add_argument(
            "--name",
            default="",
            help="Only show templates whose name contains this text.",
        )
        parser.add_argument(
            "--emergency-only",
            action="store_true",
            help="Skip the static command-reply templates.",
        )

    def handle(self, *args, **options):
        needle = (options["name"] or "").lower()
        alert = sample_alert()

        groups = [("Emergency", alert_templates(alert))]
        if not options["emergency_only"]:
            groups.append(("Command replies", templates.all_static_templates()))

        shown = 0
        for group_name, entries in groups:
            printed_header = False
            for name, body in entries.items():
                if needle and needle not in name.lower():
                    continue
                if not printed_header:
                    self.stdout.write(self.style.MIGRATE_HEADING(f"\n{group_name}"))
                    printed_header = True
                segments = count_segments(body)
                self.stdout.write(
                    self.style.SUCCESS(
                        f"\n--- {name} ({len(body)} chars, {segments} segment"
                        f"{'s' if segments != 1 else ''}) ---"
                    )
                )
                self.stdout.write(body)
                shown += 1

        if shown == 0:
            self.stdout.write(self.style.WARNING("No template matched."))
        else:
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n{shown} template(s) shown. Nothing was sent."))
