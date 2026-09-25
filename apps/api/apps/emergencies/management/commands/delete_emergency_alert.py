from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import FileField

from apps.emergencies.models import (
    EmergencyAlert,
    EmergencyAssignmentLog,
    EmergencyAssignmentRoute,
    EmergencyChatAttachment,
    EmergencyChatMessage,
    EmergencyChatReadState,
    EmergencyCommunityComment,
    EmergencyEscalation,
    EmergencyAppeal,
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResolutionEvidence,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    BackupRequest,
    WitnessNotification,
)


def delete_stored_files(queryset) -> int:
    file_fields = [f for f in queryset.model._meta.fields if isinstance(f, FileField)]
    if not file_fields:
        return 0
    count = 0
    for obj in queryset.iterator():
        for field in file_fields:
            file = getattr(obj, field.name, None)
            if file and file.name:
                file.delete(save=False)
                count += 1
    return count


class Command(BaseCommand):
    help = "Permanently delete an emergency alert and all related records."

    def add_arguments(self, parser):
        parser.add_argument("--alert-id", type=int, help="Primary key of the EmergencyAlert to delete")
        parser.add_argument("--tracking-id", help="Tracking ID (e.g. SOS-2026-000324)")
        parser.add_argument("--dry-run", action="store_true", help="Show what would be deleted without deleting")

    def handle(self, *args, **options):
        alert_id = options["alert_id"]
        tracking_id = options["tracking_id"]

        if alert_id:
            alert = EmergencyAlert.objects.filter(pk=alert_id).first()
        elif tracking_id:
            parts = tracking_id.split("-")
            if len(parts) != 3 or parts[0] != "SOS":
                raise CommandError(f"Invalid tracking ID format: {tracking_id}. Expected SOS-YYYY-NNNNNN")
            year = int(parts[1])
            seq = int(parts[2])
            alert = EmergencyAlert.objects.filter(pk=seq).first()
            if alert and alert.created_at and alert.created_at.year != year:
                raise CommandError(f"Tracking ID {tracking_id} does not match alert PK {seq} (created {alert.created_at.year})")
        else:
            raise CommandError("Provide --alert-id or --tracking-id")

        if alert is None:
            raise CommandError(f"No EmergencyAlert found with{' PK=' + str(alert_id) if alert_id else ' tracking ID ' + tracking_id}")

        tracking = alert.tracking_id

        related_counts = {
            "media": EmergencyMedia.objects.filter(alert=alert).count(),
            "assignments": EmergencyResponderAssignment.objects.filter(alert=alert).count(),
            "assignment_logs": EmergencyAssignmentLog.objects.filter(alert=alert).count(),
            "assignment_routes": EmergencyAssignmentRoute.objects.filter(assignment__alert=alert).count(),
            "backup_requests": BackupRequest.objects.filter(alert=alert).count(),
            "location_pings": EmergencyLocationPing.objects.filter(assignment__alert=alert).count(),
            "status_events": EmergencyStatusEvent.objects.filter(alert=alert).count(),
            "witness_notifications": WitnessNotification.objects.filter(alert=alert).count(),
            "appeals": EmergencyAppeal.objects.filter(alert=alert).count(),
            "escalations": EmergencyEscalation.objects.filter(alert=alert).count(),
            "chat_messages": EmergencyChatMessage.objects.filter(alert=alert).count(),
            "chat_read_states": EmergencyChatReadState.objects.filter(alert=alert).count(),
            "community_comments": EmergencyCommunityComment.objects.filter(alert=alert).count(),
            "chat_attachments": EmergencyChatAttachment.objects.filter(message__alert=alert).count(),
            "resolution_evidence": EmergencyResolutionEvidence.objects.filter(alert=alert).count(),
        }

        file_querysets = [
            EmergencyMedia.objects.filter(alert=alert),
            EmergencyResolutionEvidence.objects.filter(alert=alert),
            EmergencyChatAttachment.objects.filter(message__alert=alert),
        ]
        total_files = 0
        if not options["dry_run"]:
            for q in file_querysets:
                total_files += delete_stored_files(q)
        else:
            for q in file_querysets:
                counted = 0
                for obj in q.iterator():
                    for f in [f for f in q.model._meta.fields if isinstance(f, FileField)]:
                        if getattr(obj, f.name, None) and getattr(obj, f.name).name:
                            counted += 1
                total_files += counted

        total_records = 1 + sum(related_counts.values())

        self.stdout.write(f"Target: {tracking} (PK={alert.pk}, type={alert.type}, status={alert.status})")
        self.stdout.write(f"Related records to delete:")
        for label, count in related_counts.items():
            if count:
                self.stdout.write(f"  {label}: {count}")
        self.stdout.write(f"  alert itself: 1")
        self.stdout.write(f"Stored files to remove: {total_files}")
        self.stdout.write(f"Total records to delete: {total_records}")

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("DRY RUN — no changes made"))
            return

        with transaction.atomic():
            for queryset in file_querysets:
                delete_stored_files(queryset)
            alert.delete()

        self.stdout.write(self.style.SUCCESS(f"Deleted {tracking} and {total_records - 1} related records"))
