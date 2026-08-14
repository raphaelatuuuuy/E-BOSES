import json
import random
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.demo_scenarios import EMERGENCIES
from apps.demo_seed import backdate, jitter_point, streets_by_zone
from apps.emergencies.models import (
    EmergencyAlert,
    EmergencyCategory,
    EmergencyChatMessage,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    EmergencyTypeRoleMap,
)

BACKUP_DIR = Path("_demo_backups")


class Command(BaseCommand):
    help = (
        "Seed emergencies across the full lifecycle, using only the emergency types the "
        "barangay has configured and the units they are actually routed to."
    )

    def add_arguments(self, parser):
        parser.add_argument("--keep-existing", action="store_true")
        parser.add_argument("--skip-backup", action="store_true")

    def backup(self):
        alerts = list(
            EmergencyAlert.objects.values("id", "public_id", "type", "status", "barangay", "created_at")
        )
        if not alerts:
            return
        BACKUP_DIR.mkdir(exist_ok=True)
        path = BACKUP_DIR / f"emergencies-{timezone.now():%Y%m%d-%H%M%S}.json"
        path.write_text(json.dumps(alerts, indent=2, default=str), encoding="utf-8")
        self.stdout.write(f"  exported {len(alerts)} alerts to {path}")

    def routing(self):
        """Configured type -> (department, responder unit, ack timeout)."""
        table = {}
        for row in EmergencyTypeRoleMap.objects.select_related("department").filter(is_active=True):
            table[row.emergency_type] = (
                row.department,
                row.responder_unit,
                row.acknowledgment_timeout_seconds,
            )
        return table

    def responder_for(self, unit, responders):
        for user in responders:
            if user.responder_unit == unit:
                return user
        return responders[0] if responders else None

    def handle(self, *args, **options):
        rng = random.Random("emergency-lifecycle")
        zones = streets_by_zone()
        User = get_user_model()

        reporters = list(
            User.objects.filter(role=User.Role.RESIDENT, status=User.Status.VERIFIED)[:12]
        )
        if not reporters:
            self.stdout.write(self.style.ERROR("  No verified residents. Run seed_demo_data first."))
            return
        responders = list(
            User.objects.filter(role=User.Role.FIRST_RESPONDER, status=User.Status.VERIFIED)[:6]
        )

        configured = set(
            EmergencyCategory.objects.filter(is_active=True).values_list("code", flat=True)
        )
        routes = self.routing()
        self.stdout.write(f"  configured emergency types: {', '.join(sorted(configured)) or 'none'}")

        if not options["keep_existing"]:
            if not options["skip_backup"]:
                self.backup()
            removed = EmergencyAlert.objects.all().delete()[0]
            self.stdout.write(f"  cleared {removed} rows across the alert graph")

        created = 0
        skipped = []
        covered = set()

        for index, spec in enumerate(EMERGENCIES):
            kind = spec["type"]
            if kind not in configured:
                skipped.append(kind)
                continue

            when = timezone.now() - timedelta(hours=spec["hours_ago"])
            # Pin to the street the scenario names so the alert lands where the
            # text says it does, and inside the configured acceptance zone.
            pool = zones["inside"] or zones["outside"]
            street = next(
                (s for s in pool if s["name"].split()[0].lower() in spec["place"].lower()),
                pool[index % len(pool)],
            )
            latitude = round(street["latitude"] + rng.uniform(-0.0003, 0.0003), 7)
            longitude = round(street["longitude"] + rng.uniform(-0.0003, 0.0003), 7)
            reporter = reporters[index % len(reporters)]
            department, unit, _ack = routes.get(kind, (None, "", 0))

            alert = EmergencyAlert.objects.create(
                reporter=reporter,
                type=kind,
                status=spec["status"],
                latitude=latitude,
                longitude=longitude,
                resolved_location=spec["place"],
                reported_area=spec["place"],
                reporter_contact_number=getattr(reporter, "phone_number", "") or "",
                triage=spec.get("triage") or {},
                resolution_report=spec["note"] if spec["status"] in {"resolved", "closed"} else "",
            )
            backdate(alert, "created_at", when)
            covered.add(kind)

            for step, status_value in enumerate(spec["trail"]):
                event = EmergencyStatusEvent.objects.create(
                    alert=alert,
                    status=status_value,
                    event_key=status_value,
                    label=status_value.replace("_", " ").title(),
                    note=spec["note"] if step == len(spec["trail"]) - 1 else "",
                )
                backdate(event, "created_at", when + timedelta(minutes=step * 6))

            responder = None
            if spec.get("assign") and responders:
                responder = self.responder_for(unit, responders)
                assignment = EmergencyResponderAssignment.objects.create(
                    alert=alert,
                    responder=responder,
                    role_map=EmergencyTypeRoleMap.objects.filter(
                        emergency_type=kind, is_active=True
                    ).first(),
                    status=spec["assign"],
                    source=EmergencyResponderAssignment.Source.AUTO,
                    travel_profile="moto" if unit == "bdrrmo" else "foot",
                )
                backdate(assignment, "assigned_at", when + timedelta(minutes=2))

            for step, (who, body) in enumerate(spec.get("chat") or []):
                sender = reporter if who == "reporter" else (responder or reporter)
                message = EmergencyChatMessage.objects.create(
                    alert=alert, sender=sender, body=body
                )
                backdate(message, "created_at", when + timedelta(minutes=4 + step * 7))

            if spec["status"] in {"resolved", "closed"}:
                EmergencyAlert.objects.filter(pk=alert.pk).update(
                    resolved_at=when + timedelta(minutes=48),
                    resolution_submitted_at=when + timedelta(minutes=46),
                )
            created += 1

        self.stdout.write(self.style.SUCCESS(f"  {created} emergencies seeded"))
        self.stdout.write(f"  types demonstrated: {', '.join(sorted(covered))}")

        missing = configured - covered
        if missing:
            self.stdout.write(
                self.style.WARNING(f"  configured but not demonstrated: {', '.join(sorted(missing))}")
            )
        if skipped:
            self.stdout.write(
                self.style.WARNING(
                    f"  {len(skipped)} scenario(s) skipped, type not configured: {', '.join(sorted(set(skipped)))}"
                )
            )
