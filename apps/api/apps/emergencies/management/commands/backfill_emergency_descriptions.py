from django.core.management.base import BaseCommand
from django.db.models import Q

from apps.emergencies.models import EmergencyAlert
from apps.emergencies.tasks import generate_emergency_description_task


class Command(BaseCommand):
    help = "Run the current LLM description and title pipeline for legacy emergency summaries."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=500)
        parser.add_argument("--titles-only", action="store_true")

    def handle(self, *args, **options):
        query = Q(ai_assist__description__icontains="Detail:") | Q(
            ai_assist__description__icontains="Injuries:"
        ) | Q(ai_assist__description__icontains="People affected:") | Q(
            ai_assist__description__isnull=True
        ) | Q(ai_assist={})
        if not options["titles_only"]:
            legacy = EmergencyAlert.objects.filter(query)
        else:
            legacy = EmergencyAlert.objects.filter(
                Q(ai_assist__title__isnull=True)
                | Q(ai_assist__title="")
            )
        legacy = legacy.order_by("id")[: max(0, options["limit"])]
        ids = list(legacy.values_list("id", flat=True))
        for alert_id in ids:
            generate_emergency_description_task.run(alert_id)
        self.stdout.write(self.style.SUCCESS(f"Reprocessed {len(ids)} emergency descriptions."))
