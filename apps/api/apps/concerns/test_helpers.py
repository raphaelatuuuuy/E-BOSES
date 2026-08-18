from apps.concerns.models import Department, Designation, Position


def grant_position(user, position_code="barangay-captain", department_code="sangguniang-barangay"):
    return Designation.objects.create(
        user=user,
        department=Department.objects.get(code=department_code),
        position=Position.objects.get(code=position_code),
    )
