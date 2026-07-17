from django.db import migrations
from django.utils import timezone


SCOPE = "residence_proof"


SETTINGS = {
    "confidence_threshold": 0.80,
    "name_similarity_threshold": 0.85,
    "address_similarity_threshold": 0.80,
    "recency_days": 90,
    "manual_review_on_low_confidence": True,
    "manual_review_on_missing_fields": True,
    "manual_review_on_rule_mismatch": True,
    "auto_approve_on_all_required_pass": True,
    "failure_action": "manual_review",
}


DOCUMENTS = [
    {
        "code": "barangay_id",
        "name": "Barangay ID",
        "description": "Barangay-issued resident identification card.",
        "category": "identity",
        "requires_front": True,
        "requires_back": True,
        "allowed_sides": ["front", "back"],
        "max_files": 2,
        "keywords": ["barangay", "resident", "identification", "id"],
        "aliases": ["barangay identification card", "resident id"],
        "fields": [
            {"code": "full_name", "label": "Full name", "data_type": "name", "required": True, "aliases": ["last name first name middle name", "name"], "sides": ["front"]},
            {"code": "address", "label": "Address", "data_type": "address", "required": True, "aliases": ["address"], "sides": ["front", "back"]},
            {"code": "date_of_birth", "label": "Date of birth", "data_type": "date", "required": True, "aliases": ["birthdate", "birth date", "date of birth"], "format": "date_mdy", "sides": ["front"]},
            {"code": "place_of_birth", "label": "Place of birth", "data_type": "text", "required": False, "aliases": ["place of birth"], "sides": ["front"]},
            {"code": "civil_status", "label": "Civil status", "data_type": "text", "required": False, "aliases": ["civil status"], "sides": ["front"]},
            {"code": "gender", "label": "Gender", "data_type": "text", "required": False, "aliases": ["gender", "sex"], "sides": ["front"]},
            {"code": "issue_date", "label": "Date issued", "data_type": "date", "required": False, "aliases": ["date issued", "issued"], "format": "date_mdy", "sides": ["front"]},
            {"code": "document_number", "label": "ID number", "data_type": "identifier", "required": False, "aliases": ["id no", "id number", "identification no"], "format": "alphanumeric", "sides": ["front"]},
            {"code": "expiry_date", "label": "Valid until", "data_type": "date", "required": False, "aliases": ["valid until", "expiry date", "expiration date"], "format": "date_mdy", "sides": ["front", "back"]},
        ],
        "rules": [
            ("barangay_id_required", "Required fields", "required", "exists", {"fields": ["full_name", "address", "date_of_birth"]}),
            ("barangay_id_name_match", "Name matches resident profile", "profile_match", "matches_profile", {"field": "full_name", "profile": "name"}, 0.85),
            ("barangay_id_address_match", "Address matches resident profile", "profile_match", "matches_profile", {"field": "address", "profile": "address"}, 0.80),
            ("barangay_id_not_expired", "ID is not expired", "not_expired", "not_expired", {"field": "expiry_date"}),
        ],
    },
    {
        "code": "government_id_with_address",
        "name": "Government ID with Address",
        "description": "Government-issued identification card showing the resident's address.",
        "category": "identity",
        "requires_front": True,
        "requires_back": False,
        "allowed_sides": ["front", "back"],
        "max_files": 2,
        "keywords": ["republic", "philippines", "identification", "id"],
        "aliases": ["national id", "philsys", "driver's license", "government identification"],
        "fields": [
            {"code": "full_name", "label": "Full name", "data_type": "name", "required": True, "sides": ["front", "back"]},
            {"code": "address", "label": "Address", "data_type": "address", "required": True, "sides": ["front", "back"]},
            {"code": "date_of_birth", "label": "Date of birth", "data_type": "date", "required": False, "format": "date_mdy", "sides": ["front", "back"]},
            {"code": "document_number", "label": "Document number", "data_type": "identifier", "required": False, "format": "alphanumeric", "sides": ["front", "back"]},
            {"code": "expiry_date", "label": "Expiry date", "data_type": "date", "required": False, "format": "date_mdy", "sides": ["front", "back"]},
        ],
        "rules": [
            ("government_id_required", "Required fields", "required", "exists", {"fields": ["full_name", "address"]}),
            ("government_id_name_match", "Name matches resident profile", "profile_match", "matches_profile", {"field": "full_name", "profile": "name"}, 0.85),
            ("government_id_address_match", "Address matches resident profile", "profile_match", "matches_profile", {"field": "address", "profile": "address"}, 0.80),
            ("government_id_not_expired", "ID is not expired", "not_expired", "not_expired", {"field": "expiry_date"}),
        ],
    },
    {
        "code": "barangay_certificate",
        "name": "Barangay Certificate",
        "description": "Certificate of residency issued by the barangay.",
        "category": "certificate",
        "allowed_sides": ["single"],
        "max_files": 1,
        "keywords": ["barangay", "certificate", "residency", "residence"],
        "aliases": ["certificate of residency", "barangay clearance"],
        "fields": [
            {"code": "full_name", "label": "Resident name", "data_type": "name", "required": True},
            {"code": "address", "label": "Address", "data_type": "address", "required": True},
            {"code": "issue_date", "label": "Issue date", "data_type": "date", "required": True, "format": "date_mdy"},
        ],
        "rules": [
            ("certificate_required", "Required fields", "required", "exists", {"fields": ["full_name", "address", "issue_date"]}),
            ("certificate_name_match", "Name matches resident profile", "profile_match", "matches_profile", {"field": "full_name", "profile": "name"}, 0.85),
            ("certificate_address_match", "Address matches resident profile", "profile_match", "matches_profile", {"field": "address", "profile": "address"}, 0.80),
            ("certificate_recent", "Certificate issued within 90 days", "recency", "within_days", {"field": "issue_date", "days": 90}),
        ],
    },
    {
        "code": "electricity_bill",
        "name": "Electricity Bill",
        "description": "Recent electricity bill showing the service address.",
        "category": "utility",
        "allowed_sides": ["single"],
        "max_files": 1,
        "keywords": ["electric bill", "electricity", "account number", "service address"],
        "provider_names": ["meralco"],
        "aliases": ["meralco bill", "power bill"],
        "fields": [
            {"code": "account_name", "label": "Account name", "data_type": "name", "required": True},
            {"code": "billing_address", "label": "Billing address", "data_type": "address", "required": True},
            {"code": "bill_date", "label": "Bill date", "data_type": "date", "required": True, "format": "date_mdy"},
            {"code": "account_number", "label": "Account number", "data_type": "identifier", "required": False, "format": "alphanumeric"},
            {"code": "provider_name", "label": "Provider", "data_type": "text", "required": False},
        ],
        "rules": [
            ("electric_bill_required", "Required fields", "required", "exists", {"fields": ["account_name", "billing_address", "bill_date"]}),
            ("electric_bill_name_match", "Account name matches resident profile", "profile_match", "matches_profile", {"field": "account_name", "profile": "name"}, 0.85),
            ("electric_bill_address_match", "Billing address matches resident profile", "profile_match", "matches_profile", {"field": "billing_address", "profile": "address"}, 0.80),
            ("electric_bill_recent", "Bill issued within 90 days", "recency", "within_days", {"field": "bill_date", "days": 90}),
            ("electric_bill_provider", "Provider is on the allowed list", "allowed_value", "one_of", {"field": "provider_name", "values": ["meralco"]}),
        ],
    },
    {
        "code": "water_bill",
        "name": "Water Bill",
        "description": "Recent water utility bill showing the service address.",
        "category": "utility",
        "allowed_sides": ["single"],
        "max_files": 1,
        "keywords": ["water bill", "account number", "service address"],
        "provider_names": ["manila water", "maynilad"],
        "aliases": ["manila water bill", "maynilad bill"],
        "fields": [
            {"code": "account_name", "label": "Account name", "data_type": "name", "required": True},
            {"code": "billing_address", "label": "Billing address", "data_type": "address", "required": True},
            {"code": "bill_date", "label": "Bill date", "data_type": "date", "required": True, "format": "date_mdy"},
            {"code": "account_number", "label": "Account number", "data_type": "identifier", "required": False, "format": "alphanumeric"},
            {"code": "provider_name", "label": "Provider", "data_type": "text", "required": False},
        ],
        "rules": [
            ("water_bill_required", "Required fields", "required", "exists", {"fields": ["account_name", "billing_address", "bill_date"]}),
            ("water_bill_name_match", "Account name matches resident profile", "profile_match", "matches_profile", {"field": "account_name", "profile": "name"}, 0.85),
            ("water_bill_address_match", "Billing address matches resident profile", "profile_match", "matches_profile", {"field": "billing_address", "profile": "address"}, 0.80),
            ("water_bill_recent", "Bill issued within 90 days", "recency", "within_days", {"field": "bill_date", "days": 90}),
            ("water_bill_provider", "Provider is on the allowed list", "allowed_value", "one_of", {"field": "provider_name", "values": ["manila water", "maynilad"]}),
        ],
    },
    {
        "code": "internet_or_telecom_bill",
        "name": "Internet or Telecom Bill",
        "description": "Recent internet or telephone bill showing the service address.",
        "category": "utility",
        "allowed_sides": ["single"],
        "max_files": 1,
        "keywords": ["internet", "telephone", "account number", "service address"],
        "provider_names": ["pldt", "globe", "converge", "smart"],
        "aliases": ["internet bill", "telephone bill", "telecom bill"],
        "fields": [
            {"code": "account_name", "label": "Account name", "data_type": "name", "required": True},
            {"code": "billing_address", "label": "Billing address", "data_type": "address", "required": True},
            {"code": "bill_date", "label": "Bill date", "data_type": "date", "required": True, "format": "date_mdy"},
            {"code": "account_number", "label": "Account number", "data_type": "identifier", "required": False, "format": "alphanumeric"},
            {"code": "provider_name", "label": "Provider", "data_type": "text", "required": False},
        ],
        "rules": [
            ("telecom_bill_required", "Required fields", "required", "exists", {"fields": ["account_name", "billing_address", "bill_date"]}),
            ("telecom_bill_name_match", "Account name matches resident profile", "profile_match", "matches_profile", {"field": "account_name", "profile": "name"}, 0.85),
            ("telecom_bill_address_match", "Billing address matches resident profile", "profile_match", "matches_profile", {"field": "billing_address", "profile": "address"}, 0.80),
            ("telecom_bill_recent", "Bill issued within 90 days", "recency", "within_days", {"field": "bill_date", "days": 90}),
            ("telecom_bill_provider", "Provider is on the allowed list", "allowed_value", "one_of", {"field": "provider_name", "values": ["pldt", "globe", "converge", "smart"]}),
        ],
    },
    {
        "code": "lease_agreement",
        "name": "Lease Agreement",
        "description": "Signed lease or rental agreement containing the residence address.",
        "category": "agreement",
        "allowed_sides": ["single", "front", "back"],
        "max_files": 2,
        "keywords": ["lease", "rental", "agreement", "address"],
        "aliases": ["rental agreement", "lease contract"],
        "fields": [
            {"code": "full_name", "label": "Resident name", "data_type": "name", "required": True},
            {"code": "address", "label": "Address", "data_type": "address", "required": True},
            {"code": "issue_date", "label": "Issue date", "data_type": "date", "required": False, "format": "date_mdy"},
            {"code": "expiry_date", "label": "Expiry date", "data_type": "date", "required": False, "format": "date_mdy"},
        ],
        "rules": [
            ("lease_required", "Required fields", "required", "exists", {"fields": ["full_name", "address"]}),
            ("lease_name_match", "Tenant name matches resident profile", "profile_match", "matches_profile", {"field": "full_name", "profile": "name"}, 0.85),
            ("lease_address_match", "Lease address matches resident profile", "profile_match", "matches_profile", {"field": "address", "profile": "address"}, 0.80),
            ("lease_not_expired", "Lease is not expired", "not_expired", "not_expired", {"field": "expiry_date"}),
        ],
    },
]


