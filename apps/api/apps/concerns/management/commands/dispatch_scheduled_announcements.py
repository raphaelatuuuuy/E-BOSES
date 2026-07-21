from django.core.management.base import BaseCommand

from apps.concerns.announcement_services import dispatch_due_announcements


class Command(BaseCommand):
    help = "Send due scheduled announcement notifications."

    def handle(self, *args, **options):
        sent = dispatch_due_announcements()
        self.stdout.write(self.style.SUCCESS(f"Dispatched {sent} scheduled announcement(s)."))
