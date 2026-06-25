"""
Development settings for E-Boses API.
"""
from .base import *  # noqa: F403, F401

DEBUG = True

ALLOWED_HOSTS = ["*"]

# Disable password strength checks in dev
AUTH_PASSWORD_VALIDATORS = []

# Dev email backend (prints to console)
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
