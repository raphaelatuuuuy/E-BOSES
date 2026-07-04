from django.conf import settings
from django.db import models

from apps.accounts.storage import PrivateMediaStorage, PublicMediaStorage


class Concern(models.Model):
    class Visibility(models.TextChoices):
        PRIVATE = "private", "Private"
        COMMUNITY = "community", "Community"

    class Category(models.TextChoices):
        INFRASTRUCTURE = "infrastructure", "Infrastructure"
        ENVIRONMENT = "environment", "Environment"
        PUBLIC_SAFETY = "public_safety", "Public Safety"
        OTHERS = "others", "Others"

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        IN_PROGRESS = "in_progress", "In Progress"
        RESOLVED = "resolved", "Resolved"
        REJECTED = "rejected", "Rejected"
        APPEALED = "appealed", "Appealed"

    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concerns")
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.OTHERS)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.SUBMITTED)
    address = models.CharField(max_length=255, blank=True)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    update_text = models.CharField(max_length=255, blank=True)
    visibility = models.CharField(max_length=16, choices=Visibility.choices, default=Visibility.COMMUNITY)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class ConcernMedia(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(storage=PrivateMediaStorage(), upload_to="raw/concern-media/%Y/%m/")
    preview_file = models.FileField(storage=PublicMediaStorage(), upload_to="previews/concern-media/%Y/%m/", blank=True)
    original_filename = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class ConcernStatusEvent(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="status_events")
    status = models.CharField(max_length=32, choices=Concern.Status.choices)
    note = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_status_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class ConcernVote(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_votes")
    value = models.SmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["concern", "user"], name="unique_concern_vote_per_user"),
        ]


class ConcernComment(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_comments")
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies")
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]


class Announcement(models.Model):
    class Audience(models.TextChoices):
        ALL = "all", "All"
        RESIDENTS = "residents", "Residents"

    title = models.CharField(max_length=160)
    body = models.TextField()
    tag = models.CharField(max_length=40, default="Barangay")
    audience = models.CharField(max_length=24, choices=Audience.choices, default=Audience.ALL)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-published_at", "-created_at"]


class BarangayEvent(models.Model):
    title = models.CharField(max_length=160)
    detail = models.CharField(max_length=255, blank=True)
    barangay = models.CharField(max_length=120, default="Marikina Heights")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["starts_at", "id"]
