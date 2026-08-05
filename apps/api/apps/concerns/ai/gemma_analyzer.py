"""Gemma reads the report — text and photo — and recommends what to do next.

This replaces a two-model arrangement where YOLO named COCO objects, a
hand-maintained table mapped `car → vehicle`, and Gemma was handed those labels
as "photo evidence". The mapping was fiction (`person → others`,
`knife → public_safety`), and it meant Gemma's view of the image was whatever
survived an 80-class detector trained on a different problem.

Now Gemma looks at the image itself and reports what it sees in plain language.
It also decides whether the photo *might* contain something privacy-sensitive —
it never confirms it. That single boolean is what gates SAM3: no scan runs
unless Gemma asks for one, and SAM3 only ever receives the classes Gemma named.

There is one prompt and one response schema for both text-only and
image-assisted requests. The previous code had a second, four-field prompt used
only when an image was attached, so the fields available to the official
silently depended on whether the upload happened to decode.
"""

import json
import logging
import re
import time
from dataclasses import asdict

from django.conf import settings

from apps.concerns.models import Concern, ConcernCategory
from apps.emergencies.models import EmergencyCategory

from .image_prep import PreparedImage
from .text_classifier import TextClassificationResult, TextClassifierNotConfigured


OLLAMA_CLOUD_PROVIDER = "ollama_cloud"
OLLAMA_TEXT_MODEL = "gemma4:31b"

RELEVANCE_VALUES = {"VALID", "UNCLEAR", "IRRELEVANT"}
SEVERITY_VALUES = {"low", "medium", "high"}

EVIDENCE_RELATIONSHIPS = {
    "supports_report",
    "partially_supports_report",
    "contradicts_report",
    "no_useful_image_evidence",
    "image_unavailable",
    "image_review_failed",
}

RECOMMENDED_ACTIONS = {
    "accept",
    "accept_with_privacy_review",
    "manual_review",
    "request_more_information",
    "escalate_as_emergency",
    "reject_as_irrelevant",
}

# SAM3 is an open-vocabulary segmenter, so Gemma names what to blur rather than
# picking from a fixed list. The constraint is what SAM3 can actually *see*:
# short concrete nouns work ("face", "license plate", "id card"), abstractions
# do not. Asked for an "injury" it returns nothing, because nothing in a photo
# looks like the concept of an injury — and a silently empty scan reads as "no
# sensitive content found", which is the worst possible failure here.
CORE_SENSITIVE_CLASSES = ["face", "license plate", "blood"]

MAX_SENSITIVE_CLASSES = 4

# Phrasings that mean one of the core classes. Keys are already normalised
# (lowercase, punctuation stripped, single spaces).
_CLASS_SYNONYMS = {
    "human face": "face",
    "human faces": "face",
    "faces": "face",
    "person face": "face",
    "facial features": "face",
    "licence plate": "license plate",
    "number plate": "license plate",
    "plate number": "license plate",
    "car plate": "license plate",
    "vehicle plate": "license plate",
    "license plates": "license plate",
    "blood like stain": "blood",
    "bloodlike stain": "blood",
    "blood stain": "blood",
    "bloodstain": "blood",
    "blood spatter": "blood",
}

# Concepts rather than things. SAM3 cannot segment any of these, so letting one
# through would produce an empty result that looks like an all-clear.
_ABSTRACT_TERMS = {
    "injury", "injuries", "wound", "wounds", "harm", "danger", "violence",
    "privacy", "pii", "sensitive", "identity", "identifiable", "personal",
    "information", "data", "victim", "minor", "evidence", "crime", "nudity",
    "abuse", "trauma", "medical", "emergency",
}


