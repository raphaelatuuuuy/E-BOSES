from django.db import migrations

# 0037 (original, already applied in this environment) created a document-suffixed
# profile_match rule for every profile-mappable field, which produced redundant copies
# beside pre-existing canonical rules (e.g. gender_match_barangay_id next to the existing
# gender_match_gender, and *_match_custom_document_* copies next to the National doc's
# canonical rules). This migration dedupes: for each group of profile_match rules sharing
# the same (configuration, document, field, value), it keeps the shortest/earliest
# (canonical) code and deletes the generated suffix duplicates.
#
# A revised 0037 in fresh databases no longer creates these duplicates, so this step is
# a no-op there; it only cleans the already-applied duplicates in this deployment.

from django.db.models import Count

RULE_TYPE = "profile_match"


def dedupe_profile_rules(apps, schema_editor):
    Rule = apps.get_model("accounts", "OCRRule")

    groups = (
        Rule.objects.filter(rule_type=RULE_TYPE)
        .values("configuration_id", "document_type_id", "field_id", "value")
        .annotate(cnt=Count("id"))
        .filter(cnt__gt=1)
    )
    for g in groups:
        rules = list(
            Rule.objects.filter(rule_type=RULE_TYPE).filter(
                configuration_id=g["configuration_id"],
                document_type_id=g["document_type_id"],
                field_id=g["field_id"],
                value=g["value"],
            )
        )
        # keep the canonical ("un-suffixed", shorter) code, drop the generated ones
        keep = min(rules, key=lambda r: len(r.code))
        for rule in rules:
            if rule.id != keep.id:
                rule.delete()


def reverse_dedupe(apps, schema_editor):
    return


class Migration(migrations.Migration):
    dependencies = [("accounts", "0037_ocr_ensure_profile_match_rules")]
    operations = [migrations.RunPython(dedupe_profile_rules, reverse_dedupe)]