"""Fill missing resident home coordinates from the street in their address.

Older accounts predate saved home coordinates, so the SOS "Home address"
shortcut reports "not saved" for them even though every user has an address.
This resolves each profile's street segment (the part before the first comma,
e.g. "Bayan-bayanan avenue" from "Bayan-bayanan avenue, Marikina Heights")
against the imported street catalogue and stores the street centroid.

Safe to rerun: profiles that already have coordinates are skipped unless
--overwrite is given. Profiles whose street cannot be matched are left alone
and reported, never guessed.
"""

import re
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction


def _key(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _geometry_points(geometry):
    coords = (geometry or {}).get("coordinates") or []
    flat = []
    stack = [coords]
    while stack:
        item = stack.pop()
        if (
            isinstance(item, (list, tuple))
            and len(item) == 2
            and all(isinstance(v, (int, float)) for v in item)
        ):
            flat.append(item)
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
    return flat


def _street_centroid(row):
    flat = _geometry_points(row.geometry or {})
    if not flat:
        return None
    return (
        sum(pair[1] for pair in flat) / len(flat),
        sum(pair[0] for pair in flat) / len(flat),
    )


class Command(BaseCommand):
    help = "Backfill missing resident home coordinates from their street address."

    def add_arguments(self, parser):
        parser.add_argument(
            "--overwrite",
            action="store_true",
            help="Re-resolve even profiles that already have home coordinates.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without saving.",
        )

    def handle(self, *args, **options):
        from apps.accounts.models import ResidentProfile
        from apps.emergencies.models import MapGeometry

        overwrite = options["overwrite"]
        dry_run = options["dry_run"]

        streets = list(
            MapGeometry.objects.filter(
                kind=MapGeometry.Kind.STREET, is_active=True
            ).order_by("name", "id")
        )
        catalog = []
        for row in streets:
            name_key = _key(row.name)
            if not name_key:
                continue
            centroid = _street_centroid(row)
            if centroid is None:
                continue
            catalog.append((row.name, name_key, centroid))
        # Longest names first so "Bayan-bayanan avenue" wins over "Avenue".
        catalog.sort(key=lambda entry: len(entry[1]), reverse=True)

        profiles = ResidentProfile.objects.all().order_by("id")
        if not overwrite:
            profiles = profiles.filter(home_latitude__isnull=True)

        updated = 0
        already = 0
        no_address = 0
        unmatched = []

        for profile in profiles.iterator():
            if (
                not overwrite
                and profile.home_latitude is not None
                and profile.home_longitude is not None
            ):
                already += 1
                continue
            address = (profile.address or "").strip()
            if not address or address.lower() == "pending":
                no_address += 1
                continue
            # Landmarks come first ("Barangay Hall, Bayan-Bayanan Avenue, ..."),
            # so try every comma segment until a catalog street matches.
            segments = [
                (segment or "").strip()
                for segment in address.split(",")
            ]
            match = None
            for segment in segments:
                segment_key = _key(segment)
                if not segment_key:
                    continue
                for name, name_key, centroid in catalog:
                    if name_key and (
                        name_key in segment_key or segment_key in name_key
                    ):
                        match = (name, centroid)
                        break
                if match is not None:
                    break
            if match is None:
                unmatched.append(f"#{profile.id} {address}")
                continue
            name, (latitude, longitude) = match
            if not dry_run:
                with transaction.atomic():
                    profile.home_latitude = Decimal(str(round(latitude, 7)))
                    profile.home_longitude = Decimal(str(round(longitude, 7)))
                    profile.home_location_source = "backfill"
                    profile.save(
                        update_fields=[
                            "home_latitude",
                            "home_longitude",
                            "home_location_source",
                            "updated_at",
                        ]
                    )
            updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Would update' if dry_run else 'Updated'} {updated} profile(s); "
                f"already had coordinates: {already}; no usable address: {no_address}; "
                f"street not matched: {len(unmatched)}."
            )
        )
        for line in unmatched[:50]:
            self.stdout.write(f"  unmatched: {line}")
        if len(unmatched) > 50:
            self.stdout.write(f"  ... and {len(unmatched) - 50} more.")
