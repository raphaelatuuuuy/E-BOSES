import os

from django.apps import apps
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import FileField


DELETE_ROW_WHEN_MISSING = {
    "concerns.ConcernMedia": "file",
    "concerns.ConcernResolutionEvidence": "file",
    "concerns.ConcernChatAttachment": "file",
    "emergencies.EmergencyMedia": "file",
    "emergencies.EmergencyChatAttachment": "file",
    "accounts.OCRSample": "file",
    "accounts.OCRTestRun": "file",
}


CLEAR_FIELD_WHEN_MISSING = {
    "concerns.Announcement": ["image", "original_image"],
    "concerns.ConcernCategory": ["icon_image"],
    "emergencies.EmergencyCategory": ["icon_image"],
    "accounts.OCRDocumentType": ["sample_file"],
}


PREVIEW_FIELDS = {
    "concerns.ConcernMedia": ["preview_file"],
    "concerns.ConcernResolutionEvidence": ["preview_file"],
    "concerns.ConcernChatAttachment": ["preview_file"],
    "emergencies.EmergencyMedia": ["preview_file"],
    "emergencies.EmergencyChatAttachment": ["preview_file"],
    "accounts.ResidenceProof": ["blurred_preview_file"],
}


def file_is_missing(instance, field_name):
    value = getattr(instance, field_name, None)
    if not value:
        return False
    try:
        return not os.path.exists(value.path)
    except Exception:


        return False


class Command(BaseCommand):
    help = (
        "Find rows whose uploaded file is gone from disk and clear or delete them. "
        "Residence proofs are never deleted silently - their verification cases are "
        "flagged for resubmission instead."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually change the database. Without it this is a dry run.",
        )

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        if not apply_changes:
            self.stdout.write(
                self.style.WARNING("DRY RUN - nothing will change. Re-run with --apply.\n")
            )

        totals = {"deleted": 0, "cleared": 0, "proofs_flagged": 0}

        with transaction.atomic():
            self.clear_previews(apply_changes, totals)
            self.clear_fields(apply_changes, totals)
            self.delete_rows(apply_changes, totals)
            self.handle_residence_proofs(apply_changes, totals)
            if not apply_changes:
                transaction.set_rollback(True)

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Summary"))
        self.stdout.write(f"  rows deleted        : {totals['deleted']}")
        self.stdout.write(f"  fields cleared      : {totals['cleared']}")
        self.stdout.write(f"  proof cases flagged : {totals['proofs_flagged']}")
        if apply_changes:
            self.stdout.write(self.style.SUCCESS("\nApplied."))
        else:
            self.stdout.write(self.style.WARNING("\nDry run - no changes were saved."))

    def iter_rows(self, label, field_name):
        model = apps.get_model(label)
        field = model._meta.get_field(field_name)
        if not isinstance(field, FileField):
            return
        queryset = model.objects.exclude(**{field_name: ""}).exclude(**{f"{field_name}__isnull": True})
        for instance in queryset.iterator():
            if file_is_missing(instance, field_name):
                yield instance

    def clear_previews(self, apply_changes, totals):
        for label, fields in PREVIEW_FIELDS.items():
            for field_name in fields:
                count = 0
                for instance in self.iter_rows(label, field_name):
                    if apply_changes:
                        setattr(instance, field_name, "")
                        instance.save(update_fields=[field_name])
                    count += 1
                if count:
                    totals["cleared"] += count
                    self.stdout.write(f"  preview cleared  {label}.{field_name}: {count}")

    def clear_fields(self, apply_changes, totals):
        for label, fields in CLEAR_FIELD_WHEN_MISSING.items():
            for field_name in fields:
                try:
                    count = 0
                    for instance in self.iter_rows(label, field_name):
                        if apply_changes:
                            setattr(instance, field_name, "")
                            instance.save(update_fields=[field_name])
                        count += 1
                except Exception as exc:
                    self.stdout.write(self.style.WARNING(f"  skipped {label}.{field_name}: {exc}"))
                    continue
                if count:
                    totals["cleared"] += count
                    self.stdout.write(f"  field cleared    {label}.{field_name}: {count}")

    def delete_rows(self, apply_changes, totals):
        for label, field_name in DELETE_ROW_WHEN_MISSING.items():
            doomed = [instance.pk for instance in self.iter_rows(label, field_name)]
            if not doomed:
                continue
            if apply_changes:
                apps.get_model(label).objects.filter(pk__in=doomed).delete()
            totals["deleted"] += len(doomed)
            self.stdout.write(f"  rows deleted     {label}: {len(doomed)}")

    def handle_residence_proofs(self, apply_changes, totals):
        """A missing ID image leaves an official unable to decide a case.

        Deleting the proof would cascade the VerificationCheck rows that hold
        the extracted fields and the hashed identifier claim, so the row stays
        and any case still waiting on a human is marked resubmission_required.
        """
        ResidenceProof = apps.get_model("accounts.ResidenceProof")
        Case = apps.get_model("accounts.ResidenceVerificationCase")

        orphaned = [p for p in self.iter_rows("accounts.ResidenceProof", "file")]
        if not orphaned:
            return

        self.stdout.write(f"  proofs with no file: {len(orphaned)}")
        user_ids = {proof.user_id for proof in orphaned}

        open_cases = Case.objects.filter(
            user_id__in=user_ids,
            status__in=[
                Case.Status.MANUAL_REVIEW,
                Case.Status.QUEUED,
                Case.Status.PROCESSING,
            ],
        )
        count = open_cases.count()
        if apply_changes and count:
            open_cases.update(
                status=Case.Status.MANUAL_REVIEW,
                review_reason=Case.ReviewReason.RESUBMISSION_REQUIRED,
                retry_eligible=False,
            )
        totals["proofs_flagged"] += count
        if count:
            self.stdout.write(
                f"  cases flagged for resubmission (proof image gone): {count}"
            )
