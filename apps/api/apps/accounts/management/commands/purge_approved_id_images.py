from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import ResidenceProof, ResidenceVerificationCase, User


class Command(BaseCommand):
    """Delete government ID images once verification is settled.

    Nothing reads the raw image after approval: the extracted fields, match
    scores and the hashed identifier claim all live on VerificationCheck and
    IdentityIdentifierClaim, so duplicate and ID-reuse detection is unaffected.
    The grace period exists for retries and for an official re-opening a case.
    """

    help = "Delete raw ID images for accounts verified longer than the retention window."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=None,
            help="Retention window in days (default ID_IMAGE_RETENTION_DAYS).",
        )
        parser.add_argument("--apply", action="store_true", help="Without this it is a dry run.")

    def handle(self, *args, **options):
        days = options["days"]
        if days is None:
            days = getattr(settings, "ID_IMAGE_RETENTION_DAYS", 30)
        cutoff = timezone.now() - timedelta(days=days)

        settled = ResidenceVerificationCase.objects.filter(
            status__in=[
                ResidenceVerificationCase.Status.APPROVED,
                ResidenceVerificationCase.Status.REJECTED,
            ],
            updated_at__lte=cutoff,
        ).values_list("user_id", flat=True)

        proofs = ResidenceProof.objects.filter(user_id__in=list(settled)).exclude(file="")

        purged = 0
        freed = 0
        for proof in proofs.iterator():
            try:
                freed += proof.file.size
            except Exception:
                pass
            if options["apply"]:
                proof.file.delete(save=False)
                if proof.blurred_preview_file:
                    proof.blurred_preview_file.delete(save=False)
                proof.save(update_fields=["file", "blurred_preview_file"])
            purged += 1

        self.stdout.write(f"  retention window : {days} days")
        self.stdout.write(f"  ID images purged : {purged}")
        self.stdout.write(f"  space reclaimed  : {freed / 1_048_576:.1f} MB")
        self.stdout.write(
            "  dedup unaffected : sha256_hash, phash and identifier claims are DB columns"
        )
        if not options["apply"]:
            self.stdout.write(self.style.WARNING("\n  Dry run - re-run with --apply."))
        else:
            self.stdout.write(self.style.SUCCESS("\n  Applied."))
