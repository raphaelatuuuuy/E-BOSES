from django.core.management.base import BaseCommand, CommandError

from apps.concerns.ai import process_concern_ai
from apps.concerns.models import Concern, ConcernAiAssessment


class Command(BaseCommand):
    help = "Process AI assessment for one concern or pending concern assessments."

    def add_arguments(self, parser):
        parser.add_argument("--id", type=int, dest="concern_id")
        parser.add_argument("--pending", action="store_true")

    def handle(self, *args, **options):
        concern_id = options.get("concern_id")
        pending = options.get("pending")
        if not concern_id and not pending:
            raise CommandError("Use --id <concern_id> or --pending.")

        ids = [concern_id] if concern_id else list(
            Concern.objects.filter(ai_assessment__status=ConcernAiAssessment.Status.PENDING)
            .values_list("id", flat=True)
        )
        for pk in ids:
            assessment = process_concern_ai(pk)
            self.stdout.write(f"Concern {pk}: {assessment.status}")
