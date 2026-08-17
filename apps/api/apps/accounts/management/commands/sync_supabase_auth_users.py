import uuid

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User


class Command(BaseCommand):
    help = "Preview or invite existing Django users into Supabase Auth."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--confirm-send-invites", action="store_true")
        parser.add_argument("--redirect-to", default="")

    def handle(self, *args, **options):
        users = list(
            User.objects.filter(is_active=True, supabase_user_id__isnull=True)
            .exclude(email__endswith=".test")
            .order_by("id")
        )
        counts = {}
        for user in users:
            counts[user.role] = counts.get(user.role, 0) + 1
        self.stdout.write(f"Unlinked active users: {len(users)}; by role: {counts}")
        if not options["apply"]:
            self.stdout.write("Dry run only. No Supabase users or emails were created.")
            return
        if not options["confirm_send_invites"]:
            raise CommandError("--apply also requires --confirm-send-invites because this sends email.")
        if not settings.SUPABASE_URL or not settings.SUPABASE_SECRET_KEY:
            raise CommandError("Supabase URL and secret key are required.")

        headers = {
            "Authorization": f"Bearer {settings.SUPABASE_SECRET_KEY}",
            "apikey": settings.SUPABASE_SECRET_KEY,
            "Content-Type": "application/json",
        }
        linked = 0
        for user in users:
            payload = {"email": user.email, "data": {"app_role": user.role}}
            if options["redirect_to"]:
                payload["redirect_to"] = options["redirect_to"]
            try:
                response = httpx.post(
                    f"{settings.SUPABASE_URL}/auth/v1/invite",
                    json=payload,
                    headers=headers,
                    timeout=20,
                )
                response.raise_for_status()
                subject = uuid.UUID(response.json()["id"])
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
                raise CommandError(f"Stopped after {linked} invite(s); Supabase rejected user id {user.pk}.") from exc
            with transaction.atomic():
                locked = User.objects.select_for_update().get(pk=user.pk, supabase_user_id__isnull=True)
                locked.supabase_user_id = subject
                locked.save(update_fields=["supabase_user_id", "updated_at"])
            linked += 1
        self.stdout.write(self.style.SUCCESS(f"Invited and linked {linked} user(s)."))
