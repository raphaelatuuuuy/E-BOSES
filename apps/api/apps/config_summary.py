"""Status for the Configuration hub cards.

The hub shows eleven sections. Loading each card from its own endpoint would be
eleven round trips before an official can see whether anything needs them, so
this collapses the lot into one request.

Each entry carries a `status` line for the card and a `needs_attention` flag.
The flag is what drives the warning marker, and it is derived rather than
decorative: an emergency type with no unit behind it, or a privacy request left
open, is a real gap in barangay operations that should be visible without
opening anything.

Sections whose UI has not been built yet still report honestly — a card reading
"Not configured" is better than a hidden feature, and it doubles as a roadmap
inside the product.
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


def _routing():
    categories = list(ConcernCategory.objects.filter(is_active=True))
    routed_ids = set(
        RoutingRule.objects.filter(is_active=True).values_list("category_id", flat=True)
    )
    unrouted = [c for c in categories if c.pk not in routed_ids]
    total = len(categories)
    return {
        "status": f"{total - len(unrouted)}/{total} categories mapped" if total else "No categories",
        # An unrouted category means concerns land with nobody responsible.
        "detail": (
            f"Unassigned: {', '.join(c.name for c in unrouted[:3])}"
            if unrouted
            else "Every category has a responsible unit"
        ),
        "needs_attention": bool(unrouted),
    }


# The card said "Relevance 0.65 · duplicate 0.85", which is the model's
# vocabulary, not the barangay's. These bands mirror the three presets on the
# screen itself so the card and the setting agree in plain words.
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


def _sms():
    # Not built. The research frames SMS fallback as conditional on budget and
    # provider terms, so the card states the truth rather than implying a
    # feature that does not exist.
    return {
        "status": "Not configured",
        "detail": "Fallback for residents without mobile data",
        "needs_attention": True,
        "available": False,
    }


def _verification():
    # Only MANUAL_REVIEW needs a person. QUEUED and PROCESSING are the pipeline
    # working through cases on its own, so counting them would show officials a
    # backlog that is not theirs to clear.
    waiting = ResidenceVerificationCase.objects.filter(
        status=ResidenceVerificationCase.Status.MANUAL_REVIEW
    ).count()
    in_pipeline = ResidenceVerificationCase.objects.filter(
        status__in=[
            ResidenceVerificationCase.Status.QUEUED,
            ResidenceVerificationCase.Status.PROCESSING,
        ]
    ).count()
    return {
        "status": f"{_plural(waiting, 'case')} awaiting review" if waiting else "Nothing to review",
        "detail": f"{in_pipeline} still processing" if in_pipeline else "Resident ID and residence proof",
        "needs_attention": waiting > 0,
    }


def _privacy():
    # SUBMITTED is the only state that needs an official; REVIEWED has been
    # actioned and is awaiting completion elsewhere.
    open_requests = AccountRequest.objects.filter(
        status=AccountRequest.Status.SUBMITTED
    ).count()
    return {
        "status": _plural(open_requests, "open request") if open_requests else "No open requests",
        "detail": "Data export, deactivation and deletion",
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
