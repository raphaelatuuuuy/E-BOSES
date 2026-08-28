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
    MANAGE_CATEGORIES,
    MANAGE_ROLES,
    MANAGE_UNITS,
    MANAGE_USERS,
    capabilities_for,
)
from apps.concerns.models import ConcernCategory, Department, Position, RoutingRule
from apps.emergencies.models import (
    EmergencyCategory,
    EmergencyTypeRoleMap,
    MapDispatchPolicy,
)


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
    if config.media_integrity_enabled:
        held.append("edited photos")

    return {
        "status": "Checking carefully",
        "detail": "Monitor live report checks, test sample reports, and review the actions taken.",
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
    
    if not missing:
        status = "All emergency types covered"
    elif len(missing) == 1:
        status = f"1 emergency type needs a unit"
    else:
        status = f"{len(missing)} emergency types need a unit"
    
    return {
        "status": status,
        "detail": (
            f"No unit answers: {', '.join(labels.get(item, item) for item in missing)}" if missing else "Every type has a responding unit"
        ),
        "needs_attention": bool(missing),
    }


def _coverage():
    """The coverage area card: the barangay and the acceptance zone.

    This is geography — which area a station answers for — not the emergency
    types it routes (that is the dispatch card).
    """
    policy = MapDispatchPolicy.current()
    zone = (
        f"{policy.acceptance_radius_meters} m radius"
        if not policy.acceptance_geometry
        else "Drawn zone"
    )
    return {
        "status": f"{zone} · {policy.barangay}",
        "detail": f"Reports outside: {policy.get_out_of_zone_action_display()}",
        "needs_attention": False,
    }


def _verification():
    # ID checks are automatic and there is no verification queue screen — it was
    # removed on purpose, because cases needing a human surface through normal
    # account review instead.
    #
    # So MANUAL_REVIEW must not be reported as work for an official. It was, and
    # it pointed at a screen that does not exist: the card said "1 case the
    # automatic check could not decide" with nowhere to go and no way to clear
    # it. What an official can actually act on is a stuck pipeline.
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone

    resident_action = ResidenceVerificationCase.objects.filter(
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

    if stuck:
        status_text = f"{_plural(stuck, 'check')} stuck in the pipeline"
    elif in_pipeline:
        status_text = f"{_plural(in_pipeline, 'ID')} being checked now"
    else:
        status_text = "Set up a document"

    if resident_action:
        detail = f"{_plural(resident_action, 'resident')} must upload a clearer photo"
    else:
        detail = "Resident ID and residence proof"

    # Only a stuck pipeline is the barangay's problem. A resident who needs to
    # re-upload is waiting on themselves, not on an official.
    return {
        "status": status_text,
        "detail": detail,
        "needs_attention": stuck > 0,
    }


def _audit():
    """The audit card counts activity, never "work to do".

    A log is a record, not a queue. Nothing here should ever ask for attention,
    or officials learn to dismiss the one screen that must stay trustworthy.
    """
    from datetime import timedelta

    from django.utils import timezone
    from apps.audit_log import SENSITIVE_ACTIONS
    from apps.accounts.models import AuditLog

    since = timezone.now() - timedelta(days=7)
    recent = AuditLog.objects.filter(created_at__gte=since)
    total = recent.count()
    private = recent.filter(action__in=SENSITIVE_ACTIONS).count()

    return {
        "status": f"{total:,} action{'' if total == 1 else 's'} this week",
        "detail": (
            f"{private} touched private data" if private else "None touched private data"
        ),
        "needs_attention": False,
    }


def _privacy():
    # Data exports complete themselves, so only deletions reach an official.
    # The type filter used to be missing, so a resident's own export — which no
    # official ever has to touch — sat on this card as "1 open request" that
    # nothing could clear.
    #
    # REVIEWED is counted too: nothing else finishes a reviewed request, and
    # leaving it out meant a half-actioned deletion dropped off the board.
    open_requests = AccountRequest.objects.filter(
        type=AccountRequest.Type.DELETION,
        status__in=[AccountRequest.Status.SUBMITTED, AccountRequest.Status.REVIEWED],
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
    "coverage": (CONFIGURE_GEOGRAPHY, _coverage),
    "verification": (MANAGE_USERS, _verification),
    "privacy": (MANAGE_USERS, _privacy),
    "audit": (MANAGE_USERS, _audit),
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
