"""Keep the legacy `User.responder_unit` enum and Designation membership in step.

Dispatch resolves responders through Designation so that a unit created in the
Units screen can actually receive alerts. But `responder_unit` is still the input
on the responder admin endpoints and still drives some display code, so setting
it must produce the matching designation — otherwise an official creates a
responder through the UI and that responder is never dispatched to.

This is transitional. When `responder_unit` is dropped, this module goes with it.
"""

from __future__ import annotations

from .models import Department, Designation, Position


RESPONDER_UNIT_TO_DEPARTMENT = {
    "tanod": "bpso-tanod",
    "bhw": "bhw",
    "bdrrmo": "bdrrmo",
}

LEGACY_UNIT_BY_DEPARTMENT_CODE = {
    code: unit for unit, code in RESPONDER_UNIT_TO_DEPARTMENT.items()
}

DEFAULT_RESPONDER_POSITION = "staff"


def department_for_responder_unit(unit: str, community=None):
    code = RESPONDER_UNIT_TO_DEPARTMENT.get((unit or "").strip())
    if not code:
        return None
    queryset = Department.objects.filter(code=code)
    if community is not None:
        queryset = queryset.filter(community=community)
    return queryset.first()


# --- Selectors for other apps ---------------------------------------------
# Emergency dispatch needs to resolve units, but views may not import another
# app's models (see accounts.tests_architecture). These functions are the
# supported way in.


def departments_declaring_emergency_type(alert_type: str):
    """Active units that declare they answer `alert_type`, most preferred first.

    Filtered in Python rather than with a `__contains` JSON lookup: that lookup
    is unsupported on SQLite, which the test settings use. The unit roster is a
    dozen rows, so the difference is not measurable.
    """
    return [
        department
        for department in Department.objects.filter(
            is_active=True, responds_to_emergencies=True
        ).order_by("sort_order", "name")
        if alert_type in (department.emergency_types or [])
    ]


def active_departments_by_codes(codes):
    return list(
        Department.objects.filter(code__in=list(codes), is_active=True).order_by("sort_order", "name")
    )


def department_ids_for_code(code: str):
    if not code:
        return set()
    return set(Department.objects.filter(code=code).values_list("pk", flat=True))


def assigned_unit_for(user):
    """The unit a responder belongs to, as the barangay configured it.

    Membership is a Designation written by officials in the Units screen; the
    legacy `responder_unit` enum is the fallback for responders created before
    the unit migration. Returns None when the responder has neither, which is a
    state only an official can fix.

    This is the single source for "which unit is this responder in". Responder
    self-service must read it rather than accept a unit from the client — a
    responder who can name their own unit can route themselves into another
    unit's emergencies.
    """
    designation = (
        Designation.objects.filter(user=user, is_active=True, department__is_active=True)
        .select_related("department")
        .order_by("department__sort_order", "department__name")
        .first()
    )
    department = designation.department if designation else None
    if department is None:
        department = department_for_responder_unit(getattr(user, "responder_unit", ""))
    if department is None:
        return None

    return {
        "id": department.pk,
        "code": department.code,
        "name": department.name,
        "short_name": department.short_name or department.name,
        "description": department.description,
        "responds_to_emergencies": department.responds_to_emergencies,
        "emergency_types": list(department.emergency_types or []),
        # The shift row still stores the closed enum. Blank for a unit the
        # barangay created itself, which has no legacy equivalent.
        "legacy_unit": LEGACY_UNIT_BY_DEPARTMENT_CODE.get(department.code, ""),
    }


def assigned_legacy_unit(user) -> str:
    """Legacy enum code for the unit the barangay assigned this responder.

    Falls back to whatever is already on the account so a responder whose unit
    has no legacy equivalent still records a shift instead of being blocked.
    """
    unit = assigned_unit_for(user)
    if unit and unit["legacy_unit"]:
        return unit["legacy_unit"]
    return getattr(user, "responder_unit", "") or ""


def sync_responder_designation(user) -> Designation | None:
    """Make the user's active designations match their `responder_unit`.

    Returns the designation now representing their unit, or None when the unit
    is blank or unmapped. Designations in *other* departments are deactivated
    rather than deleted so the history of who served where survives.
    """
    department = department_for_responder_unit(getattr(user, "responder_unit", ""))
    if department is None:
        return None

    position = Position.objects.filter(code=DEFAULT_RESPONDER_POSITION).first()
    if position is None:
        # The RBAC seed has not run. Refusing here would block responder
        # creation entirely, so leave membership alone and let dispatch fall
        # back to the legacy enum.
        return None

    designation, _created = Designation.objects.get_or_create(
        user=user,
        department=department,
        position=position,
        defaults={"is_active": True},
    )
    if not designation.is_active:
        designation.is_active = True
        designation.save(update_fields=["is_active", "updated_at"])

    Designation.objects.filter(user=user, is_active=True, position=position).exclude(
        pk=designation.pk
    ).update(is_active=False)

    return designation
