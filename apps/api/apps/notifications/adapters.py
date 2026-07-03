"""Adapter interfaces for notification delivery integrations."""

from typing import Protocol


class PushNotificationAdapter(Protocol):
    def send_push(self, *, user_id: int, payload: dict) -> None:
        """Send a push notification to a user's registered devices."""


class WebSocketNotificationAdapter(Protocol):
    def send_ws_event(self, *, group: str, event: dict) -> None:
        """Publish a real-time event to a WebSocket group."""


class EmailAdapter(Protocol):
    def send_email(self, *, to: str, subject: str, body: str) -> None:
        """Send a notification email."""


class SMSAdapter(Protocol):
    def send_sms(self, *, phone_number: str, message: str) -> None:
        """Send a notification SMS."""
