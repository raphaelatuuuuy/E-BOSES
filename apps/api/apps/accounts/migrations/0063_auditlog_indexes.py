from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0062_allow_unconfigured_community_resolution"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="auditlog",
            index=models.Index(fields=["community_id"], name="audit_log_community_id"),
        ),
        migrations.AddIndex(
            model_name="auditlog",
            index=models.Index(fields=["action"], name="audit_log_action"),
        ),
    ]