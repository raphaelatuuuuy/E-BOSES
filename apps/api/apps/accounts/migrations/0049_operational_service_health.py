from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0048_restore_default_ocr_field_rules")]

    operations = [
        migrations.AddField(
            model_name="servicehealthday",
            name="checks_total",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="operational_checks",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="degraded_checks",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="down_checks",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="not_configured_checks",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="unknown_checks",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="latency_total_ms",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="latency_max_ms",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="servicehealthday",
            name="last_sample_bucket",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ServiceHealthState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("module_key", models.SlugField(max_length=40, unique=True)),
                ("status", models.CharField(default="unknown", max_length=24)),
                ("detail", models.CharField(blank=True, max_length=255)),
                ("message", models.CharField(blank=True, max_length=255)),
                ("latency_ms", models.PositiveIntegerField(default=0)),
                ("consecutive_failures", models.PositiveSmallIntegerField(default=0)),
                ("consecutive_successes", models.PositiveSmallIntegerField(default=0)),
                ("checked_at", models.DateTimeField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["module_key"]},
        ),
        migrations.CreateModel(
            name="ServiceIncident",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("module_key", models.SlugField(db_index=True, max_length=40)),
                ("status", models.CharField(max_length=24)),
                ("message", models.CharField(blank=True, max_length=255)),
                ("started_at", models.DateTimeField(db_index=True)),
                ("resolved_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-started_at"],
                "indexes": [models.Index(fields=["module_key", "resolved_at"], name="accounts_s_module__422750_idx")],
            },
        ),
    ]
