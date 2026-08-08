"""Delete OCR test runs and their stored sample files.

OCR test runs are diagnostic artifacts officials trigger from the OCR config
screen (see ``apps.accounts.models.OCRTestRun``). Nothing in verification
depends on an old run, so purging them reclaims private-media space without
touching any resident data. Files are removed through the storage backend so
every on-disk copy goes with its row.

Usage::

    python manage.py purge_ocr_test_runs --older-than-days 30   # default
    python manage.py purge_ocr_test_runs --all                   # everything
    python manage.py purge_ocr_test_runs --all --dry-run         # preview only
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import OCRTestRun


class Command(BaseCommand):
    help = "Delete OCR test runs (rows + stored files), optionally older than N days."

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than-days",
            type=int,
            default=30,
            help="Delete runs created more than this many days ago (default: 30).",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help="Delete every OCR test run regardless of age.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be deleted without deleting anything.",
        )

    def handle(self, *args, **options):
        queryset = OCRTestRun.objects.all()
        if not options["all"]:
            cutoff = timezone.now() - timedelta(days=options["older_than_days"])
            queryset = queryset.filter(created_at__lt=cutoff)

        ids = list(queryset.values_list("pk", flat=True))
        with_files = OCRTestRun.objects.filter(pk__in=ids).exclude(file="").count()
        self.stdout.write(
            f"OCR test runs to delete: {len(ids)} (with stored files: {with_files})"
        )

        if options["dry_run"] or not ids:
            return

        # Remove stored files first, then delete all rows in one query (avoids
        # skipping rows when deleting while iterating a server-side cursor).
        files_deleted = 0
        for run in OCRTestRun.objects.filter(pk__in=ids).only("id", "file").iterator(chunk_size=200):
            if run.file:
                try:
                    run.file.delete(save=False)
                    files_deleted += 1
                except Exception as exc:  # noqa: BLE001 - keep going, log and continue
                    self.stderr.write(f"Could not delete file for run {run.pk}: {exc}")
        OCRTestRun.objects.filter(pk__in=ids).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {len(ids)} OCR test runs and {files_deleted} stored files."
            )
        )