def _copy_bundle(apps, source, target):
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")
    for source_doc in DocumentType.objects.filter(configuration=source).order_by("display_order", "pk"):
        target_doc = DocumentType.objects.create(
            configuration=target,
            code=source_doc.code,
            name=source_doc.name,
            description=source_doc.description,
            category=source_doc.category,
            enabled=source_doc.enabled,
            requires_front=source_doc.requires_front,
            requires_back=source_doc.requires_back,
            allowed_sides=source_doc.allowed_sides,
            accepted_mime_types=source_doc.accepted_mime_types,
            max_files=source_doc.max_files,
            keywords=source_doc.keywords,
            provider_names=source_doc.provider_names,
            aliases=source_doc.aliases,
            display_order=source_doc.display_order,
        )
        fields = Field.objects.filter(document_type=source_doc).order_by("display_order", "pk")
        field_map = {}
        for source_field in fields:
            target_field = Field.objects.create(
                document_type=target_doc,
                code=source_field.code,
                label=source_field.label,
                data_type=source_field.data_type,
                required=source_field.required,
                enabled=source_field.enabled,
                sides=source_field.sides,
                aliases=source_field.aliases,
                extraction_hints=source_field.extraction_hints,
                normalization=source_field.normalization,
                format=source_field.format,
                min_confidence=source_field.min_confidence,
                display_order=source_field.display_order,
            )
            field_map[source_field.pk] = target_field
        for source_rule in Rule.objects.filter(configuration=source, document_type=source_doc).order_by("display_order", "pk"):
            Rule.objects.create(
                configuration=target,
                document_type=target_doc,
                field=field_map.get(source_rule.field_id),
                code=source_rule.code,
                name=source_rule.name,
                rule_type=source_rule.rule_type,
                operator=source_rule.operator,
                value=source_rule.value,
                threshold=source_rule.threshold,
                on_failure=source_rule.on_failure,
                enabled=source_rule.enabled,
                display_order=source_rule.display_order,
            )


