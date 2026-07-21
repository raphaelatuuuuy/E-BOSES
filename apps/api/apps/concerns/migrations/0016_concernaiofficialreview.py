from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    # Keep this branch rooted at 0014 so the location index and official-review
    # fields can be applied independently before the explicit merge migration.
    dependencies = [("concerns", "0014_concernchatattachment"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.AddField(model_name="concernaiassessment", name="official_decision", field=models.CharField(blank=True, choices=[("related", "Related"), ("irrelevant", "Irrelevant"), ("suspicious", "Suspicious"), ("needs_review", "Needs review")], max_length=24)),
        migrations.AddField(model_name="concernaiassessment", name="official_reason", field=models.TextField(blank=True)),
        migrations.AddField(model_name="concernaiassessment", name="official_reviewed_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="concernaiassessment", name="official_reviewer", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="ai_assessment_reviews", to=settings.AUTH_USER_MODEL)),
    ]
