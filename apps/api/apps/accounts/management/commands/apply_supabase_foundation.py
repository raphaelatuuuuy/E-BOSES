import hashlib
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction


class Command(BaseCommand):
    help = "Apply reviewed Supabase-only RLS, Storage, and Auth SQL files."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        if settings.DATABASE_TARGET != "supabase":
            raise CommandError("DATABASE_TARGET must be supabase.")
        root = Path(settings.BASE_DIR).parent.parent
        files = sorted((root / "supabase" / "migrations").glob("*.sql"))
        if not files:
            raise CommandError("No Supabase SQL migrations were found.")
        if not options["apply"]:
            self.stdout.write(f"Dry run: {len(files)} SQL file(s) ready. No SQL was applied.")
            return

        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(hashtext('eboses_supabase_foundation'))")
            cursor.execute(
                """
                create table if not exists public.eboses_supabase_migrations (
                    name text primary key,
                    sha256 text not null,
                    applied_at timestamptz not null default now()
                )
                """
            )
            for path in files:
                sql = path.read_text(encoding="utf-8")
                digest = hashlib.sha256(sql.encode()).hexdigest()
                cursor.execute(
                    "select sha256 from public.eboses_supabase_migrations where name = %s",
                    [path.name],
                )
                existing = cursor.fetchone()
                if existing:
                    if existing[0] != digest:
                        raise CommandError(f"Applied SQL file changed: {path.name}")
                    self.stdout.write(f"Already applied: {path.name}")
                    continue
                cursor.execute(sql)
                cursor.execute(
                    "insert into public.eboses_supabase_migrations(name, sha256) values (%s, %s)",
                    [path.name, digest],
                )
                self.stdout.write(self.style.SUCCESS(f"Applied: {path.name}"))
