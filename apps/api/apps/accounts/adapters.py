"""Integration adapters for account workflows.

The account app touches the outside world through two adapters: media
processing (redaction, preview generation, raw-file audit trails) and
verification. Views depend on this module instead of reaching into
CV/PIL/HTTP specifics themselves.
"""

from .media_services import (
    build_redacted_preview_bytes,
    build_sanitized_preview_bytes,
    ensure_residence_proof_preview,
    log_raw_media_access,
    user_can_access_residence_proof_raw,
)

__all__ = [
    "build_redacted_preview_bytes",
    "build_sanitized_preview_bytes",
    "ensure_residence_proof_preview",
    "log_raw_media_access",
    "user_can_access_residence_proof_raw",
]
