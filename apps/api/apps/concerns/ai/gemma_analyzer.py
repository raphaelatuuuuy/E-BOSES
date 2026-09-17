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
from django.db.models import Q

from apps.concerns.models import Concern, ConcernCategory
from apps.concerns.notification_subject import normalise_notification_subject
from apps.emergencies.models import EmergencyCategory
from apps.emergencies.temporal import NON_CURRENT, infer_incident_timing, normalise_incident_timing

from .image_prep import PreparedImage
from .text_classifier import TextClassificationResult, TextClassifierNotConfigured


OLLAMA_CLOUD_PROVIDER = "ollama_cloud"
OLLAMA_TEXT_MODEL = "gemma4:31b"

RELEVANCE_VALUES = {"VALID", "UNCLEAR", "IRRELEVANT"}
SEVERITY_VALUES = {"low", "medium", "high", "critical"}

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
    "request_more_information",
    "escalate_as_emergency",
    "reject_as_irrelevant",
}

_MAINTENANCE_REPORT_TERMS = (
    "sidewalk", "pothole", "potholes", "walkway", "parking obstruction",
    "blocked access", "cracked pavement", "broken pavement", "road repair",
)
_EXPLICIT_HARM_TERMS = (
    "injured", "hurt", "bleeding", "trapped", "fell", "fallen", "accident",
    "immediate danger", "dangerous now", "about to fall", "someone was hit",
)

# Content-level authenticity. The byte-level layer (accounts/media_forensics.py)
# reads EXIF, PNG chunks, C2PA and ELA, so it catches a Photoshop save or a
# tagged AI export. It cannot catch a screenshot of an AI image, a UFO pasted
# into a clean re-save, or a cartoon portrait on an otherwise ordinary JPEG —
# nothing in the file is wrong, only the scene is. That is what these verdicts
# are for, and neither layer replaces the other.
INTEGRITY_VERDICTS = {
    "authentic",
    "suspected_edit",
    "suspected_ai",
    "impossible_content",
    "photo_of_screen",
    "inconclusive",
}

# "authentic" is the absence of a finding, never proof. Only these act.
INTEGRITY_FLAGGED_VERDICTS = INTEGRITY_VERDICTS - {"authentic", "inconclusive"}

MAX_INTEGRITY_SIGNALS = 4

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
    category_queryset = ConcernCategory.objects.filter(is_active=True)
    if getattr(config, "community_id", None):
        category_queryset = category_queryset.filter(
            Q(community_id=config.community_id) | Q(community__isnull=True)
        )
    categories = list(category_queryset.order_by("community_id", "name"))
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


def configured_emergency_types(configuration=None) -> list[dict]:
    categories = EmergencyCategory.objects.filter(is_active=True)
    community_id = getattr(configuration, "community_id", None)
    if community_id:
        categories = categories.filter(community_id=community_id)
    categories = categories.order_by("sort_order", "label")
    return [{"key": category.code, "label": category.label} for category in categories]


# A concern can be urgent without being one of the emergency types. These are
# deliberately concrete signals: generic words such as "danger", "disaster",
# "ongoing", and "could hurt someone" must never create an emergency match.
# Keeping this allow-list here gives the LLM a strict semantic backstop before
# its output can reach the automatic escalation path.
_EMERGENCY_EVIDENCE_TERMS = {
    "fire": (
        "fire", "smoke", "flame", "flames", "burning", "sunog", "usok", "apoy", "nasusunog",
    ),
    "medical": (
        "medical emergency", "injured", "injury", "bleeding", "not breathing", "unconscious",
        "collapsed", "seizure", "heart attack", "electric shock", "electrocuted", "nahimatay",
        "nasugatan", "hindi makahinga", "walang malay", "nakuryente",
    ),
    "flood": (
        "flood", "flooding", "floodwater", "rising water", "water entering", "baha", "binabaha",
        "rumaragasang tubig",
    ),
    "crime": (
        "crime", "robbery", "robbed", "theft", "stolen", "stealing", "fight", "assault", "shooting",
        "shot", "stabbing", "stabbed", "hold up", "nakawan", "ninakaw", "nanakaw", "nakikipag-away",
        "sinuntok", "sinaksak", "barilan", "pagnanakaw",
    ),
    "domestic_violence": (
        "domestic violence", "family violence", "partner violence", "battered", "abused at home",
        "violence at home", "vawc", "karahasan sa tahanan", "sinaktan ng asawa", "sinaktan sa bahay",
    ),
    "child_protection": (
        "child abuse", "abused child", "missing child", "neglected child", "abandoned child",
        "child exploitation", "pang aabuso sa bata", "inaabuso ang bata", "nawawalang bata",
    ),
    "dangerous_animal": (
        "animal attack", "dog attack", "dog bite", "bitten by", "snake", "ahas", "rabid",
        "dangerous animal", "aggressive dog", "kagat ng aso", "sinugod ng aso",
    ),
    "disaster": (
        "earthquake", "lindol", "landslide", "mudslide", "pagguho", "typhoon", "bagyo", "storm",
        "tropical storm", "tsunami", "volcanic eruption", "eruption", "building collapse",
        "collapsed building", "gumuho", "gumuhong gusali", "tornado", "storm surge",
    ),
    "drug_related": (
        "drug", "drugs", "illegal drugs", "shabu", "meth", "narcotics", "droga", "bentahan ng droga",
        "tulak ng droga",
    ),
}


def has_concrete_emergency_evidence(emergency_type: str, report_text: str) -> bool:
    """Return whether report text contains evidence for this exact emergency type.

    This is intentionally conservative. A high-severity civic hazard such as a
    hanging electrical wire remains a normal concern unless the report also
    describes a configured emergency event, such as an electrocution or fire.
    """
    terms = _EMERGENCY_EVIDENCE_TERMS.get(str(emergency_type or "").strip().lower(), ())
    if not terms:
        return False
    text = re.sub(r"[^a-z0-9]+", " ", str(report_text or "").lower())
    return any(re.search(rf"\b{re.escape(term)}\b", text) for term in terms)


