"""Diagnostic test for the audit log endpoint.

Run: python manage.py test_audit_log

Exercises the audit log query with the same filters the official
config hub uses and prints timing + row counts so you can verify
the index and timeout fixes actually help.
"""

from __future__ import annotations

import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.accounts.models import AuditLog


class Command(BaseCommand):
    help = "Benchmark the audit log query with the filters the official hub uses"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=30, help="Days window (default 30)")
        parser.add_argument("--limit", type=int, default=200, help="Page size (default 200)")
        parser.add_argument("--category", default="all", help="Category filter (default all)")
        parser.add_argument("--search", default="", help="Search term (default empty)")

    def handle(self, *args, **opts):
        days = opts["days"]
        limit = opts["limit"]
        category = opts["category"]
        search = opts["search"]

        self.stdout.write(self.style.NOTICE(
            f"\nAudit log diagnostic — days={days} limit={limit} "
            f"category={category} search={search!r}\n"
        ))

        total_rows = AuditLog.objects.count()
        self.stdout.write(f"Total audit log rows in DB: {total_rows}")

        if total_rows == 0:
            self.stdout.write(self.style.WARNING("No audit log rows exist — create some first."))
            return

        from apps.audit_log import CATEGORIES, OTHER_CATEGORY

        # Derived from the view's own taxonomy so this diagnostic can never
        # print tabs the API no longer serves.
        categories = [
            ("all", "All activity"),
            *((key, label) for key, label, _prefixes in CATEGORIES),
            OTHER_CATEGORY,
        ]

        for key, label in categories:
            if category != "all" and key != category:
                continue
            self._run_single(key, label, days, limit, search)

        self._show_null_community()

    def _run_single(self, key, label, days, limit, search):
        from apps.audit_log import CATEGORIES, OTHER_CATEGORY, category_match, tab_match

        prefixes = next((p for k, _l, p in CATEGORIES if k == key), None)
        if prefixes is None and key not in {"all", OTHER_CATEGORY[0]}:
            return

        queryset = AuditLog.objects.select_related(
            "actor", "actor__resident_profile", "target_user", "target_user__resident_profile"
        )

        if key == OTHER_CATEGORY[0]:
            queryset = queryset.exclude(category_match())
        elif key != "all":
            queryset = queryset.filter(tab_match(prefixes))

        queryset = queryset.filter(
            created_at__gte=timezone.now() - timedelta(days=days)
        )
        if search:
            queryset = queryset.filter(
                Q(action__icontains=search)
                | Q(actor__email__icontains=search)
                | Q(target_user__email__icontains=search)
            )

        start = time.monotonic()
        total = queryset.count()
        fetch_time = time.monotonic() - start

        start = time.monotonic()
        rows = list(queryset.order_by("-created_at", "-id")[:limit])
        slice_time = time.monotonic() - start

        null_comm = sum(1 for r in rows if r.community_id is None)

        self.stdout.write(
            f"  {key:15s} {label:30s} | total={total:6d}  "
            f"count={fetch_time:.3f}s  slice={slice_time:.3f}s  "
            f"null_community={null_comm}"
        )

        if fetch_time > 5:
            self.stdout.write(
                self.style.ERROR(
                    f"    [SLOW] {fetch_time:.2f}s exceeds 5s threshold. "
                    f"Check indexes on community_id and action."
                )
            )
        if null_comm > 0:
            self.stdout.write(
                self.style.WARNING(
                    f"    [NULL_COMM] {null_comm} rows have null community_id — "
                    f"these are invisible to non-superusers in the current view."
                )
            )

    def _show_null_community(self):
        null_count = AuditLog.objects.filter(community_id__isnull=True).count()
        self.stdout.write(f"\nRows with null community_id: {null_count}")
        if null_count > 0:
            self.stdout.write(
                self.style.WARNING(
                    "These rows are filtered out for non-superusers. "
                    "Backfill with the correct community or adjust the view."
                )
            )