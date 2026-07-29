"""Capability-based authorisation for barangay staff.

`accounts.permissions.ROLE_PERMISSIONS` answers "what may a *role* do" and stays
in place for resident and responder surfaces. It cannot answer "may this
particular official manage users", because every staff member carries the single
flat `barangay_official` role — a Secretary and the Barangay Captain are
indistinguishable to it.

Capabilities close that gap. A capability is granted by a `Position`, held
through an active `Designation` (user + department + position), and resolved as
the union across all of a user's active designations. Someone who is both
Secretary and a BHW unit head holds both sets, which is how small barangays
actually staff themselves.

The vocabulary is a fixed constant, deliberately. Officials configure *who holds
which position*, never which capabilities exist.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission


# --- Vocabulary -----------------------------------------------------------

MANAGE_UNITS = "manage_units"
MANAGE_ROLES = "manage_roles"
MANAGE_USERS = "manage_users"
REVIEW_VERIFICATION = "review_verification"
HANDLE_PRIVACY = "handle_privacy"
RESOLVE_CONCERNS = "resolve_concerns"
MANAGE_CATEGORIES = "manage_categories"
CONFIGURE_CLASSIFICATION = "configure_classification"
CONFIGURE_DISPATCH = "configure_dispatch"
CONFIGURE_GEOGRAPHY = "configure_geography"
PUBLISH_ANNOUNCEMENTS = "publish_announcements"
DISPATCH_EMERGENCIES = "dispatch_emergencies"

ALL_CAPABILITIES = (
    MANAGE_UNITS,
    MANAGE_ROLES,
    MANAGE_USERS,
    REVIEW_VERIFICATION,
    HANDLE_PRIVACY,
    RESOLVE_CONCERNS,
    MANAGE_CATEGORIES,
    CONFIGURE_CLASSIFICATION,
    CONFIGURE_DISPATCH,
    CONFIGURE_GEOGRAPHY,
    PUBLISH_ANNOUNCEMENTS,
    DISPATCH_EMERGENCIES,
)

# Plain-language labels. The Roles screen renders these instead of the codes so
# an official granting a capability can tell what they are granting.
CAPABILITY_LABELS = {
    MANAGE_UNITS: ("Manage units", "Create, edit and deactivate barangay units"),
    MANAGE_ROLES: ("Manage roles", "Change which capabilities each position holds"),
    MANAGE_USERS: ("Manage users", "Create accounts, assign units and positions, deactivate"),
    REVIEW_VERIFICATION: ("Review verification", "Approve or reject resident ID and residence proof"),
    HANDLE_PRIVACY: ("Handle privacy requests", "Action data export and deletion requests"),
    RESOLVE_CONCERNS: ("Resolve concerns", "Update status, assign and close community concerns"),
    MANAGE_CATEGORIES: ("Manage categories", "Edit concern categories and their intake forms"),
    CONFIGURE_CLASSIFICATION: ("Configure AI classification", "Adjust thresholds and keyword rules"),
    CONFIGURE_DISPATCH: ("Configure dispatch", "Set which unit answers each emergency type"),
    CONFIGURE_GEOGRAPHY: ("Configure geography", "Set barangay boundary, zones and alert radii"),
    PUBLISH_ANNOUNCEMENTS: ("Publish announcements", "Post announcements and barangay events"),
    DISPATCH_EMERGENCIES: ("Dispatch emergencies", "Assign responders and escalate active alerts"),
}

# Grouping drives the Roles screen layout; it carries no authorisation meaning.
CAPABILITY_GROUPS = (
    ("People & access", (MANAGE_UNITS, MANAGE_ROLES, MANAGE_USERS)),
    ("Intake & routing", (MANAGE_CATEGORIES, CONFIGURE_CLASSIFICATION, RESOLVE_CONCERNS)),
    ("Emergency response", (CONFIGURE_DISPATCH, CONFIGURE_GEOGRAPHY, DISPATCH_EMERGENCIES)),
    ("Trust & community", (REVIEW_VERIFICATION, HANDLE_PRIVACY, PUBLISH_ANNOUNCEMENTS)),
)


# --- Seeded positions -----------------------------------------------------

# Mirrors how Barangay Marikina Heights actually operates: record access today
# rests with the Secretary and the Captain, and every other operational role is
# a volunteer posting.
POSITION_SEEDS = (
    ("barangay-captain", "Barangay Captain", list(ALL_CAPABILITIES)),
    (
        "secretary",
        "Barangay Secretary",
        [MANAGE_USERS, REVIEW_VERIFICATION, HANDLE_PRIVACY, PUBLISH_ANNOUNCEMENTS, RESOLVE_CONCERNS],
    ),
    ("kagawad", "Kagawad", [RESOLVE_CONCERNS, PUBLISH_ANNOUNCEMENTS]),
    ("unit-head", "Unit Head", [DISPATCH_EMERGENCIES, RESOLVE_CONCERNS]),
    ("staff", "Staff / Volunteer", [RESOLVE_CONCERNS]),
)


# --- Resolution -----------------------------------------------------------

def capabilities_for(user) -> set[str]:
    """Union of capabilities across a user's active designations.

    Superusers hold everything. Unauthenticated, inactive and unverified
    accounts hold nothing — an account mid-verification must not be able to
    act on barangay records simply because a designation was created early.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return set()
    if user.is_superuser:
        return set(ALL_CAPABILITIES)

    # Imported lazily so this module stays importable from accounts.permissions
    # without pulling the model layer in at app-loading time.
    from apps.accounts.models import User

    if not user.is_active or user.status != User.Status.VERIFIED:
        return set()

    designations = list(
        user.designations.filter(is_active=True, position__is_active=True).select_related("position")
    )

    if not designations:
        # Transitional: an official who has never been placed in a unit keeps
        # the blanket access they have today rather than silently losing all of
        # it. 0027_rbac_positions_and_designations seeds a Captain designation
        # for officials that existed at migration time, but accounts created by
        # other means (admin scripts, fixtures, tests) would otherwise arrive
        # with zero capabilities and be locked out of their own barangay.
        #
        # Giving someone *any* designation switches them to explicit
        # capabilities, so restricting an official is a deliberate act in the
        # Roles screen — never an accident of account creation order.
        if user.role == User.Role.BARANGAY_OFFICIAL:
            return set(ALL_CAPABILITIES)
        return set()

    granted: set[str] = set()
    for designation in designations:
        for code in designation.position.permissions or []:
            if code in ALL_CAPABILITIES:
                granted.add(code)
    return granted


