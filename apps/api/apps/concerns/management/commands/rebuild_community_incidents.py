from django.core.management.base import BaseCommand
from django.db import transaction

from apps.concerns.merge_services import resolve_primary
from apps.concerns.models import Concern


class Command(BaseCommand):
    """Recompute the community-facing summary for grouped reports.

    A primary with duplicates is shown to neighbours as one incident. This
    rebuilds `community_summary` and `community_observed` from the group so the
    feed does not keep stale text after a merge or unmerge.
    """

    help = "Rebuild the community incident summary on primary reports."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        updated = 0
        cleared = 0

        for concern in Concern.objects.filter(duplicate_of__isnull=True).iterator():
            duplicates = list(concern.duplicates.select_related("reporter").order_by("created_at"))
            if not duplicates:
                if concern.community_summary or concern.community_observed:
                    cleared += 1
                    if not options["dry_run"]:
                        concern.community_summary = ""
                        concern.community_observed = []
                        concern.save(update_fields=["community_summary", "community_observed"])
                continue

            observed = [
                {
                    "concern_id": duplicate.pk,
                    "tracking_id": duplicate.tracking_id,
                    "reported_at": duplicate.created_at.isoformat() if duplicate.created_at else None,
                    "address": duplicate.address or "",
                }
                for duplicate in duplicates
            ]
            total = len(duplicates) + 1
            summary = (
                f"{total} residents reported this. First reported "
                f"{concern.created_at:%b %d} and most recently "
                f"{duplicates[-1].created_at:%b %d}."
            )
            updated += 1
            if not options["dry_run"]:
                concern.community_summary = summary
                concern.community_observed = observed
                concern.save(update_fields=["community_summary", "community_observed"])


        stale = Concern.objects.filter(duplicate_of__isnull=False).exclude(community_summary="")
        stale_count = stale.count()
        if stale_count and not options["dry_run"]:
            stale.update(community_summary="", community_observed=[])

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("  dry run - nothing was saved"))
        self.stdout.write(self.style.SUCCESS(f"  incidents rebuilt: {updated}"))
        self.stdout.write(f"  summaries cleared: {cleared + stale_count}")
