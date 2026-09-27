"""Backfill missing community_id on AuditLog rows.

Rows where community_id is null get resolved from the actor's or
target_user's resident profile community, falling back to the
actor's designation department community.

Run once after deploying the index migration:

    python manage.py backfill_audit_log_community

Idempotent: only updates rows that still have null community_id.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.accounts.models import AuditLog
from apps.community_scope import PRIMARY_COMMUNITY_CODE
from apps.emergencies.models import Community


class Command(BaseCommand):
    help = "Backfill missing community_id on existing AuditLog rows"

    def handle(self, *args, **opts):
        null_rows = AuditLog.objects.filter(community_id__isnull=True)
        total = null_rows.count()
        self.stdout.write(f"Found {total} AuditLog rows with null community_id\n")

        if total == 0:
            self.stdout.write(self.style.SUCCESS("Nothing to backfill."))
            return

        # Fallback community (primary community) for rows that can't be resolved
        fallback = (
            Community.objects.filter(status="active", code=PRIMARY_COMMUNITY_CODE)
            .values_list("id", flat=True)
            .first()
        )

        updated = 0
        skipped = 0

        for row in null_rows.iterator(chunk_size=200):
            community = None

            actor = row.actor
            target = row.target_user
            metadata = row.metadata or {}

            # Try to resolve from concern_id in metadata
            concern_id = metadata.get("concern_id")
            if concern_id:
                from apps.concerns.models import Concern
                community = (
                    Concern.objects.filter(pk=concern_id)
                    .values_list("community", flat=True)
                    .first()
                )

            # Try to resolve from actor/target resident profile
            if community is None:
                user = target or actor
                if user:
                    profile = getattr(user, "resident_profile", None)
                    if profile and profile.community_id:
                        community = profile.community_id

            # Try to resolve from actor designations
            if community is None and actor:
                community = (
                    actor.designations.filter(is_active=True)
                    .values_list("department__community_id", flat=True)
                    .first()
                )

            if community is not None:
                row.community_id = community
                row.save(update_fields=["community_id"])
                updated += 1
            elif fallback:
                row.community_id = fallback
                row.save(update_fields=["community_id"])
                updated += 1
            else:
                skipped += 1

        self.stdout.write(f"\nUpdated: {updated}")
        self.stdout.write(f"Skipped: {skipped}")

        if updated > 0:
            self.stdout.write(self.style.SUCCESS("Backfill complete."))
        if skipped > 0:
            self.stdout.write(
                self.style.WARNING(
                    f"{skipped} rows still have null community_id. "
                    f"No fallback community configured."
                )
            )