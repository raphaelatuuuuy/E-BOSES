"""Concern reporting models for E-Boses."""

from django.conf import settings
from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=80, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "categories"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Concern(models.Model):
    class Status(models.TextChoices):
        PENDING_REVIEW = "pending_review", "Pending Review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        IN_PROGRESS = "in_progress", "In Progress"
        RESOLVED = "resolved", "Resolved"

    title = models.CharField(max_length=160)
    description = models.TextField()
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concerns")
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="concerns")
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.PENDING_REVIEW)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    ai_severity_score = models.FloatField(null=True, blank=True)
    ai_category_suggestion = models.CharField(max_length=80, blank=True)
    ai_relevance_score = models.FloatField(null=True, blank=True)
    ai_fake_report_score = models.FloatField(null=True, blank=True)
    ai_model_version = models.CharField(max_length=120, blank=True)
    ai_explanation = models.TextField(blank=True)
    ai_metadata = models.JSONField(default=dict, blank=True)
    ai_reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewer_severity_score = models.FloatField(null=True, blank=True)
    reviewer_category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_concerns")
    reviewer_relevance_score = models.FloatField(null=True, blank=True)
    reviewer_fake_report_score = models.FloatField(null=True, blank=True)
    reviewer_override_reason = models.TextField(blank=True)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="concern_ai_overrides")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["status", "created_at"]), models.Index(fields=["ai_severity_score"])]
        ordering = ["-created_at"]

    def __str__(self):
        return self.title

    @property
    def final_severity_score(self):
        return self.reviewer_severity_score if self.reviewer_severity_score is not None else self.ai_severity_score

    @property
    def final_category(self):
        return self.reviewer_category or self.category


class ConcernMedia(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(upload_to="concerns/%Y/%m/")
    mime_type = models.CharField(max_length=120, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Media for {self.concern_id}"


class ConcernStatusLog(models.Model):
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="status_logs")
    status = models.CharField(max_length=32, choices=Concern.Status.choices)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