def normalise_sensitive_class(value) -> str:
    """Clean one class name, or return "" if SAM3 could not act on it.

    Keeps it to one or two words: longer phrases are descriptions rather than
    objects, and the workflow splits the class list on commas anyway.
    """
    text = re.sub(r"[^a-z0-9 ]+", " ", str(value or "").lower())
    text = " ".join(text.split())
    if not text:
        return ""
    text = _CLASS_SYNONYMS.get(text, text)
    words = text.split()
    if len(words) > 2:
        return ""
    if any(word in _ABSTRACT_TERMS for word in words):
        return ""
    return text


def sensitive_classes_from(values) -> list[str]:
    """Normalise, de-duplicate and cap a list of proposed classes."""
    cleaned: list[str] = []
    for value in values or []:
        name = normalise_sensitive_class(value)
        if name and name not in cleaned:
            cleaned.append(name)
    return cleaned[:MAX_SENSITIVE_CLASSES]

logger = logging.getLogger(__name__)


def configured_concern_categories(config) -> list[dict]:
    """The category keys Gemma is allowed to choose from.

    Reads the rows officials actually maintain in the Categories screen, falling
    back to the legacy enum when that table is empty (fresh install, tests).
    """
    categories = list(ConcernCategory.objects.filter(is_active=True).order_by("name"))
    enabled = set(getattr(config, "enabled_categories", None) or [])
    labels = dict(Concern.Category.choices)
    if categories:
        return [
            {"key": category.code, "label": category.name}
            for category in categories
            if not enabled or category.code in enabled
        ]
    return [
        {"key": code, "label": labels.get(code, code.replace("_", " ").title())}
        for code in Concern.Category.values
        if not enabled or code in enabled
    ]


def configured_emergency_types() -> list[dict]:
    categories = EmergencyCategory.objects.filter(is_active=True).order_by("sort_order", "label")
    return [{"key": category.code, "label": category.label} for category in categories]


def empty_details() -> dict:
    """Every schema key, at its safe default.

    Used as the base for both fallback results and parsed ones, so no consumer
    ever has to guard against a missing key.
    """
    return {
        "relevance": "UNCLEAR",
        "primary_category": "",
        "possible_categories": [],
        "selected_category_match": None,
        "detected_objects": [],
        "text_assessment": "",
        "photo_assessment": "",
        "evidence_relationship": "image_unavailable",
        "missing_information": [],
        "urgent_attention": False,
        "severity": "medium",
        "privacy_scan_required": False,
        "privacy_scan_reasons": [],
        "suspected_sensitive_classes": [],
        "ai_result_uncertain": False,
        "recommended_action": "manual_review",
        "short_explanation": "",
        "image_review_succeeded": None,
    }


def safe_needs_review(
    *,
    model_version: str,
    reason: str,
    image_attached: bool = False,
    image_review_succeeded: bool | None = None,
) -> TextClassificationResult:
    """The result used whenever Gemma could not produce one.

    Deliberately not "irrelevant": a report the system failed to read is a
    report an official still has to read. `is_irrelevant` is set so the soft
    flag gate routes it into the review queue, but the recommended action is
    manual review and nothing about the media is claimed to be safe.
    """
    details = {
        **empty_details(),
        "evidence_relationship": "image_review_failed" if image_attached else "image_unavailable",
        "ai_result_uncertain": True,
        "recommended_action": "manual_review",
        "short_explanation": reason,
        "image_review_succeeded": image_review_succeeded,
    }
    return TextClassificationResult(
        label="needs_review",
        confidence=0.0,
        category="",
        severity="medium",
        model_version=model_version,
        is_suspicious=False,
        is_irrelevant=True,
        details=details,
    )


