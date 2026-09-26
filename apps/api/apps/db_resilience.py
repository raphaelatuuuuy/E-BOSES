"""Resilience helpers for flaky managed-Postgres connections.

The Supabase pooler intermittently drops connections (SSL EOF / timeout
expired). A single failed query must not fail a whole periodic task or
corrupt a health signal — retry once on a fresh connection, then let the
error propagate so beat/Flower still see genuinely broken states.
"""

from __future__ import annotations

import functools
import logging
import time

logger = logging.getLogger(__name__)


def _is_db_blip(exc: BaseException) -> bool:
    from django.db.utils import OperationalError

    if not isinstance(exc, OperationalError):
        return False
    message = str(exc).lower()
    return any(
        fragment in message
        for fragment in (
            "ssl error",
            "unexpected eof",
            "timeout expired",
            "connection",
            "server closed",
            "could not connect",
        )
    )


def retry_on_db_blip(func):
    """Run func; on a single DB-blip OperationalError, reconnect and retry once."""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            if not _is_db_blip(exc):
                raise
            logger.warning(
                "DB blip during %s (%s); reconnecting and retrying once",
                getattr(func, "__name__", func),
                exc.__class__.__name__,
            )
            try:
                from django.db import close_old_connections

                close_old_connections()
            except Exception:
                pass
            time.sleep(1.0)
            return func(*args, **kwargs)

    return wrapper
