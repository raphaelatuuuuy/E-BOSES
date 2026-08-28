"""A second, independent opinion on a content flag against community content.

A resident's flag reason is a claim, not a fact — this asks Gemma to look at the
flagged text itself and decide whether it actually violates one of the five
reason categories, rather than trusting whatever the reporter picked from the
dropdown. It follows the same Ollama-backed pattern as `gemma_analyzer.py`
(same client setup, `format="json"`, `temperature=0`), but the schema here is
much smaller: this is a moderation triage call, not a full report review.

Fail-open is the entire safety model. An outage, a missing API key, or a
response that fails to parse must never look like "the model found a
violation" — it must always resolve to "held for staff review, no automatic
action taken". `matched_reason` empty is what a caller checks before ever
touching real content.
"""

import json
import logging

from django.conf import settings


logger = logging.getLogger(__name__)

ASSESSMENT_VALUES = {"clearly_violates", "borderline", "likely_acceptable"}
REASON_VALUES = {"irrelevant", "false_info", "sensitive", "abusive", "other", ""}
DISPOSITION_VALUES = {"dismiss", "take_down"}

FAIL_OPEN_RESULT = {
    "assessment": "likely_acceptable",
    "matched_reason": "",
    "recommended_disposition": "dismiss",
    "short_explanation": "Automatic validation was unavailable; held for staff review.",
}


def _configured_model() -> str:
    return getattr(settings, "OLLAMA_TEXT_MODEL", "gemma4:31b") or "gemma4:31b"


def model_version_in_use() -> str:
    """The model name this call would actually use, or "" if not configured.

    Used only for the LlmDecisionLog audit row — never affects the decision
    itself.
    """
    if not getattr(settings, "OLLAMA_API_KEY", ""):
        return ""
    try:
        import ollama  # noqa: F401
    except Exception:
        return ""
    return _configured_model()


def analyze_flagged_content(
    *,
    content_text: str,
    reason: str,
    reporter_note: str = "",
    images: list[str] | None = None,
    image_submitted: bool = False,
) -> dict:
    """Review flagged text and any attached images.

    Failures still resolve to ``FAIL_OPEN_RESULT`` and never remove content.
    """
    api_key = getattr(settings, "OLLAMA_API_KEY", "")
    if not api_key:
        return _with_image_review(
            FAIL_OPEN_RESULT,
            image_checked=bool(images),
            image_submitted=image_submitted,
        )

    try:
        from ollama import Client
    except Exception:
        return _with_image_review(
            FAIL_OPEN_RESULT,
            image_checked=bool(images),
            image_submitted=image_submitted,
        )

    host = getattr(settings, "OLLAMA_HOST", "https://ollama.com")
    model = _configured_model()
    timeout = getattr(settings, "OLLAMA_TIMEOUT_SECONDS", 120)
    prepared_images = images or []
    prompt = build_prompt(
        content_text=content_text,
        reason=reason,
        reporter_note=reporter_note,
        image_count=len(prepared_images),
        image_unavailable=image_submitted and not prepared_images,
    )

    try:
        client = Client(host=host, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout)
        response = client.chat(
            model,
            messages=[
                {"role": "system", "content": "Return valid JSON only. No Markdown. No prose."},
                {
                    "role": "user",
                    "content": prompt,
                    **({"images": prepared_images} if prepared_images else {}),
                },
            ],
            format="json",
            options={"temperature": 0},
            stream=False,
        )
    except Exception:
        logger.warning("Community moderation analyzer call failed; failing open.", exc_info=True)
        return _with_image_review(
            FAIL_OPEN_RESULT,
            image_checked=bool(prepared_images),
            image_submitted=image_submitted,
        )

    return parse_result(
        _response_content(response),
        image_checked=bool(prepared_images),
        image_submitted=image_submitted,
    )


