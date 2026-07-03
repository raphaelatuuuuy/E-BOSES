"""
Concerns serializers for E-Boses.
"""

from rest_framework import serializers

from apps.accounts.services import validate_concern_media_file


class ConcernMediaUploadSerializer(serializers.Serializer):
    """Reusable validation entry point for future concern media uploads."""

    media = serializers.FileField(
        allow_empty_file=False,
        validators=[validate_concern_media_file],
    )

    def validate_media(self, value):
        return validate_concern_media_file(value)
