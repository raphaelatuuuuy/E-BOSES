from django.contrib.auth import get_user_model

from apps.capabilities import DISPATCH_EMERGENCIES, user_has_capability

from .models import EmergencyTypeRoleMap


def dispatch_officials(alert, *, department_ids=None, limit=None):
    User = get_user_model()
    mapped_ids = list(
        EmergencyTypeRoleMap.objects.filter(
            community=alert.community,
            emergency_type=alert.type,
            is_active=True,
        ).values_list("department_id", flat=True)
    )
    target_ids = list(department_ids) if department_ids is not None else mapped_ids
    officials = User.objects.filter(
        role=User.Role.BARANGAY_OFFICIAL,
        status=User.Status.VERIFIED,
        is_active=True,
        designations__is_active=True,
        designations__department__community=alert.community,
        designations__department__is_active=True,
    )
    if target_ids:
        officials = officials.filter(designations__department_id__in=target_ids)
    result = [user for user in officials.distinct() if user_has_capability(user, DISPATCH_EMERGENCIES)]
    return result[:limit] if limit else result
