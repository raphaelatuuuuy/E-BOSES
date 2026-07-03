"""Read/query helpers for account workflows.

Selectors keep lookup and filtering details out of API views so views can
validate input, call services, and format responses without growing queryset
logic over time.
"""

from django.contrib.auth import get_user_model

from .models import OTPChallenge


def find_user_by_identifier(identifier):
    """Return a user matching an email address or phone number."""
    UserModel = get_user_model()
    return UserModel.objects.filter(email=identifier).first() or UserModel.objects.filter(phone_number=identifier).first()


def latest_active_otp_challenge(user, channel, purpose):
    """Return the latest unverified OTP challenge for a user/channel/purpose."""
    return OTPChallenge.objects.filter(
        user=user,
        channel=channel,
        purpose=purpose,
        verified_at__isnull=True,
    ).latest("created_at")
