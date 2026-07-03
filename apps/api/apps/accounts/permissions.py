from rest_framework.permissions import BasePermission

from .models import User


ROLE_PERMISSIONS = {
    User.Role.RESIDENT: {
        "concerns.create",
        "concerns.view_own",
        "emergencies.create",
        "profile.view_own",
        "profile.update_own",
    },
    User.Role.FIRST_RESPONDER: {
        "concerns.view_assigned",
        "emergencies.respond",
        "emergencies.update_assigned",
        "profile.view_own",
        "profile.update_own",
    },
    User.Role.BARANGAY_OFFICIAL: {
        "accounts.create_staff",
        "accounts.verify_residents",
        "audit.view",
        "concerns.manage",
        "emergencies.manage",
        "profile.view_any",
    },
}


def user_has_role_permission(user, permission):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    return permission in ROLE_PERMISSIONS.get(user.role, set())


class HasRolePermission(BasePermission):
    required_permission = None

    def has_permission(self, request, view):
        required = getattr(view, "required_permission", self.required_permission)
        return bool(required and user_has_role_permission(request.user, required))


class IsStaffOrSuperuser(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.is_staff or user.is_superuser or user_has_role_permission(user, "accounts.create_staff"))
        )
