from django.db.models import Q
from django.core.exceptions import ValidationError


def community_ids_for_user(user):
    if not user or not user.is_authenticated:
        return set()
    if user.is_superuser:
        from apps.emergencies.models import Community
        return set(Community.objects.filter(status="active").values_list("id", flat=True))
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


def scope_emergency_queryset(queryset, user):
    if not user or not user.is_authenticated:
        return queryset.none()
    if user.is_superuser:
        return queryset
    communities = community_ids_for_user(user)

    from apps.capabilities import DISPATCH_EMERGENCIES, user_has_capability

    if user.is_staff or user_has_capability(user, DISPATCH_EMERGENCIES):
        return queryset.filter(
            Q(reporter=user) | Q(community_id__in=communities)
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

        public_types = set(
            EmergencyCategory.objects.filter(
                is_active=True, visible_to_residents=True
            ).values_list("code", flat=True)
        )
        profile = getattr(user, "resident_profile", None)
        resident_community = getattr(profile, "community_id", None)
        resident_communities = communities | ({resident_community} if resident_community else set())
        if resident_communities and public_types:
            visible |= Q(community_id__in=resident_communities, type__in=public_types)

    return queryset.filter(visible).distinct()


def user_can_view_emergency(user, alert):
    return scope_emergency_queryset(type(alert).objects.filter(pk=alert.pk), user).exists()


def selected_community(user, requested=None):
    from apps.emergencies.models import Community

    allowed = community_ids_for_user(user)
    queryset = Community.objects.filter(pk__in=allowed, status="active")
    if requested:
        if str(requested).isdigit():
            return queryset.filter(pk=requested).first()
        try:
            return queryset.filter(public_id=requested).first()
        except (TypeError, ValueError, ValidationError):
            return None
    return queryset.order_by("name").first() if len(allowed) == 1 else None


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
        rule |= Q(community_id__in=communities, visibility="community", validation_status="accepted")
    rule |= Q(community_id__in=communities, assigned_department_id__in=departments)
    rule |= Q(community_id__in=communities, category_ref__department_id__in=departments)
    return queryset.filter(rule).distinct()
