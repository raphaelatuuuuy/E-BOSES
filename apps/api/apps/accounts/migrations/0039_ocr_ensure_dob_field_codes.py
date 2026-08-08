from django.db import migrations
from django.db.models import Max


# Some templates label the birth-date field as "Birth date", "DOB", "Date of Birth",
# etc. Their auto-generated code often differs from "date_of_birth" (e.g. "birthdate",
# "dob", "birth_date"). That mismatch breaks two things:
#   1. `_field_is_dob` in ocr_engine looks for canonical tokens in the code and label
#      to trigger DOB parseability rules at sign-up.
#   2. Migration 0037 only attaches a profile_match rule when the field code is
#      literally "date_of_birth" — so templates like Barangay ID silently skip the
#      DOB match check even after the admin toggled it.
#
# This migration is idempotent. For every non-archived residence_proof
# configuration, for every document type, it:
#   * Canonicalises any DOB-like field to code="date_of_birth", data_type="date".
#   * Then ensures a profile_match rule pointing to that field with
#     value={field: date_of_birth, profile: date_of_birth}.


DOB_TOKENS = ("dob", "birth", "birthday", "birthdate", "date_of_birth")


def _matches_dob(*fragments) -> bool:
    for fragment in fragments:
        text = str(fragment or "").lower()
        for token in DOB_TOKENS:
            if token in text:
                return True
    return False


def ensure_dob_fields(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")

    configurations = Configuration.objects.filter(scope="residence_proof").exclude(
        status="archived"
    )
    for configuration in configurations:
        for document in DocumentType.objects.filter(configuration=configuration):
            existing_codes = {
                f.code
                for f in Field.objects.filter(document_type=document).only("code")
            }
            for field in Field.objects.filter(document_type=document):
                if not _matches_dob(field.code, field.label):
                    continue

                # Canonicalise data_type so DOB parseability heuristic fires.
                changed = False
                if field.data_type != "date":
                    field.data_type = "date"
                    changed = True

                # Canonicalise code when the field is not already canonical AND
                # the canonical slot is free (avoid unique collisions).
                if field.code != "date_of_birth" and "date_of_birth" not in existing_codes:
                    existing_codes.discard(field.code)
                    field.code = "date_of_birth"
                    existing_codes.add(field.code)
                    changed = True

                if changed:
                    field.save(update_fields=["code", "data_type"])

                # If a profile_match rule already exists for this field, keep
                # it — it may have a distinct code from earlier migrations.
                existing_field_rule = Rule.objects.filter(
                    configuration=configuration,
                    document_type=document,
                    field=field,
                    rule_type="profile_match",
                ).first()
                if existing_field_rule is not None:
                    # Refresh value/operator in case the field code was
                    # canonicalised above; keep other attributes.
                    existing_field_rule.value = {
                        "field": field.code,
                        "profile": "date_of_birth",
                    }
                    existing_field_rule.operator = "matches_profile"
                    existing_field_rule.enabled = True
                    existing_field_rule.save(
                        update_fields=["value", "operator", "enabled"]
                    )
                    continue

                # Otherwise upsert on the actual unique key (configuration,
                # code). A stray rule with the same code might already exist
                # unbound (document_type=None) from prior migrations —
                # reassign it rather than colliding.
                rule_code = f"date_of_birth_match_{document.code or document.pk}"
                next_order = (
                    Rule.objects.filter(
                        configuration=configuration,
                        document_type=document,
                    ).aggregate(max_order=Max("display_order"))["max_order"]
                    or 0
                ) + 1
                Rule.objects.update_or_create(
                    configuration=configuration,
                    code=rule_code,
                    defaults={
                        "document_type": document,
                        "field": field,
                        "name": "Date of birth matches the birth date on file",
                        "rule_type": "profile_match",
                        "operator": "matches_profile",
                        "value": {
                            "field": field.code,
                            "profile": "date_of_birth",
                        },
                        "on_failure": "manual_review",
                        "enabled": True,
                        "display_order": next_order,
                    },
                )


def reverse_noop(apps, schema_editor):
    # Data-only migration; canonicalisation is not meaningfully reversible.
    pass


class Migration(migrations.Migration):
    dependencies = [("accounts", "0038_ocr_dedupe_profile_match_rules")]
    operations = [migrations.RunPython(ensure_dob_fields, reverse_noop)]
