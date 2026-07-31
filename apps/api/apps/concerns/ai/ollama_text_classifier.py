import json
import logging
import re
from dataclasses import asdict
from io import BytesIO

from django.conf import settings
from PIL import Image, ImageOps

from apps.concerns.models import Concern, ConcernCategory
from apps.emergencies.models import EmergencyCategory

from .text_classifier import TextClassificationResult, TextClassifierNotConfigured


OLLAMA_CLOUD_PROVIDER = "ollama_cloud"
OLLAMA_TEXT_MODEL = "gemma4:31b"
VEHICLE_LABELS = {"car", "motorcycle", "bus", "truck", "bicycle"}
BASE_LABEL_MAPPINGS = {
    "traffic light": Concern.Category.INFRASTRUCTURE,
    "bench": Concern.Category.INFRASTRUCTURE,
    "parking meter": Concern.Category.INFRASTRUCTURE,
    "garbage": Concern.Category.ENVIRONMENT,
    "trash": Concern.Category.ENVIRONMENT,
    "knife": Concern.Category.PUBLIC_SAFETY,
    "dog": Concern.Category.PUBLIC_SAFETY,
    "cat": Concern.Category.PUBLIC_SAFETY,
    "handbag": Concern.Category.OTHERS,
    "backpack": Concern.Category.OTHERS,
    "suitcase": Concern.Category.OTHERS,
    "car": Concern.Category.VEHICLE,
    "truck": Concern.Category.VEHICLE,
    "motorcycle": Concern.Category.VEHICLE,
    "bus": Concern.Category.VEHICLE,
    "bicycle": Concern.Category.VEHICLE,
    "person": Concern.Category.OTHERS,
}
logger = logging.getLogger(__name__)


def display_label_for(raw_label: str) -> str:
    label = str(raw_label or "").lower()
    return "vehicle" if label in VEHICLE_LABELS else label


