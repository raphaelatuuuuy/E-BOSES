from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def seed_configuration(apps, schema_editor):
    Config = apps.get_model("concerns", "ConcernClassificationConfiguration")
    Config.objects.get_or_create(pk=1, defaults={
        "suspicious_terms": ["asdf", "qwerty", "test", "testing", "12345"],
        "category_keywords": {
            "infrastructure": ["pothole", "lubak", "kalsada", "streetlight", "ilaw", "kanal", "drainage"],
            "environment": ["basura", "garbage", "trash", "baha", "flood", "tubig", "pollution", "punong natumba"],
            "public_safety": ["aksidente", "accident", "sunog", "fire", "away", "crime", "danger", "delikado", "stray dog"],
            "others": [],
        },
        "label_mappings": {"pothole": "infrastructure", "garbage": "environment", "floodwater": "environment", "fire": "public_safety", "dog": "public_safety"},
    })


class Migration(migrations.Migration):
    dependencies = [("concerns", "0007_concernappeal_concernassignment_concernclarification_and_more"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="ConcernClassificationConfiguration",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("image_provider", models.CharField(default="ultralytics", max_length=32)),
                ("image_model", models.CharField(default="yolov8m.pt", max_length=80)),
                ("nlp_provider", models.CharField(default="keyword_baseline", max_length=32)),
                ("nlp_model", models.CharField(default="multilingual-keyword-v1", max_length=120)),
                ("image_confidence_threshold", models.FloatField(default=0.7)),
                ("relevance_threshold", models.FloatField(default=0.65)),
                ("duplicate_threshold", models.FloatField(default=0.85)),
                ("minimum_description_length", models.PositiveSmallIntegerField(default=20)),
                ("mismatch_action", models.CharField(choices=[("manual_review", "Flag for official review"), ("reject", "Reject automatically"), ("request_resubmission", "Request resubmission")], default="manual_review", max_length=32)),
                ("duplicate_detection_enabled", models.BooleanField(default=True)),
                ("flag_suspicious", models.BooleanField(default=True)),
                ("flag_irrelevant", models.BooleanField(default=True)),
                ("notify_reviewer", models.BooleanField(default=True)),
                ("suspicious_terms", models.JSONField(blank=True, default=list)),
                ("category_keywords", models.JSONField(blank=True, default=dict)),
                ("label_mappings", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("updated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="classification_config_updates", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.RunPython(seed_configuration, migrations.RunPython.noop),
    ]
