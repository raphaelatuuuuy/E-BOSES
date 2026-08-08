from django.db import migrations
from django.db.models import Max


# Field-level rules that were missing from the barangay ID template, leaving
# Address / Date of birth / Date issued rows unvalidated ("—" in the test tool).
# Codes are prefixed with "barangay_" because OCRRule codes are unique per
# configuration, and operators may have created rules with the base codes for
# their custom documents.
ADD_RULES = [
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


def add_missing_field_rules(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")

    configurations = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    for configuration in configurations:
        document = DocumentType.objects.filter(configuration=configuration, code="barangay_id").first()
        if not document:
            continue

        for spec in ADD_RULES:
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


def remove_missing_field_rules(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    Rule = apps.get_model("accounts", "OCRRule")
    codes = [spec["code"] for spec in ADD_RULES]
    Rule.objects.filter(
        configuration__scope="residence_proof",
        code__in=codes,
    ).exclude(configuration__status="archived").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0028_ocr_test_run_metadata")]
    operations = [migrations.RunPython(add_missing_field_rules, remove_missing_field_rules)]