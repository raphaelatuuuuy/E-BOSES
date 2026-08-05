"""Catch up the `nlp_model` default with the model definition.

Pre-existing drift, surfaced by this refactor rather than caused by it: 0034 set
the column default to `gemma4:cloud` while `models.py` has said `gemma4:31b`
since. Recording it keeps `makemigrations --check` clean.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('concerns', '0038_media_privacy_state'),
    ]

    operations = [
        migrations.AlterField(
            model_name='concernclassificationconfiguration',
            name='nlp_model',
            field=models.CharField(default='gemma4:31b', max_length=120),
        ),
    ]
