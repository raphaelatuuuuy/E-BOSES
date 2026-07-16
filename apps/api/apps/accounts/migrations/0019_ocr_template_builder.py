from django.db import migrations, models
import django.core.validators
import apps.accounts.storage


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0018_ocr_failure_action"),
    ]

    operations = [
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="template_name",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="template_version",
            field=models.CharField(default="v1.0", max_length=32),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="expected_title",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="min_ocr_confidence",
            field=models.DecimalField(
                decimal_places=3,
                default=0.900,
                max_digits=4,
                validators=[
                    django.core.validators.MinValueValidator(0),
                    django.core.validators.MaxValueValidator(1),
                ],
            ),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="accept_rotated",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="accept_scanned_pdf",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="sample_file",
            field=models.FileField(
                blank=True,
                storage=apps.accounts.storage.PrivateMediaStorage(),
                upload_to="raw/ocr-samples/%Y/%m/",
            ),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="sample_original_filename",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="ocrdocumenttype",
            name="template_settings",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddConstraint(
            model_name="ocrdocumenttype",
            constraint=models.CheckConstraint(
                condition=models.Q(min_ocr_confidence__gte=0, min_ocr_confidence__lte=1),
                name="accounts_ocr_doc_min_conf_range",
            ),
        ),
    ]
