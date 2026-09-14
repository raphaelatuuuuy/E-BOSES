from django.core.management.base import BaseCommand

from apps.concerns.announcement_summary import refresh_announcement_summary
from apps.concerns.models import Announcement
from apps.notifications.models import Notification


class Command(BaseCommand):
    help = "Generate missing or refreshed resident-facing announcement summaries."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Regenerate summaries even when one is already stored.",
        )
        parser.add_argument(
            "--fallback-only",
            action="store_true",
            help="Regenerate without calling the configured language model.",
        )

    def handle(self, *args, **options):
        changed = 0
        skipped = 0
        notifications_updated = 0
        for announcement in Announcement.objects.order_by("pk").iterator():
            before = announcement.llm_summary
            refresh_announcement_summary(
                announcement,
                force=options["force"],
                use_model=not options["fallback_only"],
            )
            if announcement.llm_summary != before:
                changed += 1
            else:
                skipped += 1
            notifications_updated += Notification.objects.filter(
                type=Notification.Type.ANNOUNCEMENT,
                metadata__announcement_id=announcement.pk,
            ).exclude(body=announcement.llm_summary[:240]).update(
                body=announcement.llm_summary[:240]
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"  {changed} announcement summaries updated, {skipped} unchanged; "
                f"{notifications_updated} feed notifications synced"
            )
        )
