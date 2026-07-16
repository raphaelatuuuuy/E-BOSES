from django.db import migrations


BARANGAY_FIELDS = [
    ("place_of_birth", "Place of birth", "text", False, ["place of birth"]),
    ("civil_status", "Civil status", "text", False, ["civil status"]),
    ("gender", "Gender", "text", False, ["gender", "sex"]),
    ("issue_date", "Date issued", "date", False, ["date issued", "issued"]),
]

EXISTING_FIELD_ALIASES = {
    "full_name": ["last name first name middle name", "name"],
    "address": ["address"],
    "date_of_birth": ["birthdate", "birth date", "date of birth"],
    "document_number": ["id no", "id number", "identification no"],
    "expiry_date": ["valid until", "expiry date", "expiration date"],
}


def upgrade_barangay_id(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")

    configurations = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    for configuration in configurations:
        document = DocumentType.objects.filter(configuration=configuration, code="barangay_id").first()
        if not document:
            continue

        document.keywords = list(dict.fromkeys((document.keywords or []) + [
            "barangay marikina heights",
            "identification card",
            "bona fide resident",
        ]))
        document.aliases = list(dict.fromkeys((document.aliases or []) + [
            "barangay id card",
            "barangay identification card",
        ]))
        document.save(update_fields=["keywords", "aliases", "updated_at"])

        for code, aliases in EXISTING_FIELD_ALIASES.items():
            field = Field.objects.filter(document_type=document, code=code).first()
            if field:
                field.aliases = list(dict.fromkeys((field.aliases or []) + aliases))
                field.save(update_fields=["aliases", "updated_at"])

        for order, (code, label, data_type, required, aliases) in enumerate(BARANGAY_FIELDS, start=5):
            Field.objects.get_or_create(
                document_type=document,
                code=code,
                defaults={
                    "label": label,
                    "data_type": data_type,
                    "required": required,
                    "enabled": True,
                    "aliases": aliases,
                    "sides": ["front"],
                    "format": "date_mdy" if data_type == "date" else "none",
                    "min_confidence": 0.8,
                    "display_order": order,
                },
            )

        # The front-card vocabulary is useful for classification, but the
        # existing required/name/address/expiry rules remain the decision gates.
        Rule.objects.get_or_create(
            configuration=configuration,
            code="barangay_id_document_keyword",
            defaults={
                "document_type": document,
                "name": "Barangay ID wording is present",
                "rule_type": "contains_keyword",
                "operator": "contains_any",
                "value": {"keywords": ["barangay", "identification card", "bona fide resident"]},
                "on_failure": "warning",
                "enabled": True,
                "display_order": 20,
            },
        )


def downgrade_barangay_id(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")
    configurations = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    for configuration in configurations:
        document = configuration.document_types.filter(code="barangay_id").first()
        if not document:
            continue
        Field.objects.filter(document_type=document, code__in=[item[0] for item in BARANGAY_FIELDS]).delete()
        Rule.objects.filter(configuration=configuration, code="barangay_id_document_keyword").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0016_seed_ocr_defaults")]
    operations = [migrations.RunPython(upgrade_barangay_id, downgrade_barangay_id)]
