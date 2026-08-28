from datetime import timedelta

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from apps.emergencies.models import Community
from apps.geo_services import point_in_geojson_inclusive

from .models import CommunityResolution, EmailOTPChallenge, OCRConfigurationVersion, User


TOKEN_SALT = "accounts.community-resolution.v1"
TOKEN_MAX_AGE_SECONDS = 2 * 60 * 60


class CommunityResolutionError(Exception):
    def __init__(self, code, detail, *, status_code=400):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status_code = status_code


def email_hash(email):
    return salted_hmac("community-resolution-email", email.strip().lower()).hexdigest()


def _verified_email(email):
    # The OTP must be unexpired when it is entered, but once verified it is
    # the signup session's proof of email ownership. Registration is a
    # multi-step flow (location, proof, phone), so the original 10-minute OTP
    # window must not expire while the resident is completing those steps.
    return EmailOTPChallenge.objects.filter(
        email__iexact=email,
        verified_at__isnull=False,
        consumed_at__isnull=True,
    ).order_by("-verified_at", "-id").first()


def _candidate_communities(latitude, longitude):
    return (
        Community.objects.filter(
            status=Community.Status.ACTIVE,
            boundary__isnull=False,
            boundary__is_active=True,
            boundary__kind="boundary",
        )
        .filter(
            Q(bbox_min_latitude__isnull=True)
            | Q(
                bbox_min_latitude__lte=latitude,
                bbox_max_latitude__gte=latitude,
                bbox_min_longitude__lte=longitude,
                bbox_max_longitude__gte=longitude,
            )
        )
        .select_related("boundary")
        .order_by("id")
    )


@transaction.atomic
def create_resolution(*, email, latitude, longitude, accuracy_meters, address, source):
    normalized_email = email.strip().lower()
    email_challenge = _verified_email(normalized_email)
    if not email_challenge:
        raise CommunityResolutionError("email_not_verified", "Verify the email code before locating the community.")
    if accuracy_meters is not None and accuracy_meters > 100 and source != "manual":
        raise CommunityResolutionError(
            "location_confirmation_required",
            "Location accuracy is low. Move the map pin to the home address and confirm it.",
        )

    matches = [
        community
        for community in _candidate_communities(latitude, longitude)
        if point_in_geojson_inclusive(longitude, latitude, community.boundary.geometry)
    ]
    if not matches:
        raise CommunityResolutionError(
            "community_not_served",
            "No community covers this location yet. Move the pin to your home inside a served community.",
            status_code=404,
        )
    if len(matches) > 1:
        raise CommunityResolutionError(
            "community_boundary_conflict",
            "This address is inside overlapping community boundaries. An official must correct the boundaries.",
            status_code=409,
        )

    community = matches[0]
    configuration = OCRConfigurationVersion.objects.filter(
        community=community,
        scope="residence_proof",
        status=OCRConfigurationVersion.Status.PUBLISHED,
    ).first()
    if configuration is None:
        raise CommunityResolutionError(
            "community_registration_unavailable",
            "Registration is not ready for this community.",
            status_code=409,
        )

    resolution = CommunityResolution.objects.create(
        email_hash=email_hash(normalized_email),
        email_challenge=email_challenge,
        community=community,
        configuration=configuration,
        latitude=latitude,
        longitude=longitude,
        accuracy_meters=accuracy_meters,
        address=address or {},
        source=source,
        boundary_revision=community.boundary_revision,
        expires_at=timezone.now() + timedelta(seconds=TOKEN_MAX_AGE_SECONDS),
    )
    token = signing.dumps(
        {"resolution": str(resolution.public_id), "email_hash": resolution.email_hash},
        salt=TOKEN_SALT,
        compress=True,
    )
    return resolution, token


def resolve_token(token, *, email, consume=False, email_challenge=None):
    try:
        payload = signing.loads(token, salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired as exc:
        raise CommunityResolutionError("community_token_expired", "Confirm the home location again.") from exc
    except BadSignature as exc:
        raise CommunityResolutionError("community_token_invalid", "The community confirmation is invalid.") from exc

    expected_hash = email_hash(email)
    if not constant_time_compare(payload.get("email_hash", ""), expected_hash):
        raise CommunityResolutionError("community_token_invalid", "The community confirmation does not match this email.")

    queryset = CommunityResolution.objects.select_related("community", "configuration")
    if consume:
        queryset = queryset.select_for_update()
    resolution = queryset.filter(public_id=payload.get("resolution"), email_hash=expected_hash).first()
    if resolution is None:
        raise CommunityResolutionError("community_token_invalid", "The community confirmation was not found.")
    if email_challenge is not None and resolution.email_challenge_id != email_challenge.pk:
        raise CommunityResolutionError("email_session_changed", "Verify the email again before continuing.")
    if resolution.consumed_at is not None:
        raise CommunityResolutionError("community_token_used", "This community confirmation was already used.")
    if resolution.expires_at <= timezone.now():
        raise CommunityResolutionError("community_token_expired", "Confirm the home location again.")
    if resolution.community.status != Community.Status.ACTIVE:
        raise CommunityResolutionError("community_disabled", "This community is not accepting registrations.")
    if resolution.community.boundary_revision != resolution.boundary_revision:
        raise CommunityResolutionError("community_boundary_changed", "The community boundary changed. Confirm the location again.")
    if resolution.configuration.status not in {
        OCRConfigurationVersion.Status.PUBLISHED,
        OCRConfigurationVersion.Status.ARCHIVED,
    }:
        raise CommunityResolutionError("ocr_configuration_revoked", "The proof rules changed. Confirm the location again.")
    if consume:
        resolution.consumed_at = timezone.now()
        resolution.save(update_fields=["consumed_at"])
    return resolution


def verified_resident_count(community):
    count = User.objects.filter(
        role=User.Role.RESIDENT,
        status=User.Status.VERIFIED,
        resident_profile__community=community,
    ).count()
    if count < 10:
        return 0
    return (count // (100 if count >= 1000 else 10)) * (100 if count >= 1000 else 10)