class GemmaAnalyzer:
    """One call to Gemma per report, with the image attached when we have one."""

    def __init__(self, *, configuration=None):
        self.configuration = configuration
        self.host = getattr(settings, "OLLAMA_HOST", "https://ollama.com")
        self.api_key = getattr(settings, "OLLAMA_API_KEY", "")
        self.model = getattr(settings, "OLLAMA_TEXT_MODEL", OLLAMA_TEXT_MODEL) or OLLAMA_TEXT_MODEL
        self.text_timeout = getattr(settings, "OLLAMA_TIMEOUT_SECONDS", 120)
        self.image_timeout = getattr(settings, "OLLAMA_IMAGE_TIMEOUT_SECONDS", 90)
        self.retry_delay = getattr(settings, "OLLAMA_IMAGE_RETRY_DELAY_SECONDS", 2.0)
        self.image_attempts = max(1, int(getattr(settings, "OLLAMA_IMAGE_MAX_ATTEMPTS", 3)))

    def analyze(
        self,
        *,
        title: str,
        description: str,
        selected_category: str,
        image: PreparedImage | None = None,
    ) -> TextClassificationResult:
        low_information = low_information_reason(description)
        if low_information:
            return low_information_result(
                model_version=self.model,
                reason=low_information,
                image_attached=bool(image),
            )
        if not self.api_key:
            raise TextClassifierNotConfigured("OLLAMA_API_KEY is not configured.")

        try:
            from ollama import Client
        except Exception as exc:
            raise TextClassifierNotConfigured("The ollama Python package is not installed.") from exc

        prompt = build_prompt(
            configuration=self.configuration,
            selected_category=selected_category,
            title=title,
            description=description,
            image_attached=bool(image),
        )

        image_review_succeeded: bool | None = None
        content = ""

        if image is not None:
            content, image_review_succeeded = self._attempt_with_image(Client, prompt, image)

        if not content:
            # Either no image was submitted, or both image attempts failed and
            # we are falling back to the description alone. Either way the
            # report is still analysed — it is never dropped.
            text_prompt = (
                prompt
                if image is None
                else build_prompt(
                    configuration=self.configuration,
                    selected_category=selected_category,
                    title=title,
                    description=description,
                    image_attached=False,
                    # Critical: a photo *was* submitted, we just could not send
                    # it. Without this the model is told there is no image and
                    # writes "since there is no image…" into a summary sitting
                    # directly beneath the resident's photo.
                    image_unreadable=True,
                )
            )
            content = self._request(Client, text_prompt, image=None, timeout=self.text_timeout)

        result = parse_gemma_result(
            content,
            model_version=self.model,
            selected_category=selected_category,
            configuration=self.configuration,
            image_attached=bool(image),
            image_review_succeeded=image_review_succeeded,
        )
        return result

    def _attempt_with_image(self, Client, prompt: str, image: PreparedImage) -> tuple[str, bool]:
        """Try the image request a few times, backing off, then give up.

        Returns (content, succeeded). An empty content string means every
        attempt failed and the caller should fall back to text.

        Ollama Cloud answers image requests with an intermittent HTTP 500: the
        *same* payload succeeds on one call and fails on the next, seconds
        apart. Two attempts a fixed two seconds apart was not enough to ride
        that out, so the count is configurable and the delay doubles each time.
        """
        attempts = self.image_attempts
        for attempt in range(1, attempts + 1):
            started = time.monotonic()
            try:
                content = self._request(Client, prompt, image=image, timeout=self.image_timeout)
            except Exception as exc:
                _log_image_attempt(
                    image,
                    model=self.model,
                    duration_ms=int((time.monotonic() - started) * 1000),
                    attempt=attempt,
                    attempts=attempts,
                    succeeded=False,
                    exc=exc,
                )
                if attempt < attempts:
                    # Exponential: 2s, 4s, 8s… A flaky backend usually recovers
                    # within one of those, and the task has the budget for it.
                    time.sleep(self.retry_delay * (2 ** (attempt - 1)))
                continue
            _log_image_attempt(
                image,
                model=self.model,
                duration_ms=int((time.monotonic() - started) * 1000),
                attempt=attempt,
                attempts=attempts,
                succeeded=True,
                exc=None,
            )
            return content, True
        return "", False

    def _request(self, Client, prompt: str, *, image: PreparedImage | None, timeout) -> str:
        client = Client(
            host=self.host,
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=timeout,
        )
        message = {"role": "user", "content": prompt}
        if image is not None:
            message["images"] = [image.data]
        response = client.chat(
            self.model,
            messages=[
                {"role": "system", "content": "Return valid JSON only. No Markdown. No prose."},
                message,
            ],
            format="json",
            options={"temperature": 0},
            stream=False,
        )
        return _response_content(response)


