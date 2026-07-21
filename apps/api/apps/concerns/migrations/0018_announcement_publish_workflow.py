from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("concerns", "0017_concernresolutionevidence"),
    ]

    operations = [
        migrations.AddField(
            model_name="announcement",
            name="expires_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="announcement",
            name="is_pinned",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="announcement",
            name="starts_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="announcement",
            name="urgency",
            field=models.CharField(choices=[("normal", "Normal"), ("important", "Important"), ("urgent", "Urgent")], default="normal", max_length=16),
        ),
        migrations.AlterField(
            model_name="announcement",
            name="audience",
            field=models.CharField(choices=[("all", "All"), ("residents", "Residents"), ("responders", "Responders"), ("officials", "Officials")], default="all", max_length=24),
        ),
        migrations.AlterModelOptions(
            name="announcement",
            options={"ordering": ["-is_pinned", "-published_at", "-created_at"]},
        ),
    ]
