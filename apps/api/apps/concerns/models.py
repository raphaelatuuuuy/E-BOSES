import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class ConcernCategory(models.Model):
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ConcernReport(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        IN_PROGRESS = "in_progress", "In Progress"
        RESOLVED = "resolved", "Resolved"
        DEFERRED = "deferred", "Deferred"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    resident = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_reports")
    barangay = models.CharField(max_length=120)
    tracking_number = models.CharField(max_length=20, unique=True, blank=True)
    category = models.ForeignKey(ConcernCategory, on_delete=models.PROTECT, related_name="reports")
    description = models.TextField()
    photo_url = models.URLField(max_length=500, blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=7)
    longitude = models.DecimalField(max_digits=10, decimal_places=7)
    zone = models.CharField(max_length=50, blank=True)
    severity_score = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(5)])
    ai_confidence_flag = models.BooleanField(default=False)
    severity_override = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(5)])
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.SUBMITTED)
    vote_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["resident", "status"]), models.Index(fields=["barangay", "status"])]

    def save(self, *args, **kwargs):
        if not self.tracking_number:
            year = timezone.now().year
            count = ConcernReport.objects.filter(created_at__year=year).count() + 1
            self.tracking_number = f"RPT-{year}-{count:04d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return self.tracking_number


class ConcernMedia(models.Model):
    class MediaType(models.TextChoices):
        PHOTO = "photo", "Photo"
        VIDEO = "video", "Video"
        DOCUMENT = "document", "Document"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(ConcernReport, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(upload_to="concerns/%Y/%m/")
    media_type = models.CharField(max_length=20, choices=MediaType.choices, default=MediaType.PHOTO)
    original_filename = models.CharField(max_length=255, blank=True)
    mime_type = models.CharField(max_length=120, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    public_url = models.URLField(max_length=500, blank=True)
    is_public = models.BooleanField(default=False)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="uploaded_concern_media")
    uploaded_at = models.DateTimeField(auto_now_add=True)


class ConcernVote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(ConcernReport, on_delete=models.CASCADE, related_name="votes")
    resident = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concern_votes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("report", "resident")


class ConcernStatusHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(ConcernReport, on_delete=models.CASCADE, related_name="status_history")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="concern_status_updates")
    old_status = models.CharField(max_length=30)
    new_status = models.CharField(max_length=30)
    resolution_note = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now_add=True)
