"""Status for the Configuration hub cards.

Loading each card from its own endpoint would be one round trip per section
before an official can see whether anything needs them, so this collapses the
lot into a single request.

Each entry carries a `status` line for the card and a `needs_attention` flag.
The flag is what drives the warning marker, and it is derived rather than
decorative: an emergency type with no unit behind it, or a privacy request left
open, is a real gap in barangay operations that should be visible without
opening anything.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AccountRequest, ResidenceVerificationCase, User
from apps.capabilities import (
    CONFIGURE_CLASSIFICATION,
    CONFIGURE_DISPATCH,
    CONFIGURE_GEOGRAPHY,
    HANDLE_PRIVACY,
    MANAGE_CATEGORIES,
    MANAGE_ROLES,
    MANAGE_UNITS,
    MANAGE_USERS,
    REVIEW_VERIFICATION,
    capabilities_for,
)
from apps.concerns.models import ConcernCategory, Department, Position, RoutingRule
from apps.emergencies.models import EmergencyCategory, EmergencyTypeRoleMap, MapDispatchPolicy


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular if count == 1 else (plural or singular + 's')}"


def _units():
    total = Department.objects.filter(is_active=True).count()
    inactive = Department.objects.filter(is_active=False).count()
    responding = Department.objects.filter(is_active=True, responds_to_emergencies=True).count()
    status = _plural(total, "unit")
    if inactive:
        status += f" · {inactive} inactive"
    return {
        "status": status,
        "detail": f"{responding} respond to emergencies",
        # No unit answering emergencies means no SOS can be auto-routed at all.
        "needs_attention": responding == 0,
    }


def _roles():
    total = Position.objects.filter(is_active=True).count()
    unconfigured = [p for p in Position.objects.filter(is_active=True) if not p.permissions]
    return {
        "status": _plural(total, "position"),
        "detail": (
            f"{len(unconfigured)} with no capabilities" if unconfigured else "All positions configured"
        ),
        "needs_attention": bool(unconfigured),
    }


def _users():
    User_ = get_user_model()
    total = User_.objects.filter(is_active=True).count()
    pending = User_.objects.filter(status=User.Status.PENDING_VERIFICATION).count()
    return {
        "status": _plural(total, "account"),
        "detail": f"{pending} pending verification" if pending else "None pending",
        "needs_attention": pending > 0,
    }


def _categories():
    """Categories and their routing are one card: a category with no unit is a
    category whose concerns reach nobody, which is the thing worth surfacing."""
    categories = list(ConcernCategory.objects.filter(is_active=True))
    routed_ids = set(
        RoutingRule.objects.filter(is_active=True).values_list("category_id", flat=True)
    )
    unrouted = [c for c in categories if c.pk not in routed_ids and c.department_id is None]
    return {
        "status": _plural(len(categories), "category", "categories"),
        "detail": (
            f"{len(unrouted)} with no unit assigned"
            if unrouted
            else "Every category has a responsible unit"
        ),
        "needs_attention": bool(unrouted) or not categories,
    }



def _strictness_label(relevance: float) -> str:
    if relevance >= 0.75:
        return "Checking carefully"
    if relevance >= 0.6:
        return "Balanced checking"
    return "Letting most through"


def _classification():
    from apps.concerns.models import ConcernClassificationConfiguration

    config = ConcernClassificationConfiguration.current()
    held = []
    if config.flag_suspicious:
        held.append("junk")
    if config.duplicate_detection_enabled:
        held.append("duplicates")
    if config.flag_irrelevant:
        held.append("off-topic reports")

    return {
        "status": _strictness_label(config.relevance_threshold),
        "detail": (
            f"Holds {', '.join(held)} for review"
            if held
            else "Nothing is held for review — every report goes straight to your queue"
        ),
        # Nothing being held means the checks are effectively off, which an
        # official should notice rather than discover from a flooded queue.
        "needs_attention": not held,
    }


def _dispatch():
    categories = list(EmergencyCategory.objects.filter(is_active=True).values_list("code", "label"))
    types = [code for code, _ in categories]
    mapped = set(
        EmergencyTypeRoleMap.objects.filter(
            is_active=True,
            department__isnull=False,
            department__is_active=True,
            department__responds_to_emergencies=True,
        ).values_list("emergency_type", flat=True)
    )
    covered = mapped
    covered_count = sum(1 for item in types if item in covered)
    labels = dict(categories)
    missing = [t for t in types if t not in covered]
    return {
        "status": f"{covered_count}/{len(types)} emergency types covered",
        "detail": (
            f"No unit answers: {', '.join(labels.get(item, item) for item in missing)}" if missing else "Every type has a responding unit"
        ),
        "needs_attention": bool(missing),
    }


def _geography():
    """Zones and the SMS fallback share a card because they are both "how does an
    emergency reach us"; SMS being unset is the actionable half."""
    policy = MapDispatchPolicy.current()
    has_sms = bool(policy.emergency_sms_number)
    return {
        "status": f"{policy.acceptance_radius_meters}m acceptance radius",
        "detail": (
            f"Witness alerts {policy.witness_radius_meters}m · "
            + ("SMS fallback set" if has_sms else "SMS fallback not set")
        ),
        "needs_attention": not has_sms,
    }



