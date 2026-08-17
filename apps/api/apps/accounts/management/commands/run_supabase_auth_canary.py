import secrets

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.supabase_admin import provision_supabase_user


class Command(BaseCommand):
    help = "Create, authenticate, verify, and remove one fictional Supabase Auth canary."

    def add_arguments(self, parser):
        parser.add_argument("--dataset-id", required=True)

    def handle(self, *args, **options):
        if settings.DATABASE_TARGET != "supabase" or settings.AUTH_BACKEND != "supabase":
            raise CommandError("DATABASE_TARGET and AUTH_BACKEND must both be supabase.")
        email = f"e2e-{options['dataset_id'].lower()}-resident1@example.invalid"
        user = User.objects.filter(email=email, supabase_user_id__isnull=True).first()
        if not user:
            raise CommandError("The unlinked fictional canary user was not found.")
        password = f"{secrets.token_urlsafe(24)}!Aa1"
        subject = None
        try:
            user.set_password(password)
            user.save(update_fields=["password", "updated_at"])
            subject = provision_supabase_user(user, password)
            response = httpx.post(
                f"{settings.SUPABASE_URL}/auth/v1/token?grant_type=password",
                json={"email": email, "password": password},
                headers={"apikey": settings.SUPABASE_PUBLISHABLE_KEY},
                timeout=20,
            )
            response.raise_for_status()
            token = response.json()["access_token"]
            api_response = APIClient().get(
                "/api/auth/me/",
                HTTP_AUTHORIZATION=f"Bearer {token}",
                HTTP_HOST="localhost",
            )
            if api_response.status_code != 200 or api_response.data.get("id") != user.pk:
                raise CommandError(f"Django rejected the Supabase session with HTTP {api_response.status_code}.")
            self.stdout.write(self.style.SUCCESS("Supabase Auth create, sign-in, JWT mapping, and Django API canary passed."))
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise CommandError("Supabase Auth canary failed.") from exc
        finally:
            if subject:
                delete = httpx.delete(
                    f"{settings.SUPABASE_URL}/auth/v1/admin/users/{subject}",
                    headers={
                        "Authorization": f"Bearer {settings.SUPABASE_SECRET_KEY}",
                        "apikey": settings.SUPABASE_SECRET_KEY,
                    },
                    timeout=20,
                )
                if delete.status_code >= 400:
                    raise CommandError("Canary passed but temporary Supabase Auth user cleanup failed.")
                User.objects.filter(pk=user.pk, supabase_user_id=subject).update(
                    supabase_user_id=None,
                    password="!",
                )
                self.stdout.write("Temporary Auth user removed and Django mapping cleared.")
