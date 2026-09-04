"""HTTP API for configurable proof-of-residency OCR and review."""

from __future__ import annotations

import re
from copy import deepcopy

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.capabilities import MANAGE_USERS, user_has_capability

from .models import (
    OCRConfigurationVersion,
    OCRDocumentType,
    OCRFieldDefinition,
    OCRRule,
    OCRSample,
    OCRServiceStatus,
    OCRTestRun,
    AuditLog,
    ResidenceVerificationCase,
    User,
    VerificationCheck,
)
from .ocr_runtime import (
    decide_case,
    draft_configuration,
    document_type_for_registration,
    published_configuration,
    official_service_status,
    process_test_run,
    retry_case,
    run_official_health_canary,
)
from .services import create_audit_log, validate_uploaded_media_file
from .permissions import user_has_role_permission


SAFE_SETTINGS = {
    "confidence_threshold": (float, 0.0, 1.0),
    "name_similarity_threshold": (float, 0.0, 1.0),
    "address_similarity_threshold": (float, 0.0, 1.0),
    "recency_days": (int, 1, 3650),
    "manual_review_on_low_confidence": (bool, None, None),
    "manual_review_on_missing_fields": (bool, None, None),
    "manual_review_on_rule_mismatch": (bool, None, None),
    "auto_approve_on_all_required_pass": (bool, None, None),
    "failure_action": (str, {"manual_review", "reject", "request_resubmission"}, None),
    # The picture check itself is not configurable — only how sure the model
    # has to be before its opinion counts against a resident.
    "id_integrity_min_confidence": (float, 0.0, 1.0),
}
# Keys the builder used to send. The picture check is no longer optional, so a
# value for these decides nothing — but a published configuration or a browser
# tab left open from before the change still carries them, and rejecting the
# whole PATCH over a setting that no longer exists breaks every unrelated edit
# on that screen. Accept and drop.
RETIRED_SETTINGS = frozenset({"id_integrity_enabled", "id_integrity_compare_sample"})

SAFE_CODE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


def _delete_replaced_file(storage, old_name, new_name):
    """Remove the previous blob when an upload replaces another, best effort."""
    if not old_name or old_name == new_name:
        return
    try:
        storage.delete(old_name)
    except Exception:
        pass


def _official(request):
    user = request.user
    return bool(
        user
        and user.is_authenticated
        and user.is_active
        and (
            user.is_superuser
            or (
                user.role == user.Role.BARANGAY_OFFICIAL
                and
                user_has_role_permission(user, "accounts.verify_residents")
                and user_has_capability(user, MANAGE_USERS)
            )
        )
    )


def _official_community(request):
    from apps.community_scope import selected_community

    requested = request.data.get("community_id") if hasattr(request, "data") else None
    requested = requested or request.query_params.get("community_id")
    return selected_community(request.user, requested)


