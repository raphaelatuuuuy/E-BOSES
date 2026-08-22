"""Reverse-geocode every record that is missing a real street address.

Handles emergencies, concerns, and announcements with coordinates.

Usage:
    python manage.py batch_reverse_geocode          # dry run (preview)
    python manage.py batch_reverse_geocode --apply   # write to database
"""

import time

from django.core.management.base import BaseCommand


GENERIC_ADDRESSES = {
    "",
    "pinned location on map",
    "location needs confirmation",
    "marikina heights",
    "marikina heights subdivision",
    "marikina",
}


def is_bad_address(addr: str | None) -> bool:
    if not addr:
        return True
    lower = addr.strip().lower()
    return lower in GENERIC_ADDRESSES or "pinned location" in lower


class Command(BaseCommand):
    help = "Reverse-geocode emergencies, concerns, and announcements with bad addresses."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually write the resolved addresses to the database.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]
        from apps.geo_services import reverse_geocode

        total_updated = 0

        # ── Emergencies ────────────────────────────────────────────────────
        from apps.emergencies.models import EmergencyAlert

        alerts = EmergencyAlert.objects.filter(
            latitude__isnull=False, longitude__isnull=False,
        )
        self.stdout.write(f"\n=== EMERGENCIES ({alerts.count()}) ===")
        updated = 0
        for alert in alerts:
            addr = (alert.address or "").strip()
            resolved = (alert.resolved_location or "").strip()
            if addr and not is_bad_address(addr) and resolved:
                continue  # both good
            result = reverse_geocode(float(alert.latitude), float(alert.longitude))
            location = (result.get("location") or "").strip()
            if not location:
                self.stdout.write(f"  #{alert.pk} {alert.type} — no geocode result, skip")
                time.sleep(1.1)
                continue
            self.stdout.write(f"  #{alert.pk} {alert.type} — {addr!r} -> {location}")
            if apply:
                changes = []
                if is_bad_address(addr) or not addr:
                    alert.address = location
                    changes.append("address")
                if not resolved:
                    alert.resolved_location = location
                    changes.append("resolved_location")
                if changes:
                    alert.save(update_fields=[*changes, "updated_at"])
                    updated += 1
            time.sleep(1.1)
        total_updated += updated
        self.stdout.write(f"  -> {updated} emergencies updated")

        # ── Concerns ───────────────────────────────────────────────────────
        from apps.concerns.models import Concern

        concerns = Concern.objects.filter(
            latitude__isnull=False, longitude__isnull=False,
        )
        self.stdout.write(f"\n=== CONCERNS ({concerns.count()}) ===")
        updated = 0
        for concern in concerns:
            addr = (concern.address or "").strip()
            if addr and not is_bad_address(addr):
                continue
            result = reverse_geocode(float(concern.latitude), float(concern.longitude))
            location = (result.get("location") or "").strip()
            if not location:
                self.stdout.write(f"  #{concern.pk} — no geocode result, skip")
                time.sleep(1.1)
                continue
            self.stdout.write(f"  #{concern.pk} \"{concern.title}\" — {addr!r} -> {location}")
            if apply:
                concern.address = location
                concern.save(update_fields=["address", "updated_at"])
                updated += 1
            time.sleep(1.1)
        total_updated += updated
        self.stdout.write(f"  -> {updated} concerns updated")

        # ── Announcements ──────────────────────────────────────────────────
        from apps.concerns.models import Announcement

        announcements = Announcement.objects.filter(
            latitude__isnull=False, longitude__isnull=False,
        )
        self.stdout.write(f"\n=== ANNOUNCEMENTS ({announcements.count()}) ===")
        updated = 0
        for ann in announcements:
            label = (ann.place_label or "").strip()
            if label and not is_bad_address(label) and label != "Marikina Heights":
                continue
            result = reverse_geocode(float(ann.latitude), float(ann.longitude))
            location = (result.get("location") or "").strip()
            if not location:
                self.stdout.write(f"  #{ann.pk} — no geocode result, skip")
                time.sleep(1.1)
                continue
            self.stdout.write(f"  #{ann.pk} \"{ann.title}\" — {label!r} -> {location}")
            if apply:
                ann.place_label = location
                ann.save(update_fields=["place_label", "updated_at"])
                updated += 1
            time.sleep(1.1)
        total_updated += updated
        self.stdout.write(f"  -> {updated} announcements updated")

        # ── Summary ────────────────────────────────────────────────────────
        if apply:
            self.stdout.write(self.style.SUCCESS(f"\nDone. Total: {total_updated} records updated."))
        else:
            self.stdout.write(
                self.style.WARNING(
                    "\nDry run — no changes written. Re-run with --apply to save."
                )
            )
