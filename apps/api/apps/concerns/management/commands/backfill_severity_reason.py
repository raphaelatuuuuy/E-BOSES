"""Sync severity_reason from ConcernAiAssessment.raw_result into LlmDecisionLog."""

from django.core.management.base import BaseCommand
from apps.concerns.models import Concern, LlmDecisionLog


class Command(BaseCommand):
    help = "Sync severity_reason from ai_assessment into LlmDecisionLog output_snapshot."

    def handle(self, *args, **options):
        total = 0
        updated = 0
        for concern in Concern.objects.filter(ai_assessment__isnull=False).iterator(chunk_size=50):
            raw = concern.ai_assessment.raw_result or {}
            review = raw.get("review", {})
            severity_reason = review.get("severity_reason", "")
            if not severity_reason:
                continue
            logs = LlmDecisionLog.objects.filter(concern=concern, run_kind=LlmDecisionLog.RunKind.PRODUCTION)
            for log in logs:
                snap = log.output_snapshot or {}
                if snap.get("severity_reason") != severity_reason:
                    snap["severity_reason"] = severity_reason
                    log.output_snapshot = snap
                    log.save(update_fields=["output_snapshot"])
                    updated += 1
                total += 1

        self.stdout.write(self.style.SUCCESS(f"Done. Synced {updated}/{total} log entries."))
