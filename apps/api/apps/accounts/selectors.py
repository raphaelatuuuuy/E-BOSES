"""Read/query helpers for account workflows.

Selectors keep lookup and filtering details out of API views so views can
validate input, call services, and format responses without growing queryset
logic over time.
"""

import re

from django.contrib.auth import get_user_model

from .models import OTPChallenge

_PH_MOBILE = re.compile(r"^(?:\+?63|0)?(9\d{9})$")


def normalize_phone_number(value):
    """Return the stored +63XXXXXXXXXX form, or None when it is not a PH mobile.

    Numbers are stored in E.164, but people type `0917...`, `917...` and
    `+63 917 ...` interchangeably. Matching the raw string meant only one of
    those shapes could ever sign in.
    """
    match = _PH_MOBILE.match(re.sub(r"[\s().-]", "", value or ""))
    return f"+63{match.group(1)}" if match else None


def find_user_by_identifier(identifier):
    """Return a user matching an email address or phone number."""
    UserModel = get_user_model()
    value = (identifier or "").strip()
    if not value:
        return None
    user = UserModel.objects.filter(email__iexact=value).first()
    if user is not None:
        return user
    phone = normalize_phone_number(value)
    if phone is not None:
        user = UserModel.objects.filter(phone_number=phone).first()
        if user is not None:
            return user
    return UserModel.objects.filter(phone_number=value).first()


def latest_active_otp_challenge(user, channel, purpose):
    """Return the latest unverified OTP challenge for a user/channel/purpose."""
    return OTPChallenge.objects.filter(
        user=user,
        channel=channel,
        purpose=purpose,
        verified_at__isnull=True,
    ).latest("created_at")


def served_community_areas():
    """Active communities with a drawn outline, for the public sign-up map."""
    from apps.emergencies.models import Community
    from apps.community_scope import PRIMARY_COMMUNITY_CODE

    communities = (
        Community.objects.filter(
            status=Community.Status.ACTIVE,
            code=PRIMARY_COMMUNITY_CODE,
            boundary__isnull=False,
            boundary__is_active=True,
        )
        .select_related("boundary")
        .order_by("name")
    )
    return [
        {
            "id": str(community.public_id),
            "name": community.name,
            "center": {
                "latitude": float(community.center_latitude),
                "longitude": float(community.center_longitude),
            },
            "boundary": community.boundary.geometry,
        }
        for community in communities
    ]
