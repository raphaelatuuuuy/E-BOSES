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
# apps.service_status is a bare module, not an app, so autodiscover misses its
# task the same way. Without it the health sampler never registers and the
# status timeline only fills in when somebody opens the page.
app.conf.imports = ("apps.accounts.ocr_tasks", "apps.service_status")


__all__ = ("app",)