def image_bytes_for_ollama(raw: bytes) -> tuple[str | None, str]:
    if not getattr(settings, "OLLAMA_ENABLE_IMAGE_ANALYSIS", True):
        return None, ""
    try:
        image = Image.open(BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
        max_side = max(128, int(getattr(settings, "OLLAMA_IMAGE_MAX_SIDE", 512)))
        quality = max(40, min(95, int(getattr(settings, "OLLAMA_IMAGE_JPEG_QUALITY", 70))))
        max_bytes = max(0, int(getattr(settings, "OLLAMA_IMAGE_MAX_BYTES", 0)))
        image.thumbnail((max_side, max_side))
        output = BytesIO()
        image.save(output, "JPEG", quality=quality, optimize=True)
    except Exception:
        return None, ""
    if max_bytes and output.tell() > max_bytes:
        logger.info("Skipping Ollama image analysis; normalized image is %s bytes", output.tell())
        return None, ""
    import base64
    return base64.b64encode(output.getvalue()).decode("ascii"), "image/jpeg"


def evidence_objects(objects: list[dict]) -> list[dict]:
    return [
        {
            "raw_label": item.get("label", ""),
            "display_label": display_label_for(item.get("label", "")),
            "mapped_category": item.get("category", ""),
            "confidence": item.get("confidence"),
        }
        for item in objects
    ]


def configured_concern_categories(config) -> list[dict]:
    categories = list(ConcernCategory.objects.filter(is_active=True).order_by("name"))
    enabled = set(getattr(config, "enabled_categories", None) or [])
    labels = dict(Concern.Category.choices)
    if categories:
        result = [
            {"key": category.code, "label": category.name}
            for category in categories
            if not enabled or category.code in enabled
        ]
    else:
        result = [
            {"key": code, "label": labels.get(code, code.replace("_", " ").title())}
            for code in Concern.Category.values
            if not enabled or code in enabled
        ]
    seen = {item["key"] for item in result}
    mapping_values = {str(value) for value in {**BASE_LABEL_MAPPINGS, **(getattr(config, "label_mappings", {}) or {})}.values()}
    for mapped_category in sorted(mapping_values):
        if mapped_category in labels and mapped_category not in seen:
            result.append({"key": mapped_category, "label": labels[mapped_category]})
            seen.add(mapped_category)
    return [
        item
        for item in result
    ]


def configured_emergency_types() -> list[dict]:
    categories = EmergencyCategory.objects.filter(is_active=True).order_by("sort_order", "label")
    return [{"key": category.code, "label": category.label} for category in categories]


def safe_needs_review(
    *,
    model_version: str,
    reason: str,
    image_objects: list[dict] | None = None,
    content_flag: str = "text_classifier_unavailable",
) -> TextClassificationResult:
    has_image_evidence = bool(image_objects)
    return TextClassificationResult(
        label="needs_review",
        confidence=0.0,
        category="",
        severity="medium",
        model_version=model_version,
        is_suspicious=False,
        is_irrelevant=True,
        details={
            "relevance": "UNCLEAR",
            "primary_category": "",
            "possible_categories": [],
            "selected_category_match": None,
            "content_flags": [content_flag],
            "image_flags": [f"{display_label_for(item.get('label', ''))}_detected" for item in (image_objects or []) if item.get("label")],
            "privacy_sensitive_information_detected": False,
            "disturbing_content_detected": False,
            "urgent_attention": False,
            "evidence_relationship": "no_useful_image_evidence" if has_image_evidence else "image_unavailable",
            "severity": "medium",
            "ai_result_uncertain": True,
            "recommended_action": "manual_review",
            "public_media_treatment": "safe_to_display",
            "short_explanation": reason,
        },
    )


class OllamaTextClassifier:
    def __init__(self, *, configuration=None):
        self.configuration = configuration
        self.host = getattr(settings, "OLLAMA_HOST", "https://ollama.com")
        self.api_key = getattr(settings, "OLLAMA_API_KEY", "")
        self.model = getattr(settings, "OLLAMA_TEXT_MODEL", OLLAMA_TEXT_MODEL) or OLLAMA_TEXT_MODEL
        self.timeout = getattr(settings, "OLLAMA_TIMEOUT_SECONDS", 120)

    def classify(
        self,
        *,
        title: str,
        description: str,
        selected_category: str,
        image_objects: list[dict] | None = None,
        image_data: str | None = None,
        image_mime_type: str = "",
    ) -> TextClassificationResult:
        low_information = low_information_reason(description)
        if low_information:
            return low_information_result(model_version=self.model, reason=low_information, image_objects=image_objects or [])
        if not self.api_key:
            raise TextClassifierNotConfigured("OLLAMA_API_KEY is not configured.")

        try:
            from ollama import Client
        except Exception as exc:
            raise TextClassifierNotConfigured("The ollama Python package is not installed.") from exc

        client = Client(host=self.host, headers={"Authorization": f"Bearer {self.api_key}"}, timeout=self.timeout)
        image_review_limited = False
        try:
            if image_data:
                image_prompt = (
                    "You are a photo analyst for E-Boses, a barangay concern system in the Philippines.\n\n"
                    f"Report description: {description}\n"
                    f"Selected category: {selected_category}\n\n"
                    'Return valid JSON only:\n'
                    '{"photo_assessment": "...", "visual_summary": "...", '
                    '"image_flags": [], '
                    '"recognized_photo_items": []}\n\n'
                    "photo_assessment: CONFIRMED if photo matches the report, "
                    "NOT_CONFIRMED if it contradicts, UNCLEAR if unsure.\n"
                    "visual_summary: one sentence describing the photo.\n"
                    "image_flags: list from: privacy_sensitive_information_detected, "
                    "disturbing_content_detected, vehicle_detected, animal_detected.\n"
                    "recognized_photo_items: list of visible objects (e.g., garbage, trash, dog, car)."
                )
                user_message = {"role": "user", "content": image_prompt, "images": [image_data]}
            else:
                prompt = build_prompt(
                    configuration=self.configuration,
                    selected_category=selected_category,
                    title=title,
                    description=description,
                    image_objects=image_objects or [],
                    image_attached=False,
                    image_mime_type="",
                )
                user_message = {"role": "user", "content": prompt}
            response = client.chat(
                self.model,
                messages=[
                    {"role": "system", "content": "Return valid JSON only. No Markdown. No prose."},
                    user_message,
                ],
                options={"temperature": 0},
                stream=False,
            )
        except Exception as exc:
            if not image_data:
                raise
            logger.warning("Ollama image classification failed; retrying without image: %s", exc)
            image_review_limited = True
            retry_prompt = build_prompt(
                configuration=self.configuration,
                selected_category=selected_category,
                title=title,
                description=description,
                image_objects=image_objects or [],
                image_attached=False,
                image_mime_type="",
            )
            response = client.chat(
                self.model,
                messages=[
                    {"role": "system", "content": "Return valid JSON only. No Markdown. No prose."},
                    {"role": "user", "content": retry_prompt},
                ],
                format="json",
                options={"temperature": 0},
                stream=False,
            )
        content = _response_content(response)
        result = parse_ollama_result(
            content,
            model_version=self.model,
            selected_category=selected_category,
            configuration=self.configuration,
            image_objects=image_objects or [],
            image_attached=bool(image_data) and not image_review_limited,
        )
        if image_review_limited:
            result.details["image_review_limited"] = True
            result.details.setdefault("content_flags", []).append("image_review_limited")
            has_objects = bool(image_objects)
            if has_objects:
                result.details["image_review_message"] = "Photo review was unavailable. The result used the description and recognized photo items instead."
                result.details["photo_assessment"] = "Photo review was unavailable. Recognized photo items were used instead."
            else:
                result.details["image_review_message"] = "Photo review was unavailable. The result used only the written description."
                result.details["photo_assessment"] = "Photo review was unavailable. No objects were detected from the photo."
            result.details["visual_summary"] = ""
        return result


def build_prompt(*, configuration, selected_category: str, title: str, description: str, image_objects: list[dict], image_attached: bool = False, image_mime_type: str = "") -> str:
    label_mappings = {**BASE_LABEL_MAPPINGS, **(getattr(configuration, "label_mappings", {}) or {})}
    payload = {
        "configured_concern_categories": configured_concern_categories(configuration),
        "configured_emergency_types": configured_emergency_types(),
        "recognized_photo_item_mappings": label_mappings,
        "resident_selected_category": selected_category,
        "resident_title": title,
        "resident_description": description,
        "photo_evidence": {
            "attached_image_available": image_attached,
            "attached_image_mime_type": image_mime_type,
            "recognized_photo_items": evidence_objects(image_objects),
        },
    }
    return (
        "You are the report-checking assistant for E-Boses, "
        "a barangay civic concern and emergency coordination system in the Philippines.\n\n"
        "Analyze Filipino, English, or Taglish reports and the attached image when one is provided. Provide recommendations only. "
        "Do not make final decisions, reject emergencies, or invent information.\n\n"
        "Use only the configured concern categories, emergency types, recognized photo items, and mappings in this payload. "
        "Submitted location is handled separately by the system; do not extract location.\n\n"
        "Rules:\n"
        "1. relevance must be VALID, UNCLEAR, or IRRELEVANT.\n"
        "2. primary_category must be one configured concern category key, or empty when unclear/irrelevant.\n"
        "3. possible_categories is a list of other plausible configured category keys; it may contain multiple values.\n"
        "4. If the description is gibberish, keyboard spam, repeated words, mostly symbols, or unrelated chatter, mark it UNCLEAR or IRRELEVANT and ask for clearer details.\n"
        "5. If strong language appears inside a real civic or emergency report, keep the report meaningful and add a content flag such as profanity; do not reject it only for tone.\n"
        "6. If the text describes immediate danger, fire, medical distress, violent crime, or serious harm, set urgent_attention true and consider escalate_as_emergency.\n"
        "7. Photo evidence means only what is visible in the attached image and the recognized photo items. Do not invent objects from the text.\n"
        "8. If text says vehicle but the photo only clearly shows a person and no vehicle is visible, photo evidence does not confirm the report.\n"
        "9. Text-only claims like plate numbers or faces are not confirmed photo evidence unless visible in the attached image.\n"
        "10. image_flags must describe visible photo evidence only. content_flags must describe text problems or text-only claims.\n"
        "6. evidence_relationship must be supports_report, partially_supports_report, contradicts_report, no_useful_image_evidence, or image_unavailable.\n"
        "7. severity is low, medium, or high. Low is minor/non-urgent; medium blocks access or needs official action; high is immediate danger or serious harm.\n"
        "8. recommended_action must be accept, accept_with_privacy_review, manual_review, request_more_information, escalate_as_emergency, or reject_as_irrelevant.\n"
        "9. public_media_treatment must be safe_to_display, blur_sensitive_details_before_public_display, hide_from_public_show_to_officials_only, or do_not_display.\n"
        "10. short_explanation is for barangay staff and residents. Use one or two sentences, no more than roughly 35 words. Describe only what the available evidence supports. State whether text and photo match. Mention privacy protection when required. Mention uncertainty clearly. Avoid technical model terminology. Avoid assigning guilt or identifying anyone. Avoid issuing the final barangay decision.\n"
        "11. Return valid JSON only. No Markdown.\n\n"
        f"Payload:\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        "Return exactly this JSON shape:\n"
        "{\n"
        '  "relevance": null,\n'
        '  "primary_category": null,\n'
        '  "possible_categories": [],\n'
        '  "selected_category_match": null,\n'
        '  "content_flags": [],\n'
        '  "image_flags": [],\n'
        '  "text_assessment": null,\n'
        '  "photo_assessment": null,\n'
        '  "recognized_photo_items": [],\n'
        '  "visual_summary": null,\n'
        '  "mismatch_reason": null,\n'
        '  "privacy_sensitive_information_detected": null,\n'
        '  "disturbing_content_detected": null,\n'
        '  "urgent_attention": null,\n'
        '  "evidence_relationship": null,\n'
        '  "severity": null,\n'
        '  "confidence": null,\n'
        '  "ai_result_uncertain": null,\n'
        '  "recommended_action": null,\n'
        '  "public_media_treatment": null,\n'
        '  "short_explanation": null\n'
        "}"
    )


def parse_ollama_result(content: str, *, model_version: str, selected_category: str, configuration=None, image_objects: list[dict] | None = None, image_attached: bool = False) -> TextClassificationResult:
    try:
        data = json.loads(_json_body(content))
    except Exception:
        return safe_needs_review(
            model_version=model_version,
            reason="Ollama returned invalid JSON; official review required.",
            image_objects=image_objects or [],
            content_flag="text_classifier_invalid_output",
        )

    allowed_categories = {item["key"] for item in configured_concern_categories(configuration)} if configuration else set(Concern.Category.values)
    relevance = str(data.get("relevance") or "UNCLEAR").upper()
    primary = str(data.get("primary_category") or "")
    if primary not in allowed_categories:
        primary = ""
    confidence = _clamp_float(data.get("confidence"), default=0.0)
    severity = str(data.get("severity") or "medium").lower()
    if severity not in {"low", "medium", "high"}:
        severity = "medium"
    possible = [str(item) for item in (data.get("possible_categories") or []) if str(item) in allowed_categories and str(item) != primary]
    data = _apply_evidence_guardrails(data, primary=primary, selected_category=selected_category, image_objects=image_objects or [], image_attached=image_attached)
    recognized = evidence_objects(image_objects or [])
    photo_categories = {str(item.get("mapped_category") or "") for item in recognized if item.get("mapped_category")}
    selected_match = (primary == selected_category) or selected_category in photo_categories if primary or photo_categories else None
    label = f"related_{primary}" if relevance == "VALID" and primary else "needs_review"
    is_irrelevant = relevance in {"UNCLEAR", "IRRELEVANT"} or not primary
    is_suspicious = bool(set(data.get("content_flags") or []) & {"spam", "harassment", "threat", "hate_or_discrimination", "sexual_content", "possible_fake_report"})
    details = {
        **data,
        "relevance": relevance,
        "primary_category": primary,
        "possible_categories": possible,
        "recognized_photo_categories": sorted(photo_categories),
        "selected_category_match": selected_match,
        "confidence": confidence,
        "severity": severity,
        "recognized_photo_items": data.get("recognized_photo_items") or [item["display_label"] for item in recognized if item.get("display_label")],
    }
    return TextClassificationResult(
        label=label,
        confidence=confidence,
        category=primary,
        severity=severity,
        model_version=model_version,
        is_suspicious=is_suspicious,
        is_irrelevant=is_irrelevant,
        details=details,
    )


def payload_from_result(result: TextClassificationResult, *, selected_category: str) -> dict:
    if "selected_category_match" in result.details:
        category_match = bool(result.details.get("selected_category_match"))
    else:
        category_match = bool(result.category) and result.category == selected_category
    if result.details.get("ai_result_uncertain"):
        outcome = "needs_review"
    elif result.details.get("relevance") == "IRRELEVANT":
        outcome = "irrelevant"
    elif not result.category or result.confidence is None or not category_match:
        outcome = "irrelevant"
    else:
        outcome = "related"
    return {
        **asdict(result),
        "selected_category": selected_category,
        "category_match": category_match,
        "outcome": outcome,
        "action": result.details.get("recommended_action") or ("manual_review" if outcome != "related" else "continue"),
        "calibrated": False,
        "notice": result.details.get("short_explanation") or "Ollama Cloud recommendation; an official must review flagged reports.",
    }


def _json_body(content: str) -> str:
    text = str(content or "").strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end >= start:
        return text[start:end + 1]
    return text


def _response_content(response) -> str:
    if isinstance(response, dict):
        return str((response.get("message") or {}).get("content") or "")
    message = getattr(response, "message", None)
    if isinstance(message, dict):
        return str(message.get("content") or "")
    return str(getattr(message, "content", "") or "")


def low_information_reason(text: str) -> str:
    cleaned = str(text or "").strip().lower()
    letters = re.findall(r"[a-zA-ZÀ-ÿ0-9]+", cleaned)
    joined = " ".join(letters)
    if len(joined) < 10:
        return "Description needs more detail."
    if re.fullmatch(r"(.)\1{7,}", cleaned.replace(" ", "")):
        return "Description appears to be repeated characters."
    if letters and len(set(letters)) <= 2 and len(letters) >= 5:
        return "Description appears to repeat the same words."
    if re.search(r"\b(asdf|qwerty|test test|12345)\b", cleaned):
        return "Description appears to be test text or keyboard spam."
    symbol_count = sum(1 for char in cleaned if not char.isalnum() and not char.isspace())
    if cleaned and symbol_count / max(len(cleaned), 1) > 0.45:
        return "Description has too many symbols to understand."
    return ""


def low_information_result(*, model_version: str, reason: str, image_objects: list[dict]) -> TextClassificationResult:
    return TextClassificationResult(
        label="needs_review",
        confidence=0.0,
        category="",
        severity="medium",
        model_version=model_version,
        is_suspicious=False,
        is_irrelevant=True,
        details={
            "relevance": "UNCLEAR",
            "primary_category": "",
            "possible_categories": [],
            "selected_category_match": None,
            "content_flags": ["low_information_text"],
            "image_flags": [],
            "text_assessment": "The description needs more clear detail.",
            "photo_assessment": "Photo can be checked after the text is clear.",
            "recognized_photo_items": [item["display_label"] for item in evidence_objects(image_objects) if item.get("display_label")],
            "visual_summary": "",
            "mismatch_reason": reason,
            "privacy_sensitive_information_detected": False,
            "disturbing_content_detected": False,
            "urgent_attention": False,
            "evidence_relationship": "no_useful_image_evidence" if image_objects else "image_unavailable",
            "severity": "medium",
            "ai_result_uncertain": True,
            "recommended_action": "request_more_information",
            "public_media_treatment": "safe_to_display",
            "short_explanation": "The description does not provide enough clear information to understand the issue. Ask the resident to describe what happened and what needs attention.",
        },
    )


def _apply_evidence_guardrails(data: dict, *, primary: str, selected_category: str, image_objects: list[dict], image_attached: bool) -> dict:
    relationship = str(data.get("evidence_relationship") or "").lower()
    recognized = evidence_objects(image_objects)
    displays = {str(item.get("display_label") or "").lower() for item in recognized}
    categories = {str(item.get("mapped_category") or "") for item in recognized if item.get("mapped_category")}
    if relationship == "supports_report" and image_objects:
        if primary == Concern.Category.VEHICLE and displays and displays <= {"person"}:
            data["evidence_relationship"] = "no_useful_image_evidence"
            data["mismatch_reason"] = data.get("mismatch_reason") or "The recognized photo evidence does not confirm the vehicle issue."
        elif primary and primary not in categories and selected_category not in categories:
            data["evidence_relationship"] = "partially_supports_report"
            data["mismatch_reason"] = data.get("mismatch_reason") or "The photo evidence only partly supports the report."
    if not image_attached and data.get("privacy_sensitive_information_detected") and not image_objects:
        data["ai_result_uncertain"] = True
        data["recommended_action"] = "manual_review"
    return data


def _clamp_float(value, *, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, number))
