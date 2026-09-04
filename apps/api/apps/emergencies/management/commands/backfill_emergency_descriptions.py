from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.emergencies.models import EmergencyAlert
from apps.emergencies.tasks import generate_emergency_description_task


class Command(BaseCommand):
    help = "Run the current LLM description pipeline for legacy emergency summaries."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=500)

    def handle(self, *args, **options):
        legacy = EmergencyAlert.objects.filter(
            Q(ai_assist__description__icontains="Detail:")
            | Q(ai_assist__description__icontains="Injuries:")
            | Q(ai_assist__description__icontains="People affected:")
            | Q(ai_assist__description__isnull=True)
            | Q(ai_assist={})
        ).order_by("id")[: max(0, options["limit"])]
        ids = list(legacy.values_list("id", flat=True))
        for alert_id in ids:
            generate_emergency_description_task.run(alert_id)
        self.stdout.write(self.style.SUCCESS(f"Reprocessed {len(ids)} emergency descriptions."))
