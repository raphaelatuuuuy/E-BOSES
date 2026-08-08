"""Integration adapters for notification delivery.

Delivery spans WebSocket fan-out (Channels), browser push (Web Push API) and
the in-app notification feed. This module is the boundary the rest of the app
uses to reach those transports.
"""

from .services import (
    broadcast_emergency_update,
    broadcast_notification,
    send_browser_push,
)

__all__ = ["broadcast_emergency_update", "broadcast_notification", "send_browser_push"]
