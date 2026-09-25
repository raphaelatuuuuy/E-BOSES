"""Backfill AuditLog entries for LLM decisions created before this fix.

When the system first started writing LlmDecisionLog rows, no AuditLog
entries were created alongside them. This command finds production
LLM decisions that have no corresponding AuditLog entry and writes one.

Run:

    python manage.py backfill_llm_audit_logs

Idempotent: entries already backfilled are skipped.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta

from apps.accounts.models import AuditLog
from apps.accounts.services import create_audit_log
from apps.concerns.models import LlmDecisionLog, ContentFlag


DOMAIN_ACTION = {
    LlmDecisionLog.Domain.CONCERN: "concern.ai_decided",
    LlmDecisionLog.Domain.COMMUNITY: "content.flag_auto_reviewed",
}


def _concern_metadata(row):
    output = row.output_snapshot if isinstance(row.output_snapshot, dict) else {}
    final = output.get("final_decision") if isinstance(output.get("final_decision"), dict) else {}
    return {
        "concern_id": row.concern_id,
        "decision": final.get("status", row.recommended_action or ""),
        "reason": final.get("reason", row.resident_message or ""),
        "rejection_code": "",
        "model_version": row.model_version or "",
        "recommended_action": row.recommended_action or "",
        "backfilled": True,
    }


def _community_metadata(row):
    matched_reason = ""
    action_taken = "dismissed"
    content_type = ""
    output = row.output_snapshot if isinstance(row.output_snapshot, dict) else {}
    if row.content_flag_id:
        try:
            flag = ContentFlag.objects.filter(pk=row.content_flag_id).first()
            if flag:
                action_taken = "taken_down" if flag.auto_moderated else "dismissed"
                content_type = flag.target_kind or ""
        except Exception:
            pass
    return {
        "flag_id": row.content_flag_id,
        "content_type": content_type or "concern_comment",
        "matched_reason": row.resident_message or output.get("matched_reason", ""),
        "action_taken": action_taken,
        "model_version": row.model_version or "",
        "backfilled": True,
    }


DOMAIN_METADATA = {
    LlmDecisionLog.Domain.CONCERN: _concern_metadata,
    LlmDecisionLog.Domain.COMMUNITY: _community_metadata,
}


def _target_for(row):
    if row.domain == LlmDecisionLog.Domain.CONCERN and row.concern:
        return row.concern.reporter
    if row.domain == LlmDecisionLog.Domain.COMMUNITY:
        if row.content_flag_id:
            try:
                flag = ContentFlag.objects.filter(pk=row.content_flag_id).first()
                if flag and flag.concern:
                    return flag.concern.reporter
                if flag:
                    return flag.reporter
            except Exception:
                pass
    return None


class Command(BaseCommand):
    help = "Backfill AuditLog entries for past production LLM decisions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Only backfill LLM decisions from the last N days. Default: 30.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be created without writing anything.",
        )

    def handle(self, *args, **options):
        days = options["days"]
        dry_run = options["dry_run"]
        cutoff = timezone.now() - timedelta(days=days)

        qs = LlmDecisionLog.objects.filter(
            run_kind=LlmDecisionLog.RunKind.PRODUCTION,
            created_at__gte=cutoff,
        ).select_related("concern", "concern__reporter")

        total = qs.count()
        created = 0
        skipped = 0
        errors = 0

        self.stdout.write(f"Backfilling {total} production LLM decisions from the last {days} days...")

        for row in qs.iterator(chunk_size=200):
            action = DOMAIN_ACTION.get(row.domain)
            if not action:
                skipped += 1
                continue

            metadata_fn = DOMAIN_METADATA.get(row.domain)
            if not metadata_fn:
                skipped += 1
                continue

            target = _target_for(row)
            if not target:
                skipped += 1
                continue

            existing = AuditLog.objects.filter(
                action=action,
                target_user=target,
                metadata__contains={"backfilled": True},
            )
            if row.domain == LlmDecisionLog.Domain.CONCERN:
                existing = existing.filter(metadata__concern_id=row.concern_id)
            elif row.domain == LlmDecisionLog.Domain.COMMUNITY:
                existing = existing.filter(metadata__flag_id=row.content_flag_id)

            if existing.exists():
                skipped += 1
                continue

            metadata = metadata_fn(row)

            if dry_run:
                self.stdout.write(
                    f"  [DRY RUN] {action} | concern={row.concern_id} | flag={row.content_flag_id} | created_at={row.created_at}"
                )
                created += 1
                continue

            try:
                create_audit_log(
                    action,
                    actor=None,
                    target_user=target,
                    metadata=metadata,
                    request_meta={},
                    community=row.concern.community if row.concern else None,
                )
                created += 1
            except Exception:
                errors += 1
                self.stderr.write(f"  ERROR: Failed for {action} | row_id={row.pk}")

        self.stdout.write(self.style.SUCCESS(
            f"Done. Created: {created} | Skipped: {skipped} | Errors: {errors} / {total}"
        ))
