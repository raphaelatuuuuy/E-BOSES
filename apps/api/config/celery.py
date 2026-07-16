"""Celery application used by OCR and other bounded background workflows."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("eboses")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


__all__ = ("app",)
