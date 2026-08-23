from apps.accounts.models import ResidentProfile
from apps.concerns.models import Department, Designation, Position
from apps.emergencies.models import Community


def active_test_community():
    community = Community.objects.get(code="marikina-heights")
    if community.status != Community.Status.ACTIVE:
        community.status = Community.Status.ACTIVE
        community.save(update_fields=["status", "updated_at"])
    return community


def ensure_test_profile(user, **defaults):
    community = defaults.pop("community", None) or active_test_community()
    values = {
        "first_name": "Test",
        "last_name": "Resident",
        "date_of_birth": "1990-01-01",
        "address": "Test address",
        "barangay": community.name,
        "community": community,
        **defaults,
    }
    profile, _ = ResidentProfile.objects.update_or_create(user=user, defaults=values)
    return profile


def grant_position(user, position_code="barangay-captain", department_code="sangguniang-barangay"):
    community = active_test_community()
    department = Department.objects.get(code=department_code, community=community)
    return Designation.objects.create(
        user=user,
        department=department,
        position=Position.objects.get(code=position_code),
    )
