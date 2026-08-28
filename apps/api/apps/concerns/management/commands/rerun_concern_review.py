from django.core.management.base import BaseCommand

from apps.concerns.models import Concern, ConcernAiAssessment


class Command(BaseCommand):
    help = "Re-run the AI assessment for reports that never got a usable one."

    def add_arguments(self, parser):
        parser.add_argument("--id", type=int, action="append", dest="ids", help="Specific concern id (repeatable).")
        parser.add_argument("--failed-only", action="store_true", help="Only pending/failed assessments.")
        parser.add_argument("--all", action="store_true", dest="every", help="Every report, including ones already assessed.")
        parser.add_argument("--sync", action="store_true", help="Run inline instead of queueing.")
        parser.add_argument("--limit", type=int, default=50)
        parser.add_argument("--dry-run", action="store_true")

    def targets(self, options):
        queryset = Concern.objects.all().order_by("-created_at")
        if options["ids"]:
            return queryset.filter(pk__in=options["ids"])
        if options["every"]:
            return queryset
        if options["failed_only"]:
            return queryset.filter(
                ai_assessment__status__in=[
                    ConcernAiAssessment.Status.PENDING,
                    ConcernAiAssessment.Status.FAILED,
                ]
            )
        return queryset.filter(ai_assessment__isnull=True)

    def handle(self, *args, **options):
        from apps.concerns.tasks import enqueue_concern_ai
        from apps.concerns.ai.pipeline import process_concern_ai

        concerns = list(self.targets(options)[: options["limit"]])
        if not concerns:
            self.stdout.write("  nothing to re-review")
            return

        self.stdout.write(f"  {len(concerns)} report(s) selected")
        if options["dry_run"]:
            for concern in concerns:
                self.stdout.write(f"    would re-review {concern.tracking_id}: {concern.title[:50]}")
            self.stdout.write(self.style.WARNING("  dry run - nothing was queued"))
            return

        if options["sync"]:
            done = 0
            for concern in concerns:
                try:
                    process_concern_ai(concern.pk)
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(f"    failed {concern.tracking_id}: {exc}"))
                    continue
                concern.refresh_from_db()
                done += 1
                self.stdout.write(f"    {concern.tracking_id}: {concern.official_title or '(no title)'}")
            self.stdout.write(self.style.SUCCESS(f"  reviewed {done}/{len(concerns)} report(s)"))
            return

        for concern in concerns:
            enqueue_concern_ai(concern.pk)
            self.stdout.write(f"    queued {concern.tracking_id}")
        self.stdout.write(self.style.SUCCESS(f"  queued {len(concerns)} report(s)"))
