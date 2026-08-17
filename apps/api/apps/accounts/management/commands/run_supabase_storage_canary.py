import base64
import uuid

import httpx
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.storage import PrivateMediaStorage


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class Command(BaseCommand):
    help = "Upload, read, sign, and remove one synthetic private Storage object."

    def handle(self, *args, **options):
        if settings.STORAGE_BACKEND != "supabase":
            raise CommandError("STORAGE_BACKEND must be supabase.")
        storage = PrivateMediaStorage()
        name = f"canary/{uuid.uuid4()}.png"
        saved = None
        try:
            saved = storage.save(name, ContentFile(PNG, name="canary.png"))
            with storage.open(saved, "rb") as file:
                if file.read() != PNG:
                    raise CommandError("Downloaded canary bytes do not match the upload.")
            signed = storage.signed_url(saved, 60)
            response = httpx.get(signed, timeout=20)
            response.raise_for_status()
            if response.content != PNG:
                raise CommandError("Signed URL returned different bytes.")
            self.stdout.write(self.style.SUCCESS("Supabase private Storage upload, read, and signed URL canary passed."))
        finally:
            if saved:
                storage.delete(saved)
                if storage.exists(saved):
                    raise CommandError("Storage canary cleanup failed.")
                self.stdout.write("Temporary Storage object removed.")
