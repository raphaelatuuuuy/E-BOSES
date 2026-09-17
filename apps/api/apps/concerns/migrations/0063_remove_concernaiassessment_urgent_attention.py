from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("concerns", "0062_announcement_llm_summary"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="concernaiassessment",
            name="urgent_attention",
        ),
    ]