def _failure_category(exc: Exception | None) -> str:
    if exc is None:
        return ""
    name = exc.__class__.__name__.lower()
    text = str(exc).lower()
    if "timeout" in name or "timed out" in text:
        return "timeout"
    if "connection" in name or "connect" in text:
        return "connection"
    # Ollama Cloud's intermittent image failure. Worth its own label: it looks
    # nothing like a timeout in the logs, and "other" hid what was happening.
    if "internal server error" in text or "status code: 5" in text:
        return "server_error"
    if "json" in name or "json" in text:
        return "invalid_json"
    return "other"


def _log_image_attempt(image: PreparedImage, *, model, duration_ms, attempt, attempts, succeeded, exc) -> None:
    """Developer-only record of one image request. Never reaches the UI.

    Severity reflects the *outcome*, not the attempt. Ollama Cloud fails around
    half of all image requests with a 500 — measured, not guessed — so a first
    attempt failing and the second succeeding is the retry doing its job, not an
    incident. Logging every attempt at WARNING filled the console with alarming
    "Gemma image review failed" lines during runs that worked perfectly.

    Only exhausting every attempt is a warning now; recovered attempts are INFO.
    """
    telemetry = image.telemetry or {}
    exhausted = not succeeded and attempt >= attempts
    record = {
        "filename": telemetry.get("filename"),
        "original_bytes": telemetry.get("original_bytes"),
        "normalized_bytes": telemetry.get("normalized_bytes"),
        "original_resolution": telemetry.get("original_resolution"),
        "normalized_resolution": telemetry.get("normalized_resolution"),
        "mime_type": image.mime_type,
        "source_mime_type": telemetry.get("source_mime_type"),
        "model": model,
        "duration_ms": duration_ms,
        "attempt": f"{attempt}/{attempts}",
        "retry_count": attempt - 1,
        "image_review_succeeded": succeeded,
        "failure_category": _failure_category(exc),
        "exception": exc.__class__.__name__ if exc else "",
    }
    if succeeded:
        logger.info("Gemma image review succeeded %s", json.dumps(record))
    elif exhausted:
        logger.warning("Gemma image review unavailable after %s attempts %s", attempts, json.dumps(record))
    else:
        logger.info("Gemma image attempt failed, retrying %s", json.dumps(record))


