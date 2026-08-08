from django.db import migrations
from django.db.models import Max


# Canonical barangay ID template: every field gets a rule so the test tool
# never shows an unvalidated "—" row — and the address/DOB match rules always
# reflect on the current draft.
# 0030 ran this once, but a later draft save (the builder sends document_types
# without rules) wiped these fields/rules via the same sync path. This migration
# re-ensures them idempotently for every non-archived residence_proof config.
MISSING_FIELDS = [
    {
        "code": "civil_status",
        "label": "Civil status",
        "data_type": "text",
        "required": False,
        "aliases": ["civil status"],
        "format": "none",
        "display_order": 6,
    },
    {
        "code": "issue_date",
        "label": "Date issued",
        "data_type": "date",
        "required": False,
        "aliases": ["date issued", "issued"],
        "format": "date_mdy",
        "display_order": 8,
    },
]

REQUIRED_RULES = [
    {
        "code": "document_number_required",
        "name": "Document number is present",
        "rule_type": "required",
        "operator": "exists",
        "value": {"field": "document_number", "fields": ["document_number"]},
    },
    {
        "code": "expiry_date_required",
        "name": "Expiry date is present",
        "rule_type": "required",
        "operator": "exists",
        "value": {"field": "expiry_date", "fields": ["expiry_date"]},
    },
    {
        "code": "expiry_date_not_expired",
        "name": "Expiry date is in the future",
        "rule_type": "not_expired",
        "operator": "not_expired",
        "value": {"field": "expiry_date"},
    },
    {
        "code": "place_of_birth_required",
        "name": "Place of birth is present",
        "rule_type": "required",
        "operator": "exists",
        "value": {"field": "place_of_birth", "fields": ["place_of_birth"]},
    },
    {
        "code": "barangay_civil_status_required",
        "name": "Civil status is present",
        "rule_type": "required",
        "operator": "exists",
        "value": {"field": "civil_status", "fields": ["civil_status"]},
    },
    {
        "code": "gender_match_gender",
        "name": "Gender matches the gender on file",
        "rule_type": "profile_match",
        "operator": "matches_profile",
        "value": {"field": "gender", "profile": "gender"},
    },
    {
        "code": "full_name_required",
        "name": "Full name is present",
        "rule_type": "required",
        "operator": "exists",
        "value": {"field": "full_name", "fields": ["full_name"]},
    },
    {
        "code": "full_name_match_first_name",
        "name": "Full name matches the first name on file",
        "rule_type": "profile_match",
        "operator": "matches_profile",
        "value": {"field": "full_name", "profile": "first_name"},
    },
    {
        "code": "full_name_match_last_name",
        "name": "Full name matches the last name on file",
        "rule_type": "profile_match",
        "operator": "matches_profile",
        "value": {"field": "full_name", "profile": "last_name"},
    },
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
    {
        "code": "barangay_issue_date_required",
        "name": "Date issued is present",
        "rule_type": "required",
        "operator": "exists",
        "value": {"field": "issue_date", "fields": ["issue_date"]},
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
                    "sides": ["front"],
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
            _, created = Rule.objects.get_or_create(
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
    codes = [spec["code"] for spec in REQUIRED_RULES if spec["code"].startswith("barangay_")]
    field_codes = [spec["code"] for spec in MISSING_FIELDS]
    live = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    Rule.objects.filter(configuration__in=live, code__in=codes).delete()
    Field.objects.filter(document_type__configuration__in=live, code__in=field_codes).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0030_ocr_ensure_field_rules")]
    operations = [migrations.RunPython(ensure_fields_and_rules, remove_rules_and_fields)]