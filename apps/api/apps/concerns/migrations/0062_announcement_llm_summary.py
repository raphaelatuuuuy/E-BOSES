from django.db import migrations, models


def backfill_announcement_summaries(apps, schema_editor):
    Announcement = apps.get_model("concerns", "Announcement")
    for announcement in Announcement.objects.filter(llm_summary="").iterator():
        title = " ".join((announcement.title or "").split())
        summary = f"This announcement is about {title or 'a barangay update'}."
        announcement.llm_summary = summary[:300]
        announcement.save(update_fields=["llm_summary"])


class Migration(migrations.Migration):
    dependencies = [
        ("concerns", "0061_remove_mismatch_action"),
    ]

    operations = [
        migrations.AddField(
            model_name="announcement",
            name="llm_summary",
            field=models.CharField(blank=True, max_length=300),
        ),
        migrations.RunPython(backfill_announcement_summaries, migrations.RunPython.noop),
    ]
