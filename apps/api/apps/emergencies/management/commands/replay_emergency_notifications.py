from django.core.management.base import BaseCommand, CommandError

from apps.emergencies.models import EmergencyAlert
from apps.notifications.services import replay_emergency_notifications


class Command(BaseCommand):
    help = "Backfill and queue push/in-app notifications for an emergency timeline."

    def add_arguments(self, parser):
        parser.add_argument("--alert-id", type=int, required=True)
        parser.add_argument(
            "--recipient-id",
            type=int,
            action="append",
            help="Limit replay to one or more account IDs (repeat the option).",
        )

    def handle(self, *args, **options):
        alert_id = options["alert_id"]
        alert = (
            EmergencyAlert.objects.filter(pk=alert_id)
            .prefetch_related("status_events", "status_events__actor", "assignments", "assignments__responder")
            .first()
        )
        if not alert:
            raise CommandError(f"Emergency alert {alert_id} was not found.")
        result = replay_emergency_notifications(
            alert,
            recipient_ids=options.get("recipient_id"),
        )
        self.stdout.write(self.style.SUCCESS(str(result)))
