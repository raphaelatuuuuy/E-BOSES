"""Adapter interfaces for concern reporting integrations."""

from typing import Protocol


class StorageAdapter(Protocol):
    def save_media(self, *, path: str, content: bytes, content_type: str) -> str:
        """Persist concern media and return a storage key or URL."""


class MapsAdapter(Protocol):
    def reverse_geocode(self, *, latitude: float, longitude: float) -> dict:
        """Resolve coordinates into address/barangay metadata."""


class YOLOAdapter(Protocol):
    def detect_objects(self, *, image_path: str) -> list[dict]:
        """Detect objects in submitted evidence images."""


class NLPAdapter(Protocol):
    def classify_concern(self, *, title: str, description: str) -> dict:
        """Classify category, urgency, or unsafe content from concern text."""