def build_prompt(
    *,
    configuration,
    selected_category: str,
    title: str,
    description: str,
    image_attached: bool,
    image_unreadable: bool = False,
) -> str:
    payload = {
        "configured_concern_categories": configured_concern_categories(configuration),
        "configured_emergency_types": configured_emergency_types(),
        "resident_selected_category": selected_category,
        "resident_title": title,
        "resident_description": description,
        "attached_image_available": image_attached,
        "photo_submitted_but_unreadable": image_unreadable,
    }
    unreadable_rule = (
        "\nIMPORTANT: the resident DID submit a photo, but it could not be analyzed this time. "
        "Never write that there is no image, no photo, or that none was provided. Do not describe "
        "the photo or guess what it shows. Say only that the photo could not be reviewed "
        "automatically and that it needs a manual look.\n"
        if image_unreadable
        else ""
    )
    return (
        "You are the report-review assistant for E-Boses, a barangay civic concern and "
        "emergency coordination system in the Philippines.\n\n"
        "Analyze Filipino, English, or Taglish reports, and the attached image when one is provided. "
        "You give recommendations only. You never make the final decision, never reject an emergency, "
        "and never invent information.\n\n"
        "Use only the configured concern categories and emergency types in this payload. "
        "Location is handled separately by the system; do not extract it.\n\n"
        "Rules:\n"
        "1. relevance is VALID, UNCLEAR, or IRRELEVANT.\n"
        "2. primary_category must be one configured concern category key, or empty when unclear.\n"
        "3. possible_categories lists other plausible configured category keys.\n"
        "4. detected_objects lists what you can actually see in the attached image, in ordinary words "
        "(for example: garbage, vehicle, residential gate, floodwater). Leave it empty when no image "
        "is attached. Never list something you only read about in the description.\n"
        "5. If the description is gibberish, keyboard spam, repeated words, mostly symbols, or unrelated "
        "chatter, mark it UNCLEAR or IRRELEVANT and ask for clearer details.\n"
        "6. Strong language inside a real civic report does not make it invalid. Keep it meaningful.\n"
        "7. If the text describes immediate danger, fire, medical distress, violent crime, or serious harm, "
        "set urgent_attention true and consider escalate_as_emergency.\n"
        "8. evidence_relationship must be supports_report, partially_supports_report, contradicts_report, "
        "no_useful_image_evidence, or image_unavailable when no image is attached.\n"
        "9. A category that does not match the photo is a reason for manual_review, never for "
        "reject_as_irrelevant on its own.\n"
        "10. severity is low, medium, or high. Low is minor and non-urgent; medium blocks access or needs "
        "official action; high is immediate danger or serious harm.\n"
        "11. Privacy: set privacy_scan_required true when the image may show something that should not "
        "be public. In suspected_sensitive_classes, name each one as a SHORT CONCRETE OBJECT of one or "
        "two words — the words a person would use to point at it in the photo. These are passed to an "
        "image segmenter that can only find things it can see.\n"
        "    Good: face, license plate, blood, id card, house number, phone screen, name tag, signature, "
        "street sign, tattoo, receipt.\n"
        "    Bad (never use these): injury, personal information, privacy, sensitive content, identity, "
        "victim, evidence, medical detail. A segmenter cannot find a concept, and an empty result would "
        "be mistaken for 'nothing sensitive here'.\n"
        "    Only name something you can actually see in this image. Give short reasons in "
        "privacy_scan_reasons. You are flagging a suspicion for a second system to check — never state "
        "that sensitive content is confirmed, and never state that an image is safe.\n"
        "12. missing_information lists what an official would still need, in short phrases "
        '(for example: "a more specific location", "a clearer photo").\n'
        "13. recommended_action must be accept, accept_with_privacy_review, manual_review, "
        "request_more_information, escalate_as_emergency, or reject_as_irrelevant.\n"
        "14. short_explanation is read by barangay staff. Write one or two complete sentences, at most "
        "about 45 words, that say: what the resident reported, what the image appears to show, whether "
        "the text and image support each other, and why you recommended that next step. Never write "
        'fragments such as "Category yes", "Evidence no", "No photo relevance", or "No supported object". '
        "Do not name any person, do not assign blame, and do not issue the barangay's decision.\n"
        "15. Return valid JSON only. No Markdown.\n"
        f"{unreadable_rule}\n"
        "Example of a good short_explanation: \"The description reports accumulated garbage near the "
        "roadside, and the photo appears to show waste materials in the same area, which supports the "
        "selected Environment category.\"\n\n"
        "Another: \"The description reports a drainage problem, but the photo mainly shows a parked "
        "vehicle and a residential gate, so the image does not confirm the reported issue and manual "
        "review is recommended.\"\n\n"
        f"Payload:\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        "Return exactly this JSON shape:\n"
        "{\n"
        '  "relevance": null,\n'
        '  "primary_category": null,\n'
        '  "possible_categories": [],\n'
        '  "selected_category_match": null,\n'
        '  "detected_objects": [],\n'
        '  "text_assessment": null,\n'
        '  "photo_assessment": null,\n'
        '  "evidence_relationship": null,\n'
        '  "missing_information": [],\n'
        '  "urgent_attention": false,\n'
        '  "severity": null,\n'
        '  "privacy_scan_required": false,\n'
        '  "privacy_scan_reasons": [],\n'
        '  "suspected_sensitive_classes": [],\n'
        '  "ai_result_uncertain": false,\n'
        '  "recommended_action": null,\n'
        '  "short_explanation": null\n'
        "}"
    )


