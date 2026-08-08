from django.db import migrations
from django.db.models import Max


MISSING_FIELDS = [
    {
        "code": "address",
        "label": "Address",
        "data_type": "address",
        "required": True,
        "aliases": ["address"],
        "sides": ["front", "back"],
        "format": "none",
        "display_order": 2,
    },
    {
        "code": "date_of_birth",
        "label": "Date of birth",
        "data_type": "date",
        "required": True,
        "aliases": ["birthdate", "birth date", "date of birth"],
        "sides": ["front"],
        "format": "date_mdy",
        "display_order": 3,
    },
]

REQUIRED_RULES = [
    {
        "code": "barangay_address_match_address",
        "name": "Address matches the address on file",
        "rule_type": "profile_match",
        "operator": "matches_profile",
        "value": {"field": "address", "profile": "address"},
    },
    {
        "code": "barangay_date_of_birth_match_dob",
        "name": "Date of birth matches the birth date on file",
        "rule_type": "profile_match",
        "operator": "matches_profile",
        "value": {"field": "date_of_birth", "profile": "date_of_birth"},
    },
]


def ensure_fields_and_rules(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")

    configurations = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    for configuration in configurations:
        document = DocumentType.objects.filter(configuration=configuration, code="barangay_id").first()
        if not document:
            continue

        for spec in MISSING_FIELDS:
            Field.objects.get_or_create(
                document_type=document,
                code=spec["code"],
                defaults={
                    "label": spec["label"],
                    "data_type": spec["data_type"],
                    "required": spec["required"],
                    "enabled": True,
                    "aliases": spec["aliases"],
                    "sides": spec["sides"],
                    "format": spec["format"],
                    "min_confidence": 0.8,
                    "normalization": "none",
                    "display_order": spec["display_order"],
                },
            )

        for spec in REQUIRED_RULES:
            field = Field.objects.filter(document_type=document, code=spec["value"]["field"]).first()
            if not field:
                continue
            Rule.objects.get_or_create(
                configuration=configuration,
                code=spec["code"],
                defaults={
                    "document_type": document,
                    "field": field,
                    "name": spec["name"],
                    "rule_type": spec["rule_type"],
                    "operator": spec["operator"],
                    "value": spec["value"],
                    "on_failure": "manual_review",
                    "enabled": True,
                    "display_order": (Rule.objects.filter(
                        configuration=configuration,
                        document_type=document,
                    ).aggregate(max_order=Max("display_order"))["max_order"] or 0) + 1,
                },
            )


def remove_rules_and_fields(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    Rule = apps.get_model("accounts", "OCRRule")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    codes = [spec["code"] for spec in REQUIRED_RULES]
    field_codes = [spec["code"] for spec in MISSING_FIELDS]
    live = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    Rule.objects.filter(configuration__in=live, code__in=codes).delete()
    Field.objects.filter(document_type__configuration__in=live, code__in=field_codes).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0031_ocr_reensure_canonical_rules")]
    operations = [migrations.RunPython(ensure_fields_and_rules, remove_rules_and_fields)]
