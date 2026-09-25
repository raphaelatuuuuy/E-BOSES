from django.core.management.base import BaseCommand
from apps.accounts.models import AuditLog
from apps.concerns.models import Concern

class Command(BaseCommand):
    help = "Add concern_title to existing concern.ai_decided audit log entries"

    def handle(self, *args, **options):
        entries = AuditLog.objects.filter(action='concern.ai_decided')
        missing_title = [e for e in entries if 'concern_title' not in e.metadata]
        self.stdout.write(f"Entries missing concern_title: {len(missing_title)}")
        for e in missing_title:
            try:
                concern = Concern.objects.get(pk=e.metadata.get('concern_id'))
                e.metadata['concern_title'] = (concern.title or '')[:200]
                e.save()
                self.stdout.write(f"Updated ID={e.id}: title={concern.title}")
            except Concern.DoesNotExist:
                self.stdout.write(f"ID={e.id}: concern_id={e.metadata.get('concern_id')} NOT FOUND")
