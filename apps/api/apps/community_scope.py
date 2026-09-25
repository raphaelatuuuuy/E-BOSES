from django.db.models import Q
from django.core.exceptions import ValidationError

PRIMARY_COMMUNITY_CODE = "marikina-heights"

# Mirrors apps.emergencies.views.ACTIVE_STATUSES as raw strings so scoping does
# not have to import the views module (which imports this one).
ACTIVE_EMERGENCY_STATUSES = {
    "submitted",
    "routing",
    "routed",
    "awaiting_acknowledgment",
    "acknowledged",
    "en_route",
    "nearby",
    "arrived",
    "resident_safe",
    "backup_requested",
    "backup_assigned",
    "in_progress",
    "transfer_required",
    "escalation_required",
}


def community_ids_for_user(user):
    if not user or not user.is_authenticated:
        return set()
    if user.is_superuser:
        from apps.emergencies.models import Community
        return set(
            Community.objects.filter(
                status="active", code=PRIMARY_COMMUNITY_CODE
            ).values_list("id", flat=True)
        )
    ids = set(user.designations.filter(is_active=True, department__community__status="active").values_list("department__community_id", flat=True))
    profile = getattr(user, "resident_profile", None)
    if getattr(user, "role", None) == "resident" and profile and profile.community_id:
        ids.add(profile.community_id)
    return {item for item in ids if item}


def department_ids_for_user(user):
    if not user or not user.is_authenticated:
        return set()
    if user.is_superuser:
        from apps.concerns.models import Department
        return set(Department.objects.filter(is_active=True).values_list("id", flat=True))
    return set(user.designations.filter(is_active=True, department__is_active=True).values_list("department_id", flat=True))


def scope_user_queryset(queryset, user):
    if not user or not user.is_authenticated:
        return queryset.none()
    if user.is_superuser:
        return queryset
    communities = community_ids_for_user(user)
    return queryset.filter(
        Q(pk=user.pk)
        | Q(resident_profile__community_id__in=communities)
        | Q(designations__is_active=True, designations__department__community_id__in=communities)
    ).distinct()


def scope_emergency_queryset(queryset, user):
    if not user or not user.is_authenticated:
        return queryset.none()
    if user.is_superuser:
        return queryset
    communities = community_ids_for_user(user)

    from apps.capabilities import DISPATCH_EMERGENCIES, user_has_capability

    if user.is_superuser or user_has_capability(user, DISPATCH_EMERGENCIES):
        return queryset.filter(
            Q(reporter=user) | Q(community_id__in=communities)
        ).distinct()

    if getattr(user, "role", None) == "first_responder":
        from apps.emergencies.models import EmergencyTypeRoleMap

        departments = department_ids_for_user(user)
        unit_assignment = Q(
            assignments__status__in=[
                "assigned",
                "acknowledged",
                "en_route",
                "arrived",
                "assisting",
                "resolved",
            ],
            assignments__role_map__department_id__in=departments,
        ) | Q(
            assignments__status__in=[
                "assigned",
                "acknowledged",
                "en_route",
                "arrived",
                "assisting",
                "resolved",
            ],
            assignments__responder__designations__is_active=True,
            assignments__responder__designations__department_id__in=departments,
        )
        # An incident still waiting for somebody to take it has no assignment
        # rows at all, so the two assignment filters above cannot see it. The
        # unit's own queue and the claim list are empty by construction unless
        # the responder is also allowed to look at the unassigned incidents
        # their unit is being matched for.
        unit_waiting = Q(
            community_id__in=communities,
            type__in=set(
                EmergencyTypeRoleMap.objects.filter(
                    department_id__in=departments, is_active=True
                ).values_list("emergency_type", flat=True)
            ),
            status__in=ACTIVE_EMERGENCY_STATUSES,
            assignments__isnull=True,
        )
        return queryset.filter(
            Q(assignments__responder=user) | unit_assignment | unit_waiting
        ).distinct()

    departments = department_ids_for_user(user)
    allowed_types = set(
        user.designations.filter(
            is_active=True,
            department_id__in=departments,
            department__emergency_role_maps__is_active=True,
        ).values_list("department__emergency_role_maps__emergency_type", flat=True)
    )
    visible = (
        Q(reporter=user)
        | Q(assignments__responder=user, assignments__status__in=["assigned", "acknowledged", "en_route", "arrived", "assisting"])
        | Q(community_id__in=communities, type__in=allowed_types)
    )

    # A resident sees the public alerts on their own community's map, so the
    # detail endpoint behind those pins has to resolve for them too. Responders
    # are deliberately excluded: an unassigned responder must still 404 on an
    # incident that is not theirs.
    if getattr(user, "role", None) == "resident":
        from apps.emergencies.models import EmergencyCategory

        profile = getattr(user, "resident_profile", None)
        resident_community = getattr(profile, "community_id", None)
        resident_communities = communities | ({resident_community} if resident_community else set())
        visible_types = EmergencyCategory.objects.filter(
            community_id__in=resident_communities,
            is_active=True,
            visible_to_residents=True,
        ).values_list("community_id", "code")
        for community_id, category_code in visible_types:
            visible |= Q(community_id=community_id, type=category_code)

    return queryset.filter(visible).distinct()


def user_can_view_emergency(user, alert):
    return scope_emergency_queryset(type(alert).objects.filter(pk=alert.pk), user).exists()


def selected_community(user, requested=None):
    from apps.emergencies.models import Community

    allowed = community_ids_for_user(user)
    queryset = Community.objects.filter(pk__in=allowed, status="active").select_related("boundary")
    if requested:
        if str(requested).isdigit():
            return queryset.filter(pk=requested).first()
        try:
            return queryset.filter(public_id=requested).first()
        except (TypeError, ValueError, ValidationError):
            return None

    # Staff accounts can have designations in more than one community, but
    # their residence profile still identifies the community that should open
    # first on a map. Keep this preference inside the already-authorised set;
    # it must never grant access to a community the account is not scoped to.
    profile = getattr(user, "resident_profile", None)
    profile_community_id = getattr(profile, "community_id", None)
    if profile_community_id in allowed:
        community = queryset.filter(pk=profile_community_id).first()
        if community:
            return community

    # If a multi-community account has no residence profile, use the boundary
    # marked as the deployment home before falling back to a deterministic
    # allowed community. This avoids silently opening the alphabetically first
    # community when the account's operational scope spans several areas.
    home = queryset.filter(boundary__is_active=True, boundary__is_home=True).order_by("name", "pk").first()
    return home or queryset.order_by("name", "pk").first()


def scope_concern_queryset(queryset, user, *, include_public=True):
    if not user or not user.is_authenticated:
        if include_public:
            return queryset.filter(visibility="community", validation_status="accepted")
        return queryset.none()
    if user.is_superuser:
        return queryset
    communities = community_ids_for_user(user)
    departments = department_ids_for_user(user)
    rule = Q(reporter=user) | Q(assignments__assignee=user, assignments__status="active")
    if include_public:
        rule |= Q(
            visibility="community",
            validation_status="accepted",
            status__in=["submitted", "under_review", "assigned", "in_progress", "resolved"],
        )
    rule |= Q(community_id__in=communities, assigned_department_id__in=departments)
    rule |= Q(community_id__in=communities, category_ref__department_id__in=departments)
    return queryset.filter(rule).distinct()
