from django.db import migrations
from django.db.models import Max

# Draft/published saves have occasionally re-bound the canonical profile-match rules
# (date_of_birth / address / gender / first_name / last_name / middle_name) to the wrong
# document type (e.g. the custom National ID doc instead of Barangay). That leaves the
# test tool with a green "Passed" DOB row because no rule actually compared the dates.
# This migration rebinds or (re)creates the canonical profile-match rules on the document
# type that owns the matching field, and weaves in the missing ones idempotently.

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


def _rule_code(field_code: str) -> str:
    return f"{field_code}_match_{PROFILE_BY_FIELD[field_code]}"


def reattach_profile_rules(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")

    configurations = Configuration.objects.filter(scope="residence_proof").exclude(status="archived")
    for configuration in configurations:
        for document in DocumentType.objects.filter(configuration=configuration):
            for field in Field.objects.filter(document_type=document):
                field_code = (field.code or "").lower()
                if field_code not in PROFILE_BY_FIELD:
                    continue
                value = _rule_field_value(field_code)
                code = _rule_code(field_code)

                # 1) Rebind a same-code rule that drifted to another document in
                #    this config back onto the field owner.
                stale = (
                    Rule.objects.filter(
                        configuration=configuration,
                        code=code,
                        value=value,
                    )
                    .exclude(document_type=document)
                    .exclude(field=field)
                    .first()
                )
                if stale is not None:
                    stale.document_type = document
                    stale.field = field
                    stale.rule_type = RULE_TYPE
                    stale.operator = RULE_OPERATOR
                    stale.on_failure = "manual_review" if not stale.on_failure else stale.on_failure
                    stale.enabled = True
                    stale.save()

                current = (
                    Rule.objects.filter(
                        configuration=configuration,
                        document_type=document,
                        field=field,
                        code=code,
                        rule_type=RULE_TYPE,
                        operator=RULE_OPERATOR,
                    ).first()
                )
                if current is None:
                    max_order = (
                        Rule.objects.filter(
                            configuration=configuration,
                            document_type=document,
                        ).aggregate(max_order=Max("display_order"))["max_order"]
                        or 0
                    )
                    Rule.objects.create(
                        configuration=configuration,
                        document_type=document,
                        field=field,
                        code=code,
                        name=NAME_BY_FIELD[field_code],
                        rule_type=RULE_TYPE,
                        operator=RULE_OPERATOR,
                        value=value,
                        on_failure="manual_review",
                        enabled=True,
                        display_order=max_order + 1,
                    )


def reverse_rules(apps, schema_editor):
    Rule = apps.get_model("accounts", "OCRRule")
    for field_code in PROFILE_BY_FIELD:
        Rule.objects.filter(code=_rule_code(field_code)).delete()


def _rule_field_value(field_code: str) -> dict:
    return {"field": field_code, "profile": PROFILE_BY_FIELD[field_code]}


class Migration(migrations.Migration):
    dependencies = [("accounts", "0035_fix_national_digital_number_labels")]
    operations = [migrations.RunPython(reattach_profile_rules, reverse_rules)]