"""Call the barangay's existing Roboflow SAM3 workflow over HTTP.

Why not `inference_sdk`: every published version of that package caps at
`Requires-Python <3.13`, and this project runs 3.13. It cannot be installed
here, and pinning the whole API to an older interpreter to gain a thin HTTP
wrapper is the wrong trade. This module posts to the same serverless workflow
endpoint the SDK posts to, using `requests`, which is already a dependency.

Two rules this module exists to enforce:

* The API key is read from settings and never returned, logged, or attached to
  an exception message. Callers get an exception *type*, not a payload.
* A missing key is a different condition from a failed call. "Not configured"
  means media protection was never switched on; "unavailable" means it was and
  we could not reach it. The privacy service restricts media in both cases, but
  the configuration screen needs to tell officials which one they are looking
  at.
"""

from __future__ import annotations

import base64
import logging

import requests
from django.conf import settings


logger = logging.getLogger(__name__)


class Sam3NotConfigured(RuntimeError):
    """ROBOFLOW_API_KEY, workspace, or workflow id is unset."""


class Sam3Unavailable(RuntimeError):
    """The workflow was called but did not return a usable response."""


def _workflow_url() -> str:
    base = str(getattr(settings, "ROBOFLOW_API_URL", "https://serverless.roboflow.com")).rstrip("/")
    workspace = getattr(settings, "ROBOFLOW_WORKSPACE", "")
    workflow = getattr(settings, "ROBOFLOW_WORKFLOW_ID", "")
    if not workspace or not workflow:
        raise Sam3NotConfigured("ROBOFLOW_WORKSPACE and ROBOFLOW_WORKFLOW_ID must both be set.")
    return f"{base}/infer/workflows/{workspace}/{workflow}"


def run_segmentation(image_path: str, classes: list[str]) -> dict:
    """Run the SAM3 workflow for `classes` against one image.

    `classes` is built by the caller from Gemma's suspicions and is already
    filtered to the allowed vocabulary — this function does not widen it.
    """
    api_key = getattr(settings, "ROBOFLOW_API_KEY", "")
    if not api_key:
        raise Sam3NotConfigured("ROBOFLOW_API_KEY is not configured.")
    if not classes:
        raise Sam3NotConfigured("No sensitive classes were requested.")

    url = _workflow_url()

    try:
        with open(image_path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")
    except OSError as exc:
        raise Sam3Unavailable(exc.__class__.__name__) from None

    payload = {
        "api_key": api_key,
        "inputs": {
            "image": {"type": "base64", "value": encoded},
            "classes": ", ".join(classes),
        },
        "use_cache": True,
    }

    try:
        response = requests.post(
            url,
            json=payload,
            timeout=int(getattr(settings, "ROBOFLOW_TIMEOUT_SECONDS", 60)),
        )
        response.raise_for_status()
        result = response.json()
    except Exception as exc:
        # Deliberately not `from exc`, and never str(exc): a requests error
        # renders the full request, and the key is in the body.
        logger.warning(
            "SAM3 segmentation failed classes=%s error=%s",
            ",".join(classes),
            exc.__class__.__name__,
        )
        raise Sam3Unavailable(exc.__class__.__name__) from None

    # The workflow endpoint answers {"outputs": [ {...} ]} for a single image.
    if isinstance(result, dict):
        outputs = result.get("outputs")
        if isinstance(outputs, list):
            return outputs[0] if outputs else {}
        return result
    if isinstance(result, list):
        return result[0] if result else {}
    return {}