def _verification():
    # ID checks are automatic. A case only reaches an official when the machine
    # could not decide, so MANUAL_REVIEW is the only number that is theirs to
    # clear. QUEUED/PROCESSING is reported as pipeline activity, and only counts
    # as attention when it has been stuck long enough for the sweeper to care.
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone

    waiting = ResidenceVerificationCase.objects.filter(
        status=ResidenceVerificationCase.Status.MANUAL_REVIEW
    ).count()
    in_flight = ResidenceVerificationCase.objects.filter(
        status__in=[
            ResidenceVerificationCase.Status.QUEUED,
            ResidenceVerificationCase.Status.PROCESSING,
        ]
    )
    in_pipeline = in_flight.count()
    stale_cutoff = timezone.now() - timedelta(
        minutes=getattr(settings, "OCR_STUCK_CASE_MINUTES", 15)
    )
    stuck = in_flight.filter(updated_at__lte=stale_cutoff).count()

    if waiting:
        status_text = f"{_plural(waiting, 'case')} the automatic check could not decide"
    else:
        status_text = "Running automatically"

    if stuck:
        detail = f"{stuck} stuck in the pipeline"
    elif in_pipeline:
        detail = f"{in_pipeline} being checked now"
    else:
        detail = "Resident ID and residence proof"

    return {
        "status": status_text,
        "detail": detail,
        "needs_attention": waiting > 0 or stuck > 0,
    }


def _privacy():
    # Data exports complete themselves, so only deletions reach an official.
    # REVIEWED is counted too: nothing else finishes a reviewed request, and
    # leaving it out meant a half-actioned deletion dropped off the board.
    open_requests = AccountRequest.objects.filter(
        status__in=[AccountRequest.Status.SUBMITTED, AccountRequest.Status.REVIEWED]
    ).count()
    return {
        "status": _plural(open_requests, "open request") if open_requests else "No open requests",
        "detail": "Account deletion requests. Residents export their own data.",
        "needs_attention": open_requests > 0,
    }


# Section key -> (capability required to see it, builder). Sections an official
# has no capability for are omitted entirely, so the hub matches their nav.
SECTIONS = {
    "units": (MANAGE_UNITS, _units),
    "roles": (MANAGE_ROLES, _roles),
    "users": (MANAGE_USERS, _users),
    "categories": (MANAGE_CATEGORIES, _categories),
    "classification": (CONFIGURE_CLASSIFICATION, _classification),
    "dispatch": (CONFIGURE_DISPATCH, _dispatch),
    "zones": (CONFIGURE_GEOGRAPHY, _geography),
    "verification": (REVIEW_VERIFICATION, _verification),
    "privacy": (HANDLE_PRIVACY, _privacy),
}


class ConfigurationSummaryView(APIView):
    """One request behind the whole Configuration hub."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        granted = capabilities_for(request.user)
        if not granted:
            return Response({"sections": {}, "capabilities": []})

        sections = {}
        for key, (capability, build) in SECTIONS.items():
            if capability not in granted:
                continue
            try:
                sections[key] = build()
            except Exception:
                # One broken summary must not take down Configuration itself —
                # the card renders with its label and no status instead.
                sections[key] = {
                    "status": None,
                    "detail": "Status unavailable",
                    "needs_attention": False,
                }

        return Response({"sections": sections, "capabilities": sorted(granted)})
