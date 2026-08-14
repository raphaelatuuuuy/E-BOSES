import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.concerns.models import Announcement, BarangayEvent
from apps.demo_scenarios import ANNOUNCEMENTS, EVENTS, PHOTOS
from apps.demo_seed import NoPhotoAvailable, backdate, photo_by_title, streets


class Command(BaseCommand):
    help = "Seed demo announcements and barangay calendar events."

    def add_arguments(self, parser):
        parser.add_argument(
            "--keep-existing",
            action="store_true",
            help="Add to what is already there instead of clearing first.",
        )
        parser.add_argument(
            "--no-images",
            action="store_true",
            help="Skip generating announcement images.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        rng = random.Random("announcements")
        if not options["keep_existing"]:
            removed = Announcement.objects.all().delete()[0] + BarangayEvent.objects.all().delete()[0]
            self.stdout.write(f"  cleared {removed} existing rows")

        now = timezone.now()
        created = 0
        for spec in ANNOUNCEMENTS:
            published_at = now - timedelta(days=spec["days_ago"], hours=rng.randint(0, 10))
            announcement = Announcement.objects.create(
                title=spec["title"],
                body=spec["body"],
                tag=spec["tag"],
                urgency=spec["urgency"],
                audience=spec.get("audience", Announcement.Audience.ALL),
                is_pinned=spec.get("pinned", False),
                is_published=True,
                published_at=published_at,
                place_label=rng.choice(streets()),


                notification_sent_at=published_at,
            )
            photo_spec = PHOTOS.get(spec.get("photo") or "")
            if photo_spec and not options["no_images"]:
                try:
                    photo = photo_by_title(photo_spec["title"])
                except (NoPhotoAvailable, Exception):
                    photo = None
                if photo is not None:
                    announcement.image.save(
                        f"announcement-{announcement.pk}.jpg", photo, save=True
                    )
                    announcement.image_alt = spec["title"]
                    announcement.image_privacy_state = "not_required"
                    announcement.save(update_fields=["image_alt", "image_privacy_state"])
            backdate(announcement, "created_at", published_at)
            created += 1

        events = 0
        for title, detail, days_ahead, hour in EVENTS:
            starts_at = (now + timedelta(days=days_ahead)).replace(
                hour=hour, minute=0, second=0, microsecond=0
            )
            BarangayEvent.objects.create(
                title=title,
                detail=detail,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(hours=3),
                is_published=True,
            )
            events += 1

        self.stdout.write(
            self.style.SUCCESS(f"  {created} announcements, {events} calendar events")
        )
