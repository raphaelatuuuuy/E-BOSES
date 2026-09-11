import hashlib
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.emergencies.description import description_for_display
from apps.emergencies.models import EmergencyAlert, EmergencyStatusEvent
from apps.emergencies.serializers import EmergencyStatusEventSerializer
from apps.sms.parsing import parse_emergency_sms


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def snapshot(alert):
    return {
        "triage": alert.triage,
        "ai_assist": alert.ai_assist,
        "updated_at": alert.updated_at.isoformat(),
        "events": list(alert.status_events.order_by("id").values("id", "label", "note")),
    }


class Command(BaseCommand):
    help = "Preview evidence-based emergency corrections, then apply a reviewed manifest without dispatch or notifications."

    def add_arguments(self, parser):
        parser.add_argument("--output", default="../../tmp/emergency-realignment.json")
        parser.add_argument("--apply")
        parser.add_argument("--rollback")

    def handle(self, *args, **options):
        source = options["apply"] or options["rollback"]
        if options["apply"] and options["rollback"]:
            raise CommandError("Choose apply or rollback, not both.")
        if source:
            self.apply_manifest(Path(source), rollback=bool(options["rollback"]))
            return
        from apps.sms.models import InboundSmsMessage

        records = []
        for alert in EmergencyAlert.objects.order_by("pk").iterator():
            before = snapshot(alert)
            triage = dict(alert.triage or {})
            gaps = []
            for inbound in InboundSmsMessage.objects.filter(alert=alert).order_by("server_received_at", "pk"):
                parsed = parse_emergency_sms(inbound.body, sender_is_known=True)
                if not parsed.is_emergency:
                    continue
                for key, value in parsed.triage.items():
                    if key in triage and triage[key] != value:
                        gaps.append(f"Conflicting {key} in inbound message {inbound.pk}; retained stored answer.")
                    else:
                        triage[key] = value
            for key in ("people_affected", "injuries"):
                if not triage.get(key):
                    gaps.append(f"No recoverable {key} answer.")
            alert.triage = triage
            assist = dict(alert.ai_assist or {})
            assist.update(description=description_for_display(alert), description_status="ready", presentation_version=1)
            after = {
                **before,
                "triage": triage,
                "ai_assist": assist,
                "events": [{"id": event.pk, "label": EmergencyStatusEventSerializer(event).data["label"], "note": EmergencyStatusEventSerializer(event).data["note"]} for event in alert.status_events.order_by("id")],
            }
            records.append({"id": alert.pk, "approved": False, "before": before, "after": after, "before_hash": digest(before), "gaps": gaps})
        manifest = {"version": 1, "created_at": timezone.now().isoformat(), "records": records}
        target = Path(options["output"]).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        self.stdout.write(f"Previewed {len(records)} emergencies: {target}. No records changed. Mark reviewed records approved before applying.")

    def apply_manifest(self, source, *, rollback):
        manifest = json.loads(source.read_text(encoding="utf-8"))
        if manifest.get("version") != 1:
            raise CommandError("Unsupported manifest version.")
        applied = []
        for item in manifest["records"]:
            if not item.get("approved"):
                continue
            expected = item["after"] if rollback else item["before"]
            desired = item["before"] if rollback else item["after"]
            with transaction.atomic():
                alert = EmergencyAlert.objects.select_for_update().get(pk=item["id"])
                current = snapshot(alert)
                if digest(current) == digest(desired):
                    continue
                if digest(current) != digest(expected):
                    raise CommandError(f"Emergency {alert.pk} changed after preview; regenerate its correction.")
                EmergencyAlert.objects.filter(pk=alert.pk).update(triage=desired["triage"], ai_assist=desired["ai_assist"])
                for event in desired["events"]:
                    EmergencyStatusEvent.objects.filter(pk=event["id"], alert=alert).update(label=event["label"], note=event["note"])
            applied.append(item["id"])
        receipt = source.with_name(source.stem + ("-rollback-receipt" if rollback else "-applied-receipt") + ".json")
        receipt.write_text(json.dumps({"at": timezone.now().isoformat(), "ids": applied, "source_hash": digest(manifest)}, indent=2), encoding="utf-8")
        self.stdout.write(f"{'Rolled back' if rollback else 'Applied'} {len(applied)} reviewed corrections. No notifications or dispatch were triggered.")
