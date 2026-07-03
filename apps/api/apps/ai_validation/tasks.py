"""Isolated background execution path for concern AI validation."""

from concurrent.futures import ThreadPoolExecutor

from .services import validate_concern

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="concern-ai-validation")


def enqueue_concern_validation(concern_id: int):
    """Queue advisory AI validation without blocking request/approval flow."""
    return _executor.submit(validate_concern, concern_id)
