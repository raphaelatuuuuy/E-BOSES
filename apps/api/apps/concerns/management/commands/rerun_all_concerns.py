"""Rerun all concerns through the AI pipeline to populate severity_reason."""

from django.core.management.base import BaseCommand
from apps.concerns.ai.pipeline import process_concern_ai
from apps.concerns.models import Concern


class Command(BaseCommand):
    help = "Rerun all concerns through the AI pipeline."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=0, help="Max concerns to process. 0 = all.")
        parser.add_argument("--dry-run", action="store_true", help="Show what would be processed.")

    def handle(self, *args, **options):
        limit = options["limit"]
        dry_run = options["dry_run"]
        concerns = Concern.objects.order_by("-created_at")
        if limit:
            concerns = concerns[:limit]

        total = concerns.count()
        done = 0
        errors = 0

        self.stdout.write(f"Rerunning {total} concerns through the AI pipeline...")
        for concern in concerns:
            label = concern.tracking_id or f"pk={concern.pk}"
            if dry_run:
                self.stdout.write(f"  [DRY RUN] {label}")
                done += 1
                continue
            try:
                process_concern_ai(concern.pk)
                done += 1
                self.stdout.write(f"  OK: {label}")
            except Exception as e:
                errors += 1
                self.stderr.write(f"  ERROR: {label}: {e}")

        self.stdout.write(self.style.SUCCESS(f"Done. Processed: {done} | Errors: {errors} / {total}"))
