from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0022_alter_user_options_user_accounts_resp_avail_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="residenceverificationcase",
            name="review_reason",
            field=models.CharField(
                blank=True,
                choices=[
                    ("ocr_unavailable", "OCR unavailable"),
                    ("low_confidence", "Low OCR confidence"),
                    ("missing_required_field", "Missing required field"),
                    ("document_type_mismatch", "Document type mismatch"),
                    ("rule_mismatch", "Validation rule mismatch"),
                    ("duplicate_identity", "Possible duplicate identity"),
                    ("resubmission_required", "Request a new submission"),
                    ("official_requested", "Official requested review"),
                    ("legacy_pending", "Legacy pending verification"),
                ],
                max_length=40,
            ),
        ),
        migrations.CreateModel(
            name="IdentityIdentifierClaim",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("document_type_code", models.SlugField(max_length=64)),
                ("field_code", models.SlugField(max_length=64)),
                ("value_hash", models.CharField(max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "source_case",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="identity_identifier_claims",
                        to="accounts.residenceverificationcase",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="identity_identifier_claims",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(
                        fields=["document_type_code", "field_code", "value_hash"],
                        name="acct_identity_claim_lookup",
                    )
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("document_type_code", "field_code", "value_hash"),
                        name="accounts_identity_identifier_claim_uniq",
                    )
                ],
            },
        ),
    ]