def user_has_capability(user, capability: str) -> bool:
    return capability in capabilities_for(user)


def capability_denied(capability: str | None):
    """A 403 that names what the official is missing.

    Imported by views that do their own gating rather than using
    `HasCapability`. Naming the capability lets the client say "you need
    Manage users — ask the Barangay Captain" instead of showing a dead end.
    """
    from rest_framework import status
    from rest_framework.response import Response

    if not capability:
        return Response(
            {"detail": "You do not have permission to manage configuration."},
            status=status.HTTP_403_FORBIDDEN,
        )

    label, _description = CAPABILITY_LABELS.get(capability, (capability, ""))
    return Response(
        {
            "detail": f"This action requires the “{label}” capability.",
            "required_capability": capability,
        },
        status=status.HTTP_403_FORBIDDEN,
    )


class HasCapability(BasePermission):
    """Gate a view on a capability declared as `required_capability`.

    The 403 body names the missing capability so the client can tell the
    official what they need rather than showing an empty screen.
    """

    required_capability: str | None = None

    def has_permission(self, request, view):
        required = getattr(view, "required_capability", self.required_capability)
        if not required:
            return False
        if user_has_capability(request.user, required):
            return True
        label, _description = CAPABILITY_LABELS.get(required, (required, ""))
        self.message = {
            "detail": f"This action requires the “{label}” capability.",
            "required_capability": required,
        }
        return False