def parse_gemma_result(
    content: str,
    *,
    model_version: str,
    selected_category: str,
    configuration=None,
    image_attached: bool = False,
    image_review_succeeded: bool | None = None,
) -> TextClassificationResult:
    """Coerce Gemma's JSON into the schema, discarding anything out of contract."""
    try:
        data = json.loads(_json_body(content))
    except Exception:
        return safe_needs_review(
            model_version=model_version,
            reason="The automatic review returned an unreadable result, so this report needs a manual look.",
            image_attached=image_attached,
            image_review_succeeded=image_review_succeeded,
        )
    if not isinstance(data, dict):
        return safe_needs_review(
            model_version=model_version,
            reason="The automatic review returned an unreadable result, so this report needs a manual look.",
            image_attached=image_attached,
            image_review_succeeded=image_review_succeeded,
        )

    allowed_categories = (
        {item["key"] for item in configured_concern_categories(configuration)}
        if configuration is not None
        else set(Concern.Category.values)
    )

    relevance = str(data.get("relevance") or "UNCLEAR").upper()
    if relevance not in RELEVANCE_VALUES:
        relevance = "UNCLEAR"

    primary = str(data.get("primary_category") or "")
    if primary not in allowed_categories:
        primary = ""

    possible = [
        str(item)
        for item in _as_list(data.get("possible_categories"))
        if str(item) in allowed_categories and str(item) != primary
    ]

    severity = str(data.get("severity") or "medium").lower()
    if severity not in SEVERITY_VALUES:
        severity = "medium"

    relationship = _resolve_relationship(
        data.get("evidence_relationship"),
        image_attached=image_attached,
        image_review_succeeded=image_review_succeeded,
    )

    action = str(data.get("recommended_action") or "").lower()
    if action not in RECOMMENDED_ACTIONS:
        action = "manual_review"

    urgent = bool(data.get("urgent_attention"))
    if urgent and action == "accept":
        # An accept on something the model itself called urgent is the one
        # combination that would let a dangerous report slide through the queue.
        action = "escalate_as_emergency"

    detected_objects = _clean_strings(data.get("detected_objects"))
    if not image_attached or image_review_succeeded is False:
        # No image was read, so nothing was observed in one. Anything listed
        # here came from the description, which is exactly the invention the
        # prompt forbids.
        detected_objects = []

    suspected = sensitive_classes_from(_as_list(data.get("suspected_sensitive_classes")))
    privacy_required = bool(data.get("privacy_scan_required")) and bool(suspected)
    if image_review_succeeded is False or not image_attached:
        # A privacy suspicion about an image nobody managed to look at is a
        # guess. It must not become a SAM3 request, and it must not become
        # "no sensitive content found" either — the media stays restricted,
        # which the pipeline handles from `image_review_succeeded`.
        privacy_required = False
        suspected = []

    selected_match = data.get("selected_category_match")
    if not isinstance(selected_match, bool):
        selected_match = (primary == selected_category) if primary else None

    uncertain = bool(data.get("ai_result_uncertain")) or image_review_succeeded is False

    details = {
        **empty_details(),
        "relevance": relevance,
        "primary_category": primary,
        "possible_categories": possible,
        "selected_category_match": selected_match,
        "detected_objects": detected_objects,
        "text_assessment": _clean_text(data.get("text_assessment")),
        "photo_assessment": _clean_text(data.get("photo_assessment")),
        "evidence_relationship": relationship,
        "missing_information": _clean_strings(data.get("missing_information")),
        "urgent_attention": urgent,
        "severity": severity,
        "privacy_scan_required": privacy_required,
        "privacy_scan_reasons": _clean_strings(data.get("privacy_scan_reasons")) if privacy_required else [],
        "suspected_sensitive_classes": suspected,
        "ai_result_uncertain": uncertain,
        "recommended_action": action,
        "short_explanation": _clean_text(data.get("short_explanation")),
        "image_review_succeeded": image_review_succeeded,
    }

    label = f"related_{primary}" if relevance == "VALID" and primary else "needs_review"
    is_irrelevant = relevance in {"UNCLEAR", "IRRELEVANT"} or not primary
    is_suspicious = relevance == "IRRELEVANT" and action == "reject_as_irrelevant"

    return TextClassificationResult(
        label=label,
        confidence=1.0 if relevance == "VALID" and primary else 0.0,
        category=primary,
        severity=severity,
        model_version=model_version,
        is_suspicious=is_suspicious,
        is_irrelevant=is_irrelevant,
        details=details,
    )


