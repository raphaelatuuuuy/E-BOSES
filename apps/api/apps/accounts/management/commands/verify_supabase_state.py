from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


class Command(BaseCommand):
    help = "Verify Supabase schema, RLS, buckets, claims hook, and safe seed state."

    def handle(self, *args, **options):
        if settings.DATABASE_TARGET != "supabase":
            raise CommandError("DATABASE_TARGET must be supabase.")
        executor = MigrationExecutor(connection)
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        failures = []
        if pending:
            failures.append(f"{len(pending)} Django migration(s) are pending")

        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*) from pg_tables where schemaname='public' and "
                "(tablename like 'accounts_%' or tablename like 'concerns_%' or "
                "tablename like 'emergencies_%' or tablename like 'notifications_%' or tablename like 'sms_%')"
            )
            business_tables = cursor.fetchone()[0]
            cursor.execute(
                "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                "where n.nspname='public' and c.relkind='r' and c.relname ~ '^(accounts|concerns|emergencies|notifications|sms)_' and c.relrowsecurity"
            )
            rls_tables = cursor.fetchone()[0]
            cursor.execute("select id from storage.buckets where id in ('original-photos','protected-photos') order by id")
            buckets = [row[0] for row in cursor.fetchall()]
            cursor.execute("select to_regprocedure('public.custom_access_token_hook(jsonb)') is not null")
            claims_hook = cursor.fetchone()[0]
            cursor.execute(
                "select count(*) from public.accounts_user where email in "
                "('official@eboses.test','responder@eboses.test','resident@eboses.test') "
                "and (is_active or is_staff or is_superuser or password <> '!')"
            )
            unsafe_seeded = cursor.fetchone()[0]
            cursor.execute("select code from public.emergencies_emergencycategory where is_active order by sort_order, code")
            active_categories = [row[0] for row in cursor.fetchall()]

        if business_tables != rls_tables:
            failures.append(f"RLS enabled on {rls_tables} of {business_tables} business tables")
        if buckets != ["original-photos", "protected-photos"]:
            failures.append("private Storage buckets are missing")
        if not claims_hook:
            failures.append("custom access-token hook function is missing")
        if unsafe_seeded:
            failures.append("known demo accounts are still usable")
        if active_categories != ["fire", "medical", "flood", "crime", "disaster"]:
            failures.append(f"active emergency categories do not match local configuration: {active_categories}")

        self.stdout.write(f"Django migrations pending: {len(pending)}")
        self.stdout.write(f"Business tables with RLS: {rls_tables}/{business_tables}")
        self.stdout.write(f"Private buckets: {', '.join(buckets)}")
        self.stdout.write(f"Active emergency categories: {', '.join(active_categories)}")
        if failures:
            for failure in failures:
                self.stdout.write(self.style.ERROR(f"FAIL: {failure}"))
            raise CommandError(f"Supabase verification failed with {len(failures)} issue(s).")
        self.stdout.write(self.style.SUCCESS("Supabase foundation verification passed."))
