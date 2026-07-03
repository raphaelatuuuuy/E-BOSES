"""
Emergencies serializers for E-Boses.
"""

from rest_framework import serializers

from apps.accounts.services import validate_emergency_media_file


class EmergencyMediaUploadSerializer(serializers.Serializer):
    """Reusable validation entry point for future emergency media uploads."""

    media = serializers.FileField(
        allow_empty_file=False,
        validators=[validate_emergency_media_file],
    )

    def validate_media(self, value):
        return validate_emergency_media_file(value)