def build_prompt(
    *,
    content_text: str,
    reason: str,
    reporter_note: str,
    image_count: int = 0,
    image_unavailable: bool = False,
) -> str:
    payload = {
        "flagged_content": content_text,
        "reporter_selected_reason": reason,
        "reporter_note": reporter_note,
        "attached_image_count": image_count,
        "image_submitted_but_unavailable": image_unavailable,
    }
    return (
        "You are the community-content moderation assistant for E-Boses, a barangay civic "
        "reporting and community platform in the Philippines.\n\n"
        "A resident flagged a piece of community content (a comment, or a public post) as a "
        "problem. Independently assess the text and each attached image when one is available. "
        "The reporter's selected reason is only a hint, not ground truth — decide for yourself "
        "what actually applies, if anything.\n\n"
        "Reason categories:\n"
        "- irrelevant: the content has nothing to do with the barangay concern or announcement it is attached to.\n"
        "- false_info: the content states something false or misleading as fact.\n"
        "- sensitive: the content exposes private or sensitive information about a person.\n"
        "- abusive: the content is harassing, threatening, hateful, or otherwise abusive toward a person or group.\n"
        "- other: a genuine problem that does not fit any category above.\n\n"
        "Rules:\n"
        "1. assessment is clearly_violates, borderline, or likely_acceptable.\n"
        "2. matched_reason is one of irrelevant, false_info, sensitive, abusive, other, or an empty string "
        "when nothing you can independently confirm actually matches. Never default to the reporter's "
        "selected reason just because they chose it.\n"
        "3. recommended_disposition is dismiss or take_down. Only recommend take_down when matched_reason "
        "is non-empty and you are confident real risk exists. When in doubt, recommend dismiss and leave it "
        "for a human moderator.\n"
        "4. short_explanation is read by barangay staff. Write one short sentence, at most about 45 words, "
        "explaining your assessment. Do not name any person, do not assign blame, and do not issue the "
        "barangay's final decision.\n"
        "5. image_review must say whether the image supports the flag, does not support it, or "
        "could not be judged. Check visible graphic content, exposed personal information, and "
        "misleading or manipulated media. Never call an unavailable image safe.\n"
        "6. Return valid JSON only. No Markdown. No prose.\n\n"
        f"Payload:\n{json.dumps(payload, ensure_ascii=False)}\n\n"
        "Return exactly this JSON shape:\n"
        "{\n"
        '  "assessment": null,\n'
        '  "matched_reason": null,\n'
        '  "recommended_disposition": null,\n'
        '  "short_explanation": null,\n'
        '  "image_review": {"status": null, "explanation": null}\n'
        "}"
    )


def parse_result(content: str, *, image_checked: bool = False, image_submitted: bool = False) -> dict:
    try:
        data = json.loads(_json_body(content))
    except Exception:
        return _with_image_review(
            FAIL_OPEN_RESULT,
            image_checked=image_checked,
            image_submitted=image_submitted,
        )
    if not isinstance(data, dict):
        return _with_image_review(
            FAIL_OPEN_RESULT,
            image_checked=image_checked,
            image_submitted=image_submitted,
        )

    assessment = str(data.get("assessment") or "").strip().lower()
    if assessment not in ASSESSMENT_VALUES:
        return _with_image_review(
            FAIL_OPEN_RESULT,
            image_checked=image_checked,
            image_submitted=image_submitted,
        )

    matched_reason = str(data.get("matched_reason") or "").strip().lower()
    if matched_reason not in REASON_VALUES:
        matched_reason = ""

    disposition = str(data.get("recommended_disposition") or "").strip().lower()
    if disposition not in DISPOSITION_VALUES:
        disposition = "take_down" if matched_reason else "dismiss"
    if not matched_reason:
        # An empty matched_reason can never justify a take_down, regardless
        # of what the model returned for this field.
        disposition = "dismiss"

    explanation = str(data.get("short_explanation") or "").strip()
    if not explanation:
        explanation = FAIL_OPEN_RESULT["short_explanation"]

    image_review = data.get("image_review") if isinstance(data.get("image_review"), dict) else {}
    image_status = str(image_review.get("status") or "").strip().lower()
    if image_status not in {"supports_flag", "not_supported", "unclear", "not_present", "unavailable"}:
        image_status = "checked" if image_checked else "not_present"

    return {
        "assessment": assessment,
        "matched_reason": matched_reason,
        "recommended_disposition": disposition,
        "short_explanation": explanation,
        "image_review": {
            "status": image_status,
            "explanation": str(image_review.get("explanation") or "").strip(),
        },
    }


def _with_image_review(result: dict, *, image_checked: bool, image_submitted: bool = False) -> dict:
    payload = dict(result)
    payload.setdefault(
        "image_review",
        {
            "status": "checked" if image_checked else ("unavailable" if image_submitted else "not_present"),
            "explanation": (
                ""
                if image_checked
                else ("The submitted image could not be checked." if image_submitted else "No image was attached.")
            ),
        },
    )
    return payload


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
