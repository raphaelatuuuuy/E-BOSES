from collections import defaultdict

from django.core.management.base import BaseCommand

from apps.notifications.models import Notification


class Command(BaseCommand):
    help = "Archive duplicate announcement notifications while keeping the newest copy."

    def add_arguments(self, parser):
        parser.add_argument(
            "--delete",
            action="store_true",
            help="Permanently delete duplicate rows instead of archiving them.",
        )

    def handle(self, *args, **options):
        rows = Notification.objects.filter(
            type=Notification.Type.ANNOUNCEMENT,
        ).order_by("recipient_id", "title", "body", "-created_at", "-id")
        grouped = defaultdict(list)
        for notification in rows.iterator():
            grouped[(notification.recipient_id, notification.title, notification.body)].append(notification)

        duplicate_ids = [
            notification.pk
            for group in grouped.values()
            for notification in group[1:]
        ]
        if not duplicate_ids:
            self.stdout.write("No duplicate announcement notifications found.")
            return

        if options["delete"]:
            deleted, _ = Notification.objects.filter(pk__in=duplicate_ids).delete()
            self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} duplicate notification rows."))
            return

        archived = Notification.objects.filter(
            pk__in=duplicate_ids,
            is_archived=False,
        ).update(is_archived=True)
        self.stdout.write(
            self.style.SUCCESS(
                f"Archived {archived} duplicate announcement rows; "
                f"kept {len(grouped)} newest notification copies."
            )
        )
