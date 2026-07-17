"""Adapter interfaces for emergency response integrations."""

from typing import Protocol


class MapsAdapter(Protocol):
    def estimate_route(self, *, origin: tuple[float, float], destination: tuple[float, float]) -> dict:
        """Return routing metadata for responders."""


class PushNotificationAdapter(Protocol):
    def broadcast_emergency(self, *, topic: str, payload: dict) -> None:
        """Push an emergency alert to subscribed devices."""
