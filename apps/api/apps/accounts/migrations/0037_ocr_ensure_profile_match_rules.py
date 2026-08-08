from django.db import migrations
from django.db.models import Max

# The Barangay doc (barangay_id) is missing date_of_birth and address profile-match
# rules, so the test tool shows a green "Passed" DOB row even when the extracted date
# does not match the profile date (no rule ever compared them).
#
# OCRRule.codes are unique per (configuration, code), and both the Barangay and the
# National docs own address/date_of_birth fields. So the Barangay doc must get its
# own uniquely-named rules bound to its own fields. This migration (re)creates, for
# every document type that owns a profile-mappable field, a profile_match rule whose
# code is derived from the field code plus a document-specific suffix to avoid the
# config-wide unique-code collisions.

RULE_TYPE = "profile_match"
RULE_OPERATOR = "matches_profile"

PROFILE_BY_FIELD = {
    "date_of_birth": "date_of_birth",
    "address": "address",
    "gender": "gender",
    "first_name": "first_name",
    "last_name": "last_name",
    "middle_name": "middle_name",
}

NAME_BY_FIELD = {
    "date_of_birth": "Date of birth matches the birth date on file",
    "address": "Address matches the address on file",
    "gender": "Gender matches the gender on file",
    "first_name": "First name matches the first name on file",
    "last_name": "Last name matches the last name on file",
    "middle_name": "Middle name matches the middle name on file",
}

# leftover duplicate rows that were bound to the National doc's fields; they only
# existed because the migration machinery rebound canonical codes to the wrong doc.
ORPHAN_CODES = {
    "barangay_address_match_address",
    "barangay_date_of_birth_match_dob",
}


def _rule_code(field_code: str, doc_code: str) -> str:
    return f"{field_code}_match_{doc_code}"


def ensure_profile_rules(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")

    configurations = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    for configuration in configurations:
        for document in DocumentType.objects.filter(configuration=configuration):
            doc_code = document.code or f"document_{document.id}"
            for field in Field.objects.filter(document_type=document):
                field_code = (field.code or "").lower()
                if field_code not in PROFILE_BY_FIELD:
                    continue
                code = _rule_code(field_code, doc_code)
                value = {"field": field_code, "profile": PROFILE_BY_FIELD[field_code]}
                existing = Rule.objects.filter(
                    configuration=configuration,
                    document_type=document,
                    field=field,
                    rule_type=RULE_TYPE,
                ).first()
                if existing is not None:
                    continue
                rule = Rule.objects.filter(
                    configuration=configuration,
                    document_type=document,
                    field=field,
                    code=code,
                ).first()
                if rule is None:
                    rule = Rule(
                        configuration=configuration,
                        document_type=document,
                        field=field,
                        code=code,
                        name=NAME_BY_FIELD[field_code],
                        display_order=(
                            Rule.objects.filter(
                                configuration=configuration,
                                document_type=document,
                            ).aggregate(max_order=Max("display_order"))["max_order"]
                            or 0
                        )
                        + 1,
                    )
                rule.rule_type = RULE_TYPE
                rule.operator = RULE_OPERATOR
                rule.value = value
                rule.on_failure = rule.on_failure or "manual_review"
                rule.enabled = True
                rule.save()

        Rule.objects.filter(
            configuration=configuration,
            code__in=ORPHAN_CODES,
        ).delete()


def reverse_rules(apps, schema_editor):
    Rule = apps.get_model("accounts", "OCRRule")
    Rule.objects.filter(code__endswith="_match_barangay_id").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0036_ocr_reattach_profile_match_rules")]
    operations = [migrations.RunPython(ensure_profile_rules, reverse_rules)]