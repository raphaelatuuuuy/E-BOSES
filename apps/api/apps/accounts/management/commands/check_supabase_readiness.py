from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Validate Supabase and Resend configuration without printing secrets or connecting."

    def add_arguments(self, parser):
        parser.add_argument("--strict", action="store_true")

    def handle(self, *args, **options):
        failures = []
        warnings = []

        def require(condition, message):
            if not condition:
                failures.append(message)

        url = settings.SUPABASE_URL
        parsed = urlparse(url)
        require(parsed.scheme == "https" and parsed.hostname and parsed.hostname.endswith(".supabase.co"),
                "SUPABASE_URL must be the project HTTPS URL.")
        require(len(settings.SUPABASE_PUBLISHABLE_KEY) >= 20, "SUPABASE_PUBLISHABLE_KEY is missing.")
        require(len(settings.SUPABASE_SECRET_KEY) >= 20, "SUPABASE_SECRET_KEY is missing.")

        for name in ("SUPABASE_DATABASE_URL", "SUPABASE_DATABASE_POOLER_URL"):
            value = getattr(settings, name)
            db = urlparse(value)
            require(db.scheme in {"postgres", "postgresql"} and bool(db.hostname), f"{name} is invalid.")
            sslmode = parse_qs(db.query).get("sslmode", [settings.SUPABASE_SSLMODE])[0]
            if sslmode not in {"require", "verify-ca", "verify-full"}:
                failures.append(f"{name} must include sslmode=require or stronger.")

        hook_secret = settings.SUPABASE_AUTH_HOOK_SECRET
        require(
            hook_secret.startswith("v1,whsec_") and len(hook_secret) > len("v1,whsec_") + 16,
            "SUPABASE_AUTH_HOOK_SECRET must be the generated v1,whsec_ value.",
        )
        require(settings.SUPABASE_ORIGINAL_BUCKET == "original-photos", "Original bucket name does not match SQL.")
        require(settings.SUPABASE_PROTECTED_BUCKET == "protected-photos", "Protected bucket name does not match SQL.")
        require(bool(settings.RESEND_API_KEY), "RESEND_API_KEY is missing.")
        if settings.RESEND_FROM_EMAIL.endswith("@resend.dev"):
            warnings.append("RESEND_FROM_EMAIL uses the testing domain and cannot send to normal users.")

        for warning in warnings:
            self.stdout.write(self.style.WARNING(f"WARN: {warning}"))
        if failures:
            for failure in failures:
                self.stdout.write(self.style.ERROR(f"FAIL: {failure}"))
            if options["strict"]:
                raise CommandError(f"Supabase readiness failed with {len(failures)} issue(s).")
        else:
            self.stdout.write(self.style.SUCCESS("Supabase and Resend values pass local format checks."))

        self.stdout.write(
            f"Targets: database={settings.DATABASE_TARGET}, auth={settings.AUTH_BACKEND}, storage={settings.STORAGE_BACKEND}, "
            f"account_email={settings.ACCOUNT_EMAIL_PROVIDER}"
        )
