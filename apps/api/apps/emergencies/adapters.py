"""Integration adapters for emergency workflows.

Emergency media (photos, chat attachments) is stored under a private storage
backend and served through redacted previews; dispatching also depends on the
shift workflow. This module is the single boundary for those integrations.
"""

from .media_services import (
    ensure_chat_attachment_preview,
    ensure_emergency_media_preview,
    user_can_access_emergency_media,
)

__all__ = [
    "ensure_chat_attachment_preview",
    "ensure_emergency_media_preview",
    "user_can_access_emergency_media",
]
