from django.conf import settings
from django.db import models

from apps.accounts.storage import PrivateMediaStorage, PublicMediaStorage


class Concern(models.Model):
    class Visibility(models.TextChoices):
        PRIVATE = "private", "Private"
        COMMUNITY = "community", "Community"

    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concerns")
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    visibility = models.CharField(max_length=16, choices=Visibility.choices, default=Visibility.COMMUNITY)
    created_at = models.DateTimeField(auto_now_add=True)


class ConcernMedia(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/concern-media/%Y/%m/")
    preview_file = models.FileField(storage=PublicMediaStorage(), upload_to="previews/concern-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)