def empty_details() -> dict:
    """Every schema key, at its safe default.

    Used as the base for both fallback results and parsed ones, so no consumer
    ever has to guard against a missing key.
    """
    return {
        "relevance": "UNCLEAR",
        "issue_count": 1,
        "primary_category": "",
        "possible_categories": [],
        "detected_objects": [],
        "report_title": "",
        "notification_subject": "",
        "severity_reason": "",
        "text_assessment": "",
        "photo_assessment": "",
        "evidence_relationship": "image_unavailable",
        "missing_information": [],
        "severity": "medium",
        "privacy_scan_required": False,
        "privacy_scan_reasons": [],
        "suspected_sensitive_classes": [],
        "ai_result_uncertain": False,
        "recommended_action": "accept",
        "short_explanation": "",
        "image_review_succeeded": None,
        "photo_verdicts": [],
        "media_integrity": [],
        "media_integrity_overall": "inconclusive",
        "matched_emergency_type": "",
        "emergency_routing_reason": "",
        "ongoing_emergency_confirmation_required": False,
        "incident_timing": "unclear",
        "incident_timing_reason": "",
        "current_danger": False,
    }


def safe_needs_review(
    *,
    model_version: str,
    reason: str,
    image_attached: bool = False,
    image_review_succeeded: bool | None = None,
) -> TextClassificationResult:
    """The result used whenever Gemma could not produce one.

    Deliberately not "irrelevant": a model outage must not reject a real report.
    Deterministic intake checks remain authoritative and unread media stays
    private.
    """
    details = {
        **empty_details(),
        "evidence_relationship": "image_review_failed" if image_attached else "image_unavailable",
        "ai_result_uncertain": True,
        "recommended_action": "accept",
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

    def __init__(self, *, configuration=None, text_timeout=None):
        self.configuration = configuration
        self.host = getattr(settings, "OLLAMA_HOST", "https://ollama.com")
        self.api_key = getattr(settings, "OLLAMA_API_KEY", "")
        self.model = getattr(settings, "OLLAMA_TEXT_MODEL", OLLAMA_TEXT_MODEL) or OLLAMA_TEXT_MODEL
        # Interactive callers (resident precheck) pass a tighter budget than
        # the pipeline default so a stalled model cannot hold their request.
        self.text_timeout = int(text_timeout or getattr(settings, "OLLAMA_TIMEOUT_SECONDS", 120))
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
        images: list[PreparedImage] | None = None,
        image_uploaded: bool | None = None,
    ) -> TextClassificationResult:
        prepared_images = images if images is not None else ([image] if image is not None else [])
        image_attached = bool(prepared_images)
        # A photo can fail preparation (bad format, too large, corrupt) before
        # it ever reaches this method — the caller still knows the resident
        # attached one. image_uploaded carries that fact so the prompt below
        # never claims none was provided.
        image_submitted = image_attached or bool(image_uploaded)
        low_information = low_information_reason(description)
        if low_information:
            return low_information_result(
                model_version=self.model,
                reason=low_information,
                image_attached=image_attached,
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
            image_attached=image_attached,
            image_count=len(prepared_images),
            image_unreadable=image_submitted and not image_attached,
        )

        image_review_succeeded: bool | None = None
        content = ""

        if prepared_images:
            content, image_review_succeeded = self._attempt_with_image(Client, prompt, prepared_images)

        if not content:
            # Either no image was submitted, or an image was submitted (or
            # attempted) and never made it to the model — either because
            # preparation rejected it before this call, or every attempt
            # here failed. Either way the report is still analysed, it is
            # never dropped.
            text_prompt = (
                prompt
                if not image_submitted
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
            content = self._request(Client, text_prompt, images=None, timeout=self.text_timeout)

        result = parse_gemma_result(
            content,
            model_version=self.model,
            selected_category=selected_category,
            configuration=self.configuration,
            image_attached=image_attached,
            image_review_succeeded=image_review_succeeded,
            photo_count=len(prepared_images),
            report_text=f"{title} {description}".strip(),
        )
        return result

    def _attempt_with_image(self, Client, prompt: str, images: list[PreparedImage]) -> tuple[str, bool]:
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
                content = self._request(Client, prompt, images=images, timeout=self.image_timeout)
            except Exception as exc:
                _log_image_attempt(
                    images,
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
                images,
                model=self.model,
                duration_ms=int((time.monotonic() - started) * 1000),
                attempt=attempt,
                attempts=attempts,
                succeeded=True,
                exc=None,
            )
            return content, True
        return "", False

    def _request(self, Client, prompt: str, *, images: list[PreparedImage] | None, timeout) -> str:
        client = Client(
            host=self.host,
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=timeout,
        )
        message = {"role": "user", "content": prompt}
        if images:
            message["images"] = [image.data for image in images]
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


def _log_image_attempt(images: list[PreparedImage], *, model, duration_ms, attempt, attempts, succeeded, exc) -> None:
    """Developer-only record of one image request. Never reaches the UI.

    Severity reflects the *outcome*, not the attempt. Ollama Cloud fails around
    half of all image requests with a 500 — measured, not guessed — so a first
    attempt failing and the second succeeding is the retry doing its job, not an
    incident. Logging every attempt at WARNING filled the console with alarming
    "Gemma image review failed" lines during runs that worked perfectly.

    Only exhausting every attempt is a warning now; recovered attempts are INFO.
    """
    telemetry = (images[0].telemetry if images else {}) or {}
    exhausted = not succeeded and attempt >= attempts
    record = {
        "image_count": len(images),
        "filename": telemetry.get("filename"),
        "original_bytes": telemetry.get("original_bytes"),
        "normalized_bytes": telemetry.get("normalized_bytes"),
        "original_resolution": telemetry.get("original_resolution"),
        "normalized_resolution": telemetry.get("normalized_resolution"),
        "mime_type": images[0].mime_type if images else "",
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
    image_count: int = 1,
    image_unreadable: bool = False,
) -> str:
    payload = {
        "configured_concern_categories": configured_concern_categories(configuration),
        "configured_emergency_types": configured_emergency_types(configuration),
        "resident_title": title,
        "resident_description": description,
        "attached_image_available": image_attached,
        "attached_image_count": image_count,
        "photo_submitted_but_unreadable": image_unreadable,
    }
    unreadable_rule = (
        "\nIMPORTANT: the resident DID submit a photo, but it could not be analyzed this time. "
        "Never write that there is no image, no photo, or that none was provided. Do not describe "
        "the photo or guess what it shows. Say only that the photo could not be reviewed "
        "automatically and that the image will stay private.\n"
        if image_unreadable
        else ""
    )
    return (
        "You are the report-review assistant for E-Boses, a barangay civic concern and "
        "emergency coordination system in the Philippines.\n\n"
        "Analyze Filipino, English, or Taglish reports, and the attached image when one is provided. "
        "You return structured evidence for the automatic validation rules. Never reject an emergency "
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
         "chatter, mark it UNCLEAR or IRRELEVANT and ask for clearer details. A meaningful issue followed "
         "by unrelated text is still unclear; do not accept only the meaningful fragment.\n"
         "6. Check the complete description for foul, abusive, sexual, hateful, threatening, obscene, "
         "promotional, spam, or otherwise inappropriate language. If any is present, mark the description "
         "UNCLEAR, set issue_count to 0, leave primary_category empty, and use request_more_information. "
         "Do not repeat or display the offending words in any generated field. Do not penalize ordinary "
         "emotion, urgency, Taglish, or spelling mistakes when the complete statement remains appropriate "
         "and understandable.\n"
        "7. First decide incident_timing from the grammar and time words: ongoing, ended, historical, planned, "
        "hypothetical, or unclear. Category words such as fire, crime, accident, or medical do not prove that "
        "danger exists now. Read tense, negation, completion, drills, examples, quoted news, and future plans. "
        "Set current_danger true only when harm is happening now or a danger remains. A past start can still be "
        "ongoing, for example a fire that started yesterday but is still burning or a person who is still trapped.\n"
        "8. Only ongoing danger can use escalate_as_emergency. Ended, historical, "
        "planned, and hypothetical events stay normal concerns. When timing is unclear but current danger is "
        "possible, set ongoing_emergency_confirmation_required true instead of assuming. Examples: 'May sunog "
        "ngayon' is ongoing; 'Nasunog kahapon, naapula na' is ended; 'The fire was last night but a person is "
        "still trapped' is ongoing; 'Fire drill bukas' is planned.\n"
        "9. When the report describes a possible active emergency, set matched_emergency_type to the single "
        "best-matching key from configured_emergency_types (empty string if none fits), and write one "
        "sentence in emergency_routing_reason naming which configured emergency type and why. Do this "
        "independently of primary_category — a report can match both a concern category and an emergency "
        "type.\n"
        "9a. Be strict: an emergency type requires concrete event evidence in the report, not just a high "
        "severity, an ongoing hazard, or words such as danger, disaster, urgent, or could hurt someone. "
        "A hanging or exposed wire, cable, broken streetlight, pothole, garbage, drainage issue, fallen "
        "tree, or blocked road is a normal civic concern and must leave matched_emergency_type empty unless "
        "the report separately describes a configured emergency such as fire, flood, electrocution/injury, "
        "assault, or a named natural disaster. Never use disaster as a generic label for a dangerous concern.\n"
        "10. evidence_relationship must be supports_report, partially_supports_report, contradicts_report, "
        "no_useful_image_evidence, or image_unavailable when no image is attached.\n"
        "10a. If evidence_relationship is contradicts_report, or any photo_verdicts item has "
        "relevance contradicts_report, recommended_action must be request_more_information. "
        "Never accept a report when the photo contradicts the description, even if the selected "
        "category or reported area matches.\n"
         "10b. When one or more photos are attached and successfully reviewed, every "
         "photo_verdicts item must have relevance supports_report before recommended_action can be "
         "accept. A photo that merely shows the general location, road, or surroundings does not "
         "support a claimed defect unless that defect is actually visible. If any photo is neutral, "
         "unclear, or contradicts the report, use request_more_information.\n"
         "10c. Split the description into its concrete issue claims and compare every claim against "
         "each photo. Ignore polite requests and filler words. Use supports_report only when the "
         "photo visibly confirms all concrete issue claims in that description. Generic overlap is "
         "not enough: debris is not automatically garbage collection, a wet road is not automatically "
         "flooding, and a street or sidewalk is not automatically the reported damage. If a photo "
          "confirms only some claims, use unclear for that photo and set evidence_relationship to "
          "partially_supports_report; never treat partial support as a passing match.\n"
          "10d. Set issue_count to the number of distinct concrete civic issues in the description. "
          "One issue with several details or symptoms counts as 1. Two separate requests, such as a "
          "broken sidewalk and garbage collection, count as 2. If the description combines a valid "
          "issue with unrelated word salad, nonsense, or casual text that does not explain the issue, "
          "set issue_count to 0, relevance to UNCLEAR, primary_category to null, and "
          "recommended_action to request_more_information. If issue_count is greater than 1, set "
          "recommended_action to request_more_information.\n"
          "10e. The photo cannot repair an unclear or inappropriate description. If the photo clearly shows the valid "
          "part of a mixed description, still set issue_count to 0 and request a new understandable "
          "statement. Only a description whose complete meaningful content is about the same civic issue "
          "shown in the photo can pass.\n"
         "11. Choose the single best primary_category from the configured concern categories using "
        "the report and image. This category is authoritative and will be used for routing. Do not "
        "compare it with a resident-selected category. Never use reject_as_irrelevant only because "
        "of category choice.\n"
        "12. Decide severity in this order: first write severity_reason, then pick the severity that "
        "reason actually supports. Judge the real risk to people from the description AND the photo "
        "together — read scale from the image: how deep, how wide, how close to where people walk, "
        "whether anything is already broken or exposed.\n"
        "    critical = someone is being harmed right now or is in immediate mortal danger. A person "
        "already reported injured or trapped, an active fire, flood water inside occupied homes with "
        "people unable to evacuate, an active assault or robbery in progress, or a collapsing "
        "structure with occupants. Do not use critical for a hazard that could cause harm; use it "
        "only when the report states that harm is already happening or is seconds away.\n"
        "    high  = someone can be hurt as things stand but is not currently being harmed. A hole "
        "or opening a person can fall into, exposed or sagging electrical wiring, a structure at "
        "risk of collapse, water entering occupied homes, a hazard right where children pass such as "
        "a school or day-care gate, or anyone already reported hurt.\n"
        "    medium = it blocks access, damages property, or is a health risk that needs official "
        "action, but nobody is about to be injured. Clogged or overflowing canals, uncollected "
        "garbage, a dark streetlight on an ordinary street, a rough or cracked road surface.\n"
         "    A damaged sidewalk, parking obstruction, driveway obstruction, or blocked access route "
         "with no stated immediate risk of injury is medium: set current_danger to false.\n"
        "    low   = nuisance, comfort or upkeep with no physical risk. Noise, videoke, faded paint, "
        "overgrown grass, scattered litter, a stray animal that has not harmed anyone.\n"
        "    Do not default to medium. Most ordinary reports are low or medium; keep high for a real "
        "risk of injury and critical only for confirmed ongoing harm. These must never disagree: "
        "if your reason says nobody is in physical danger, severity is not high; if your reason "
        "names someone who could be hurt today, severity is not low.\n"
         "11a. severity_reason is one sentence naming the specific thing in the description or image "
         "that set that severity -- what is damaged, blocked, or at risk, and who it affects. Never "
         "restate the level itself. When severity is critical, describe who is being harmed or is "
         "in immediate mortal danger. When severity is high with current danger and ongoing timing, "
         "describe the human risk naturally. Do not use the generic phrase risk of injury for a "
         "Critical report, and do not claim anyone is already injured unless the report says so.\n"
         "11b. report_title is a short official heading for the barangay queue: at most 10 words, no "
         "ending period, naming the issue and where it is. Write it in English even when the report is "
         "in Filipino or Taglish. State only what the report and image support, never a cause or blame. "
         "Good: Stray dogs gathering outside the day-care on Dao Street. "
         "Bad: Urgent!!! ang daming askal!!!, Negligent owners letting dogs roam.\n"
         "11c. text_assessment is the concise, plain-English summary shown to residents and staff. "
         "Write one or two natural sentences explaining what the report is about. When severity is "
         "critical, the system displays the report as Critical, so describe the immediate human risk in "
         "context rather than copying a priority label or appending a canned sentence. For example, "
         "write 'The report describes a vehicle collision that just happened near Ayala Malls, where "
         "someone could be hurt.' Do not use the generic phrase 'risk of injury' for an urgent report. "
         "Keep the summary grounded in the resident description and image; do not invent that anyone is "
         "already injured.\n"
         "11d. notification_subject is the short subject shown in a resident notification: exactly one, "
        "two, or three words only. It must name the concrete issue, not the category, location, report "
        "status, urgency, or a generic phrase. Write it in clear English, without punctuation, quotes, "
        "a sentence, or an explanation. Prefer specific phrases such as 'Roadside Pothole', "
        "'Blocked Drainage', 'Fallen Powerline', 'Accumulated Garbage', or 'Broken Streetlight'. "
        "Do not use 'Community Concern', 'General Issue', 'Report Update', or 'Public Safety' unless "
        "the report truly gives no more specific clue. Never invent a detail that is not supported by "
        "the report or image.\n"
        "12. Privacy: set privacy_scan_required true when the image may show something that should not "
        "be public. In suspected_sensitive_classes, name each one as a SHORT CONCRETE OBJECT of one or "
        "two words — the words a person would use to point at it in the photo. These are passed to an "
        "image segmenter that can only find things it can see.\n"
        "    Good: face or license plate. These are the only objects the automatic "
        "public blur is allowed to cover. Never request a street sign, house number, "
        "sidewalk, cable, wire, document, or other readable civic evidence.\n"
        "    Bad (never use these): injury, personal information, privacy, sensitive content, identity, "
        "victim, evidence, medical detail. A segmenter cannot find a concept, and an empty result would "
        "be mistaken for 'nothing sensitive here'.\n"
        "    Only name something you can actually see in this image. Give short reasons in "
        "privacy_scan_reasons. You are flagging a suspicion for a second system to check — never state "
        "that sensitive content is confirmed, and never state that an image is safe.\n"
        "13. missing_information lists what the resident must add in a new submission, in short phrases "
        '(for example: "a more specific location", "a clearer photo").\n'
        "14. recommended_action must be accept, accept_with_privacy_review, "
        "request_more_information, escalate_as_emergency, or reject_as_irrelevant.\n"
        "15. short_explanation is read by barangay staff, shown next to a separate recommended_action "
        "field they already see. Write one or two complete sentences, at most about 45 words, that "
        "describe FINDINGS only: what the resident reported, what the image appears to show, and "
        "whether the text and image support each other. This is a findings summary, never a "
        "recommendation — do not write \"I recommend\", \"acceptance is recommended\", \"should be "
        "accepted\", or any other phrasing that states or restates a decision; recommended_action "
        "already carries that. Never write fragments such as \"Category yes\", \"Evidence no\", \"No "
        "photo relevance\", or \"No supported object\". Do not name any person, do not assign blame, "
        "and do not issue the barangay's decision.\n"
        "16. Return valid JSON only. No Markdown.\n"
        "17. photo_verdicts: when images are attached, judge each photo on its own. "
        "Each item has index (the 0-based position of that photo, in the order they were attached), "
        "relevance (supports_report, contradicts_report, neutral, or unclear), and a one-sentence "
        "note saying what the photo appears to show and whether it matches the described issue. "
        "Never skip a photo that was attached. Return [] when no image is attached.\n"
        "18. media_integrity: judge each attached photo on whether it looks like a straight, "
        "unedited camera photo of a real scene. Report only what you can SEE. You cannot read "
        "file metadata, so never refer to it.\n"
        "    Signs to look for: an object whose lighting, shadow direction, or scale disagrees "
        "with the rest of the scene; edges that are unnaturally clean, smeared, or repeated "
        "(clone stamping); text or logos that are warped, misspelled, or dissolve into scribble; "
        "hands, faces, or repeated structures with the wrong count or geometry; a scene that "
        "could not physically occur (a UFO, a cartoon character, a fictional creature, an "
        "impossible vehicle); a smooth rendered surface unlike camera sensor grain; screen "
        "glare, moire, pixel grid, or a device bezel, meaning this is a photo of a screen "
        "rather than of the scene itself.\n"
        "    verdict is authentic, suspected_edit, suspected_ai, impossible_content, "
        "photo_of_screen, or inconclusive. Use inconclusive when the photo is too small, dark, "
        "plain, or blurred to judge — that is a normal, common outcome and is not an accusation.\n"
        "    confidence is 0.0 to 1.0 and states how sure you are of that verdict.\n"
        "    signals lists the short concrete things you actually saw, in ordinary words (for "
        'example: "the shadow of the object falls opposite to every other shadow", "the sign '
        'text is unreadable scribble"). Leave it empty for authentic and inconclusive.\n'
        "    Never state that a photo is genuine or proven real. authentic means only that you "
        "saw no sign of a problem. Return [] when no image is attached.\n"
        "19. Ordinary phone-photo defects are NOT manipulation. Never flag: compression blocks "
        "or artefacts, low light, grain, motion blur, a date or time stamp burned in by the "
        "camera, portrait-mode background blur, a watermark, a rotated or cropped frame, or a "
        "photo taken at an angle. A real resident's photo usually has several of these.\n"
        "    media_integrity_overall is the most serious verdict among the photos, using this "
        "order: impossible_content, suspected_ai, suspected_edit, photo_of_screen, inconclusive, "
        "authentic.\n"
        f"{unreadable_rule}\n"
        "Example of a good short_explanation: \"The description reports accumulated garbage near the "
        "roadside, and the photo appears to show waste materials in the same area, which supports the "
        "the Environment category.\"\n\n"
        "Another: \"The description reports a drainage problem, but the photo mainly shows a parked "
        "vehicle and a residential gate, so the image does not confirm the reported issue.\"\n\n"
        f"Payload:\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        "Return exactly this JSON shape:\n"
        "{\n"
         '  "relevance": null,\n'
         '  "issue_count": 1,\n'
         '  "primary_category": null,\n'
        '  "possible_categories": [],\n'
        '  "detected_objects": [],\n'
        '  "report_title": null,\n'
        '  "notification_subject": null,\n'
        '  "text_assessment": null,\n'
        '  "photo_assessment": null,\n'
        '  "evidence_relationship": null,\n'
        '  "missing_information": [],\n'
        '  "severity_reason": null,\n'
        '  "severity": null,\n'
        '  "privacy_scan_required": false,\n'
        '  "privacy_scan_reasons": [],\n'
        '  "suspected_sensitive_classes": [],\n'
        '  "ai_result_uncertain": false,\n'
        '  "recommended_action": null,\n'
        '  "short_explanation": null,\n'
        '  "photo_verdicts": [{"index": 0, "relevance": "supports_report", "note": "The photo shows the reported issue."}],\n'
        '  "media_integrity": [{"index": 0, "verdict": "authentic", "confidence": 0.0, "signals": [], "note": ""}],\n'
        '  "media_integrity_overall": null,\n'
        '  "matched_emergency_type": null,\n'
        '  "emergency_routing_reason": null,\n'
        '  "ongoing_emergency_confirmation_required": false,\n'
        '  "incident_timing": "unclear",\n'
        '  "incident_timing_reason": "The report does not clearly say if danger remains.",\n'
        '  "current_danger": false\n'
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
    photo_count: int = 0,
    report_text: str = "",
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
        action = "accept"

    try:
        issue_count = int(data.get("issue_count", 1))
    except (TypeError, ValueError):
        issue_count = 1
    issue_count = max(0, min(issue_count, 5))
    if issue_count == 0:
        relevance = "UNCLEAR"
        primary = ""
        possible = []
        action = "request_more_information"
    elif issue_count > 1:
        action = "request_more_information"

    detected_objects = _clean_strings(data.get("detected_objects"))
    if not image_attached or image_review_succeeded is False:
        # No image was read, so nothing was observed in one. Anything listed
        # here came from the description, which is exactly the invention the
        # prompt forbids.
        detected_objects = []

    photo_verdicts = _coerce_photo_verdicts(data.get("photo_verdicts"), count=photo_count)
    if not image_attached or image_review_succeeded is False:
        photo_verdicts = []

    if relationship == "contradicts_report" or any(
        item.get("relevance") == "contradicts_report" for item in photo_verdicts
    ):
        action = "request_more_information"

    min_integrity_confidence = float(
        getattr(configuration, "media_integrity_min_confidence", None) or 0.70
    )
    media_integrity = _coerce_integrity(
        data.get("media_integrity"),
        count=photo_count,
        min_confidence=min_integrity_confidence,
    )
    if not image_attached or image_review_succeeded is False:
        # Same reasoning as detected_objects above: an authenticity claim about
        # an image nobody managed to look at is invention, and "authentic" would
        # be the more dangerous of the two possible inventions.
        media_integrity = []
    media_integrity_overall = integrity_overall(media_integrity)

    suspected = sensitive_classes_from(_as_list(data.get("suspected_sensitive_classes")))
    privacy_required = bool(data.get("privacy_scan_required")) and bool(suspected)
    if image_review_succeeded is False or not image_attached:
        # A privacy suspicion about an image nobody managed to look at is a
        # guess. It must not become a SAM3 request, and it must not become
        # "no sensitive content found" either — the media stays restricted,
        # which the pipeline handles from `image_review_succeeded`.
        privacy_required = False
        suspected = []

    uncertain = bool(data.get("ai_result_uncertain")) or image_review_succeeded is False

    allowed_emergency_types = {item["key"] for item in configured_emergency_types(configuration)}
    matched_emergency_type = str(data.get("matched_emergency_type") or "")
    if matched_emergency_type not in allowed_emergency_types:
        matched_emergency_type = ""

    emergency_routing_reason = _clean_text(data.get("emergency_routing_reason"))
    if matched_emergency_type and not has_concrete_emergency_evidence(matched_emergency_type, report_text):
        # Do not let a model infer an emergency type from severity alone. This
        # is the final guard before the precheck can authorize auto-escalation.
        matched_emergency_type = ""
        emergency_routing_reason = ""
        if action == "escalate_as_emergency":
            action = "accept"
    inferred_timing, inferred_reason = infer_incident_timing(report_text)
    model_timing = normalise_incident_timing(data.get("incident_timing"))
    incident_timing = inferred_timing if inferred_timing != "unclear" else model_timing
    incident_timing_reason = (
        inferred_reason
        if inferred_timing != "unclear"
        else _clean_text(data.get("incident_timing_reason")) or inferred_reason
    )
    current_danger = incident_timing == "ongoing" or (
        incident_timing == "unclear" and bool(data.get("current_danger"))
    )

    report_text_lower = report_text.lower()
    maintenance_report = any(term in report_text_lower for term in _MAINTENANCE_REPORT_TERMS)
    explicit_harm = any(term in report_text_lower for term in _EXPLICIT_HARM_TERMS)
    if severity == "high" and maintenance_report and not explicit_harm and not matched_emergency_type:
        severity = "medium"

    # Timing only matters when the report was otherwise an emergency signal.
    # Running the drill/past/future downgrade on every concern -- including
    # ordinary ones the model never called urgent -- surfaced an irrelevant
    # "this is not a current emergency" line on plain infrastructure reports.
    had_emergency_signal = bool(matched_emergency_type) or bool(data.get("current_danger"))

    if incident_timing in NON_CURRENT and had_emergency_signal:
        matched_emergency_type = ""
        current_danger = False
        ongoing_emergency_confirmation_required = False
        if action == "escalate_as_emergency":
            action = "accept"
        emergency_routing_reason = incident_timing_reason
    elif incident_timing == "ongoing" and matched_emergency_type:
        action = "escalate_as_emergency"
        ongoing_emergency_confirmation_required = False
    else:
        ongoing_emergency_confirmation_required = bool(
            matched_emergency_type and incident_timing == "unclear" and current_danger
        )
        if incident_timing in NON_CURRENT:
            incident_timing = "unclear"
            incident_timing_reason = ""

    details = {
        **empty_details(),
        "relevance": relevance,
        "issue_count": issue_count,
        "primary_category": primary,
        "possible_categories": possible,
        "detected_objects": detected_objects,
        "report_title": _clean_text(data.get("report_title"))[:140],
        "notification_subject": normalise_notification_subject(data.get("notification_subject")),
        "severity_reason": _clean_text(data.get("severity_reason"))[:300],
        "text_assessment": _clean_text(data.get("text_assessment")),
        "photo_assessment": _clean_text(data.get("photo_assessment")),
        "evidence_relationship": relationship,
        "missing_information": _clean_strings(data.get("missing_information")),
        "severity": severity,
        "privacy_scan_required": privacy_required,
        "privacy_scan_reasons": _clean_strings(data.get("privacy_scan_reasons")) if privacy_required else [],
        "suspected_sensitive_classes": suspected,
        "ai_result_uncertain": uncertain,
        "recommended_action": action,
        "short_explanation": _clean_text(data.get("short_explanation")),
        "image_review_succeeded": image_review_succeeded,
        "photo_verdicts": photo_verdicts,
        "media_integrity": media_integrity,
        "media_integrity_overall": media_integrity_overall,
        "matched_emergency_type": matched_emergency_type,
        "emergency_routing_reason": emergency_routing_reason,
        "ongoing_emergency_confirmation_required": ongoing_emergency_confirmation_required,
        "incident_timing": incident_timing,
        "incident_timing_reason": incident_timing_reason,
        "current_danger": current_danger,
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
    """Flat payload for the configuration screen's sample tester and resident precheck.

    Category ownership belongs to the model now. ``selected_category`` remains
    in the function signature for old callers, but it is not used to decide
    whether the report is valid.
    """
    details = result.details or {}
    category_match = bool(result.category)

    if details.get("ai_result_uncertain"):
        outcome = "needs_review"
    elif details.get("relevance") == "IRRELEVANT":
        outcome = "irrelevant"
    elif not result.category:
        outcome = "needs_review"
    else:
        outcome = "related"

    return {
        **asdict(result),
        "category_match": category_match,
        "outcome": outcome,
        "action": details.get("recommended_action") or "accept",
        "notice": details.get("short_explanation") or "Automatic validation used the safe intake fallback.",
    }


def _as_list(value) -> list:
    return value if isinstance(value, list) else []


def _clean_strings(value) -> list[str]:
    return [text for text in (str(item).strip() for item in _as_list(value)) if text][:8]


def _clean_text(value) -> str:
    return str(value or "").strip()


_PHOTO_VERDICT_RELEVANCES = {"supports_report", "contradicts_report", "neutral", "unclear"}


def _coerce_photo_verdicts(value, *, count: int) -> list[dict]:
    """Normalise per-photo verdicts: one entry per index, in model order."""
    verdicts: list[dict] = []
    seen = set()
    for item in _as_list(value):
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if index < 0 or index >= count or index in seen:
            continue
        seen.add(index)
        relevance = str(item.get("relevance") or "unclear").lower()
        if relevance not in _PHOTO_VERDICT_RELEVANCES:
            relevance = "unclear"
        verdicts.append(
            {
                "index": index,
                "relevance": relevance,
                "note": str(item.get("note") or "").strip()[:200],
            }
        )
    return verdicts


# Most serious first. Used to pick the overall verdict and to keep the model
# from downgrading a flagged photo by reporting a calmer overall value.
_INTEGRITY_SEVERITY = [
    "impossible_content",
    "suspected_ai",
    "suspected_edit",
    "photo_of_screen",
    "inconclusive",
    "authentic",
]


def _coerce_integrity(value, *, count: int, min_confidence: float) -> list[dict]:
    """Normalise per-photo integrity findings, dropping anything out of contract.

    A verdict below `min_confidence` becomes "inconclusive". A low-confidence
    guess must never reject a real resident's report, and the alternative —
    letting the caller compare the number itself — has been forgotten at one
    call site or another in every version of this file.
    """
    findings: list[dict] = []
    seen = set()
    for item in _as_list(value):
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if index < 0 or index >= count or index in seen:
            continue
        seen.add(index)
        verdict = str(item.get("verdict") or "").lower().strip()
        if verdict not in INTEGRITY_VERDICTS:
            verdict = "inconclusive"
        try:
            confidence = round(min(max(float(item.get("confidence") or 0.0), 0.0), 1.0), 3)
        except (TypeError, ValueError):
            confidence = 0.0
        if verdict in INTEGRITY_FLAGGED_VERDICTS and confidence < min_confidence:
            verdict = "inconclusive"
        signals = (
            _clean_strings(item.get("signals"))[:MAX_INTEGRITY_SIGNALS]
            if verdict in INTEGRITY_FLAGGED_VERDICTS
            else []
        )
        findings.append(
            {
                "index": index,
                "verdict": verdict,
                "confidence": confidence,
                "signals": signals,
                "note": _clean_text(item.get("note"))[:200],
            }
        )
    return findings


def integrity_overall(findings: list[dict]) -> str:
    """The most serious verdict across the photos.

    Derived rather than read from the model: asked for both, Gemma will
    sometimes flag one photo and then report a calm overall value, and the
    quieter of the two must not be the one that decides.
    """
    if not findings:
        return "inconclusive"
    verdicts = {str(item.get("verdict") or "inconclusive") for item in findings}
    for verdict in _INTEGRITY_SEVERITY:
        if verdict in verdicts:
            return verdict
    return "inconclusive"


def flagged_integrity_findings(findings: list[dict]) -> list[dict]:
    return [item for item in findings if item.get("verdict") in INTEGRITY_FLAGGED_VERDICTS]


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
    if letters and len(set(letters)) <= 2 and (
        len(letters) >= 5 or any(letters.count(word) >= 3 for word in set(letters))
    ):
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
        "issue_count": 0,
        "ai_result_uncertain": True,
        "low_information": True,
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


STREET_VERDICTS = {"area_matches", "area_mismatch", "inconclusive"}
PHOTO_DUP_VERDICTS = {"same_issue", "different", "uncertain"}


def _vision_json_call(*, prompt: str, images: list[PreparedImage], configuration=None) -> dict | None:
    """One JSON-mode Gemma call with images attached. None on any failure.

    Used by the auxiliary checks (street-imagery verification, visual photo
    dedup). These are advisory signals, so unlike the main analysis a failure
    here degrades to "check skipped" rather than failing the report.
    """
    api_key = getattr(settings, "OLLAMA_API_KEY", "")
    if not api_key:
        return None
    try:
        from ollama import Client
    except Exception:
        return None
    client = Client(
        host=getattr(settings, "OLLAMA_HOST", "https://ollama.com"),
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=float(getattr(settings, "OLLAMA_IMAGE_TIMEOUT_SECONDS", 90)),
    )
    message = {"role": "user", "content": prompt, "images": [image.data for image in images]}
    try:
        response = client.chat(
            getattr(settings, "OLLAMA_TEXT_MODEL", OLLAMA_TEXT_MODEL) or OLLAMA_TEXT_MODEL,
            messages=[
                {"role": "system", "content": "Return valid JSON only. No Markdown. No prose."},
                message,
            ],
            format="json",
            options={"temperature": 0},
            stream=False,
        )
        parsed = json.loads(_json_body(_response_content(response)))
        return parsed if isinstance(parsed, dict) else None
    except Exception as exc:
        logger.warning("Auxiliary vision check failed: %s", exc.__class__.__name__)
        return None


def verify_street_context(*, submitted: list[PreparedImage], street: PreparedImage) -> dict | None:
    """Check whether the submitted concern photo(s) and current street imagery show the same place.

    This is a location sanity check, nothing more: does the pin sit where the
    resident's photo says it does? It is never a search for the reported issue
    itself. A passing street-view car will almost never happen to have caught
    a specific pothole, crack, or pile of garbage at the moment it drove by —
    that is expected on nearly every real report and must never read as a
    problem with the report.

    A report is not limited to one photo. Every submitted photo is sent so any
    one of them — a wide shot with more surroundings, say, even if another is a
    tight close-up of just the issue — can match. `street` is always singular:
    one panorama near the pin, never one per submitted photo.

    Returns {"verdict": area_matches|area_mismatch|inconclusive, "explanation":
    str} or None when the call failed (treated as skipped).
    """
    if not submitted:
        return None
    submitted_count = len(submitted)
    photo_ref = "IMAGE 1" if submitted_count == 1 else f"IMAGES 1-{submitted_count}"
    pano_number = submitted_count + 1
    prompt = (
        "You verify the LOCATION of civic concern reports for a barangay system "
        "in the Philippines. This is a place check only.\n\n"
        f"{photo_ref}: the photo(s) the resident submitted with their report — "
        "different angles or distances of the same reported location, not "
        "different places.\n"
        f"IMAGE {pano_number} is a full 360-degree street-level panorama "
        "captured at (or very near) the reported pin location recently, "
        f"unrolled into one wide strip. The surroundings shown in {photo_ref} "
        "could line up with any part of that strip, including the far left or "
        f"right edge, not just the center. Scan the ENTIRE width of IMAGE "
        f"{pano_number} from edge to edge before deciding. The panorama was "
        "taken by a moving camera, so it may show the street from a different "
        f"angle and at a different moment than {photo_ref}.\n\n"
        f"Your ONLY job is to judge whether IMAGE {pano_number} shows the SAME "
        f"general place as {photo_ref} — the same street, the same block, the "
        "same kind of surroundings (similar buildings, fences, road markings, "
        "vegetation, etc.). Do NOT look for the reported issue itself (the "
        "pothole, the garbage, the damage — whatever the report describes). "
        f"Whether that specific issue is visible in IMAGE {pano_number} is "
        "irrelevant and must never affect your verdict — a real, correctly "
        "located report will very often not have its exact issue visible in a "
        "drive-by panorama, and that is completely normal.\n\n"
        f"First check: does {photo_ref} even show enough surroundings to compare "
        "— a street, a fence, a building, anything beyond the reported issue "
        "itself? A tight close-up of a pothole, a pile of garbage, or a crack "
        "with no background is NOT evidence of a different place — it is simply "
        "not evidence of anything. If none of the submitted photos show enough "
        "surroundings to compare, stop here and answer \"inconclusive\". Never "
        "answer \"area_mismatch\" just because a close-up photo has little or no "
        "background to check.\n\n"
        "If there is background to compare, judge the general TYPE OF "
        "ENVIRONMENT first — this is the main signal, weigh it more than any "
        "single small detail: the pavement and ground itself (paved asphalt "
        "vs. concrete vs. bare dirt/gravel, road width, presence and material "
        "of a sidewalk or curb, drainage canal or gutter), and the overall "
        "setting (a residential street vs. a market vs. an open lot vs. a "
        "highway shoulder, roughly how dense the buildings are, the kind of "
        "fencing or vegetation). If the pavement/ground and general setting "
        "look like the same kind of place, that alone is enough to call it a "
        "match — you do not need every specific detail to also line up. Use "
        "specific details (fence and gate style, house facades, roofline, "
        "utility poles, road markings, parked vehicles, signage) only as a "
        "tiebreaker when two candidate places could otherwise look alike, not "
        "as a checklist every item must individually match. Expect and ignore "
        "ordinary differences: different time of day or weather, different "
        "camera distance or angle, cars or people present in one image and not "
        "the other, foliage that has grown or been trimmed. None of those "
        "alone justify \"area_mismatch\".\n\n"
        "Decide only this:\n"
        f"- \"area_matches\": IMAGE {pano_number}'s surroundings are "
        f"recognizably the same street/block as {photo_ref} (any one submitted "
        "photo matching is enough), even if the specific reported issue is not "
        f"visible in IMAGE {pano_number}. If it's plausibly the same place, "
        "prefer this over \"area_mismatch\".\n"
        f"- \"area_mismatch\": you are confident IMAGE {pano_number} shows a "
        f"clearly different, unrelated place — a different kind of area, or "
        f"specific features that directly contradict each other (e.g. a "
        "concrete perimeter wall where the photo shows an open lot). Reserve "
        "this for cases you are sure about, not merely unsure.\n"
        "- \"inconclusive\": you genuinely cannot tell either way (poor image "
        f"quality, heavy occlusion, or {photo_ref} has no distinguishing "
        "surroundings to compare against). When in doubt between "
        "\"area_mismatch\" and \"inconclusive\", choose \"inconclusive\" — a "
        "wrong mismatch blocks a resident's real report.\n\n"
        "The imagery may be newer or older than the report; never judge based on "
        "timing.\n\n"
        'Respond as JSON: {"verdict": "...", "explanation": "one short sentence '
        'about whether the SURROUNDINGS match — never mention whether the '
        'reported issue itself is visible"}'
    )
    parsed = _vision_json_call(prompt=prompt, images=[*submitted, street])
    if not parsed:
        return None
    verdict = str(parsed.get("verdict") or "").lower().strip()
    if verdict not in STREET_VERDICTS:
        return None
    return {
        "verdict": verdict,
        "explanation": str(parsed.get("explanation") or "").strip()[:300],
    }


def confirm_media_integrity(
    *,
    image: PreparedImage,
    verdict: str,
    signals: list[str],
    min_confidence: float = 0.70,
) -> dict | None:
    """Second look at one photo the main analysis flagged.

    A single vision judgement about authenticity is the kind of call that goes
    wrong on ordinary photos — heavy compression, a burned-in date stamp, an
    odd shadow on a wet road. Acting on one pass would mean turning real
    residents away, so a flag has to survive being asked again, cold, with the
    first answer supplied as a claim to check rather than a conclusion to
    agree with.

    Returns {"agrees": bool, "verdict": str, "confidence": float,
    "signals": [...]}, or None when the call failed — the caller treats that
    as "not confirmed" and the flag is dropped.
    """
    listed = "; ".join(signals[:MAX_INTEGRITY_SIGNALS]) or "none given"
    prompt = (
        "You are double-checking one photo submitted with a civic concern report "
        "in a barangay system in the Philippines.\n\n"
        "An earlier automated check claimed this photo is not a straight, unedited "
        f"camera photo of a real scene. Its claim was \"{verdict}\", based on: {listed}.\n\n"
        "That earlier check is often wrong. Do NOT assume it is right and do not try "
        "to agree with it. Look at the photo yourself and decide independently.\n\n"
        "Confirm the claim ONLY if you can see the problem yourself and say what it "
        "is. If the photo looks like an ordinary camera photo, or you cannot tell, "
        "say so — that is the correct and common answer.\n\n"
        "These are normal in a real resident's photo and must NEVER confirm a claim: "
        "compression blocks or artefacts, low light, grain, motion blur, a date or "
        "time stamp burned in by the camera, portrait-mode background blur, a "
        "watermark, a rotated or cropped frame, a photo taken at an angle, glare, or "
        "a dirty lens.\n\n"
        "Real problems look like: an object whose lighting, shadow direction, or "
        "scale disagrees with the rest of the scene; edges that are unnaturally "
        "clean, smeared, or repeated; text or logos that are warped or dissolve into "
        "scribble; hands, faces, or repeated structures with the wrong count or "
        "geometry; a scene that could not physically occur; a smooth rendered "
        "surface unlike camera sensor grain; screen glare, moire, pixel grid, or a "
        "device bezel showing this is a photo of a screen.\n\n"
        "verdict must be authentic, suspected_edit, suspected_ai, impossible_content, "
        "photo_of_screen, or inconclusive.\n"
        "confidence is 0.0 to 1.0.\n"
        "signals lists only what you can actually see, in short plain phrases.\n\n"
        'Respond as JSON: {"verdict": "...", "confidence": 0.0, "signals": []}'
    )
    parsed = _vision_json_call(prompt=prompt, images=[image])
    if not parsed:
        return None
    second = str(parsed.get("verdict") or "").lower().strip()
    if second not in INTEGRITY_VERDICTS:
        second = "inconclusive"
    try:
        confidence = round(min(max(float(parsed.get("confidence") or 0.0), 0.0), 1.0), 3)
    except (TypeError, ValueError):
        confidence = 0.0
    # Both passes must land on a flagged verdict, at confidence. They need not
    # name the same one: "this portrait is a cartoon" arriving once as
    # impossible_content and once as suspected_ai is still two independent
    # findings that something is wrong with the picture.
    agrees = second in INTEGRITY_FLAGGED_VERDICTS and confidence >= min_confidence
    return {
        "agrees": agrees,
        "verdict": second,
        "confidence": confidence,
        "signals": _clean_strings(parsed.get("signals"))[:MAX_INTEGRITY_SIGNALS] if agrees else [],
    }


def compare_photo_duplicates(
    *,
    submitted_images: list[PreparedImage],
    candidates: list[dict],
) -> list[dict] | None:
    """Visually compare submitted photos against earlier same-category photos.

    `candidates` items carry {"concern_id", "tracking_id", "captured_at",
    "image": PreparedImage}. Returns one verdict per candidate, or None when
    the call failed.
    """
    if not submitted_images or not candidates:
        return None
    submitted_count = len(submitted_images)
    lines = [
        "You detect duplicate civic concern reports by comparing photos.\n",
        f"IMAGE 1..{submitted_count}: photos attached to the NEW report being checked.",
    ]
    for offset, candidate in enumerate(candidates):
        position = submitted_count + 1 + offset
        lines.append(
            f"IMAGE {position}: photo from an EARLIER report "
            f"(ref {candidate.get('tracking_id') or candidate.get('concern_id')}, "
            f"filed {candidate.get('captured_at') or 'date unknown'})."
        )
    lines += [
        "\nFor each earlier-report image decide whether it shows the same physical "
        "issue at the same place as the new report's photos:\n"
        "- \"same_issue\": clearly the same problem and location.\n"
        "- \"different\": a different issue or a different place.\n"
        "- \"uncertain\": cannot tell.\n\n"
        "Answer for every earlier image, in order.\n"
        'Respond as JSON: {"comparisons": [{"image": <image number>, '
        '"verdict": "same_issue|different|uncertain", "reason": "short sentence"}]}'
    ]
    parsed = _vision_json_call(prompt="\n".join(lines), images=[*submitted_images, *(c["image"] for c in candidates)])
    if not parsed:
        return None
    results: list[dict] = []
    seen = set()
    for item in parsed.get("comparisons") or []:
        if not isinstance(item, dict):
            continue
        try:
            position = int(item.get("image"))
        except (TypeError, ValueError):
            continue
        offset = position - submitted_count - 1
        if offset < 0 or offset >= len(candidates) or offset in seen:
            continue
        seen.add(offset)
        verdict = str(item.get("verdict") or "").lower().strip()
        if verdict not in PHOTO_DUP_VERDICTS:
            continue
        candidate = candidates[offset]
        results.append({
            "concern_id": candidate.get("concern_id"),
            "tracking_id": candidate.get("tracking_id"),
            "captured_at": candidate.get("captured_at"),
            "verdict": verdict,
            "reason": str(item.get("reason") or "").strip()[:200],
        })
    return results or None