def _resolve_relationship(value, *, image_attached: bool, image_review_succeeded: bool | None) -> str:
    """Keep the relationship consistent with what actually happened to the image.

    Gemma is not the authority on whether we managed to send it a photo, so the
    two states it cannot know about are decided here. This is what stops the UI
    from ever showing "the photo supports the report" beside "photo review
    unavailable".
    """
    if not image_attached:
        return "image_unavailable"
    if image_review_succeeded is False:
        return "image_review_failed"
    relationship = str(value or "").lower()
    if relationship not in EVIDENCE_RELATIONSHIPS or relationship in {"image_unavailable", "image_review_failed"}:
        return "no_useful_image_evidence"
    return relationship


def payload_from_result(result: TextClassificationResult, *, selected_category: str) -> dict:
    """Flat payload for the configuration screen's sample tester and the resident precheck."""
    details = result.details or {}
    if details.get("selected_category_match") is not None:
        category_match = bool(details.get("selected_category_match"))
    else:
        category_match = bool(result.category) and result.category == selected_category

    if details.get("ai_result_uncertain"):
        outcome = "needs_review"
    elif details.get("relevance") == "IRRELEVANT":
        outcome = "irrelevant"
    elif not result.category or not category_match:
        outcome = "needs_review"
    else:
        outcome = "related"

    return {
        **asdict(result),
        "selected_category": selected_category,
        "category_match": category_match,
        "outcome": outcome,
        "action": details.get("recommended_action") or "manual_review",
        "notice": details.get("short_explanation") or "An official still needs to review this report.",
    }


def _as_list(value) -> list:
    return value if isinstance(value, list) else []


def _clean_strings(value) -> list[str]:
    return [text for text in (str(item).strip() for item in _as_list(value)) if text][:8]


def _clean_text(value) -> str:
    return str(value or "").strip()


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
    """Catch obviously empty submissions before spending a model call on them."""
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


def low_information_result(*, model_version: str, reason: str, image_attached: bool) -> TextClassificationResult:
    details = {
        **empty_details(),
        "text_assessment": reason or "The description needs more clear detail.",
        "photo_assessment": "The photo can be checked once the description is clear." if image_attached else "",
        "evidence_relationship": "no_useful_image_evidence" if image_attached else "image_unavailable",
        "missing_information": ["a clear description of what happened"],
        "ai_result_uncertain": True,
        "recommended_action": "request_more_information",
        "short_explanation": (
            "The description does not give enough detail to understand the issue. "
            "Ask the resident to describe what happened and what needs attention."
        ),
        # None rather than False: we never attempted a review, so this is not an
        # image failure. Either way the pipeline restricts the media, because
        # only `True` means an image was actually looked at.
        "image_review_succeeded": None,
    }
    return TextClassificationResult(
        label="needs_review",
        confidence=0.0,
        category="",
        severity="medium",
        model_version=model_version,
        is_suspicious=False,
        is_irrelevant=True,
        details=details,
    )
