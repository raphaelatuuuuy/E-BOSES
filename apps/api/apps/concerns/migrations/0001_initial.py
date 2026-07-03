# Generated manually for initial concern and advisory AI validation models.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Category",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=80, unique=True)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"verbose_name_plural": "categories", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="Concern",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=160)),
                ("description", models.TextField()),
                ("status", models.CharField(choices=[("pending_review", "Pending Review"), ("approved", "Approved"), ("rejected", "Rejected"), ("in_progress", "In Progress"), ("resolved", "Resolved")], default="pending_review", max_length=32)),
                ("latitude", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ("longitude", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ("ai_severity_score", models.FloatField(blank=True, null=True)),
                ("ai_category_suggestion", models.CharField(blank=True, max_length=80)),
                ("ai_relevance_score", models.FloatField(blank=True, null=True)),
                ("ai_fake_report_score", models.FloatField(blank=True, null=True)),
                ("ai_model_version", models.CharField(blank=True, max_length=120)),
                ("ai_explanation", models.TextField(blank=True)),
                ("ai_metadata", models.JSONField(blank=True, default=dict)),
                ("ai_reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("reviewer_severity_score", models.FloatField(blank=True, null=True)),
                ("reviewer_relevance_score", models.FloatField(blank=True, null=True)),
                ("reviewer_fake_report_score", models.FloatField(blank=True, null=True)),
                ("reviewer_override_reason", models.TextField(blank=True)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="concerns", to="concerns.category")),
                ("reporter", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="concerns", to=settings.AUTH_USER_MODEL)),
                ("reviewer", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="concern_ai_overrides", to=settings.AUTH_USER_MODEL)),
                ("reviewer_category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="reviewed_concerns", to="concerns.category")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="ConcernMedia",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(upload_to="concerns/%Y/%m/")),
                ("mime_type", models.CharField(blank=True, max_length=120)),
                ("uploaded_at", models.DateTimeField(auto_now_add=True)),
                ("concern", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="media", to="concerns.concern")),
            ],
        ),
        migrations.CreateModel(
            name="ConcernStatusLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("pending_review", "Pending Review"), ("approved", "Approved"), ("rejected", "Rejected"), ("in_progress", "In Progress"), ("resolved", "Resolved")], max_length=32)),
                ("note", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
                ("concern", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="status_logs", to="concerns.concern")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddIndex(model_name="concern", index=models.Index(fields=["status", "created_at"], name="concerns_co_status_8bc729_idx")),
        migrations.AddIndex(model_name="concern", index=models.Index(fields=["ai_severity_score"], name="concerns_co_ai_seve_b6e640_idx")),
    ]
