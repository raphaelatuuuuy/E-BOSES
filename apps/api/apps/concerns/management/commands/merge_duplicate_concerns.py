from django.core.management.base import BaseCommand

from apps.concerns import merge_services
from apps.concerns.models import ConcernMergeSuggestion


class Command(BaseCommand):
    help = "Scan recent reports for duplicates and record merge suggestions."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=merge_services.SUGGESTION_LOOKBACK_DAYS)
        parser.add_argument(
            "--auto-apply",
            type=float,
            default=None,
            metavar="CONFIDENCE",
            help="Merge automatically at or above this confidence (e.g. 0.95).",
        )

    def handle(self, *args, **options):
        created = merge_services.build_merge_suggestions(lookback_days=options["days"])
        self.stdout.write(f"  new suggestions: {created}")

        threshold = options["auto_apply"]
        if threshold is None:
            pending = ConcernMergeSuggestion.objects.filter(
                status=ConcernMergeSuggestion.Status.PENDING
            ).count()
            self.stdout.write(f"  awaiting an official: {pending}")
            return

        applied = 0
        skipped = 0
        pending = ConcernMergeSuggestion.objects.filter(
            status=ConcernMergeSuggestion.Status.PENDING,
            confidence__gte=threshold,
        ).select_related("concern", "primary")
        for suggestion in pending:
            try:
                merge_services.decide_suggestion(
                    suggestion, "approve", actor=None, note="Auto-merged by confidence."
                )
                applied += 1
            except merge_services.MergeConflict:
                skipped += 1
        self.stdout.write(self.style.SUCCESS(f"  auto-merged: {applied}"))
        if skipped:
            self.stdout.write(f"  skipped (conflict): {skipped}")
