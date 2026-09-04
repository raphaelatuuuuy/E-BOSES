from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.community_scope import community_ids_for_user


OWNER = "owner"
OPERATIONAL = "operational"
LOCAL_PUBLIC = "local_public"
FOREIGN_READ_ONLY = "foreign_read_only"


class ForeignCommunityReadOnly(APIException):
    status_code = 403
    default_detail = {
        "code": "foreign_community_read_only",
        "detail": "You can only view public content from another community.",
    }
    default_code = "foreign_community_read_only"


def community_summary(community):
    if community is None:
        return None
    return {
        "id": str(community.public_id),
        "public_id": str(community.public_id),
        "code": community.code,
        "name": community.name,
    }


def concern_is_public(concern):
    from apps.concerns.models import Concern

    return bool(
        concern.visibility == Concern.Visibility.COMMUNITY
        and concern.validation_status == Concern.ValidationStatus.ACCEPTED
        and concern.status
        in {
            Concern.Status.SUBMITTED,
            Concern.Status.UNDER_REVIEW,
            Concern.Status.ASSIGNED,
            Concern.Status.IN_PROGRESS,
            Concern.Status.RESOLVED,
        }
    )


def concern_access_mode(user, concern):
    if user and user.is_authenticated and user.pk == concern.reporter_id:
        return OWNER
    communities = community_ids_for_user(user)
    if user and user.is_authenticated and (
        user.is_superuser
        or any(
            assignment.assignee_id == user.pk and assignment.status == "active"
            for assignment in concern.assignments.all()
        )
        or concern.community_id in communities
        and getattr(user, "role", None) != "resident"
    ):
        return OPERATIONAL
    if concern_is_public(concern):
        if concern.community_id is None or not communities or concern.community_id in communities:
            return LOCAL_PUBLIC
        return FOREIGN_READ_ONLY
    return None


def emergency_is_public(alert):
    from apps.emergencies.models import EmergencyCategory
    from apps.emergencies.views import ACTIVE_STATUSES

    if not EmergencyCategory.objects.filter(
        community_id=alert.community_id,
        code=alert.type,
        is_active=True,
        visible_to_residents=True,
    ).exists():
        return False
    if alert.status in ACTIVE_STATUSES:
        return True
    return alert.status in {"resolved", "closed", "cancelled"} and alert.updated_at >= timezone.now() - timedelta(days=7)


def emergency_access_mode(user, alert):
    if user and user.is_authenticated and user.pk == alert.reporter_id:
        return OWNER
    communities = community_ids_for_user(user)
    responder_unit_access = False
    if user and user.is_authenticated and getattr(user, "role", None) == "first_responder":
        from apps.community_scope import department_ids_for_user

        departments = department_ids_for_user(user)
        responder_unit_access = alert.assignments.filter(
            status__in={
                "assigned",
                "acknowledged",
                "en_route",
                "arrived",
                "assisting",
                "resolved",
            },
        ).filter(
            Q(role_map__department_id__in=departments)
            | Q(
                responder__designations__is_active=True,
                responder__designations__department_id__in=departments,
            )
        ).exists()
    if user and user.is_authenticated and (
        user.is_superuser
        or any(assignment.responder_id == user.pk for assignment in alert.assignments.all())
        or responder_unit_access
        or (alert.community_id in communities and getattr(user, "role", None) != "resident")
        or (
            alert.community_id is None
            and len(communities) <= 1
            and getattr(user, "role", None) != "resident"
        )
    ):
        return OPERATIONAL
    if emergency_is_public(alert):
        if alert.community_id is None or alert.community_id in communities:
            return LOCAL_PUBLIC
        return FOREIGN_READ_ONLY
    return None


def foreign_read_only_response():
    from rest_framework import status
    from rest_framework.response import Response

    return Response(
        {
            "code": "foreign_community_read_only",
            "detail": "You can only view public content from another community.",
        },
        status=status.HTTP_403_FORBIDDEN,
    )
