from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.db.models.fields.files import FileField

from apps.accounts.models import (
    AuditLog,
    CommunityResolution,
    OCRConfigurationVersion,
    OCRDocumentType,
    OCRSample,
    OCRTestRun,
    ResidenceProof,
    ResidenceVerificationCase,
    User,
    VerificationCheck,
)
from apps.concerns.models import (
    BarangayEvent,
    Concern,
    ConcernChatAttachment,
    ConcernMedia,
    ConcernResolutionEvidence,
    Designation,
    Department,
    LlmDecisionLog,
    PublicCommentAttachment,
)
from apps.emergencies.models import (
    Community,
    CommunityMigrationIssue,
    EmergencyAlert,
    EmergencyChatAttachment,
    EmergencyMedia,
    EmergencyResolutionEvidence,
    MapGeometry,
)
from apps.notifications.models import Notification


def delete_stored_files(queryset) -> None:
    file_fields = [field for field in queryset.model._meta.fields if isinstance(field, FileField)]
    if not file_fields:
        return
    for obj in queryset.iterator():
        for field in file_fields:
            file = getattr(obj, field.name, None)
            if file and file.name:
                file.delete(save=False)


class Command(BaseCommand):
    help = "Permanently remove a retired community and every record attached to it."

    def add_arguments(self, parser):
        parser.add_argument("--code", default="concepcion-dos")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        code = options["code"].strip().lower()
        community = Community.objects.filter(code=code).first()
        if community is None:
            self.stdout.write(self.style.WARNING(f"No community found for code: {code}"))
            return

        with transaction.atomic():
            concern_filter = Q(community_id=community.pk) | Q(reporter_community_id=community.pk)
            concern_ids = list(Concern.objects.filter(concern_filter).values_list("pk", flat=True))
            alert_ids = list(EmergencyAlert.objects.filter(community_id=community.pk).values_list("pk", flat=True))
            config_ids = list(OCRConfigurationVersion.objects.filter(community_id=community.pk).values_list("pk", flat=True))
            department_ids = list(Department.objects.filter(community_id=community.pk).values_list("pk", flat=True))
            target_user_ids = set(
                User.objects.filter(resident_profile__community_id=community.pk).values_list("pk", flat=True)
            )
            target_user_ids.update(
                Designation.objects.filter(department_id__in=department_ids).values_list("user_id", flat=True)
            )
            target_user_ids.update(
                Concern.objects.filter(pk__in=concern_ids).values_list("reporter_id", flat=True)
            )
            target_user_ids.update(
                EmergencyAlert.objects.filter(pk__in=alert_ids).values_list("reporter_id", flat=True)
            )
            target_user_ids.update(
                ResidenceVerificationCase.objects.filter(
                    Q(community_id=community.pk) | Q(user_id__in=target_user_ids)
                ).values_list("user_id", flat=True)
            )

            file_querysets = [
                ConcernMedia.objects.filter(concern_id__in=concern_ids),
                ConcernResolutionEvidence.objects.filter(concern_id__in=concern_ids),
                ConcernChatAttachment.objects.filter(concern_id__in=concern_ids),
                EmergencyMedia.objects.filter(alert_id__in=alert_ids),
                EmergencyResolutionEvidence.objects.filter(alert_id__in=alert_ids),
                EmergencyChatAttachment.objects.filter(message__alert_id__in=alert_ids),
                PublicCommentAttachment.objects.filter(
                    Q(concern_comment__concern_id__in=concern_ids)
                    | Q(emergency_comment__alert_id__in=alert_ids)
                ),
                ResidenceProof.objects.filter(user_id__in=target_user_ids),
                OCRTestRun.objects.filter(configuration_id__in=config_ids),
                OCRDocumentType.objects.filter(configuration_id__in=config_ids),
                OCRSample.objects.filter(document_type__configuration_id__in=config_ids),
            ]
            counts = {
                "concerns": len(concern_ids),
                "emergencies": len(alert_ids),
                "users": len(target_user_ids),
                "audit logs": AuditLog.objects.filter(
                    Q(community_id=community.pk)
                    | Q(actor_id__in=target_user_ids)
                    | Q(target_user_id__in=target_user_ids)
                ).count(),
                "decision logs": LlmDecisionLog.objects.filter(
                    Q(concern_id__in=concern_ids)
                    | Q(assigned_department__community_id=community.pk)
                ).count(),
                "configurations": len(config_ids),
            }
            if options["dry_run"]:
                self.stdout.write(f"Would remove {community.name}: {counts}")
                return

            for queryset in file_querysets:
                delete_stored_files(queryset)

            LlmDecisionLog.objects.filter(
                Q(concern_id__in=concern_ids)
                | Q(assigned_department__community_id=community.pk)
            ).delete()
            AuditLog.objects.filter(
                Q(community_id=community.pk)
                | Q(actor_id__in=target_user_ids)
                | Q(target_user_id__in=target_user_ids)
            ).delete()
            Notification.objects.filter(
                Q(community_id=community.pk)
                | Q(concern_id__in=concern_ids)
                | Q(emergency_id__in=alert_ids)
                | Q(recipient_id__in=target_user_ids)
            ).delete()

            Concern.objects.filter(pk__in=concern_ids).delete()
            EmergencyAlert.objects.filter(pk__in=alert_ids).delete()
            ResidenceVerificationCase.objects.filter(
                Q(community_id=community.pk) | Q(user_id__in=target_user_ids)
            ).delete()
            VerificationCheck.objects.filter(
                Q(user_id__in=target_user_ids)
                | Q(configuration_id__in=config_ids)
            ).delete()
            ResidenceProof.objects.filter(user_id__in=target_user_ids).delete()
            OCRTestRun.objects.filter(configuration_id__in=config_ids).delete()
            CommunityResolution.objects.filter(community_id=community.pk).delete()
            BarangayEvent.objects.filter(community_id=community.pk).delete()
            from apps.concerns.models import Announcement

            Announcement.objects.filter(community_id=community.pk).delete()
            CommunityMigrationIssue.objects.filter(
                Q(raw_value__icontains=community.name) | Q(raw_value__icontains=community.code)
            ).delete()

            User.objects.filter(pk__in=target_user_ids, is_superuser=False).delete()
            remaining_profiles = User.objects.filter(
                resident_profile__community_id=community.pk,
                is_superuser=True,
            ).values_list("resident_profile__pk", flat=True)
            if remaining_profiles.exists():
                from apps.accounts.models import ResidentProfile

                ResidentProfile.objects.filter(pk__in=remaining_profiles).update(community=None)

            boundary_id = community.boundary_id
            community.delete()
            if boundary_id:
                MapGeometry.objects.filter(pk=boundary_id).delete()

        self.stdout.write(self.style.SUCCESS(f"Removed {community.name}: {counts}"))
