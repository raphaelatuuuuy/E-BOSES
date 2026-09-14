from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

from django.core.management.base import BaseCommand

from apps.notifications.models import Notification
from apps.notifications.notification_copy import (
    COPY_VERSION,
    generate_notification_copy,
    notification_copy_key,
    stored_notification_copy,
)


class Command(BaseCommand):
    help = "Generate compact one-line headers and descriptions for notifications."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Regenerate notifications that already have compact copy.",
        )
        parser.add_argument(
            "--fallback-only",
            action="store_true",
            help="Regenerate without calling the configured language model.",
        )
        parser.add_argument(
            "--notification-id",
            type=int,
            help="Regenerate one notification instead of the whole inbox.",
        )
        parser.add_argument(
            "--include-archived",
            action="store_true",
            help="Include archived notifications in the regeneration.",
        )

    def handle(self, *args, **options):
        queryset = Notification.objects.select_related(
            "recipient",
            "recipient__resident_profile",
            "concern",
            "concern__community",
            "concern__assigned_department",
            "emergency",
            "emergency__community",
            "community",
            "department",
        ).order_by("id")
        if not options["include_archived"]:
            queryset = queryset.filter(is_archived=False)
        if options["notification_id"]:
            queryset = queryset.filter(pk=options["notification_id"])
        notifications = list(queryset)
        if not notifications:
            self.stdout.write("No notifications found.")
            return
        if not options["force"]:
            notifications = [
                notification
                for notification in notifications
                if stored_notification_copy(notification) is None
            ]
        if not notifications:
            self.stdout.write("All selected notifications already have compact copy.")
            return

        grouped = defaultdict(list)
        for notification in notifications:
            grouped[notification_copy_key(notification)].append(notification)

        def generate_for_event(event):
            return event, generate_notification_copy(
                grouped[event][0],
                use_model=not options["fallback_only"],
            )

        generated = {}
        worker_count = min(4, len(grouped))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(generate_for_event, event) for event in grouped]
            for future in as_completed(futures):
                event, copy = future.result()
                generated[event] = copy

        for event, event_notifications in grouped.items():
            (header, description), source = generated[event]
            for notification in event_notifications:
                metadata = notification.metadata if isinstance(notification.metadata, dict) else {}
                notification.metadata = {
                    **metadata,
                    "llm_header": header,
                    "llm_description": description,
                    "llm_copy_version": COPY_VERSION,
                    "llm_copy_source": source,
                }
        Notification.objects.bulk_update(notifications, ["metadata"], batch_size=500)
        self.stdout.write(
            self.style.SUCCESS(
                f"{len(notifications)} notifications updated from "
                f"{len(grouped)} unique notification events."
            )
        )
