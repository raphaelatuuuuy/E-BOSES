"""Fill in the road-photo evidence the automated review never captured.

Every report should carry three things: a concern photo, a pinned location,
and the road panorama at that pin. The pin and the photo are enforced at
submission; the panorama was not, so a handful of decision logs ended with
``street_imagery.status`` of ``no_coverage`` or ``skipped`` and no image.

This command finds those logs, fetches the panorama at the concern's stored
coordinates, saves it into the log's snapshot, re-runs the street-context
verification against the concern's photos, and records the new verdict. It
also mirrors the light verdict fields onto the concern's audit-log rows, so
the official audit log picks the change up without another backfill.

Run:

    python manage.py backfill_street_imagery [--days 3650] [--limit 20] [--dry-run]

Idempotent: logs whose snapshot already stores a checked panorama are skipped,
and nothing is written for concerns that genuinely have no pin or no photo.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import AuditLog
from apps.concerns.ai.image_prep import PreparedImage
from apps.concerns.ai.pipeline import _prepare_media_image
from apps.concerns.ai.street_imagery import fetch_latest_street_imagery
from apps.concerns.ai.gemma_analyzer import verify_street_context
from apps.concerns.models import Concern, LlmDecisionLog

DOMAINS = [LlmDecisionLog.Domain.CONCERN, LlmDecisionLog.Domain.EMERGENCY]

# Snapshot statuses that mean "the panorama was never stored". A checked log
# already has its image; a not_applicable/disabled log never applies.
FILLABLE_STATUSES = {"no_coverage", "skipped", None}


def _street_status(row: LlmDecisionLog) -> str | None:
    output = row.output_snapshot if isinstance(row.output_snapshot, dict) else {}
    street = output.get("street_imagery")
    if not isinstance(street, dict):
        return None
    return street.get("status")


def _needs_backfill(row: LlmDecisionLog) -> bool:
    if _street_status(row) not in FILLABLE_STATUSES:
        return False
    concern = row.concern
    if concern is None or concern.latitude is None or concern.longitude is None:
        return False
    return concern.media.filter(mime_type__startswith="image/").exists()


def _verify(concern: Concern, image_b64: str) -> dict | None:
    """Re-run the street-context comparison with the freshly fetched pano."""
    prepared_images = [
        image
        for image in (_prepare_media_image(media) for media in concern.media.filter(mime_type__startswith="image/"))
        if image is not None
    ]
    if not prepared_images:
        return None
    street_prepared = PreparedImage(data=image_b64, mime_type="image/jpeg", telemetry={})
    return verify_street_context(submitted=prepared_images, street=street_prepared)


def _refresh_audit_rows(row: LlmDecisionLog) -> None:
    """Mirror the new verdict onto the concern's audit rows."""
    output = row.output_snapshot if isinstance(row.output_snapshot, dict) else {}
    street = output.get("street_imagery") if isinstance(output.get("street_imagery"), dict) else {}
    # JSONField key paths cannot be set through a queryset .update(); each
    # row's metadata dict is rewritten in place instead.
    for audit_row in AuditLog.objects.filter(
        action="concern.ai_decided",
        metadata__concern_id=row.concern_id,
    ):
        metadata = dict(audit_row.metadata or {})
        metadata["street_verdict"] = street.get("verdict") or ""
        metadata["street_reason"] = street.get("explanation") or street.get("reason") or ""
        metadata["analysis_log_id"] = row.pk
        audit_row.metadata = metadata
        audit_row.save(update_fields=["metadata"])


class Command(BaseCommand):
    help = (
        "Fetch the missing road panorama for past decision logs, save it, "
        "and re-run the street verification through the LLM."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=3650,
            help="Only look at decision logs from the last N days. Default: all history.",
        )
        parser.add_argument("--limit", type=int, default=25, help="Maximum logs to process. Default: 25.")
        parser.add_argument("--concern", type=int, action="append", dest="concern_ids", help="Limit to specific concern ids.")
        parser.add_argument("--dry-run", action="store_true", help="List what would be processed without writing.")

    def handle(self, *args, **options):
        days = options["days"]
        limit = options["limit"]
        dry_run = options["dry_run"]
        concern_ids = options.get("concern_ids") or []
        cutoff = timezone.now() - timezone.timedelta(days=days)

        queryset = (
            LlmDecisionLog.objects.filter(
                run_kind=LlmDecisionLog.RunKind.PRODUCTION,
                domain__in=DOMAINS,
                concern__isnull=False,
                created_at__gte=cutoff,
            )
            .select_related("concern", "concern__community")
            .prefetch_related("concern__media")
            .order_by("-created_at")
        )
        if concern_ids:
            queryset = queryset.filter(concern_id__in=concern_ids)

        processed = 0
        filled = 0
        verified = 0
        still_missing = 0
        skipped = 0

        for row in queryset.iterator(chunk_size=50):
            if processed >= limit:
                break
            if not _needs_backfill(row):
                skipped += 1
                continue
            processed += 1
            concern = row.concern
            label = concern.tracking_id or f"concern {concern.pk}"

            if dry_run:
                self.stdout.write(f"  [DRY RUN] {label}: would fetch the panorama at {concern.latitude}, {concern.longitude}")
                filled += 1
                continue

            imagery = fetch_latest_street_imagery(
                latitude=float(concern.latitude),
                longitude=float(concern.longitude),
                radius_meters=50,
            )
            if imagery is None:
                still_missing += 1
                self.stdout.write(f"  {label}: no panorama available at the pin")
                continue

            verdict = _verify(concern, imagery.image_b64)
            output = dict(row.output_snapshot) if isinstance(row.output_snapshot, dict) else {}
            street = dict(output.get("street_imagery") or {})
            street.update(
                {
                    "status": "checked" if verdict else "skipped",
                    "verdict": (verdict or {}).get("verdict", "inconclusive"),
                    "explanation": (verdict or {}).get("explanation", "The street comparison could not run right now."),
                    "pano_id": imagery.pano_id,
                    "captured_date": imagery.captured_date,
                    "latitude": imagery.latitude,
                    "longitude": imagery.longitude,
                    "distance_meters": imagery.distance_meters,
                    "image_b64": imagery.image_b64,
                    "backfilled": True,
                }
            )
            output["street_imagery"] = street
            row.output_snapshot = output
            row.save(update_fields=["output_snapshot"])
            filled += 1
            if verdict:
                verified += 1
            _refresh_audit_rows(row)
            self.stdout.write(
                f"  {label}: panorama saved ({imagery.distance_meters} m from pin), "
                f"verdict={street['verdict']}"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Processed: {processed} | Panoramas saved: {filled} | "
                f"Verified by the model: {verified} | No coverage at pin: {still_missing} | Skipped: {skipped}"
            )
        )
