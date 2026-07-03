"""Adapter interfaces for account-related external integrations."""

from typing import Protocol


class SMSAdapter(Protocol):
    """Sends SMS messages such as OTP challenges."""

    def send_sms(self, *, phone_number: str, message: str) -> None:
        """Deliver an SMS message to a phone number."""


class EmailAdapter(Protocol):
    """Sends transactional email such as OTP and password reset messages."""

    def send_email(self, *, to: str, subject: str, body: str) -> None:
        """Deliver an email message."""


class OCRAdapter(Protocol):
    """Extracts identity and address fields from residence proof uploads."""

    def extract_residence_fields(self, *, file_path: str) -> dict:
        """Return structured fields parsed from a proof document."""


class StorageAdapter(Protocol):
    """Stores private verification files outside model/business logic."""

    def save_private_file(self, *, path: str, content: bytes, content_type: str) -> str:
        """Persist file bytes and return a storage key or URL."""