def seed_defaults(apps, schema_editor):
    Configuration = apps.get_model("accounts", "OCRConfigurationVersion")
    DocumentType = apps.get_model("accounts", "OCRDocumentType")
    Field = apps.get_model("accounts", "OCRFieldDefinition")
    Rule = apps.get_model("accounts", "OCRRule")
    ServiceStatus = apps.get_model("accounts", "OCRServiceStatus")

    if Configuration.objects.filter(scope=SCOPE, status="published").exists():
        ServiceStatus.objects.get_or_create(provider="paddleocr")
        return

    published = Configuration.objects.create(
        scope=SCOPE,
        version=1,
        status="published",
        revision=1,
        settings=SETTINGS,
        notes="System default proof-of-residency OCR policy.",
        published_at=timezone.now(),
    )
    for display_order, document in enumerate(DOCUMENTS):
        doc = DocumentType.objects.create(
            configuration=published,
            code=document["code"],
            name=document["name"],
            description=document["description"],
            category=document["category"],
            requires_front=document.get("requires_front", False),
            requires_back=document.get("requires_back", False),
            allowed_sides=document.get("allowed_sides", ["single"]),
            accepted_mime_types=["image/jpeg", "image/png"],
            max_files=document.get("max_files", 1),
            keywords=document.get("keywords", []),
            provider_names=document.get("provider_names", []),
            aliases=document.get("aliases", []),
            display_order=display_order,
        )
        field_map = {}
        for field_order, field in enumerate(document["fields"]):
            field_map[field["code"]] = Field.objects.create(
                document_type=doc,
                code=field["code"],
                label=field["label"],
                data_type=field["data_type"],
                required=field.get("required", False),
                sides=field.get("sides", document.get("allowed_sides", ["single"])),
                aliases=field.get("aliases", []),
                extraction_hints=field.get("extraction_hints", {}),
                normalization=field.get("normalization", "none"),
                format=field.get("format", "none"),
                min_confidence=field.get("min_confidence", 0.8),
                display_order=field_order,
            )
        for rule_order, rule in enumerate(document["rules"]):
            code, name, rule_type, operator, value, *threshold = rule
            Rule.objects.create(
                configuration=published,
                document_type=doc,
                field=field_map.get(value.get("field")) if isinstance(value, dict) else None,
                code=code,
                name=name,
                rule_type=rule_type,
                operator=operator,
                value=value,
                threshold=threshold[0] if threshold else None,
                display_order=rule_order,
            )

    draft = Configuration.objects.create(
        scope=SCOPE,
        version=2,
        status="draft",
        revision=1,
        based_on=published,
        settings=SETTINGS,
        notes="Editable draft copied from the system default policy.",
    )
    _copy_bundle(apps, published, draft)
    ServiceStatus.objects.get_or_create(provider="paddleocr")


def unseed_defaults(apps, schema_editor):
    # Default records are intentionally retained on rollback to avoid deleting
    # an official's configuration when an unrelated migration is reversed.
    pass


class Migration(migrations.Migration):
    dependencies = [("accounts", "0015_ocrservicestatus_alter_verificationcheck_options_and_more")]

    operations = [migrations.RunPython(seed_defaults, unseed_defaults)]