def _normalize_extraction_hints(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    hints = {}
    if "labels" in raw:
        hints["labels"] = [str(item).strip() for item in (raw.get("labels") or []) if str(item).strip()][:16]
    if "expected_keywords" in raw:
        hints["expected_keywords"] = [
            str(item).strip() for item in (raw.get("expected_keywords") or []) if str(item).strip()
        ][:16]
    region = raw.get("region")
    if isinstance(region, dict):
        try:
            x = max(0.0, min(1.0, float(region.get("x", 0))))
            y = max(0.0, min(1.0, float(region.get("y", 0))))
            w = max(0.0, min(1.0, float(region.get("w", 0))))
            h = max(0.0, min(1.0, float(region.get("h", 0))))
            hints["region"] = {"x": x, "y": y, "w": w, "h": h}
        except (TypeError, ValueError):
            pass
    if "multi_line" in raw:
        hints["multi_line"] = bool(raw["multi_line"])
    if "auto_correct" in raw:
        hints["auto_correct"] = bool(raw["auto_correct"])
    if "remove_special_chars" in raw:
        hints["remove_special_chars"] = bool(raw["remove_special_chars"])
    pattern = str(raw.get("regex_pattern") or "").strip()
    if pattern:
        hints["regex_pattern"] = pattern[:120]
    failure_message = str(raw.get("failure_message") or "").strip()
    if failure_message:
        hints["failure_message"] = failure_message[:160]
    case_mode = str(raw.get("case_normalization") or "").strip().lower()
    if case_mode in {"none", "uppercase", "lowercase", "name", "title", "upper", "lower"}:
        hints["case_normalization"] = case_mode
    # Persist which sample side this field’s region belongs to (front / back / single).
    side = str(raw.get("side") or "").strip().lower()
    if side in {"front", "back", "single"}:
        hints["side"] = side
    return hints


def _field_payload(field):
    return {
        "id": field.pk,
        "code": field.code,
        "label": field.label,
        "data_type": field.data_type,
        "required": field.required,
        "enabled": field.enabled,
        "sides": field.sides or [],
        "aliases": field.aliases or [],
        "extraction_hints": field.extraction_hints or {},
        "normalization": field.normalization,
        "format": field.format,
        "min_confidence": float(field.min_confidence),
        "display_order": field.display_order,
    }


def _rule_payload(rule):
    return {
        "id": rule.pk,
        "code": rule.code,
        "name": rule.name,
        "document_type_id": rule.document_type_id,
        "field_id": rule.field_id,
        "rule_type": rule.rule_type,
        "operator": rule.operator,
        "value": rule.value or {},
        "threshold": float(rule.threshold) if rule.threshold is not None else None,
        "on_failure": rule.on_failure,
        "enabled": rule.enabled,
        "display_order": rule.display_order,
    }


def _sample_side_label(side: str) -> str:
    side = (side or "single").lower()
    if side == "front":
        return "Front"
    if side == "back":
        return "Back"
    return "Single"


def _document_samples_payload(document_type):
    """List per-side samples (front/back/single) for the template builder canvas."""
    samples = []
    seen_sides = set()
    for sample in document_type.samples.filter(is_active=True).order_by("name", "id"):
        side = (sample.name or "single").lower()
        if side not in {"front", "back", "single"}:
            side = "single"
        if side in seen_sides:
            continue
        if not sample.file:
            continue
        seen_sides.add(side)
        samples.append(
            {
                "side": side,
                "label": _sample_side_label(side),
                "url": f"/api/auth/ocr/document-types/{document_type.code}/sample/?side={side}",
                "filename": sample.original_filename or sample.name or "",
            }
        )
    # Legacy single sample_file as front/single fallback
    if getattr(document_type, "sample_file", None) and document_type.sample_file:
        legacy_side = "front" if "front" in (document_type.allowed_sides or []) else "single"
        if "back" in (document_type.allowed_sides or []) and "front" in (document_type.allowed_sides or []):
            legacy_side = "front"
        if legacy_side not in seen_sides:
            samples.insert(
                0,
                {
                    "side": legacy_side,
                    "label": _sample_side_label(legacy_side),
                    "url": f"/api/auth/ocr/document-types/{document_type.code}/sample/?side={legacy_side}",
                    "filename": getattr(document_type, "sample_original_filename", None) or "",
                },
            )
    # Stable order: front, back, single
    order = {"front": 0, "back": 1, "single": 2}
    samples.sort(key=lambda item: order.get(item["side"], 9))
    return samples


def _document_payload(document_type):
    samples = _document_samples_payload(document_type)
    sample_url = samples[0]["url"] if samples else None
    if not sample_url and getattr(document_type, "sample_file", None) and document_type.sample_file:
        sample_url = f"/api/auth/ocr/document-types/{document_type.code}/sample/"
    sample_filename = ""
    if samples:
        sample_filename = samples[0].get("filename") or ""
    if not sample_filename:
        sample_filename = getattr(document_type, "sample_original_filename", None) or ""
    return {
        "id": document_type.pk,
        "code": document_type.code,
        "name": document_type.name,
        "description": document_type.description,
        "category": document_type.category,
        "enabled": document_type.enabled,
        "requires_front": document_type.requires_front,
        "requires_back": document_type.requires_back,
        "allowed_sides": document_type.allowed_sides or [],
        "accepted_mime_types": document_type.accepted_mime_types or [],
        "max_files": document_type.max_files,
        "keywords": document_type.keywords or [],
        "provider_names": document_type.provider_names or [],
        "aliases": document_type.aliases or [],
        "display_order": document_type.display_order,
        # Whether the picture check has a reference to compare submissions
        # against. Read from the same rows the pipeline reads, so a blank here
        # means the pipeline really does get nothing — the config screen is
        # reporting live state, not a label somebody typed.
        "has_reference_sample": bool(samples) or bool(getattr(document_type, "sample_file", None)),
        "template_name": getattr(document_type, "template_name", None) or document_type.name,
        "template_version": getattr(document_type, "template_version", None) or "v1.0",
        "expected_title": getattr(document_type, "expected_title", None) or "",
        "min_ocr_confidence": float(getattr(document_type, "min_ocr_confidence", None) or 0.9),
        "accept_rotated": bool(getattr(document_type, "accept_rotated", True)),
        "accept_scanned_pdf": bool(getattr(document_type, "accept_scanned_pdf", True)),
        "sample_url": sample_url,
        "sample_original_filename": sample_filename,
        "samples": samples,
        "template_settings": getattr(document_type, "template_settings", None) or {},
        "fields": [_field_payload(field) for field in document_type.fields.all().order_by("display_order", "id")],
    }


def _configuration_payload(configuration):
    if configuration is None:
        return None
    rules = list(configuration.rules.all().order_by("display_order", "id"))
    return {
        "id": configuration.pk,
        "scope": configuration.scope,
        "version": configuration.version,
        "status": configuration.status,
        "revision": configuration.revision,
        "settings": configuration.settings or {},
        "notes": configuration.notes,
        "published_at": configuration.published_at,
        "updated_at": configuration.updated_at,
        "document_types": [_document_payload(item) for item in configuration.document_types.all().order_by("display_order", "id")],
        "rules": [_rule_payload(item) for item in rules],
    }


def _attempt_payload(attempt):
    return {
        "id": attempt.pk,
        "status": attempt.status,
        "trigger": attempt.trigger,
        "attempt_number": attempt.attempt_number,
        "failure_reason_code": attempt.failure_reason_code,
        "failure_reason": attempt.failure_reason,
        "ocr_confidence": float(attempt.ocr_confidence) if attempt.ocr_confidence is not None else None,
        "duplicate_match_found": attempt.duplicate_match_found,
        "duplicate_identity_matches": (attempt.metadata or {}).get("duplicate_identity_matches", []),
        "extracted_fields": attempt.extracted_fields or {},
        "rule_results": attempt.rule_results or [],
        "created_at": attempt.created_at,
        "completed_at": attempt.completed_at,
    }


def _case_payload(case, *, include_proofs=True):
    latest_attempt = case.checks.order_by("-created_at", "-id").first()
    profile = getattr(case.user, "resident_profile", None)
    full_name = " ".join(
        part for part in [
            getattr(profile, "first_name", ""),
            getattr(profile, "middle_name", ""),
            getattr(profile, "last_name", ""),
        ] if part
    )
    payload = {
        "id": case.pk,
        "reference": f"VER-{case.pk:06d}",
        "user_id": case.user_id,
        "resident": {
            "id": case.user_id,
            "full_name": full_name or case.user.email,
            "email": case.user.email,
            "phone_number": case.user.phone_number,
            "address": getattr(profile, "address", ""),
            "date_of_birth": getattr(profile, "date_of_birth", None),
        },
        "status": case.status,
        "reason_code": case.review_reason,
        "reason": case.decision_reason,
        "review_reason": case.review_reason,
        "priority": case.priority,
        "retry_eligible": case.retry_eligible,
        "can_retry": case.retry_eligible,
        "decision_source": case.decision_source,
        "decision_reason": case.decision_reason,
        "configuration_version": case.configuration.version if case.configuration_id else None,
        "document_type": _document_payload(case.document_type) if case.document_type_id else None,
        "revision": case.revision,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
        "queued_at": case.queued_at,
        "completed_at": case.completed_at,
        "latest_attempt": _attempt_payload(latest_attempt) if latest_attempt else None,
        "confidence": (
            float(latest_attempt.ocr_confidence)
            if latest_attempt and latest_attempt.ocr_confidence is not None
            else None
        ),
        "extracted_fields": latest_attempt.extracted_fields if latest_attempt else {},
        "rule_results": latest_attempt.rule_results if latest_attempt else [],
        "attempts": [_attempt_payload(item) for item in case.checks.order_by("-created_at", "-id")[:20]],
    }
    if include_proofs:
        payload["proofs"] = [
            {
                "id": proof.pk,
                "filename": proof.original_filename,
                "original_filename": proof.original_filename,
                "mime_type": proof.mime_type,
                "file_size": proof.file_size,
                "side": proof.side,
                "uploaded_at": proof.uploaded_at,
                "raw_url": f"/api/auth/media/residence-proofs/{proof.pk}/raw/",
                "preview_url": f"/api/auth/media/residence-proofs/{proof.pk}/preview/",
            }
            for proof in case.proofs.order_by("side", "id")
        ]
    return payload


def _validate_settings(settings):
    if not isinstance(settings, dict):
        raise ValidationError({"settings": ["Settings must be an object."]})
    result = {}
    for key, value in settings.items():
        if key in RETIRED_SETTINGS:
            continue
        if key not in SAFE_SETTINGS:
            raise ValidationError({"settings": [f"Unsupported setting: {key}."]})
        expected, lower, upper = SAFE_SETTINGS[key]
        if expected is str:
            if not isinstance(value, str) or value not in lower:
                raise ValidationError({"settings": [f"{key} has an unsupported option."]})
        elif expected is bool:
            if not isinstance(value, bool):
                raise ValidationError({"settings": [f"{key} must be boolean."]})
        elif expected is int:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValidationError({"settings": [f"{key} must be an integer."]})
            if not lower <= value <= upper:
                raise ValidationError({"settings": [f"{key} is outside its allowed range."]})
        else:
            try:
                value = float(value)
            except (TypeError, ValueError):
                raise ValidationError({"settings": [f"{key} must be numeric."]})
            if not lower <= value <= upper:
                raise ValidationError({"settings": [f"{key} is outside its allowed range."]})
        result[key] = value
    return result


def _safe_list(value, *, label, max_items=64):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > max_items or not all(isinstance(item, str) for item in value):
        raise ValidationError({label: ["Use a short list of text values."]})
    return [item.strip() for item in value if item.strip()]


@transaction.atomic
def _clone_configuration(source, *, version, status, based_on=None):
    target = OCRConfigurationVersion.objects.create(
        community=source.community,
        scope=source.scope,
        version=version,
        status=status,
        revision=1,
        based_on=based_on or source,
        settings=deepcopy(source.settings or {}),
        notes=source.notes,
    )
    field_map = {}
    for source_doc in source.document_types.all().order_by("display_order", "id"):
        target_doc = OCRDocumentType.objects.create(
            configuration=target,
            code=source_doc.code,
            name=source_doc.name,
            description=source_doc.description,
            category=source_doc.category,
            enabled=source_doc.enabled,
            requires_front=source_doc.requires_front,
            requires_back=source_doc.requires_back,
            allowed_sides=deepcopy(source_doc.allowed_sides or []),
            accepted_mime_types=deepcopy(source_doc.accepted_mime_types or []),
            max_files=source_doc.max_files,
            keywords=deepcopy(source_doc.keywords or []),
            provider_names=deepcopy(source_doc.provider_names or []),
            aliases=deepcopy(source_doc.aliases or []),
            display_order=source_doc.display_order,
            template_name=getattr(source_doc, "template_name", "") or source_doc.name,
            template_version=getattr(source_doc, "template_version", None) or "v1.0",
            expected_title=getattr(source_doc, "expected_title", "") or "",
            min_ocr_confidence=getattr(source_doc, "min_ocr_confidence", None) or 0.9,
            accept_rotated=bool(getattr(source_doc, "accept_rotated", True)),
            accept_scanned_pdf=bool(getattr(source_doc, "accept_scanned_pdf", True)),
            sample_original_filename=getattr(source_doc, "sample_original_filename", "") or "",
            template_settings=deepcopy(getattr(source_doc, "template_settings", None) or {}),
        )
        if getattr(source_doc, "sample_file", None) and source_doc.sample_file:
            target_doc.sample_file = source_doc.sample_file
            target_doc.save(update_fields=["sample_file"])
        for source_sample in source_doc.samples.filter(is_active=True).order_by("id"):
            if not source_sample.file:
                continue
            OCRSample.objects.create(
                document_type=target_doc,
                name=source_sample.name or "single",
                file=source_sample.file,
                original_filename=source_sample.original_filename or "",
                mime_type=source_sample.mime_type or "",
                sha256_hash=source_sample.sha256_hash or "",
                is_synthetic=source_sample.is_synthetic,
                is_active=True,
                metadata=deepcopy(source_sample.metadata or {}),
                created_by=source_sample.created_by,
            )
        for source_field in source_doc.fields.all().order_by("display_order", "id"):
            target_field = OCRFieldDefinition.objects.create(
                document_type=target_doc,
                code=source_field.code,
                label=source_field.label,
                data_type=source_field.data_type,
                required=source_field.required,
                enabled=source_field.enabled,
                sides=deepcopy(source_field.sides or []),
                aliases=deepcopy(source_field.aliases or []),
                extraction_hints=deepcopy(source_field.extraction_hints or {}),
                normalization=source_field.normalization,
                format=source_field.format,
                min_confidence=source_field.min_confidence,
                display_order=source_field.display_order,
            )
            field_map[source_field.pk] = target_field
        for source_rule in source.rules.filter(document_type=source_doc).order_by("display_order", "id"):
            OCRRule.objects.create(
                configuration=target,
                document_type=target_doc,
                field=field_map.get(source_rule.field_id),
                code=source_rule.code,
                name=source_rule.name,
                rule_type=source_rule.rule_type,
                operator=source_rule.operator,
                value=deepcopy(source_rule.value or {}),
                threshold=source_rule.threshold,
                on_failure=source_rule.on_failure,
                enabled=source_rule.enabled,
                display_order=source_rule.display_order,
            )
    return target


def _validate_code(value, label):
    code = slugify(str(value or "")).replace("-", "_")
    if not SAFE_CODE.fullmatch(code):
        raise ValidationError({label: ["Use 2-64 lowercase letters, numbers, underscores, or hyphens."]})
    return code


@transaction.atomic
def _apply_draft_payload(configuration, payload):
    if not isinstance(payload, dict):
        raise ValidationError({"detail": ["Configuration must be an object."]})
    if "revision" in payload and int(payload["revision"]) != configuration.revision:
        raise ValidationError({"revision": ["This draft changed since it was loaded. Reload before saving."]})
    if "settings" in payload:
        updated = _validate_settings(payload["settings"])
        current = dict(configuration.settings or {})
        current.update(updated)
        configuration.settings = current
    if "notes" in payload:
        configuration.notes = str(payload["notes"])[:5000]
    documents = payload.get("document_types", None)
    has_document_types_payload = documents is not None
    kept_document_ids: list[int] = []
    if documents is not None:
        if not isinstance(documents, list):
            raise ValidationError({"document_types": ["Document types must be a list."]})
        if len(documents) == 0:
            raise ValidationError({"document_types": ["Keep at least one document type."]})
        existing_by_id = {item.pk: item for item in configuration.document_types.all()}
        existing_by_code = {item.code: item for item in configuration.document_types.all()}
        for item in documents:
            if not isinstance(item, dict):
                raise ValidationError({"document_types": ["Each document type must be an object."]})
            code = _validate_code(item.get("code") or item.get("key"), "document_type.code")
            doc = None
            if item.get("id") not in (None, ""):
                try:
                    doc = existing_by_id.get(int(item["id"]))
                except (TypeError, ValueError):
                    doc = None
            if doc is None:
                doc = existing_by_code.get(code)
            if doc is None:
                doc = OCRDocumentType(
                    configuration=configuration,
                    code=code,
                    name=str(item.get("name") or code.replace("_", " ")).title(),
                )
            elif doc.code != code and OCRDocumentType.objects.filter(configuration=configuration, code=code).exclude(pk=doc.pk).exists():
                raise ValidationError({"document_types": [f"Document code already exists: {code}."]})
            doc.code = code
            for attr in ("name", "description", "category", "template_name", "template_version", "expected_title"):
                if attr in item:
                    setattr(doc, attr, str(item[attr])[:255 if attr != "template_version" else 32])
            for attr in ("enabled", "requires_front", "requires_back", "accept_rotated", "accept_scanned_pdf"):
                if attr in item:
                    setattr(doc, attr, bool(item[attr]))
            if "min_ocr_confidence" in item:
                confidence = float(item["min_ocr_confidence"])
                if not 0 <= confidence <= 1:
                    raise ValidationError({"min_ocr_confidence": ["Confidence must be between 0 and 1."]})
                doc.min_ocr_confidence = confidence
            if "template_settings" in item and isinstance(item["template_settings"], dict):
                doc.template_settings = item["template_settings"]
            if "allowed_sides" in item:
                doc.allowed_sides = _safe_list(item["allowed_sides"], label="allowed_sides", max_items=4)
            if "accepted_mime_types" in item:
                allowed_mimes = _safe_list(item["accepted_mime_types"], label="accepted_mime_types", max_items=8)
                # Unsupported types are dropped, not rejected. This used to
                # raise, which turned an official flicking a toggle into a
                # failed save and a toast they could do nothing about — the
                # list is built by the UI, not typed by hand, so a stray entry
                # is our problem to normalise rather than theirs to fix.
                aliases = {"image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg"}
                supported = {"image/jpeg", "image/png", "application/pdf"}
                cleaned = []
                for mime in allowed_mimes:
                    mime = aliases.get(mime, mime)
                    if mime in supported and mime not in cleaned:
                        cleaned.append(mime)
                doc.accepted_mime_types = cleaned or ["image/jpeg", "image/png"]
            if "accept_scanned_pdf" in item:
                mimes = list(doc.accepted_mime_types or ["image/jpeg", "image/png"])
                if item["accept_scanned_pdf"] and "application/pdf" not in mimes:
                    mimes.append("application/pdf")
                if not item["accept_scanned_pdf"]:
                    mimes = [mime for mime in mimes if mime != "application/pdf"]
                doc.accepted_mime_types = mimes or ["image/jpeg", "image/png"]
            if "max_files" in item:
                doc.max_files = max(1, min(int(item["max_files"]), 10))
            for attr in ("keywords", "provider_names", "aliases"):
                if attr in item:
                    setattr(doc, attr, _safe_list(item[attr], label=attr))
            if "display_order" in item:
                doc.display_order = max(0, min(int(item["display_order"]), 1000))
            if not doc.template_name:
                doc.template_name = doc.name
            doc.save()
            existing_by_id[doc.pk] = doc
            existing_by_code[doc.code] = doc
            kept_document_ids.append(doc.pk)
            fields = item.get("fields", None)
            if fields is not None:
                if not isinstance(fields, list):
                    raise ValidationError({"fields": ["Fields must be a list."]})
                field_by_id = {field.pk: field for field in doc.fields.all()}
                field_by_code = {field.code: field for field in doc.fields.all()}
                kept_field_ids: list[int] = []
                for field_data in fields:
                    if not isinstance(field_data, dict):
                        raise ValidationError({"fields": ["Each field must be an object."]})
                    field_code = _validate_code(field_data.get("code") or field_data.get("key"), "field.code")
                    field = None
                    if field_data.get("id") not in (None, ""):
                        try:
                            field = field_by_id.get(int(field_data["id"]))
                        except (TypeError, ValueError):
                            field = None
                    if field is None:
                        field = field_by_code.get(field_code)
                    if field is None:
                        field = OCRFieldDefinition(
                            document_type=doc,
                            code=field_code,
                            label=str(field_data.get("label") or field_code.replace("_", " ")).title(),
                        )
                    field.code = field_code
                    for attr in ("label", "data_type", "normalization", "format"):
                        if attr in field_data:
                            setattr(field, attr, str(field_data[attr])[:120])
                    for attr in ("required", "enabled"):
                        if attr in field_data:
                            setattr(field, attr, bool(field_data[attr]))
                    if "min_confidence" in field_data:
                        confidence = float(field_data["min_confidence"])
                        if not 0 <= confidence <= 1:
                            raise ValidationError({"min_confidence": ["Confidence must be between 0 and 1."]})
                        field.min_confidence = confidence
                    for attr in ("sides", "aliases"):
                        if attr in field_data:
                            setattr(field, attr, _safe_list(field_data[attr], label=attr, max_items=32))
                    if "extraction_hints" in field_data:
                        field.extraction_hints = _normalize_extraction_hints(field_data["extraction_hints"])
                    # Keep model.sides in sync with extraction_hints.side when sides omitted.
                    hint_side = str((field.extraction_hints or {}).get("side") or "").strip().lower()
                    if hint_side in {"front", "back", "single"} and "sides" not in field_data:
                        field.sides = [hint_side]
                    elif hint_side in {"front", "back", "single"} and not (field.sides or []):
                        field.sides = [hint_side]
                    if "display_order" in field_data:
                        field.display_order = max(0, min(int(field_data["display_order"]), 1000))
                    field.save()
                    field_by_id[field.pk] = field
                    field_by_code[field.code] = field
                    kept_field_ids.append(field.pk)
                # Remove fields dropped from the template builder.
                doc.fields.exclude(pk__in=kept_field_ids).delete()
        # Remove document types dropped from the template builder.
        to_remove = configuration.document_types.exclude(pk__in=kept_document_ids)
        if to_remove.exists():
            remove_ids = list(to_remove.values_list("pk", flat=True))
            # Clear / drop protected references so draft types can be removed.
            OCRTestRun.objects.filter(document_type_id__in=remove_ids).delete()
            VerificationCheck.objects.filter(document_type_id__in=remove_ids).update(document_type=None)
            ResidenceVerificationCase.objects.filter(document_type_id__in=remove_ids).update(document_type=None)
            # Drop rules/samples for removed types before deleting (avoids orphaned rule codes).
            OCRRule.objects.filter(document_type_id__in=remove_ids).delete()
            OCRSample.objects.filter(document_type_id__in=remove_ids).delete()
            to_remove.delete()

    documents = documents if isinstance(documents, list) else []
    # When document_types are in the payload, rebuild the rule set from that list only.
    # Rules for removed types must not be re-applied after the type is gone.
    rule_payloads = list(payload.get("rules", []))
    for document in documents:
        if isinstance(document, dict):
            rule_payloads.extend(document.get("rules", []) or [])
    sync_rules = has_document_types_payload or "rules" in payload
    if sync_rules:
        document_by_id = {item.pk: item for item in configuration.document_types.all()}
        document_by_code = {item.code: item for item in configuration.document_types.all()}
        rule_by_id = {item.pk: item for item in configuration.rules.all()}
        rule_by_code = {item.code: item for item in configuration.rules.all()}
        valid_rule_types = {value for value, _ in OCRRule.RuleType.choices}
        valid_operators = {value for value, _ in OCRRule.Operator.choices}
        valid_failures = {value for value, _ in OCRRule.FailureDisposition.choices}
        kept_rule_ids: list[int] = []
        for rule_data in rule_payloads:
            if not isinstance(rule_data, dict):
                continue
            try:
                rule_code = _validate_code(
                    rule_data.get("code") or rule_data.get("key"),
                    "rule.code",
                )
            except ValidationError:
                # Skip malformed rule codes instead of blocking document removal.
                continue
            rule = None
            if rule_data.get("id") not in (None, ""):
                try:
                    rule = rule_by_id.get(int(rule_data["id"]))
                except (TypeError, ValueError):
                    rule = None
            if rule is None:
                rule = rule_by_code.get(rule_code)
            if rule is None:
                rule = OCRRule(
                    configuration=configuration,
                    code=rule_code,
                    name=str(rule_data.get("name") or rule_code.replace("_", " ")).title(),
                )
            rule.code = rule_code
            for attr in ("name", "rule_type", "operator", "on_failure"):
                if attr in rule_data:
                    value = str(rule_data[attr])[:160]
                    if attr == "on_failure" and value == "reject":
                        value = "manual_review"
                    setattr(rule, attr, value)
            if (
                rule.rule_type not in valid_rule_types
                or rule.operator not in valid_operators
                or rule.on_failure not in valid_failures
            ):
                # Drop unsupported / incomplete rules rather than failing the whole save.
                continue
            if "value" in rule_data:
                value = rule_data["value"]
                if not isinstance(value, (dict, list, str, int, float, bool, type(None))):
                    continue
                rule.value = value
            if "threshold" in rule_data:
                threshold = rule_data["threshold"]
                if threshold is not None and not 0 <= float(threshold) <= 1:
                    continue
                rule.threshold = threshold
            if "enabled" in rule_data:
                rule.enabled = bool(rule_data["enabled"])
            if "display_order" in rule_data:
                rule.display_order = max(0, min(int(rule_data["display_order"]), 1000))

            document_ref = rule_data.get("document_type_id", rule_data.get("document_type"))
            if document_ref in (None, ""):
                rule.document_type = None
            else:
                try:
                    rule.document_type = document_by_id.get(int(document_ref)) or document_by_code.get(str(document_ref))
                except (TypeError, ValueError):
                    rule.document_type = document_by_code.get(str(document_ref))
                if rule.document_type is None:
                    # Rule belonged to a removed proof type — drop it.
                    if rule.pk:
                        rule_by_id.pop(rule.pk, None)
                        rule_by_code.pop(rule.code, None)
                        rule.delete()
                    continue

            field_ref = (
                rule_data.get("field_id")
                or rule_data.get("field")
                or rule_data.get("field_key")
                or (
                    rule_data.get("value", {}).get("field")
                    if isinstance(rule_data.get("value"), dict)
                    else None
                )
            )
            if field_ref in (None, ""):
                rule.field = None
            else:
                field = None
                try:
                    field = OCRFieldDefinition.objects.filter(
                        pk=int(field_ref),
                        document_type=rule.document_type,
                    ).first()
                except (TypeError, ValueError):
                    field = None
                if field is None and rule.document_type is not None:
                    # Normalize the same way field codes are stored.
                    try:
                        field_code = _validate_code(field_ref, "field.code")
                    except ValidationError:
                        field_code = str(field_ref)
                    field = rule.document_type.fields.filter(code=field_code).first()
                    if field is None:
                        field = rule.document_type.fields.filter(code=str(field_ref)).first()
                if field is None:
                    # Field was removed or never saved — drop the rule instead of blocking save.
                    if rule.pk:
                        rule_by_id.pop(rule.pk, None)
                        rule_by_code.pop(rule.code, None)
                        rule.delete()
                    continue
                rule.field = field

            rule.save()
            rule_by_id[rule.pk] = rule
            rule_by_code[rule.code] = rule
            kept_rule_ids.append(rule.pk)

        # Remove rules that are no longer in the builder payload.
        if has_document_types_payload or "rules" in payload:
            configuration.rules.exclude(pk__in=kept_rule_ids).delete()

    configuration.revision += 1
    configuration.save(update_fields=["settings", "notes", "revision", "updated_at"])
    return configuration


class ResidenceProofOptionsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"detail": "Sign-up proof options are returned by community resolution."}, status=status.HTTP_401_UNAUTHORIZED)
        community = getattr(getattr(request.user, "resident_profile", None), "community", None)
        published = published_configuration(community=community)
        document_types = []
        if published is not None:
            document_types = [
                _document_payload(item)
                for item in published.document_types.filter(enabled=True).order_by("display_order", "id")
            ]
        response = Response({
            "version": published.version if published else None,
            "document_types": document_types,
            "count": len(document_types),
        })
        # Sign-up must always see the latest published catalog after Publish Template.
        response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response["Pragma"] = "no-cache"
        return response


class VerificationMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Self-heal stuck "queued" cases (e.g. Celery worker never ran) so
        # residents who already passed signup OCR are not blocked forever.
        if request.user.status == request.user.Status.PENDING_VERIFICATION:
            try:
                from .ocr_runtime import process_stuck_user_case

                process_stuck_user_case(request.user)
                request.user.refresh_from_db()
            except Exception:
                import logging

                logging.getLogger(__name__).exception(
                    "verification/me self-heal failed for user_id=%s", request.user.pk
                )
        case = (
            request.user.residence_verification_cases.select_related("configuration", "document_type")
            .prefetch_related("proofs", "checks")
            .order_by("-created_at")
            .first()
        )
        return Response({
            "case": _case_payload(case, include_proofs=False) if case else None,
            "user_status": request.user.status,
        })


class OCRDraftConfigurationView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def _ensure_draft(self, community, actor):
        """Return this community's draft, creating an empty one when needed.

        Communities are allowed to exist before an official publishes any
        residence-proof document. Starting from an empty draft keeps the OCR
        editor community-scoped without copying the global/Marikina catalog.
        """
        draft = draft_configuration(community=community)
        if draft is not None:
            return draft
        scoped = OCRConfigurationVersion.objects.filter(
            community=community,
            scope="residence_proof",
        )
        latest = scoped.filter(status=OCRConfigurationVersion.Status.PUBLISHED).order_by("-version").first()
        if latest is not None:
            return _clone_configuration(
                latest,
                version=scoped.order_by("-version").first().version + 1,
                status=OCRConfigurationVersion.Status.DRAFT,
                based_on=latest,
            )
        next_version = (scoped.order_by("-version").values_list("version", flat=True).first() or 0) + 1
        return OCRConfigurationVersion.objects.create(
            community=community,
            scope="residence_proof",
            version=next_version,
            status=OCRConfigurationVersion.Status.DRAFT,
            revision=1,
            settings={},
            notes="No residence-proof documents configured yet.",
            created_by=actor,
        )

    def get(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        community = _official_community(request)
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        return Response(_configuration_payload(self._ensure_draft(community, request.user)))

    def patch(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        try:
            community = _official_community(request)
            if not community:
                return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
            configuration = _apply_draft_payload(self._ensure_draft(community, request.user), request.data)
        except (ValidationError, TypeError, ValueError) as exc:
            detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)
        create_audit_log("ocr.configuration_draft_saved", actor=request.user, metadata={"version": configuration.version})
        return Response(_configuration_payload(configuration))


class OCRPublishView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            community = _official_community(request)
            if not community:
                return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
            scoped = OCRConfigurationVersion.objects.select_for_update().filter(scope="residence_proof", community=community)
            draft = scoped.filter(status="draft").first()
            published = scoped.filter(status="published").first()
            if draft is None:
                return Response({"detail": "No draft configuration exists."}, status=status.HTTP_409_CONFLICT)
            expected = request.data.get("revision")
            if expected is not None and int(expected) != draft.revision:
                return Response({"detail": "Draft changed since it was loaded."}, status=status.HTTP_409_CONFLICT)
            if published:
                published.status = OCRConfigurationVersion.Status.ARCHIVED
                published.save(update_fields=["status", "updated_at"])
            now = timezone.now()
            draft.status = OCRConfigurationVersion.Status.PUBLISHED
            draft.published_by = request.user
            draft.published_at = now
            draft.revision += 1
            draft.save(update_fields=["status", "published_by", "published_at", "revision", "updated_at"])
            fresh = _clone_configuration(draft, version=scoped.order_by("-version").first().version + 1, status=OCRConfigurationVersion.Status.DRAFT, based_on=draft)
        published_payload = _configuration_payload(draft)
        enabled_count = sum(1 for item in (published_payload or {}).get("document_types", []) if item.get("enabled", True))
        create_audit_log(
            "ocr.configuration_published",
            actor=request.user,
            metadata={
                "published_version": draft.version,
                "draft_version": fresh.version,
                "enabled_document_types": enabled_count,
            },
        )
        return Response({
            "published": published_payload,
            "draft": _configuration_payload(fresh),
            "sign_up_document_type_count": enabled_count,
        })


class OCRResetDefaultsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        with transaction.atomic():
            community = _official_community(request)
            if not community:
                return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
            scoped = OCRConfigurationVersion.objects.filter(scope="residence_proof", community=community)
            published = scoped.filter(status="published").first()
            if not published:
                return Response({"detail": "No published configuration exists."}, status=status.HTTP_409_CONFLICT)
            scoped.filter(status="draft").update(status="archived", updated_at=timezone.now())
            next_version = scoped.order_by("-version").values_list("version", flat=True).first() + 1
            fresh = _clone_configuration(published, version=next_version, status=OCRConfigurationVersion.Status.DRAFT, based_on=published)
        create_audit_log("ocr.configuration_reset_defaults", actor=request.user, metadata={"based_on": published.version, "draft_version": fresh.version})
        return Response(_configuration_payload(fresh))


class OCRHealthView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        return Response(_service_payload(official_service_status()))


class OCRHealthRecheckView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        result = run_official_health_canary()
        create_audit_log("ocr.health_recheck", actor=request.user, metadata={"status": result.status, "error_code": result.error_code})
        return Response(_service_payload(result))


class OCRAuditView(APIView):
    """Expose the immutable OCR audit trail to authorized officials."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        community = _official_community(request)
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        entries = AuditLog.objects.select_related("actor").filter(
            action__startswith="ocr.",
            community=community,
        ).order_by("-created_at", "-id")[:100]
        return Response({
            "results": [
                {
                    "id": entry.pk,
                    "action": entry.action,
                    "actor": ((entry.actor.get_full_name() or entry.actor.email) if entry.actor_id else None),
                    "detail": (entry.metadata or {}).get("reason") or "",
                    "created_at": entry.created_at,
                }
                for entry in entries
            ],
        })


def _service_payload(service):
    return {
        "provider": service.provider,
        "status": service.status,
        "circuit_state": service.circuit_state,
        "consecutive_failures": service.consecutive_failures,
        "latency_ms": service.latency_ms,
        "error_code": service.error_code,
        "error_message": service.error_message,
        "last_checked_at": service.last_checked_at,
        "last_success_at": service.last_success_at,
        "last_failure_at": service.last_failure_at,
        "next_retry_at": service.next_retry_at,
    }


class OCRTestRunView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        community = _official_community(request)
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        runs = OCRTestRun.objects.select_related("document_type", "configuration").filter(configuration__community=community).order_by("-created_at")[:50]
        return Response({"results": [_test_payload(run) for run in runs]})

    def post(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        community = _official_community(request)
        if not community:
            return Response({"detail": "Choose an active community."}, status=status.HTTP_403_FORBIDDEN)
        config = draft_configuration(community=community)
        code = request.data.get("document_type")
        file = request.FILES.get("file")
        if not config or not code or not file:
            return Response({"detail": "A draft, document_type, and file are required."}, status=status.HTTP_400_BAD_REQUEST)
        # Allow testing draft types that are still hidden from sign-up so officials
        # can verify OCR boxes before enabling the proof on registration.
        document_type = config.document_types.filter(code=code).first()
        if not document_type:
            return Response(
                {"document_type": ["Select a draft document type from the template builder."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Layer 1-4 forensics read the bytes as uploaded. Validation below
        # normalizes to JPEG, which strips EXIF and C2PA and rewrites the
        # compression history ELA depends on, so this cannot wait until the
        # worker opens the stored file.
        from .media_forensics import forensics_findings

        try:
            file.seek(0)
            original_bytes = file.read()
            file.seek(0)
        except Exception:
            original_bytes = b""
        forensics = (
            forensics_findings(original_bytes)
            if original_bytes
            else {"checked": False, "flagged": False, "layer": "", "message": ""}
        )
        try:
            # Soft validation for interactive tests (same as template samples).
            file = validate_uploaded_media_file(file, strict=False, deskew=False)
        except ValidationError as exc:
            return Response(getattr(exc, "message_dict", None) or {"file": exc.messages}, status=status.HTTP_400_BAD_REQUEST)
        raw_side = str(request.data.get("side") or "").strip().lower()
        test_side = raw_side if raw_side in {"front", "back", "single"} else None
        run = OCRTestRun.objects.create(
            configuration=config,
            document_type=document_type,
            requested_by=request.user,
            file=file,
            original_filename=file.name,
            mime_type=getattr(file, "content_type", "") or "",
            file_size=file.size,
        )
        # Optional simulated resident profile: officials can type what a
        # resident would enter at sign-up so match rules are tested against
        # those details instead of the official's own account profile.
        simulated_profile = {
            key: str(request.data.get(f"profile_{key}") or "").strip()
            for key in ("first_name", "middle_name", "last_name", "gender", "date_of_birth", "address")
        }
        simulated_profile = {key: value for key, value in simulated_profile.items() if value}
        metadata = dict(run.metadata or {})
        metadata["forensics"] = forensics
        if simulated_profile:
            metadata["simulated_profile"] = simulated_profile
        run.metadata = metadata
        run.save(update_fields=["metadata", "updated_at"])
        # The local development environment commonly has no Celery worker
        # process.  Run the interactive test immediately there so officials
        # see OCR.space results instead of a job that stays queued forever.
        # Production keeps the asynchronous queue and only falls back to a
        # synchronous run when broker submission itself fails.
        if getattr(settings, "IS_LOCAL_DEVELOPMENT", False) or getattr(settings, "IS_TEST_RUN", False):
            process_test_run(run.pk, side=test_side)
        else:
            try:
                from .ocr_tasks import process_test_run_task

                process_test_run_task.delay(run.pk, side=test_side or "")
            except Exception:
                # Never run a 60s OCR.space call on the request thread. Mark
                # the run failed so the official sees it and can re-submit;
                # a silently-queued row would sit here with no sweeper.
                import logging as _logging

                run.status = run.Status.ERROR
                metadata = dict(run.metadata or {})
                metadata["failure_reason"] = "task_broker_unavailable"
                run.metadata = metadata
                run.save(update_fields=["status", "metadata", "updated_at"])
                _logging.getLogger(__name__).warning(
                    "OCR test run %s marked error: broker submission failed", run.pk
                )
        run.refresh_from_db()
        create_audit_log("ocr.test_run_created", actor=request.user, metadata={"run_id": run.pk, "document_type": document_type.code})
        return Response(_test_payload(run), status=status.HTTP_202_ACCEPTED)


class OCRTestFileView(APIView):
    """Serve a stored OCR test image to the official who owns its community."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        community = _official_community(request)
        run = OCRTestRun.objects.select_related("configuration").filter(
            pk=pk,
            configuration__community=community,
        ).first()
        if not run:
            return Response({"detail": "OCR test run not found."}, status=status.HTTP_404_NOT_FOUND)
        if not run.file:
            return Response({"detail": "This OCR test has no stored image."}, status=status.HTTP_404_NOT_FOUND)
        from django.http import FileResponse

        return FileResponse(run.file.open("rb"), content_type=run.mime_type or "application/octet-stream")


def _test_payload(run):
    raw_extracted = run.extracted_fields or {}
    template_match = None
    id_integrity = None
    id_integrity_checks = []
    pipeline = None
    readability = None
    extracted = raw_extracted
    if isinstance(raw_extracted, dict):
        template_match = raw_extracted.get("__template_match__")
        id_integrity = raw_extracted.get("__id_integrity__")
        if not isinstance(id_integrity, dict) or not id_integrity.get("checked"):
            id_integrity = None
        pipeline = raw_extracted.get("__pipeline__")
        id_integrity_checks = [
            item
            for item in ((pipeline or {}).get("integrity_checks") or [])
            if isinstance(item, dict) and item.get("checked")
        ]
        readability = raw_extracted.get("__readability__")
        internal = {
            "__template_match__",
            "__id_integrity__",
            "__pipeline__",
            "__test_side__",
            "__readability__",
        }
        extracted = {key: value for key, value in raw_extracted.items() if key not in internal}
    extraction_json = {}
    if isinstance(extracted, dict):
        for key, item in extracted.items():
            if isinstance(item, dict):
                extraction_json[key] = item.get("value") or ""
            else:
                extraction_json[key] = item
    overall = float(run.ocr_confidence) if run.ocr_confidence is not None else None
    metadata = run.metadata or {}
    reference_images = [
        {
            "side": sample.get("side", "single"),
            "label": sample.get("label") or _sample_side_label(sample.get("side", "single")),
            "url": sample.get("url"),
            "filename": sample.get("filename") or "",
        }
        for sample in _document_samples_payload(run.document_type)
        if sample.get("url")
    ]
    return {
        "id": run.pk,
        "status": run.status,
        "document_type": run.document_type.code,
        "document_type_name": run.document_type.name,
        "configuration_version": run.configuration.version,
        "original_filename": run.original_filename,
        "filename": run.original_filename,
        "ocr_confidence": overall,
        "confidence": overall,
        "overall_confidence": overall,
        "provider": metadata.get("provider", "ocrspace"),
        "model": metadata.get("model") or "",
        "provider_job_id": run.provider_job_id,
        "extracted_fields": extracted,
        "extraction_json": extraction_json,
        "template_match": template_match,
        "id_integrity": id_integrity,
        "id_integrity_checks": id_integrity_checks,
        "pipeline": pipeline,
        "readability": readability,
        "rule_results": run.rule_results or [],
        "error_code": run.error_code,
        "error_message": run.error_message,
        "error": run.error_message or None,
        "simulated_profile": metadata.get("simulated_profile") or {},
        "profile_source": metadata.get("profile_source") or "empty",
        "image_url": f"/api/auth/ocr/tests/{run.pk}/file/" if run.file else None,
        "reference_images": reference_images,
        "created_at": run.created_at,
        "completed_at": run.completed_at,
    }


class OCRDocumentSampleView(APIView):
    """Upload or fetch per-side template samples (front / back / single) for the canvas."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def _resolve_side(self, request, document) -> str:
        raw = (
            request.query_params.get("side")
            or request.data.get("side")
            or ""
        )
        side = str(raw).strip().lower()
        allowed = set(document.allowed_sides or [])
        if side in {"front", "back", "single"}:
            return side
        if "front" in allowed and "back" in allowed:
            return "front"
        if "front" in allowed:
            return "front"
        return "single"

    def _open_sample_file(self, document, side: str):
        sample = (
            document.samples.filter(is_active=True, name=side)
            .exclude(file="")
            .order_by("-updated_at", "-id")
            .first()
        )
        if sample and sample.file:
            return sample.file, sample.original_filename or sample.name or "sample"
        # Legacy fallbacks
        if side in {"front", "single"} and getattr(document, "sample_file", None) and document.sample_file:
            return document.sample_file, document.sample_original_filename or "sample"
        if side == "back":
            # Do not fall back to front when requesting back
            return None, ""
        return None, ""

    def get(self, request, code):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        config = draft_configuration(community=_official_community(request))
        document = config.document_types.filter(code=code).first() if config else None
        if not document:
            return Response({"detail": "Document type not found."}, status=status.HTTP_404_NOT_FOUND)
        side = self._resolve_side(request, document)
        file_field, filename = self._open_sample_file(document, side)
        if not file_field:
            return Response(
                {"detail": f"No {side} sample uploaded for this document type."},
                status=status.HTTP_404_NOT_FOUND,
            )
        from django.http import FileResponse

        name = (filename or "sample").lower()
        content_type = "application/octet-stream"
        if name.endswith(".png"):
            content_type = "image/png"
        elif name.endswith(".jpg") or name.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif name.endswith(".pdf"):
            content_type = "application/pdf"
        response = FileResponse(file_field.open("rb"), content_type=content_type)
        response["Content-Disposition"] = f'inline; filename="{filename or "sample"}"'
        return response

    def post(self, request, code):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        config = draft_configuration(community=_official_community(request))
        document = config.document_types.filter(code=code).first() if config else None
        if not document:
            return Response(
                {
                    "document_type": [
                        f"Unknown document type “{code}”. Save the OCR draft first so the new document type exists, then upload the sample again."
                    ]
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        file = request.FILES.get("file")
        if not file:
            return Response({"file": ["A sample file is required."]}, status=status.HTTP_400_BAD_REQUEST)
        side = self._resolve_side(request, document)
        if side not in {"front", "back", "single"}:
            return Response({"side": ["Use side=front, back, or single."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            # Soft validation for canvas samples. Never deskew template samples —
            # warping can introduce a slight slant (especially back-side photos).
            file = validate_uploaded_media_file(file, strict=False, deskew=False)
        except ValidationError as exc:
            return Response(getattr(exc, "message_dict", None) or {"file": exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        # Upsert OCRSample for this side (do not delete other sides)
        sample = document.samples.filter(name=side).order_by("-id").first()
        if sample is None:
            sample = OCRSample(document_type=document, name=side)
        old_sample_name = sample.file.name if (sample.pk and sample.file) else ""
        legacy_name = document.sample_file.name if (document.sample_file and side in {"front", "single"}) else ""
        sample.file = file
        sample.original_filename = (getattr(file, "name", None) or "sample.jpg")[:255]
        sample.mime_type = getattr(file, "content_type", "") or "image/jpeg"
        sample.is_active = True
        sample.is_synthetic = False
        sample.created_by = request.user if request.user.is_authenticated else None
        sample.metadata = {**(sample.metadata or {}), "side": side}
        sample.save()
        _delete_replaced_file(sample.file.storage, old_sample_name, sample.file.name)

        # Keep legacy sample_file in sync with primary canvas side (front or single)
        if side in {"front", "single"}:
            document.sample_file = file
            document.sample_original_filename = sample.original_filename[:255]
            document.save(update_fields=["sample_file", "sample_original_filename", "updated_at"])
            _delete_replaced_file(document.sample_file.storage, legacy_name, document.sample_file.name)
        else:
            document.save(update_fields=["updated_at"])

        create_audit_log(
            "ocr.template_sample_uploaded",
            actor=request.user,
            metadata={
                "document_type": document.code,
                "side": side,
                "filename": sample.original_filename,
            },
        )
        return Response(_document_payload(document))

    def delete(self, request, code):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        config = draft_configuration(community=_official_community(request))
        document = config.document_types.filter(code=code).first() if config else None
        if not document:
            return Response({"detail": "Document type not found."}, status=status.HTTP_404_NOT_FOUND)
        side = self._resolve_side(request, document)
        # front and single are the same primary photo (the builder aliases
        # them), so removing one must remove both or the photo comes back.
        target_names = ["front", "single"] if side in {"front", "single"} else ["back"]
        document.samples.filter(name__in=target_names).update(is_active=False)
        if side in {"front", "single"}:
            # Clear legacy primary if removing the main canvas sample
            still_primary = document.samples.filter(is_active=True, name__in=["front", "single"]).exclude(file="").exists()
            if not still_primary:
                document.sample_file = None
                document.sample_original_filename = ""
                document.save(update_fields=["sample_file", "sample_original_filename", "updated_at"])
        return Response(_document_payload(document))


class VerificationCaseListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import scope_user_queryset

        users = scope_user_queryset(User.objects.all(), request.user)
        queryset = ResidenceVerificationCase.objects.filter(user__in=users).select_related(
            "user", "user__resident_profile", "configuration", "document_type"
        ).prefetch_related("proofs", "checks")
        requested_status = request.query_params.get("status")
        if requested_status:
            queryset = queryset.filter(status=requested_status)
        return Response({"results": [_case_payload(case) for case in queryset.order_by("-priority", "created_at")[:100]]})


class VerificationCaseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import scope_user_queryset

        users = scope_user_queryset(User.objects.all(), request.user)
        case = ResidenceVerificationCase.objects.filter(user__in=users).select_related(
            "user", "user__resident_profile", "configuration", "document_type"
        ).prefetch_related("proofs", "checks").filter(pk=pk).first()
        if not case:
            return Response({"detail": "Verification case not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(_case_payload(case))


class VerificationCaseDecisionView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request, pk):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import scope_user_queryset

        users = scope_user_queryset(User.objects.all(), request.user)
        if not ResidenceVerificationCase.objects.filter(pk=pk, user__in=users).exists():
            return Response({"detail": "Verification case not found."}, status=status.HTTP_404_NOT_FOUND)
        approve = request.data.get("decision") == "approve"
        if request.data.get("decision") not in {"approve", "reject"}:
            return Response({"decision": ["Use approve or reject."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            case = decide_case(pk, official=request.user, approve=approve, reason=request.data.get("reason", ""))
        except (ValidationError, ResidenceVerificationCase.DoesNotExist) as exc:
            detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
            return Response(detail, status=status.HTTP_409_CONFLICT if "already" in str(exc).lower() else status.HTTP_400_BAD_REQUEST)
        create_audit_log(
            "ocr.case_approved" if approve else "ocr.case_rejected",
            actor=request.user,
            target_user=case.user,
            metadata={"case_id": case.pk, "reason_present": True},
        )
        return Response(_case_payload(case))


class VerificationCaseRetryView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not _official(request):
            return Response({"detail": "Official permission required."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import scope_user_queryset

        users = scope_user_queryset(User.objects.all(), request.user)
        if not ResidenceVerificationCase.objects.filter(pk=pk, user__in=users).exists():
            return Response({"detail": "Verification case not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            case = retry_case(pk)
            from .ocr_runtime import enqueue_case

            enqueue_case(case.pk, trigger=VerificationCheck.Trigger.OFFICIAL)
        except (ValidationError, ResidenceVerificationCase.DoesNotExist) as exc:
            detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
            return Response(detail, status=status.HTTP_409_CONFLICT)
        create_audit_log("ocr.case_retry_requested", actor=request.user, target_user=case.user, metadata={"case_id": case.pk})
        return Response(_case_payload(case), status=status.HTTP_202_ACCEPTED)
