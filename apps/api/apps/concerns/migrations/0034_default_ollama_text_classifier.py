from django.db import migrations, models


def forwards(apps, schema_editor):
    Config = apps.get_model("concerns", "ConcernClassificationConfiguration")
    Config.objects.filter(nlp_provider__in=["keyword_baseline", "roberta_tagalog", ""]).update(
        nlp_provider="ollama_cloud",
        nlp_model="gemma4:cloud",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("concerns", "0033_backfill_supported_classes"),
    ]

    operations = [
        migrations.AlterField(
            model_name="concernclassificationconfiguration",
            name="nlp_provider",
            field=models.CharField(default="ollama_cloud", max_length=32),
        ),
        migrations.AlterField(
            model_name="concernclassificationconfiguration",
            name="nlp_model",
            field=models.CharField(default="gemma4:cloud", max_length=120),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
