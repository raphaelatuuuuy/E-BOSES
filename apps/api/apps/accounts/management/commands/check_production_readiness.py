from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Check production deployment settings for E-Boses."

    def add_arguments(self, parser):
        parser.add_argument("--strict", action="store_true", help="Exit non-zero when blockers are found.")

    def handle(self, *args, **options):
        failures: list[str] = []
        warnings: list[str] = []

        if settings.DEBUG:
            failures.append("DEBUG must be false.")
        if settings.SECRET_KEY in {"", "local-development-only-secret-key", "change-me-local-only"}:
            failures.append("DJANGO_SECRET_KEY must be unique and high entropy.")
        if not settings.ALLOWED_HOSTS:
            failures.append("ALLOWED_HOSTS must list exact production hosts.")
        if "*" in settings.ALLOWED_HOSTS:
            failures.append("ALLOWED_HOSTS must not contain '*'.")
        if any(host in {"localhost", "127.0.0.1"} for host in settings.ALLOWED_HOSTS):
            warnings.append("ALLOWED_HOSTS contains local hosts.")

        engine = settings.DATABASES["default"]["ENGINE"]
        if "postgresql" not in engine and "postgis" not in engine:
            failures.append("Production database should be PostgreSQL/PostGIS.")

        if not getattr(settings, "REDIS_URL", ""):
            failures.append("REDIS_URL is required for Channels/WebSocket.")
        if not getattr(settings, "CELERY_BROKER_URL", ""):
            failures.append("CELERY_BROKER_URL is required for asynchronous OCR.")
        if not getattr(settings, "CELERY_RESULT_BACKEND", ""):
            warnings.append("CELERY_RESULT_BACKEND is empty; task result inspection is disabled.")
        if not settings.SESSION_COOKIE_SECURE or not settings.CSRF_COOKIE_SECURE:
            failures.append("Secure cookies must be enabled.")
        if not settings.SECURE_SSL_REDIRECT:
            warnings.append("SECURE_SSL_REDIRECT is disabled; ensure TLS termination redirects HTTP.")
        if settings.SECURE_HSTS_SECONDS < 3600:
            warnings.append("SECURE_HSTS_SECONDS is low.")

        if not settings.CSRF_TRUSTED_ORIGINS:
            warnings.append("CSRF_TRUSTED_ORIGINS is empty.")
        if not getattr(settings, "WEB_PUSH_PUBLIC_KEY", "") or not getattr(settings, "WEB_PUSH_PRIVATE_KEY", ""):
            warnings.append("Browser push VAPID keys are missing.")
        if not getattr(settings, "EBOSES_YOLO_MODEL_PATH", "") or not getattr(settings, "EBOSES_NLP_MODEL_PATH", ""):
            warnings.append("AI model paths are missing; AI assessments will stay not_configured.")

        paddle_token = getattr(settings, "PADDLEOCR_TOKEN", "")
        paddle_url = getattr(settings, "PADDLEOCR_JOB_URL", "")
        if not paddle_token:
            failures.append("PADDLEOCR_TOKEN is required for automatic document verification.")
        if not paddle_url or not paddle_url.startswith("https://"):
            failures.append("PADDLEOCR_JOB_URL must be an HTTPS PaddleOCR endpoint.")

        media_root = Path(settings.MEDIA_ROOT).resolve()
        private_media_root = Path(settings.PRIVATE_MEDIA_ROOT).resolve()
        if media_root == private_media_root or media_root in private_media_root.parents:
            failures.append("PRIVATE_MEDIA_ROOT must not be inside public MEDIA_ROOT.")

        for item in failures:
            self.stdout.write(self.style.ERROR(f"FAIL: {item}"))
        for item in warnings:
            self.stdout.write(self.style.WARNING(f"WARN: {item}"))
        if not failures:
            self.stdout.write(self.style.SUCCESS("Production readiness blockers: none."))
        if failures and options["strict"]:
            raise CommandError(f"{len(failures)} production readiness blocker(s).")
