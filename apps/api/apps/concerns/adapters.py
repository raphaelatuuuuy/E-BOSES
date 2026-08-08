"""Integration adapters for concern workflows.

Two external systems matter to reports: the media validator (image/proof
checks) and the AI classification pipeline (Gemma/SAM3 analysis of text and
photos). Views depend on this module rather than on the provider libraries
directly.
"""

from .ai.pipeline import process_concern_ai
from .classification_api import validate_concern_media_file

__all__ = ["process_concern_ai", "validate_concern_media_file"]
