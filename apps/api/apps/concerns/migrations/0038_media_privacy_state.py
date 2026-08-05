"""Gemma-driven photo state and SAM3 privacy state.

Two groups of columns:

* On the assessment — the decisions Gemma makes that the official UI and the
  privacy task both branch on. These are columns rather than `raw_result` keys
  because "should SAM3 run" and "did the image review succeed" are control flow,
  not display data.

* On the media row — where each image is in the privacy pipeline, what was
  requested, what came back, and whether the protected copy may be served
  publicly. `public_visible` defaults to False so an image is restricted until a
  run explicitly clears it.

`ConcernMediaRedaction` reinstates the model deleted in 0022, now recording both
automatic (SAM3) and official manual regions so a re-render reproduces both.
"""

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def restrict_existing_previews(apps, schema_editor):
    """Existing photos were blurred by the retired Haar cascade, not by SAM3.

    They have no privacy run behind them, so they are marked NOT_REQUIRED but
    left publicly visible: they already have a redacted preview on disk and
    hiding every historical community post would be a bigger change than this
    refactor is allowed to make. New uploads go through the real pipeline.
    """
    Media = apps.get_model("concerns", "ConcernMedia")
    Media.objects.filter(preview_file__gt="").update(public_visible=True)


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0037_remove_yolo_analysis"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="concernaiassessment",
            name="image_review_succeeded",
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="concernaiassessment",
            name="evidence_relationship",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="concernaiassessment",
            name="privacy_scan_required",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="concernaiassessment",
            name="privacy_scan_reasons",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernaiassessment",
            name="suspected_sensitive_classes",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernaiassessment",
            name="urgent_attention",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="concernaiassessment",
            name="missing_information",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernaiassessment",
            name="recommended_action",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="privacy_state",
            field=models.CharField(
                choices=[
                    ("not_required", "No privacy scan required"),
                    ("queued", "Queued for privacy processing"),
                    ("processing", "Privacy processing running"),
                    ("protected", "Protected copy created"),
                    ("sensitive_review_required", "Sensitive media, review required"),
                    ("no_match_found", "No matching sensitive region confirmed"),
                    ("failed_restricted", "Privacy processing failed, media restricted"),
                ],
                default="not_required",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="privacy_requested_classes",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="privacy_detected_classes",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="privacy_regions",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="privacy_cache_key",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="privacy_failure",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="privacy_processed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="concernmedia",
            name="public_visible",
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name="ConcernMediaRedaction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("x", models.FloatField()),
                ("y", models.FloatField()),
                ("width", models.FloatField()),
                ("height", models.FloatField()),
                ("label", models.CharField(blank=True, max_length=64)),
                (
                    "source",
                    models.CharField(
                        choices=[("sam3", "Automatic scan"), ("official", "Added by an official")],
                        default="sam3",
                        max_length=16,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="concern_media_redactions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "media",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="redactions",
                        to="concerns.concernmedia",
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.RunPython(restrict_existing_previews, migrations.RunPython.noop),
    ]
