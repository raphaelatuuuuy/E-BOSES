from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0047_llm_governance_and_comment_moderation"),
    ]

    operations = [
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="street_imagery_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="street_imagery_categories",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="street_imagery_radius_meters",
            field=models.PositiveIntegerField(default=50),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="street_imagery_action",
            field=models.CharField(
                choices=[
                    ("warn", "Warn reviewer only"),
                    ("request_resubmission", "Request resubmission"),
                    ("reject", "Reject automatically"),
                ],
                default="request_resubmission",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="photo_duplicate_llm_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="concernclassificationconfiguration",
            name="photo_duplicate_candidate_limit",
            field=models.PositiveSmallIntegerField(default=3),
        ),
    ]
