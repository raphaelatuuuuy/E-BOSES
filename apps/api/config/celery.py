"""Celery application used by OCR and other bounded background workflows."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("eboses")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
# OCR tasks live in ocr_tasks.py, not tasks.py, so autodiscover_tasks() never
# registers them. `imports` tells Celery to import that module lazily when the
# WORKER starts (after Django is fully ready), so the web server and check
# never import models while the app registry is still loading. Without it the
# 5-minute OCR canary/recovery beat schedules go into the void (KeyError).
app.conf.imports = ("apps.accounts.ocr_tasks",)


__all__ = ("app",)