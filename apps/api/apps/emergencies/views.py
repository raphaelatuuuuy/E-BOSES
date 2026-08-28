from datetime import timedelta
from io import BytesIO
import logging
from math import asin, cos, radians, sin, sqrt
import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError as ApiValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated, user_has_role_permission
from apps.accounts.media_services import log_raw_media_access, placeholder_preview_jpeg
from apps.accounts.services import (
    create_audit_log,
    validate_emergency_media_file,
    validate_location_pair,
)
from apps.media_utils import phash_file, sha256_file
from apps.accounts.views import request_meta, touch_last_seen
from apps.docs_schema import PAGE_PARAMETERS, list_envelope_response
from apps.pagination import paginate_response
from apps.notifications.services import (
    broadcast_emergency_chat_message,
    broadcast_emergency_update,
    create_emergency_notification,
    notify_emergency_status,
)

from apps.capabilities import (
    CONFIGURE_DISPATCH,
    CONFIGURE_GEOGRAPHY,
    DISPATCH_EMERGENCIES,
    capability_denied,
    user_has_capability,
)
from apps.community_scope import community_ids_for_user, scope_emergency_queryset, selected_community, user_can_view_emergency
from apps.concerns.units import (
    active_departments_by_codes,
    assigned_legacy_unit,
    department_ids_for_code,
)
from apps.geo_services import active_community_for_point, search_boundaries_online

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyCategory,
    EmergencyChatAttachment,
    EmergencyChatMessage,
    EmergencyEscalation,
    EmergencyLocationPing,
    MapDispatchPolicy,
    MapGeometry,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    EmergencyTypeRoleMap,
    EmergencyAssignmentLog,
    Community,
    BackupRequest,
    EmergencyAssignmentRoute,
    ResponderShift,
    WitnessNotification,
)
from .serializers import (
    EmergencyAlertSerializer,
    EmergencyAppealCreateSerializer,
    EmergencyAppealReviewSerializer,
    EmergencyAppealSerializer,
    EmergencyAssignmentRemoveSerializer,
    EmergencyAssignSerializer,
    EmergencyResponderAssignmentSerializer,
    EmergencyAssignmentStatusSerializer,
    EmergencyChatCreateSerializer,
    EmergencyChatMessageSerializer,
    EmergencyCategorySerializer,
    EmergencyCreateSerializer,
    EmergencyDispositionSerializer,
    EmergencyEscalateSerializer,
    EmergencyTypeRoleMapSerializer,
    EmergencyEscalationSerializer,
    EmergencyLocationPingCreateSerializer,
    MapDispatchPolicySerializer,
    EmergencyNoteSerializer,
    EmergencyReassignSerializer,
    ResponderShiftEndSerializer,
    ResponderShiftSerializer,
    ResponderShiftStartSerializer,
    emergency_category_is_covered,
)
from .recipients import dispatch_officials
from . import responder_actions, vocabulary
from .location_services import classify_location_confidence, schedule_location_resolution
from .tasks import enqueue_emergency_media_preview
from .media_services import (
    user_can_access_emergency_media,
    validate_chat_attachment,
)


ACTIVE_STATUSES = {
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTING,
    EmergencyAlert.Status.ROUTED,
    EmergencyAlert.Status.AWAITING_ACKNOWLEDGMENT,
    EmergencyAlert.Status.ACKNOWLEDGED,
    EmergencyAlert.Status.EN_ROUTE,
    EmergencyAlert.Status.NEARBY,
    EmergencyAlert.Status.ARRIVED,
    # Still active: the resident says they are safe, but a responder has not
    # confirmed it yet.
    EmergencyAlert.Status.RESIDENT_SAFE,
    EmergencyAlert.Status.BACKUP_REQUESTED,
    EmergencyAlert.Status.BACKUP_ASSIGNED,
    EmergencyAlert.Status.IN_PROGRESS,
    EmergencyAlert.Status.TRANSFER_REQUIRED,
    EmergencyAlert.Status.ESCALATION_REQUIRED,
}

ACTIVE_ASSIGNMENT_STATUSES = {
    EmergencyResponderAssignment.Status.ASSIGNED,
    EmergencyResponderAssignment.Status.ACKNOWLEDGED,
    EmergencyResponderAssignment.Status.EN_ROUTE,
    EmergencyResponderAssignment.Status.ARRIVED,
}


LEGACY_EMERGENCY_TYPE_CODES = {value for value, _ in EmergencyAlert.Type.choices}

# Map SOS category → first-responder units that handle that case
# Legacy User.responder_unit enum -> Department.code. Transitional; removed with
# the column once every responder carries a Designation.
LEGACY_UNIT_TO_DEPARTMENT_CODE = {
    "tanod": "bpso-tanod",
    "bhw": "bhw",
    "bdrrmo": "bdrrmo",
}

UNIT_BY_EMERGENCY_TYPE = {
    EmergencyAlert.Type.MEDICAL: {"bhw"},
    EmergencyAlert.Type.FIRE: {"bdrrmo"},
    EmergencyAlert.Type.CRIME: {"tanod"},
    EmergencyAlert.Type.DISASTER: {"bdrrmo"},
}

# Prefer responders with GPS updated within this window when ranking. Local
# development has nothing actually pinging a responder's live location, so a
# seeded test account goes stale within the production window and silently
# drops out of dispatch — widened here so local testing does not need a
# manual DB touch every 30 minutes just to keep a responder eligible.
RESPONDER_LOCATION_FRESH_MINUTES = (
    24 * 60 if getattr(settings, "IS_LOCAL_DEVELOPMENT", False) else 30
)
WITNESS_LOCATION_FRESH_MINUTES = 15


logger = logging.getLogger(__name__)


def log_assignment_action(*, alert, action, assignment=None, responder=None, actor=None, old_status="", new_status="", note="", metadata=None):
    return EmergencyAssignmentLog.objects.create(
        alert=alert,
        assignment=assignment,
        responder=responder or (assignment.responder if assignment else None),
        actor=actor,
        action=action,
        old_status=old_status or "",
        new_status=new_status or "",
        note=(note or "")[:255],
        metadata=metadata or {},
    )


def can_access_emergency_management(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_staff
            or user.is_superuser
            or user_has_role_permission(user, "emergencies.manage")
        )
    )


def can_manage_emergencies(user):
    return can_access_emergency_management(user) and user_has_capability(
        user, DISPATCH_EMERGENCIES
    )


def can_configure_emergencies(user, capability):
    return can_access_emergency_management(user) and user_has_capability(user, capability)


def can_respond_to_emergencies(user):
    return bool(
        user
        and user.is_authenticated
        and (
            can_manage_emergencies(user)
            or user_has_role_permission(user, "emergencies.respond")
            or user_has_role_permission(user, "emergencies.update_assigned")
        )
    )


def can_manage_responder_shift(user):
    User = get_user_model()
    return bool(
        user
        and user.is_authenticated
        and user.is_active
        and user.role == User.Role.FIRST_RESPONDER
        and user.status == User.Status.VERIFIED
    )


def responder_is_available(user):
    User = get_user_model()
    # is_on_duty is the persisted availability flag maintained by the shift
    # endpoints.  Never bypass it for a unit: an off-shift BDRRMO must not be
    # routed an emergency simply because of its role.
    return bool(
        user.role == User.Role.FIRST_RESPONDER
        and user.status == User.Status.VERIFIED
        and user.is_active
        and user.is_on_duty
    )


def responder_is_eligible(user, alert, *, require_on_duty=True):
    profile = getattr(user, "resident_profile", None)
    return bool(
        can_manage_responder_shift(user)
        and (not require_on_duty or responder_is_available(user))
        and profile
        and responder_department_ids(user) & {d.pk for d in preferred_departments_for(alert.type)}
        and normalize_barangay(profile.barangay) == normalize_barangay(alert.barangay)
    )


def responder_is_manually_assignable(user):
    """Officials may override shift/unit routing while preserving account safety."""
    User = get_user_model()
    return bool(
        user.role == User.Role.FIRST_RESPONDER
        and user.status == User.Status.VERIFIED
        and user.is_active
    )


def can_view_alert(user, alert):
    if not user or not user.is_authenticated:
        return False
    return user_can_view_emergency(user, alert)


def scoped_alert_or_404(user, pk, *, lock=False):
    queryset = EmergencyAlert.objects.select_for_update() if lock else EmergencyAlert.objects.all()
    return get_object_or_404(scope_emergency_queryset(queryset, user), pk=pk)


def create_status_event(alert, status_value, actor=None, note="", event_key=""):
    """Record what happened, in the same words the resident is told by SMS.

    `event_key` looks the wording up in apps.emergencies.vocabulary so the
    timeline heading describes the event rather than repeating the alert's
    current status - which is why five different events all used to read
    "Emergency received".
    """
    # Fall back to the event that matches the status, so an entry recorded
    # without an explicit key still says what happened.
    key = event_key or vocabulary.key_for_status(str(status_value))
    label = ""
    if key:
        label, described = vocabulary.describe(key, note)
        note = described
    event_key = key
    return EmergencyStatusEvent.objects.create(
        alert=alert,
        status=status_value,
        event_key=event_key,
        label=label,
        note=note[:255],
        actor=actor,
    )


def post_responder_chat(alert, sender, body: str):
    """Post a group-chat message from a responder (visible to resident + all assignees)."""
    if not sender or not body.strip():
        return None
    # Avoid spamming the same auto message twice for one status transition
    recent = (
        EmergencyChatMessage.objects.filter(alert=alert, sender=sender, body=body.strip())
        .order_by("-id")
        .first()
    )
    if recent and (timezone.now() - recent.created_at).total_seconds() < 120:
        return recent
    message = EmergencyChatMessage.objects.create(alert=alert, sender=sender, body=body.strip())
    message = (
        EmergencyChatMessage.objects.select_related("sender", "sender__resident_profile")
        .get(pk=message.pk)
    )
    transaction.on_commit(lambda m=message: broadcast_emergency_chat_message(m))
    return message


def location_distance_score(alert, responder):
    # An SMS emergency can arrive with a readable area but no GPS fix. Ranking
    # then falls back to workload and duty status; distance simply drops out
    # rather than the whole assignment failing.
    if alert.latitude is None or alert.longitude is None:
        return None
    if responder.current_latitude is None or responder.current_longitude is None:
        return None
    return distance_meters(
        alert.latitude,
        alert.longitude,
        responder.current_latitude,
        responder.current_longitude,
    )


def distance_meters(latitude_a, longitude_a, latitude_b, longitude_b):
    earth_radius = 6_371_000
    lat_a = radians(float(latitude_a))
    lat_b = radians(float(latitude_b))
    delta_lat = lat_b - lat_a
    delta_lng = radians(float(longitude_b) - float(longitude_a))
    value = sin(delta_lat / 2) ** 2 + cos(lat_a) * cos(lat_b) * sin(delta_lng / 2) ** 2
    return 2 * earth_radius * asin(sqrt(value))

def active_role_maps_for(alert_type, community=None):
    filters = {"emergency_type": alert_type, "is_active": True}
    if community is not None:
        filters["community"] = community
    return list(
        EmergencyTypeRoleMap.objects.filter(**filters)
        .select_related("department")
        .order_by("-priority", "id")
    )


def preferred_departments_for(alert_type, community=None):
    """Units that answer this emergency type, most preferred first.

    Three tiers, in order. Explicit role maps win. Failing that, any unit that
    declares itself an emergency responder for the type is used, which is what
    lets a newly created unit start receiving alerts without an official also
    having to add a routing row. The legacy enum map is the last resort so a
    barangay with neither configured still dispatches.
    """
    departments = [item.department for item in active_role_maps_for(alert_type, community) if item.department_id]
    if departments:
        return departments

    fallback = set()
    if alert_type in LEGACY_EMERGENCY_TYPE_CODES:
        fallback = {
            LEGACY_UNIT_TO_DEPARTMENT_CODE.get(unit, unit)
            for unit in (UNIT_BY_EMERGENCY_TYPE.get(alert_type) or set())
        }
    departments = active_departments_by_codes(fallback)
    return [item for item in departments if community is None or item.community_id == community.pk]


def role_map_for_departments(alert_type, department_ids, community=None):
    if not department_ids:
        return None
    query = EmergencyTypeRoleMap.objects.filter(
            emergency_type=alert_type,
            department_id__in=list(department_ids),
            is_active=True,
        )
    if community is not None:
        query = query.filter(community=community)
    return (
        query
        .order_by("-priority", "id")
        .first()
    )


def responder_department_ids(user):
    """Units this responder belongs to.

    Falls back to the legacy `responder_unit` enum for responders that predate
    designations, so they still resolve to a routing rule instead of being
    assigned with no role map recorded.
    """
    ids = set(user.designations.filter(is_active=True).values_list("department_id", flat=True))
    if ids:
        return ids

    legacy_code = LEGACY_UNIT_TO_DEPARTMENT_CODE.get(getattr(user, "responder_unit", "") or "")
    return department_ids_for_code(legacy_code)


def department_label(department):
    return department.short_name or department.name


def responder_display_unit(user):
    """Name of the unit a responder speaks for in notifications and chat."""
    designation = (
        user.designations.filter(is_active=True)
        .select_related("department")
        .order_by("department__sort_order", "department__name")
        .first()
    )
    if designation and designation.department:
        return department_label(designation.department)
    return "Responder"


def normalize_barangay(value: str) -> str:
    text = (value or "").strip()
    if not text or text.lower() == "pending":
        return "Community"
    return text


def _on_duty_unit_candidates(alert, *, community=None, departments=None, exclude_ids=None):
    """
    Available on-duty first responders belonging to a unit that answers this
    emergency type.

    Membership is resolved through Designation rather than the legacy
    `User.responder_unit` enum, which is what allows a unit created in the Units
    screen to actually receive alerts.
    """
    User = get_user_model()
    community = community or alert.community
    preferred = departments or preferred_departments_for(alert.type, community)
    if not preferred:
        return []

    # Designation is the real membership. The legacy enum is still honoured as a
    # fallback so a responder created before the unit migration — or by a code
    # path that only sets `responder_unit` — does not silently stop being
    # dispatchable. Dropped together with the column.
    legacy_units = {
        code
        for code, department_code in LEGACY_UNIT_TO_DEPARTMENT_CODE.items()
        if department_code in {d.code for d in preferred}
    }
    membership = models.Q(designations__is_active=True, designations__department__in=preferred)
    if legacy_units:
        membership |= models.Q(designations__isnull=True, responder_unit__in=legacy_units)
    qs = (
        User.objects.filter(
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_active=True,
        )
        .filter(membership)
        .filter(is_on_duty=True)
        .filter(designations__department__community=community)
        .filter(location_updated_at__gte=timezone.now() - timedelta(minutes=RESPONDER_LOCATION_FRESH_MINUTES))
        .filter(current_latitude__isnull=False, current_longitude__isnull=False)
        .exclude(
            emergency_assignments__alert__status__in=ACTIVE_STATUSES,
            emergency_assignments__status__in=[
                EmergencyResponderAssignment.Status.ASSIGNED,
                EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                EmergencyResponderAssignment.Status.EN_ROUTE,
                EmergencyResponderAssignment.Status.ARRIVED,
                EmergencyResponderAssignment.Status.ASSISTING,
            ],
        )
        .select_related("resident_profile")
        .distinct()
    )
    if exclude_ids:
        qs = qs.exclude(pk__in=list(exclude_ids))
    return list(qs)


def _rank_responders(alert, responders):
    fresh_after = timezone.now() - timedelta(minutes=RESPONDER_LOCATION_FRESH_MINUTES)

    def sort_key(responder):
        dist = location_distance_score(alert, responder)
        has_coords = dist is not None
        fresh = bool(
            has_coords
            and responder.location_updated_at
            and responder.location_updated_at >= fresh_after
        )
        # 0 = fresh GPS nearest, 1 = GPS but stale, 2 = on-duty no GPS
        if fresh:
            return (0, dist)
        if has_coords:
            return (1, dist)
        return (2, float("inf"))

    return sorted(responders, key=sort_key)


def role_map_for_responder(alert, responder, *, department=None):
    maps = EmergencyTypeRoleMap.objects.filter(
        emergency_type=alert.type,
        is_active=True,
        community__status=Community.Status.ACTIVE,
        department__is_active=True,
        department__community=models.F("community"),
        department__designations__user=responder,
        department__designations__is_active=True,
    )
    if department:
        maps = maps.filter(department__code=department.code)
    return maps.select_related("community", "department").order_by(
        models.Case(
            models.When(community_id=alert.community_id, then=models.Value(0)),
            default=models.Value(1),
            output_field=models.IntegerField(),
        ),
        "-priority",
        "id",
    ).first()


def find_auto_responders(alert, *, limit=5, exclude_ids=None, department=None):
    local_departments = [department] if department else None
    candidates = _on_duty_unit_candidates(alert, community=alert.community, departments=local_departments, exclude_ids=exclude_ids)
    if not candidates:
        maps = EmergencyTypeRoleMap.objects.filter(
            emergency_type=alert.type,
            is_active=True,
            community__status=Community.Status.ACTIVE,
            department__is_active=True,
        ).exclude(community=alert.community).select_related("department", "community")
        if department:
            maps = maps.filter(department__code=department.code)
        by_community = {}
        for role_map in maps:
            by_community.setdefault(role_map.community, []).append(role_map.department)
        candidates = []
        for community, departments in by_community.items():
            candidates.extend(_on_duty_unit_candidates(alert, community=community, departments=departments, exclude_ids=exclude_ids))
    if not candidates:
        return []
    ranked = _rank_responders(alert, candidates)
    return ranked[: max(1, limit)]


def find_auto_responders_by_unit(alert, *, exclude_ids=None):
    preferred = preferred_departments_for(alert.type, alert.community)
    if not preferred:
        return []
    selected = []
    covered_departments = set()
    local = _on_duty_unit_candidates(alert, community=alert.community, exclude_ids=exclude_ids)
    responders = _rank_responders(alert, local)
    if not responders:
        responders = find_auto_responders(alert, limit=1, exclude_ids=exclude_ids)
    for responder in responders:
        role_map = role_map_for_responder(alert, responder)
        departments = {role_map.department_id} if role_map else set()
        if not departments or departments & covered_departments:
            continue
        selected.append(responder)
        covered_departments.update(departments)
    return selected


def find_auto_responder(alert):
    responders = find_auto_responders(alert, limit=1)
    return responders[0] if responders else None


def find_backup_responder(alert):
    assigned_ids = alert.assignments.values_list("responder_id", flat=True)
    responders = find_auto_responders(alert, limit=1, exclude_ids=assigned_ids)
    return responders[0] if responders else None


def acknowledgment_timeout_for(alert):
    """Seconds an assignment may sit unacknowledged, from the routing rule."""
    role_map = (
        EmergencyTypeRoleMap.objects.filter(emergency_type=alert.type, is_active=True)
        .order_by("-priority", "id")
        .first()
    )
    if role_map and role_map.acknowledgment_timeout_seconds:
        return int(role_map.acknowledgment_timeout_seconds)
    return int(getattr(settings, "EMERGENCY_ACK_TIMEOUT_SECONDS", 300))


def escalate_overdue_assignments(*, minutes=None, seconds=None, triggered_by=None, audit_request_meta=None):
    """Reassign or escalate assignments nobody has acknowledged.

    Previously this only bolted a backup responder onto the alert and left the
    silent responder assigned, so an emergency could sit with someone who was
    never coming. Now the unacknowledged assignment is closed out, the next
    eligible responder is assigned, and only when nobody is left does the alert
    move to ESCALATION_REQUIRED for an official to pick up.

    The per-category timeout from EmergencyTypeRoleMap wins; `minutes`/`seconds`
    act as a floor for callers that want to force a sweep.
    """
    now = timezone.now()
    floor_seconds = seconds if seconds is not None else (int(minutes) * 60 if minutes is not None else 0)

    candidates = (
        EmergencyResponderAssignment.objects.filter(
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            alert__status__in=ACTIVE_STATUSES,
        )
        .select_related("alert")
        .order_by("assigned_at", "id")
    )

    escalations = []
    for assignment_id in list(candidates.values_list("pk", flat=True)):
        with transaction.atomic():
            assignment = (
                EmergencyResponderAssignment.objects
                .select_for_update()
                .select_related("alert", "alert__reporter", "responder")
                .filter(pk=assignment_id)
                .first()
            )
            if not assignment or assignment.status != EmergencyResponderAssignment.Status.ASSIGNED:
                continue

            alert = EmergencyAlert.objects.select_for_update().get(pk=assignment.alert_id)
            if alert.status not in ACTIVE_STATUSES:
                continue

            timeout = max(acknowledgment_timeout_for(alert), floor_seconds)
            waited = (now - assignment.assigned_at).total_seconds()
            if waited < timeout:
                continue

            escalations.append(
                _reassign_unacknowledged(
                    alert,
                    assignment,
                    waited=waited,
                    triggered_by=triggered_by,
                    audit_request_meta=audit_request_meta,
                )
            )
    return [item for item in escalations if item]


def _reassign_unacknowledged(alert, assignment, *, waited, triggered_by, audit_request_meta):
    original = assignment.responder
    assignment.status = EmergencyResponderAssignment.Status.ESCALATED
    assignment.status_note = f"No acknowledgement after {int(waited)}s."
    assignment.save(update_fields=["status", "status_note"])
    log_assignment_action(
        alert=alert,
        assignment=assignment,
        responder=original,
        actor=triggered_by,
        action="acknowledgment_timeout",
        new_status=assignment.status,
        note=assignment.status_note,
        metadata={"waited_seconds": int(waited)},
    )

    assigned_ids = list(alert.assignments.values_list("responder_id", flat=True))
    replacements = find_auto_responders(alert, limit=1, exclude_ids=assigned_ids)
    replacement = replacements[0] if replacements else None

    reason = f"Responder did not acknowledge within {int(waited)} seconds."
    escalation = EmergencyEscalation.objects.create(
        alert=alert,
        previous_assignment=assignment,
        escalated_to=replacement,
        triggered_by=triggered_by,
        reason=reason,
    )

    if replacement:
        role_map = role_map_for_responder(alert, replacement)
        new_assignment = EmergencyResponderAssignment.objects.create(
            alert=alert,
            responder=replacement,
            role_map=role_map,
            responding_community=role_map.community if role_map else None,
            is_cross_community=bool(role_map and role_map.community_id != alert.community_id),
            source=EmergencyResponderAssignment.Source.ESCALATION,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
        )
        log_assignment_action(
            alert=alert,
            assignment=new_assignment,
            responder=replacement,
            actor=triggered_by,
            action="reassigned_after_timeout",
            new_status=new_assignment.status,
            note=reason,
        )
        apply_routing_effects(alert, replacement, None, actor=triggered_by, audit_action="emergency.reassigned")
    elif not alert.assignments.filter(status__in=[
        EmergencyResponderAssignment.Status.ASSIGNED,
        EmergencyResponderAssignment.Status.ACKNOWLEDGED,
        EmergencyResponderAssignment.Status.EN_ROUTE,
        EmergencyResponderAssignment.Status.ARRIVED,
        EmergencyResponderAssignment.Status.ASSISTING,
    ]).exists():
        # Nobody left to try. Keep the alert active and visible rather than
        # letting it sit silently against a responder who never replied.
        alert.status = EmergencyAlert.Status.ESCALATION_REQUIRED
        alert.status_version += 1
        alert.save(update_fields=["status", "status_version", "updated_at"])
        create_status_event(alert, alert.status, triggered_by, note=reason, event_key="no_responder")
        notify_officials_no_responder(alert)

    create_emergency_notification(
        alert=alert,
        recipient=alert.reporter,
        type="emergency_escalated",
        title="Still arranging your responder",
        body="The barangay is assigning another responder to your emergency.",
    )
    create_audit_log(
        "emergency.acknowledgment_timeout",
        actor=triggered_by,
        target_user=alert.reporter,
        metadata={
            "alert_id": alert.pk,
            "assignment_id": assignment.pk,
            "original_responder_id": getattr(original, "pk", None),
            "replacement_id": getattr(replacement, "pk", None),
            "waited_seconds": int(waited),
            "automatic": triggered_by is None,
        },
        request_meta=audit_request_meta or {},
    )
    return escalation


def send_app_emergency_sms(alert):
    """Acknowledge the reporter and alert officials for an in-app emergency.

    Best-effort: a gateway problem must never surface as a failed SOS.
    """
    try:
        from apps.sms.notify import notify_officials_new_emergency, notify_reporter_ack

        assignment = alert.assignments.select_related("responder").first()
        unit_name = ""
        responder_name = ""
        if assignment and assignment.responder:
            unit_name = assignment.responder.get_responder_unit_display() or ""
            profile = getattr(assignment.responder, "resident_profile", None)
            if profile:
                responder_name = f"{profile.first_name} {profile.last_name}".strip()
        notify_reporter_ack(alert, unit_name=unit_name, assigned=bool(assignment))
        notify_officials_new_emergency(
            alert, unit_name=unit_name, responder_name=responder_name
        )
    except Exception:
        logger.warning("Emergency SMS fan-out failed for alert %s.", alert.pk, exc_info=True)


def notify_officials_no_responder(alert):
    User = get_user_model()
    preferred = preferred_departments_for(alert.type, alert.community)
    unit_names = ", ".join(sorted(department_label(d) for d in preferred)) or alert.type
    barangay = normalize_barangay(alert.barangay)
    officials = dispatch_officials(alert, department_ids=[department.pk for department in preferred])
    for official in officials:
        create_emergency_notification(
            alert=alert,
            recipient=official,
            type="emergency_escalated",
            title="Emergency needs manual dispatch",
            body=(
                f"No on-duty {unit_names} available for this {alert.get_type_display()} "
                f"emergency in {barangay}."
            ),
        )
    try:
        from apps.sms.notify import notify_officials_no_responder as sms_notify

        sms_notify(alert, unit_name=unit_names)
    except Exception:
        pass


def notify_standby_responders(alert, *, assigned_ids=None):
    assigned = set(assigned_ids or alert.assignments.values_list("responder_id", flat=True))
    standby = _on_duty_unit_candidates(alert, exclude_ids=assigned)
    if not standby:
        return []
    for responder in standby:
        create_emergency_notification(
            alert=alert,
            recipient=responder,
            type="emergency_routed",
            title="Standby: emergency in your unit",
            body=(
                f"A {alert.type.replace('_', ' ')} emergency was assigned to another responder in your unit. "
                "Stay available in case backup is requested."
            ),
            metadata={"standby": True, "alert_id": alert.pk},
        )
    log_assignment_action(
        alert=alert,
        action="standby_notified",
        note=f"{len(standby)} on-duty responder(s) notified for standby.",
        metadata={"responder_ids": [responder.pk for responder in standby]},
    )
    return standby


def privacy_safe_user_name(user):
    profile = getattr(user, "resident_profile", None)
    if not profile:
        return "assigned responder"
    first_name = profile.first_name.strip()
    last_initial = profile.last_name.strip()[:1]
    return f"{first_name} {last_initial}.".strip() if last_initial else first_name


def apply_routing_effects(alert, responder, request, *, actor=None, audit_action="emergency.auto_routed"):
    alert.status = EmergencyAlert.Status.ROUTED
    alert.routed_at = timezone.now()
    alert.status_version += 1
    alert.save(update_fields=["status", "routed_at", "status_version", "updated_at"])
    create_status_event(alert, EmergencyAlert.Status.ROUTED, actor, event_key="responder_assigned")
    notify_emergency_status(alert, type=EmergencyAlert.Status.ROUTED, body="Responder routed")
    unit = responder_display_unit(responder)
    create_emergency_notification(
        alert=alert,
        recipient=responder,
        type="emergency_routed",
        title="Responder routed",
        body=f"You are the nearest eligible on-duty {unit} responder.",
    )
    post_responder_chat(
        alert,
        responder,
        f"Hi, this is {privacy_safe_user_name(responder)} ({unit}). I've been assigned to your emergency.",
    )
    create_audit_log(
        audit_action,
        actor=actor,
        target_user=alert.reporter,
        metadata={"alert_id": alert.pk, "responder_id": responder.pk, "emergency_type": alert.type},
        request_meta=request_meta(request),
    )
    try:
        from apps.sms.notify import notify_responder_assigned

        notify_responder_assigned(alert, responder)
    except Exception:
        pass


def auto_route_alert(alert, request, *, retry_escalated=False):
    with transaction.atomic():
        locked_alert = EmergencyAlert.objects.select_for_update().get(pk=alert.pk)
        active_assignment = (
            locked_alert.assignments
            .filter(status__in=[
                EmergencyResponderAssignment.Status.ASSIGNED,
                EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                EmergencyResponderAssignment.Status.EN_ROUTE,
                EmergencyResponderAssignment.Status.ARRIVED,
            ])
            .select_related("responder")
            .order_by("assigned_at", "id")
            .first()
        )
        routable_statuses = {EmergencyAlert.Status.SUBMITTED}
        if retry_escalated:
            routable_statuses.add(EmergencyAlert.Status.ESCALATION_REQUIRED)
        if locked_alert.status not in routable_statuses or active_assignment:
            return active_assignment.responder if active_assignment else None

        responders = find_auto_responders_by_unit(locked_alert)
        if not responders:
            preferred = preferred_departments_for(locked_alert.type, locked_alert.community)
            unit_names = ", ".join(sorted(department_label(d) for d in preferred)) or "responder"
            reason = f"No eligible on-duty {unit_names} in {normalize_barangay(locked_alert.barangay)}."
            EmergencyEscalation.objects.get_or_create(alert=locked_alert, reason=reason)
            locked_alert.status = EmergencyAlert.Status.ESCALATION_REQUIRED
            locked_alert.status_version += 1
            locked_alert.save(update_fields=["status", "status_version", "updated_at"])
            create_status_event(locked_alert, locked_alert.status, None, note=reason, event_key="no_responder")
            notify_officials_no_responder(locked_alert)
            return None

        first = None
        for responder in responders:
            role_map = role_map_for_responder(locked_alert, responder)
            if not role_map:
                continue
            responding_community = role_map.community
            assignment = EmergencyResponderAssignment.objects.create(
                alert=locked_alert,
                responder=responder,
                role_map=role_map,
                source=EmergencyResponderAssignment.Source.AUTO,
                status=EmergencyResponderAssignment.Status.ASSIGNED,
                responding_community=responding_community,
                is_cross_community=bool(responding_community and responding_community.pk != locked_alert.community_id),
            )
            log_assignment_action(alert=locked_alert, assignment=assignment, responder=responder, action="auto_assigned", new_status=assignment.status, metadata={"role_map_id": role_map.pk if role_map else None})
            apply_routing_effects(locked_alert, responder, request)
            first = first or responder
        notify_standby_responders(locked_alert, assigned_ids=[responder.pk for responder in responders])
        return first


def retry_waiting_alerts_for_responder(responder):
    if not responder.is_on_duty:
        return []
    routed = []
    alerts = (
        EmergencyAlert.objects.filter(status=EmergencyAlert.Status.ESCALATION_REQUIRED)
        .select_related("community")
        .order_by("created_at", "id")
    )
    for alert in alerts:
        if not role_map_for_responder(alert, responder):
            continue
        if responder not in find_auto_responders(alert, limit=5):
            continue
        assigned = auto_route_alert(alert, None, retry_escalated=True)
        if assigned:
            routed.append(alert.pk)
    return routed

def create_witness_notifications(alert):
    # Warning neighbours is a proximity feature; with no pin there is no
    # proximity to compute and nobody should be alerted at random.
    if alert.latitude is None or alert.longitude is None:
        return
    reporter_profile = getattr(alert.reporter, "resident_profile", None)
    if not reporter_profile or not reporter_profile.barangay:
        return
    User = get_user_model()
    fresh_after = timezone.now() - timedelta(minutes=WITNESS_LOCATION_FRESH_MINUTES)
    try:
        radius_meters = int(MapDispatchPolicy.current().witness_radius_meters)
    except Exception:
        radius_meters = int(getattr(settings, "EMERGENCY_WITNESS_RADIUS_METERS", 250))
    witnesses = (
        User.objects
        .filter(
            status=User.Status.VERIFIED,
            role=User.Role.RESIDENT,
            resident_profile__barangay=reporter_profile.barangay,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
            location_updated_at__gte=fresh_after,
        )
        .exclude(pk=alert.reporter_id)
    )
    for witness in witnesses:
        distance = distance_meters(
            alert.latitude,
            alert.longitude,
            witness.current_latitude,
            witness.current_longitude,
        )
        if distance > radius_meters:
            continue
        delivery, created = WitnessNotification.objects.get_or_create(
            alert=alert,
            resident=witness,
            defaults={"distance_meters": round(distance)},
        )
        if not created and delivery.in_app_delivered_at is not None:
            continue
        notification = create_emergency_notification(
            alert=alert,
            recipient=witness,
            type="witness_alert",
            title="Emergency reported nearby",
            body=f"An emergency was reported in {alert.barangay}. Stay alert and avoid the area if needed.",
        )
        if notification and delivery.in_app_delivered_at is None:
            delivery.in_app_delivered_at = notification.created_at or timezone.now()
            delivery.save(update_fields=["in_app_delivered_at"])


def normalize_category_text(value):
    return re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower()).strip("_")


def active_alert_for_reporter(reporter):
    return (
        EmergencyAlert.objects.filter(reporter=reporter, status__in=ACTIVE_STATUSES)
        .order_by("-created_at", "-id")
        .first()
    )


ALERT_SERIALIZATION_PREFETCH = (
    "media",

    "status_events__actor",
    "status_events__actor__resident_profile",
    "appeals__appellant",
    "appeals__appellant__resident_profile",
    "appeals__reviewed_by",
    "appeals__reviewed_by__resident_profile",
    "escalations__escalated_to",
    "escalations__escalated_to__resident_profile",
    "escalations__triggered_by",
    "escalations__triggered_by__resident_profile",
    "assignments__responder",
    "assignments__responder__resident_profile",
    "assignments__location_pings",
    "witness_notifications",
    "assignment_logs",
)


def alert_serialization_queryset():
    """Base queryset whose rows serialize without per-row refetch queries.

    serialize_alert used to re-fetch each alert with this select_related +
    prefetch stack, costing ~15 queries per row on every list endpoint.
    Lists must build from here so the prefetch runs once for the page.
    """
    return (
        EmergencyAlert.objects
        .select_related("reporter", "reporter__resident_profile")
        .annotate(
            visible_comment_count=models.Count(
                "community_comments",
                filter=models.Q(community_comments__status="visible"),
                distinct=True,
            )
        )
        .prefetch_related(*ALERT_SERIALIZATION_PREFETCH)
    )


def serialize_alert(alert, request):
    if not hasattr(alert, "_prefetched_objects_cache"):
        # Single-alert path (detail views, idempotency lookups): fetch once.
        alert = alert_serialization_queryset().get(pk=alert.pk)
    return EmergencyAlertSerializer(alert, context={"request": request}).data


def finish_responder_shift(shift, *, ended_at=None, latitude=None, longitude=None):
    ended_at = ended_at or timezone.now()
    assignments = EmergencyResponderAssignment.objects.filter(
        responder=shift.responder,
        assigned_at__gte=shift.started_at,
        assigned_at__lte=ended_at,
    ).select_related("alert")
    response_seconds = [
        int((assignment.acknowledged_at - assignment.assigned_at).total_seconds())
        for assignment in assignments
        if assignment.acknowledged_at
    ]
    shift.status = ResponderShift.Status.ENDED
    shift.ended_at = ended_at
    shift.end_latitude = latitude
    shift.end_longitude = longitude
    shift.incidents_assigned = assignments.count()
    shift.incidents_acknowledged = assignments.filter(acknowledged_at__isnull=False).count()
    shift.incidents_resolved = assignments.filter(
        models.Q(status=EmergencyResponderAssignment.Status.RESOLVED)
        | models.Q(alert__status=EmergencyAlert.Status.RESOLVED)
    ).count()
    shift.false_alarms = assignments.filter(alert__status=EmergencyAlert.Status.CANCELLED).count()
    shift.average_response_seconds = (
        round(sum(response_seconds) / len(response_seconds)) if response_seconds else None
    )
    shift.save(
        update_fields=[
            "status",
            "ended_at",
            "end_latitude",
            "end_longitude",
            "incidents_assigned",
            "incidents_acknowledged",
            "incidents_resolved",
            "false_alarms",
            "average_response_seconds",
            "updated_at",
        ]
    )
    return shift


def _preview_is_ready(preview_file):
    name = (preview_file.name or "").lower() if preview_file else ""
    return bool(name and "/redacted-v4-sam3-" in name and name.endswith(".jpg"))


class EmergencyMediaPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        media = get_object_or_404(
            EmergencyMedia.objects.select_related("alert", "alert__reporter"),
            pk=pk,
        )
        if not user_can_access_emergency_media(request.user, media):
            return Response(
                {"detail": "You do not have permission to access this emergency media."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if _preview_is_ready(media.preview_file):
            return FileResponse(media.preview_file.open("rb"), content_type="image/jpeg")
        # Never run the SAM3 segmentation (up to a 60s HTTP call) on the
        # request thread. Re-enqueue and serve a placeholder until done.
        transaction.on_commit(lambda media_id=media.pk: enqueue_emergency_media_preview("media", media_id))
        return FileResponse(BytesIO(placeholder_preview_jpeg()), content_type="image/jpeg")


class EmergencyMediaRawView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        media = get_object_or_404(
            EmergencyMedia.objects.select_related("alert", "alert__reporter"),
            pk=pk,
        )
        if not user_can_access_emergency_media(request.user, media):
            return Response(
                {"detail": "You do not have permission to access this emergency media."},
                status=status.HTTP_403_FORBIDDEN,
            )
        log_raw_media_access(
            actor=request.user,
            target_user=media.alert.reporter,
            media_type="emergency_media",
            object_id=media.pk,
            request_meta=request_meta(request),
        )
        return FileResponse(media.file.open("rb"), content_type=media.mime_type or "application/octet-stream")


class EmergencyChatAttachmentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, preview=False):
        attachment = get_object_or_404(
            EmergencyChatAttachment.objects.select_related("message__alert", "message__alert__reporter"),
            pk=pk,
        )
        if not user_can_access_emergency_media(request.user, attachment.message):
            return Response({"detail": "You do not have permission to access this attachment."}, status=status.HTTP_403_FORBIDDEN)
        if preview:
            if attachment.media_type != "image":
                return Response({"detail": "Video previews are unavailable."}, status=status.HTTP_404_NOT_FOUND)
            if _preview_is_ready(attachment.preview_file):
                return FileResponse(attachment.preview_file.open("rb"), content_type="image/jpeg")
            transaction.on_commit(
                lambda attachment_id=attachment.pk: enqueue_emergency_media_preview("chat", attachment_id)
            )
            return FileResponse(BytesIO(placeholder_preview_jpeg()), content_type="image/jpeg")
        log_raw_media_access(
            actor=request.user,
            target_user=attachment.message.alert.reporter,
            media_type="emergency_chat_attachment",
            object_id=attachment.pk,
            request_meta=request_meta(request),
        )
        return FileResponse(attachment.file.open("rb"), content_type=attachment.mime_type)


class EmergencyCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @transaction.atomic
    def post(self, request):
        touch_last_seen(request.user)
        if not user_has_role_permission(request.user, "emergencies.create"):
            return Response({"detail": "Only residents can send emergency alerts."}, status=status.HTTP_403_FORBIDDEN)
        from apps.accounts.ip_intel import evaluate_request, ip_blocked_response

        _, ip_meta, ip_reason = evaluate_request(request)
        if ip_reason:
            return ip_blocked_response(ip_reason)
        serializer = EmergencyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        client_request_id = serializer.validated_data.get("client_request_id")
        if client_request_id:
            existing = EmergencyAlert.objects.filter(
                reporter=request.user,
                client_request_id=client_request_id,
            ).first()
            if existing:
                return Response(serialize_alert(existing, request))
        active_alert = active_alert_for_reporter(request.user)
        if active_alert:
            return Response(
                {
                    "detail": "You already have an active emergency alert.",
                    "active_emergency": serialize_alert(active_alert, request),
                    "duplicate_suppressed": True,
                },
                status=status.HTTP_409_CONFLICT,
            )
        lat = serializer.validated_data.get("latitude")
        lng = serializer.validated_data.get("longitude")
        from .location_resolution import resolve_incident_location

        location_resolution = resolve_incident_location(
            latitude=lat,
            longitude=lng,
            message_area=serializer.validated_data.get("reported_area", ""),
            user=request.user,
        )
        incident_community = location_resolution.community
        if lat is not None and lng is not None:
            if incident_community is None:
                return Response({"location": ["The point is outside an active community or is inside overlapping boundaries."]}, status=status.HTTP_400_BAD_REQUEST)
        if incident_community is None:
            return Response({"location": ["We could not determine the emergency community."]}, status=status.HTTP_400_BAD_REQUEST)
        media_files = []
        media_hashes = set()
        media_warnings = []
        uploaded_media = request.FILES.getlist("media")
        if len(uploaded_media) > 5:
            return Response(
                {"media": ["Attach at most 5 photos per alert."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for uploaded_file in uploaded_media:
            try:
                validated_file = validate_emergency_media_file(uploaded_file)
            except ValidationError as exc:
                # An SOS must not silently lose evidence: reject the whole
                # request so the resident can retake or drop the bad file.
                return Response(
                    {"media": [f"{uploaded_file.name}: {exc}"]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            media_hash = sha256_file(validated_file)
            raw_content = validated_file.read(); validated_file.seek(0)
            media_phash = phash_file(raw_content)
            if media_hash in media_hashes or EmergencyMedia.objects.filter(sha256_hash=media_hash).exists():
                media_warnings.append(f"{uploaded_file.name}: duplicate attachment was skipped.")
                continue
            media_hashes.add(media_hash)
            media_files.append((uploaded_file, validated_file, media_hash, media_phash))

        profile = getattr(request.user, "resident_profile", None)
        alert = EmergencyAlert.objects.create(
            client_request_id=client_request_id,
            reporter=request.user,
            community=incident_community,
            type=serializer.validated_data["type"],
            note=serializer.validated_data.get("note", ""),
            latitude=location_resolution.latitude,
            longitude=location_resolution.longitude,
            location_source=location_resolution.source,
            location_freshness=location_resolution.freshness,
            location_age_seconds=location_resolution.age_seconds,
            canonical_street=location_resolution.canonical_street,
            location_evidence=location_resolution.payload(),
            location_accuracy=serializer.validated_data.get("location_accuracy"),
            address=serializer.validated_data.get("address", ""),
            reported_area=serializer.validated_data.get("reported_area", ""),
            triage=serializer.validated_data.get("triage") or {},
            reporter_contact_number=getattr(request.user, "phone_number", "") or "",
            media_warnings=media_warnings,
            barangay=incident_community.name,
            ip_asn=ip_meta.get("asn", ""),
            ip_country=ip_meta.get("country", ""),
            ip_org=ip_meta.get("org", ""),
            ip_verdict=ip_meta.get("verdict", ""),
            ip_score=ip_meta.get("score"),
        )
        alert.location_confidence = classify_location_confidence(alert)
        alert.save(update_fields=["location_confidence"])
        create_status_event(alert, EmergencyAlert.Status.SUBMITTED, request.user, event_key="received_app")
        notify_emergency_status(alert, type=EmergencyAlert.Status.SUBMITTED, body="Your emergency alert was submitted.")
        auto_route_alert(alert, request)
        create_witness_notifications(alert)
        # After routing on purpose: a street name is worth having, but never at
        # the cost of delaying dispatch.
        if alert.latitude is not None and alert.longitude is not None:
            schedule_location_resolution(alert)
        for uploaded_file, validated_file, media_hash, media_phash in media_files:
            media = EmergencyMedia.objects.create(
                alert=alert,
                file=validated_file,
                original_filename=uploaded_file.name,
                mime_type=getattr(validated_file, "content_type", "") or "",
                file_size=validated_file.size,
                sha256_hash=media_hash,
                phash=media_phash,
            )
            transaction.on_commit(
                lambda media_id=media.pk: enqueue_emergency_media_preview("media", media_id)
            )
        create_audit_log(
            "emergency.created",
            actor=request.user,
            target_user=request.user,
            metadata={"alert_id": alert.pk, "type": alert.type},
            request_meta=request_meta(request),
        )
        from apps.emergencies.tasks import (
            enqueue_emergency_created_broadcast,
            enqueue_emergency_media_integrity,
        )

        transaction.on_commit(lambda: enqueue_emergency_created_broadcast(alert.pk))
        # Queued after the broadcast on purpose: responders are notified first,
        # and the photo check only ever adds a note to what they already have.
        transaction.on_commit(lambda: enqueue_emergency_media_integrity(alert.pk))
        # An emergency raised in the app gets the same SMS acknowledgement as
        # one texted in, so a resident who loses data still knows it landed.
        transaction.on_commit(lambda: send_app_emergency_sms(alert))
        return Response(serialize_alert(alert, request), status=status.HTTP_201_CREATED)


class EmergencySmsInboundView(APIView):
    """Deprecated alias for ``POST /api/sms/inbound/``.

    Kept so a handset already configured against the old URL keeps working
    through the transition. All parsing, sender matching and routing now live
    in `apps.sms`; this only forwards. Point SMS Forwarder at the new path and
    this can be deleted.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    parser_classes = [JSONParser, FormParser]

    def post(self, request):
        from apps.sms.views import SmsInboundView

        return SmsInboundView.as_view()(request._request)


class BoundarySearchView(APIView):
    """Barangay boundaries, for picking the one a station covers."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_GEOGRAPHY):
            return capability_denied(CONFIGURE_GEOGRAPHY)
        query = " ".join((request.query_params.get("q") or "").split())

        def same_place(name: str, locality: str) -> tuple[str, str]:
            """
            Key for one real barangay.

            The PSGC import and the older OSM rows both hold e.g. Marikina
            Heights, spelling its city "City of Marikina" and "Marikina", so
            matching on the raw pair would list it twice.
            """
            place = locality.strip().lower()
            for prefix in ("city of ", "municipality of ", "the municipality of "):
                if place.startswith(prefix):
                    place = place[len(prefix) :]
            place = place.removesuffix(" city").strip()
            return name.strip().lower(), place

        def row(boundary: MapGeometry) -> dict:
            return {
                "id": boundary.pk,
                "source": "saved",
                "name": boundary.name,
                "locality": boundary.locality,
                "osm_id": boundary.osm_id,
                "is_home": boundary.is_home,
                "geometry": boundary.geometry,
            }

        # This station's own barangay always leads, so "home" is one click away.
        home = list(
            MapGeometry.objects.filter(
                kind=MapGeometry.Kind.BOUNDARY, is_active=True, is_home=True
            )[:1]
        )
        results = [row(boundary) for boundary in home]
        if not query:
            return Response(results)

        if not any(query.lower() in item["name"].lower() for item in results):
            results = []

        # The imported PSGC/NAMRIA set answers first: it is the PSA's own
        # boundary data and covers barangays OSM never mapped. Every word has
        # to appear somewhere, so "san mateo" and "mateo san" both land.
        local = MapGeometry.objects.filter(kind=MapGeometry.Kind.BOUNDARY, is_active=True)
        for term in query.split():
            local = local.filter(
                models.Q(name__icontains=term) | models.Q(locality__icontains=term)
            )

        seen = {same_place(item["name"], item["locality"]) for item in results}
        # Home first, then the PSGC rows, which carry the PSA's own spelling.
        for boundary in local.order_by("-is_home", "-osm_type", "name")[:60]:
            key = same_place(boundary.name, boundary.locality)
            if key in seen:
                continue
            seen.add(key)
            results.append(row(boundary))
            if len(results) >= 25:
                break

        # Only when nothing is held locally is the slow, paced upstream asked.
        if not results:
            for hit in search_boundaries_online(query):
                key = same_place(hit["name"], hit["locality"])
                if key in seen:
                    continue
                seen.add(key)
                results.append(hit)

        return Response(results)


class ActiveCommunityBoundariesView(APIView):
    """
    Barangays already running as their own community, with their outlines.

    The coverage editor draws these so an official can see who is next door
    before dragging a zone across them: two stations accepting reports for the
    same street is a dispatch argument nobody wins.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.emergencies.public_api import normalize_locality, served_barangay_names

        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_GEOGRAPHY):
            return capability_denied(CONFIGURE_GEOGRAPHY)

        served = served_barangay_names()
        rows = MapGeometry.objects.filter(
            kind=MapGeometry.Kind.BOUNDARY, is_active=True
        ).filter(models.Q(is_home=True) | models.Q(name__in=served))

        seen = set()
        results = []
        for boundary in rows.order_by("-is_home", "name", "pk")[:50]:
            key = (boundary.name.strip().lower(), normalize_locality(boundary.locality))
            if key in seen:
                continue
            seen.add(key)
            results.append(
                {
                    "id": boundary.pk,
                    "name": boundary.name,
                    "locality": boundary.locality,
                    "is_home": boundary.is_home,
                    "geometry": boundary.geometry,
                }
            )
        return Response(results)


MIN_BOUNDARY_POINTS = 3
MAX_BOUNDARY_POINTS = 2000


def parse_boundary_geometry(value):
    """A GeoJSON Polygon safe to store as a barangay outline.

    The map hands over whatever the official dragged, so the ring is checked
    here rather than trusted: an unclosed or two-point ring would render as a
    broken edge on every map that reads this row.
    """
    if not isinstance(value, dict) or value.get("type") != "Polygon":
        raise ApiValidationError("geometry must be a GeoJSON Polygon.")
    rings = value.get("coordinates")
    if not isinstance(rings, list) or not rings:
        raise ApiValidationError("geometry must carry at least one ring.")

    cleaned = []
    for ring in rings:
        if not isinstance(ring, list):
            raise ApiValidationError("Each ring must be a list of points.")
        if len(ring) > MAX_BOUNDARY_POINTS:
            raise ApiValidationError("That outline has too many points.")
        points = []
        for position in ring:
            if not isinstance(position, (list, tuple)) or len(position) < 2:
                raise ApiValidationError("Each point must be a [longitude, latitude] pair.")
            try:
                lng = float(position[0])
                lat = float(position[1])
            except (TypeError, ValueError):
                raise ApiValidationError("Each point must be a [longitude, latitude] pair.")
            if not (-180 <= lng <= 180) or not (-90 <= lat <= 90):
                raise ApiValidationError("A point falls outside the range of the earth.")
            points.append([round(lng, 7), round(lat, 7)])
        # A ring may arrive open or closed; the count that matters is of the
        # corners it actually has, so the repeated closing point is set aside.
        if len(points) > 1 and points[0] == points[-1]:
            points.pop()
        if len(points) < MIN_BOUNDARY_POINTS:
            raise ApiValidationError("Each ring needs at least three distinct points.")
        # GeoJSON rings close on themselves.
        points.append(list(points[0]))
        cleaned.append(points)
    return {"type": "Polygon", "coordinates": cleaned}


class BoundaryDetailView(APIView):
    """Edits one barangay outline, so an official can correct the drawn edge."""

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_GEOGRAPHY):
            return capability_denied(CONFIGURE_GEOGRAPHY)
        boundary = get_object_or_404(
            MapGeometry.objects.select_for_update(), pk=pk, kind=MapGeometry.Kind.BOUNDARY, is_active=True,
            community__id__in=community_ids_for_user(request.user),
        )
        community = Community.objects.select_for_update().get(boundary=boundary)
        geometry = parse_boundary_geometry(request.data.get("geometry"))
        boundary.geometry = geometry
        boundary.save(update_fields=["geometry", "updated_at"])
        points = geometry["coordinates"][0]
        community.bbox_min_longitude = min(point[0] for point in points)
        community.bbox_max_longitude = max(point[0] for point in points)
        community.bbox_min_latitude = min(point[1] for point in points)
        community.bbox_max_latitude = max(point[1] for point in points)
        community.save(update_fields=[
            "bbox_min_longitude", "bbox_max_longitude", "bbox_min_latitude",
            "bbox_max_latitude", "updated_at",
        ])
        create_audit_log(
            "map_boundary.updated",
            actor=request.user,
            metadata={
                "boundary_id": boundary.pk,
                "name": boundary.name,
                "points": len(geometry["coordinates"][0]),
            },
            request_meta=request_meta(request),
        )
        return Response(
            {
                "id": boundary.pk,
                "source": "saved",
                "name": boundary.name,
                "locality": boundary.locality,
                "osm_id": boundary.osm_id,
                "is_home": boundary.is_home,
                "geometry": boundary.geometry,
            }
        )


class MapDispatchPolicyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_GEOGRAPHY):
            return capability_denied(CONFIGURE_GEOGRAPHY)
        return Response(MapDispatchPolicySerializer(MapDispatchPolicy.current()).data)

    def patch(self, request):
        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_GEOGRAPHY):
            return capability_denied(CONFIGURE_GEOGRAPHY)
        policy = MapDispatchPolicy.current()
        serializer = MapDispatchPolicySerializer(policy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        policy = serializer.save(updated_by=request.user)
        create_audit_log(
            "map_dispatch_policy.updated",
            actor=request.user,
            metadata={
                "acceptance_radius_meters": policy.acceptance_radius_meters,
                "out_of_zone_action": policy.out_of_zone_action,
                "witness_radius_meters": policy.witness_radius_meters,
                "responder_nearby_radius_meters": policy.responder_nearby_radius_meters,
            },
            request_meta=request_meta(request),
        )
        return Response(MapDispatchPolicySerializer(policy).data)


class MyActiveEmergencyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        alert = (
            EmergencyAlert.objects
            .filter(reporter=request.user, status__in=ACTIVE_STATUSES)
            .order_by("-created_at")
            .first()
        )
        if not alert:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(serialize_alert(alert, request))


class MyEmergencyHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="My SOS history",
        description=(
            "Every alert the authenticated resident filed, newest first, with "
            "status trail, assignments and media previews."
        ),
        request=None,
        responses={200: list_envelope_response(EmergencyAlertSerializer, name="EmergencyListEnvelope")},
        parameters=PAGE_PARAMETERS,
        tags=["emergencies"],
    )
    def get(self, request):
        touch_last_seen(request.user)
        alerts = (
            alert_serialization_queryset()
            .filter(reporter=request.user)
            .order_by("-created_at", "-id")
        )
        return paginate_response(request, alerts, lambda page: [serialize_alert(a, request) for a in page])


class EmergencyQueueView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Dispatch queue",
        description=(
            "Officials' live queue. Default returns active alerts only; "
            "`?scope=all` adds incidents closed within the last 30 days."
        ),
        request=None,
        responses={200: list_envelope_response(EmergencyAlertSerializer, name="EmergencyListEnvelope")},
        parameters=[*PAGE_PARAMETERS, OpenApiParameter(
            name="scope", type=str, location=OpenApiParameter.QUERY,
            enum=["active", "all"], description="`active` (default) or `all` with 30-day tail.",
        )],
        tags=["emergencies"],
    )
    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return capability_denied(DISPATCH_EMERGENCIES)
        alerts = scope_emergency_queryset(alert_serialization_queryset(), request.user)
        if request.query_params.get("scope") == "all":
            # Closed incidents stay queryable for 30 days so the console's
            # finished filters have content without scanning history.
            cutoff = timezone.now() - timedelta(days=30)
            alerts = alerts.filter(
                models.Q(status__in=ACTIVE_STATUSES) | models.Q(updated_at__gte=cutoff)
            )
        else:
            alerts = alerts.filter(status__in=ACTIVE_STATUSES)
        alerts = alerts.order_by("-created_at", "-id")
        return paginate_response(request, alerts, lambda page: [serialize_alert(a, request) for a in page])


class ClaimableEmergencyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, "resident_profile", None)
        if not can_manage_responder_shift(request.user) or not request.user.is_on_duty or not profile:
            return Response({"detail": "An eligible on-duty responder account is required."}, status=status.HTTP_403_FORBIDDEN)
        candidates = (
            scope_emergency_queryset(alert_serialization_queryset(), request.user)
            .filter(
                status=EmergencyAlert.Status.SUBMITTED,
                assignments__isnull=True,
            )
            .order_by("-created_at", "-id")
        )
        return paginate_response(
            request,
            candidates,
            lambda page: [
                serialize_alert(alert, request)
                for alert in page
                if responder_is_eligible(request.user, alert)
            ],
        )


class MyAssignedEmergencyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_respond_to_emergencies(request.user):
            return Response({"detail": "You do not have permission to view assigned emergencies."}, status=status.HTTP_403_FORBIDDEN)
        alerts = (
            alert_serialization_queryset()
            .filter(
                assignments__responder=request.user,
                assignments__status__in=["assigned", "acknowledged", "en_route", "arrived"],
                status__in=ACTIVE_STATUSES,
            )
            .distinct()
            .order_by("-created_at", "-id")
        )
        return paginate_response(request, alerts, lambda page: [serialize_alert(a, request) for a in page])


class EmergencyDutyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        if not can_manage_responder_shift(request.user):
            return Response({"detail": "You do not have permission to update responder duty."}, status=status.HTTP_403_FORBIDDEN)

        raw_on_duty = request.data.get("is_on_duty", True)
        is_on_duty = raw_on_duty in {True, "true", "True", "1", 1, "on"}
        # Same rule as ResponderShiftStartView: the unit comes from the
        # official-assigned membership, never from the request body.
        responder_unit = assigned_legacy_unit(request.user)

        location = ResponderShiftEndSerializer(data=request.data)
        location.is_valid(raise_exception=True)
        latitude = location.validated_data.get("latitude")
        longitude = location.validated_data.get("longitude")
        now = timezone.now()
        started_shift_id = None
        ended_shift_id = None
        with transaction.atomic():
            active_shift = (
                ResponderShift.objects
                .select_for_update()
                .filter(responder=request.user, ended_at__isnull=True)
                .order_by("-started_at", "-id")
                .first()
            )
            if is_on_duty and not active_shift:
                active_shift = ResponderShift.objects.create(
                    responder=request.user,
                    responder_unit=responder_unit,
                    status=ResponderShift.Status.ACTIVE,
                    started_at=now,
                    start_latitude=latitude,
                    start_longitude=longitude,
                )
                started_shift_id = active_shift.pk
            elif is_on_duty and active_shift and responder_unit and active_shift.responder_unit != responder_unit:
                active_shift.responder_unit = responder_unit
                active_shift.save(update_fields=["responder_unit", "updated_at"])
            elif not is_on_duty and active_shift:
                finish_responder_shift(
                    active_shift,
                    ended_at=now,
                    latitude=latitude,
                    longitude=longitude,
                )
                ended_shift_id = active_shift.pk
            request.user.is_on_duty = is_on_duty
            update_fields = ["is_on_duty", "updated_at"]
            if latitude is not None and longitude is not None:
                request.user.current_latitude = latitude
                request.user.current_longitude = longitude
                request.user.location_updated_at = now
                update_fields.extend(["current_latitude", "current_longitude", "location_updated_at"])
            request.user.save(update_fields=update_fields)
        if started_shift_id:
            create_audit_log(
                "responder.shift_started",
                actor=request.user,
                target_user=request.user,
                metadata={"shift_id": started_shift_id, "responder_unit": responder_unit, "source": "duty_compatibility"},
                request_meta=request_meta(request),
            )
        if ended_shift_id:
            create_audit_log(
                "responder.shift_ended",
                actor=request.user,
                target_user=request.user,
                metadata={"shift_id": ended_shift_id, "source": "duty_compatibility"},
                request_meta=request_meta(request),
            )
        from apps.live_map import person_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("location.updated", {"person": person_payload(request.user)}))
        return Response({
            "is_on_duty": request.user.is_on_duty,
            "responder_unit": request.user.responder_unit,
            "current_latitude": request.user.current_latitude,
            "current_longitude": request.user.current_longitude,
            "location_updated_at": request.user.location_updated_at,
        })


class ResponderShiftListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_responder_shift(request.user):
            return Response({"detail": "You do not have permission to view responder shifts."}, status=status.HTTP_403_FORBIDDEN)
        shifts = (
            ResponderShift.objects
            .filter(responder=request.user)
            .select_related("responder", "responder__resident_profile")
            .order_by("-started_at", "-id")[:30]
        )
        return Response(ResponderShiftSerializer(shifts, many=True, context={"request": request}).data)


class ResponderShiftActiveView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_responder_shift(request.user):
            return Response({"detail": "You do not have permission to view responder shifts."}, status=status.HTTP_403_FORBIDDEN)
        shift = (
            ResponderShift.objects
            .filter(responder=request.user, ended_at__isnull=True)
            .select_related("responder", "responder__resident_profile")
            .order_by("-started_at", "-id")
            .first()
        )
        if not shift:
            return Response(None)
        return Response(ResponderShiftSerializer(shift, context={"request": request}).data)


class ResponderShiftStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        if not can_manage_responder_shift(request.user):
            return Response({"detail": "You do not have permission to start responder shifts."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ResponderShiftStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # A responder does not choose their own unit. Membership is assigned by
        # officials in the Units screen and read back here; any `responder_unit`
        # in the payload is ignored. Honouring it let a BHW responder start a
        # shift as BDRRMO and begin receiving fire dispatches.
        responder_unit = assigned_legacy_unit(request.user)
        now = timezone.now()
        latitude = serializer.validated_data["latitude"]
        longitude = serializer.validated_data["longitude"]
        with transaction.atomic():
            active_shifts = list(
                ResponderShift.objects
                .select_for_update()
                .filter(responder=request.user, ended_at__isnull=True)
                .order_by("started_at", "id")
            )
            for active_shift in active_shifts:
                finish_responder_shift(
                    active_shift,
                    ended_at=now,
                    latitude=latitude,
                    longitude=longitude,
                )
            shift = ResponderShift.objects.create(
                responder=request.user,
                responder_unit=responder_unit,
                status=ResponderShift.Status.ACTIVE,
                started_at=now,
                start_latitude=latitude,
                start_longitude=longitude,
            )
            request.user.is_on_duty = True
            request.user.current_latitude = latitude
            request.user.current_longitude = longitude
            request.user.location_updated_at = now
            # `responder_unit` is deliberately absent: starting a shift reports
            # availability, it does not change who the responder is.
            request.user.save(update_fields=[
                "is_on_duty",
                "current_latitude",
                "current_longitude",
                "location_updated_at",
                "updated_at",
            ])

        from apps.live_map import person_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("location.updated", {"person": person_payload(request.user)}))
        create_audit_log(
            "responder.shift_started",
            actor=request.user,
            target_user=request.user,
            metadata={"shift_id": shift.pk, "responder_unit": responder_unit},
            request_meta=request_meta(request),
        )
        return Response(ResponderShiftSerializer(shift, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ResponderShiftEndView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        if not can_manage_responder_shift(request.user):
            return Response({"detail": "You do not have permission to end responder shifts."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ResponderShiftEndSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shift = (
            ResponderShift.objects
            .filter(responder=request.user, ended_at__isnull=True)
            .order_by("-started_at", "-id")
            .first()
        )
        if not shift:
            return Response({"detail": "No active responder shift."}, status=status.HTTP_404_NOT_FOUND)
        latitude = serializer.validated_data.get("latitude")
        longitude = serializer.validated_data.get("longitude")
        with transaction.atomic():
            shift = ResponderShift.objects.select_for_update().get(pk=shift.pk)
            shift = finish_responder_shift(shift, latitude=latitude, longitude=longitude)
            request.user.is_on_duty = False
            update_fields = ["is_on_duty", "updated_at"]
            if latitude is not None and longitude is not None:
                request.user.current_latitude = latitude
                request.user.current_longitude = longitude
                request.user.location_updated_at = timezone.now()
                update_fields.extend(["current_latitude", "current_longitude", "location_updated_at"])
            request.user.save(update_fields=update_fields)

        from apps.live_map import person_payload
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("location.updated", {"person": person_payload(request.user)}))
        create_audit_log(
            "responder.shift_ended",
            actor=request.user,
            target_user=request.user,
            metadata={"shift_id": shift.pk},
            request_meta=request_meta(request),
        )
        return Response(ResponderShiftSerializer(shift, context={"request": request}).data)


class EmergencyCategoryListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get(self, request):
        touch_last_seen(request.user)
        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            return Response({"detail": "Choose one active community."}, status=status.HTTP_400_BAD_REQUEST)
        qs = EmergencyCategory.objects.filter(community=community)
        if not can_configure_emergencies(request.user, CONFIGURE_DISPATCH):
            qs = qs.filter(is_active=True)
            qs = [category for category in qs.order_by("sort_order", "label") if emergency_category_is_covered(category.code)]
            return Response(EmergencyCategorySerializer(qs, many=True, context={"request": request}).data)
        return Response(EmergencyCategorySerializer(qs.order_by("sort_order", "label"), many=True, context={"request": request}).data)

    def post(self, request):
        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_DISPATCH):
            return capability_denied(CONFIGURE_DISPATCH)
        serializer = EmergencyCategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose one active community."}, status=status.HTTP_400_BAD_REQUEST)
        category = serializer.save(community=community)
        create_audit_log(
            "emergency.category_created",
            actor=request.user,
            metadata={"category_id": category.pk, "code": category.code},
            request_meta=request_meta(request),
        )
        return Response(EmergencyCategorySerializer(category, context={"request": request}).data, status=status.HTTP_201_CREATED)


class EmergencyCategoryDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def _allowed(self, user):
        return can_configure_emergencies(user, CONFIGURE_DISPATCH)

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return capability_denied(CONFIGURE_DISPATCH)
        category = get_object_or_404(EmergencyCategory, pk=pk, community_id__in=community_ids_for_user(request.user))
        serializer = EmergencyCategorySerializer(category, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        category = serializer.save()
        create_audit_log(
            "emergency.category_updated",
            actor=request.user,
            metadata={"category_id": category.pk, "code": category.code},
            request_meta=request_meta(request),
        )
        return Response(EmergencyCategorySerializer(category, context={"request": request}).data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return capability_denied(CONFIGURE_DISPATCH)
        category = get_object_or_404(EmergencyCategory, pk=pk, community_id__in=community_ids_for_user(request.user))
        in_use = EmergencyAlert.objects.filter(type=category.code).count()
        if in_use:
            category.is_active = False
            category.save(update_fields=["is_active", "updated_at"])
            return Response({"deleted": False, "in_use": in_use})
        category.delete()
        EmergencyTypeRoleMap.objects.filter(emergency_type=category.code).delete()
        return Response({"deleted": True, "in_use": 0})


class EmergencyTypeRoleMapListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_DISPATCH):
            return capability_denied(CONFIGURE_DISPATCH)
        community = selected_community(request.user, request.query_params.get("community_id"))
        if not community:
            return Response({"detail": "Choose one active community."}, status=status.HTTP_400_BAD_REQUEST)
        maps = EmergencyTypeRoleMap.objects.filter(community=community).order_by("emergency_type", "-priority", "id")
        return paginate_response(
            request,
            maps,
            lambda page: EmergencyTypeRoleMapSerializer(page, many=True, context={"request": request}).data,
        )

    def post(self, request):
        touch_last_seen(request.user)
        if not can_configure_emergencies(request.user, CONFIGURE_DISPATCH):
            return capability_denied(CONFIGURE_DISPATCH)
        serializer = EmergencyTypeRoleMapSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        community = selected_community(request.user, request.data.get("community_id"))
        if not community:
            return Response({"detail": "Choose one active community."}, status=status.HTTP_400_BAD_REQUEST)
        departments = [serializer.validated_data.get(key) for key in ("department", "supporting_department", "escalation_department")]
        if any(item and item.community_id != community.pk for item in departments):
            return Response({"department": ["All dispatch units must belong to the selected community."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            # Savepoint: without it the failed INSERT poisons the surrounding
            # atomic block and the recovery query below cannot run.
            with transaction.atomic():
                role_map = serializer.save(community=community)
        except IntegrityError:
            # (emergency_type, department) is unique. Since a default routing
            # table is seeded on install, an official re-adding a rule that
            # already exists is a normal mistake and deserves a readable
            # message rather than a 500.
            existing = EmergencyTypeRoleMap.objects.filter(
                emergency_type=serializer.validated_data.get("emergency_type"),
                department=serializer.validated_data.get("department"),
                community=community,
            ).first()
            return Response(
                {
                    "detail": "A dispatch rule already routes this emergency type to that unit.",
                    "existing_rule_id": getattr(existing, "pk", None),
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(EmergencyTypeRoleMapSerializer(role_map, context={"request": request}).data, status=status.HTTP_201_CREATED)


class EmergencyTypeRoleMapDetailView(APIView):
    """Change or remove one dispatch rule.

    The list/create endpoint could only add rules, so an official could never
    repoint or clear one — and the uniqueness constraint on
    (emergency_type, department) meant re-adding was rejected rather than
    updating.
    """

    permission_classes = [IsAuthenticated]

    def _denied(self):
        return capability_denied(CONFIGURE_DISPATCH)

    def _allowed(self, user):
        return can_configure_emergencies(user, CONFIGURE_DISPATCH)

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        role_map = get_object_or_404(EmergencyTypeRoleMap, pk=pk, community_id__in=community_ids_for_user(request.user))
        serializer = EmergencyTypeRoleMapSerializer(
            role_map, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk):
        touch_last_seen(request.user)
        if not self._allowed(request.user):
            return self._denied()
        role_map = get_object_or_404(EmergencyTypeRoleMap, pk=pk, community_id__in=community_ids_for_user(request.user))
        role_map.delete()
        return Response({"deleted": True})


class EmergencyAssignmentStatusView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk, assignment_id):
        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk, lock=True)
        assignment = get_object_or_404(
            EmergencyResponderAssignment.objects.select_for_update(),
            pk=assignment_id,
            alert=alert,
        )
        if not (can_manage_emergencies(request.user) or assignment.responder_id == request.user.pk):
            return Response({"detail": "You are not assigned to this dispatch item."}, status=status.HTTP_403_FORBIDDEN)
        serializer = EmergencyAssignmentStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected_version = serializer.validated_data.get("status_version")
        if expected_version is not None and expected_version != alert.status_version:
            return Response(
                {"status_version": ["This emergency was updated elsewhere. Refresh and try again."]},
                status=status.HTTP_409_CONFLICT,
            )
        old_status = assignment.status
        new_status = serializer.validated_data["status"]
        note = serializer.validated_data["note"]
        assignment.status = new_status
        assignment.status_note = note
        update_fields = ["status", "status_note"]
        if new_status == EmergencyResponderAssignment.Status.ACKNOWLEDGED and not assignment.acknowledged_at:
            assignment.acknowledged_at = timezone.now()
            update_fields.append("acknowledged_at")
        if new_status == EmergencyResponderAssignment.Status.ARRIVED and not assignment.arrived_at:
            assignment.arrived_at = timezone.now()
            update_fields.append("arrived_at")
        assignment.save(update_fields=update_fields)
        if new_status not in {EmergencyResponderAssignment.Status.DECLINED}:
            if new_status == EmergencyResponderAssignment.Status.ASSISTING:
                alert.status = EmergencyAlert.Status.ARRIVED if alert.status == EmergencyAlert.Status.NEARBY else alert.status
            elif new_status == EmergencyResponderAssignment.Status.ACKNOWLEDGED:
                alert.status = EmergencyAlert.Status.ACKNOWLEDGED
            elif new_status == EmergencyResponderAssignment.Status.EN_ROUTE:
                alert.status = EmergencyAlert.Status.EN_ROUTE
            elif new_status == EmergencyResponderAssignment.Status.ARRIVED:
                alert.status = EmergencyAlert.Status.ARRIVED
            elif new_status == EmergencyResponderAssignment.Status.RESOLVED:
                alert.status = EmergencyAlert.Status.RESOLVED
                alert.resolved_at = timezone.now()
            alert.status_version += 1
            alert.save(update_fields=["status", "status_version", "resolved_at", "updated_at"] if new_status == EmergencyResponderAssignment.Status.RESOLVED else ["status", "status_version", "updated_at"])
            create_status_event(alert, alert.status, request.user, note)
        log_assignment_action(alert=alert, assignment=assignment, responder=assignment.responder, actor=request.user, action="status_changed", old_status=old_status, new_status=new_status, note=note)
        return Response(EmergencyResponderAssignmentSerializer(assignment, context={"request": request}).data)


class EmergencyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        if not can_view_alert(request.user, alert):
            return Response({"detail": "You do not have permission to view this emergency."}, status=status.HTTP_403_FORBIDDEN)
        return Response(serialize_alert(alert, request))


class EmergencyReporterContactView(APIView):
    """Reveal the reporter's full mobile number, once, with an audit trail.

    Every other surface shows it masked. Only someone actually working the
    incident can unmask it: an assigned responder, or an official who can
    manage emergencies. The reveal is logged with the caller and the alert so
    the barangay can answer "who looked up this resident's number".
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(scope_emergency_queryset(EmergencyAlert.objects.select_related("reporter"), request.user), pk=pk)

        is_assigned = alert.assignments.filter(
            responder=request.user,
            status__in=ACTIVE_ASSIGNMENT_STATUSES,
        ).exists()
        if not (is_assigned or can_manage_emergencies(request.user)):
            return Response(
                {"detail": "Only an assigned responder or an official can reveal the reporter's number."},
                status=status.HTTP_403_FORBIDDEN,
            )

        number = (alert.reporter_contact_number or "").strip() or getattr(alert.reporter, "phone_number", "")
        if not number:
            return Response({"detail": "No contact number is on file for this emergency."}, status=status.HTTP_404_NOT_FOUND)

        create_audit_log(
            "emergency.contact_revealed",
            actor=request.user,
            target_user=alert.reporter,
            metadata={"alert_id": alert.pk, "assigned_responder": is_assigned},
            request_meta=request_meta(request),
        )
        return Response({"phone_number": number, "alert_id": alert.pk})


class EmergencyResponderContactView(APIView):
    """Reveal the assigned responder's mobile number to the reporter.

    Mirror of EmergencyReporterContactView: only the alert's reporter or an
    official who can manage emergencies may unmask it, and every reveal is
    audit-logged so the barangay can answer "who looked up this number".
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(scope_emergency_queryset(EmergencyAlert.objects.all(), request.user), pk=pk)

        is_reporter = alert.reporter_id == request.user.id
        if not (is_reporter or can_manage_emergencies(request.user)):
            return Response(
                {"detail": "Only the reporter or an official can reveal the responder's number."},
                status=status.HTTP_403_FORBIDDEN,
            )

        assignment = (
            alert.assignments.select_related("responder")
            .filter(status__in=ACTIVE_ASSIGNMENT_STATUSES)
            .order_by("-id")
            .first()
        ) or alert.assignments.select_related("responder").order_by("-id").first()
        responder = assignment.responder if assignment else None
        number = (getattr(responder, "phone_number", "") or "").strip()
        if not number:
            return Response({"detail": "No contact number is on file for this responder."}, status=status.HTTP_404_NOT_FOUND)

        create_audit_log(
            "emergency.responder_contact_revealed",
            actor=request.user,
            target_user=responder,
            metadata={"alert_id": alert.pk, "assignment_id": assignment.pk if assignment else None},
            request_meta=request_meta(request),
        )
        return Response({"phone_number": number, "alert_id": alert.pk})


class EmergencyRouteView(APIView):
    """Return the OSRM route between the primary responder and the incident."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from apps.live_map import route_for_responder_assignment

        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        if not can_view_alert(request.user, alert):
            return Response({"detail": "You do not have permission to view this emergency route."}, status=status.HTTP_403_FORBIDDEN)
        active = alert.assignments.filter(status__in=ACTIVE_ASSIGNMENT_STATUSES).select_related("responder")
        assignment_id = request.query_params.get("assignment_id")
        if assignment_id:
            assignment = active.filter(pk=assignment_id).first()
        elif request.user.role == request.user.Role.FIRST_RESPONDER:
            assignment = active.filter(responder=request.user).first()
        else:
            assignment = active.order_by("assigned_at", "id").first()
        if assignment is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        if request.user.role == request.user.Role.FIRST_RESPONDER and assignment.responder_id != request.user.pk:
            return Response({"detail": "You can only view your own route."}, status=status.HTTP_403_FORBIDDEN)
        refresh = request.query_params.get("refresh") in {"1", "true"}
        if refresh and assignment.responder_id != request.user.pk:
            return Response({"detail": "Only the assigned responder can refresh this route."}, status=status.HTTP_403_FORBIDDEN)
        route = route_for_responder_assignment(
            alert,
            assignment,
            refresh=refresh,
            include_steps=request.query_params.get("steps") in {"1", "true"},
        )
        if route is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(route)

    def post(self, request, pk):
        from apps.live_map import route_for_responder_assignment

        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        assignment = alert.assignments.filter(
            responder=request.user,
            status__in=ACTIVE_ASSIGNMENT_STATUSES,
        ).select_related("responder").first()
        if assignment is None:
            return Response({"detail": "Only an assigned responder can change the route profile."}, status=status.HTTP_403_FORBIDDEN)
        profile = (request.data.get("profile") or "").strip().lower()
        if profile not in {"car", "bike", "foot"}:
            return Response({"profile": ["Choose car, bike, or foot."]}, status=status.HTTP_400_BAD_REQUEST)
        assignment.travel_profile = profile
        assignment.save(update_fields=["travel_profile"])
        route = route_for_responder_assignment(alert, assignment, refresh=True, include_steps=True)
        return Response(route) if route else Response(status=status.HTTP_204_NO_CONTENT)


class EmergencyChatView(APIView):
    """
    Resident ↔ assigned responders chat for one SOS alert.
    GET list messages · POST send a message.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        if not can_view_alert(request.user, alert):
            return Response(
                {"detail": "You do not have permission to view this emergency chat."},
                status=status.HTTP_403_FORBIDDEN,
            )
        after_id = request.query_params.get("after")
        qs = (
            EmergencyChatMessage.objects.filter(alert=alert)
            .select_related("sender", "sender__resident_profile", "attachment")
            .order_by("created_at", "id")
        )
        if after_id and str(after_id).isdigit():
            qs = qs.filter(pk__gt=int(after_id))
        messages = list(qs[:200])
        return Response(
            EmergencyChatMessageSerializer(messages, many=True, context={"request": request}).data
        )

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        if not can_view_alert(request.user, alert):
            return Response(
                {"detail": "You do not have permission to chat on this emergency."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if alert.status not in ACTIVE_STATUSES:
            return Response(
                {"detail": "Chat is closed for resolved or cancelled alerts."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Historical/escalated assignments must not keep the private room writable.
        if not alert.assignments.filter(status__in=ACTIVE_ASSIGNMENT_STATUSES).exists():
            return Response(
                {"detail": "Chat opens after an active responder is assigned to this emergency."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = EmergencyChatCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        attachment_file = serializer.validated_data.get("attachment")
        validated_attachment = None
        attachment_metadata = None
        if attachment_file:
            try:
                validated_attachment, attachment_metadata = validate_chat_attachment(attachment_file)
            except ValidationError as exc:
                return Response({"attachment": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            message = EmergencyChatMessage.objects.create(
                alert=alert,
                sender=request.user,
                body=serializer.validated_data["body"],
            )
            if validated_attachment:
                attachment = EmergencyChatAttachment(
                    message=message,
                    file=validated_attachment,
                    original_filename=attachment_file.name,
                    file_size=validated_attachment.size,
                    **attachment_metadata,
                )
                try:
                    attachment.save()
                except Exception:
                    if attachment.file.name:
                        attachment.file.storage.delete(attachment.file.name)
                    raise
                if attachment_metadata.get("media_type") == "image":
                    transaction.on_commit(
                        lambda attachment_id=attachment.pk: enqueue_emergency_media_preview("chat", attachment_id)
                    )
        message = (
            EmergencyChatMessage.objects.select_related("sender", "sender__resident_profile")
            .get(pk=message.pk)
        )
        payload = EmergencyChatMessageSerializer(message, context={"request": request}).data
        recipient_ids = set(
            alert.assignments.filter(status__in=ACTIVE_ASSIGNMENT_STATUSES)
            .exclude(responder_id=request.user.pk)
            .values_list("responder_id", flat=True)
        )
        if alert.reporter_id != request.user.pk:
            recipient_ids.add(alert.reporter_id)
        User = get_user_model()
        recipients = User.objects.filter(
            pk__in=recipient_ids,
            is_active=True,
            status=User.Status.VERIFIED,
        )
        message_preview = message.body[:240] or "New emergency chat attachment"
        for recipient in recipients:
            create_emergency_notification(
                alert=alert,
                recipient=recipient,
                type="chat_message",
                title="New emergency message",
                body=message_preview,
                event_key=f"emergency-chat:{message.pk}:{recipient.pk}",
            )
        # Live delivery via emergency tracking websocket; REST poll is fallback
        transaction.on_commit(lambda m=message: broadcast_emergency_chat_message(m))
        return Response(payload, status=status.HTTP_201_CREATED)


class EmergencyCancelView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(
            EmergencyAlert.objects.select_for_update(), pk=pk, reporter=request.user
        )
        if alert.status not in {EmergencyAlert.Status.SUBMITTED, EmergencyAlert.Status.ROUTED}:
            return Response({"detail": "This emergency can no longer be cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        reason = str(request.data.get("reason", "")).strip()
        if len(reason) < 10:
            return Response(
                {"reason": ["Explain the cancellation in at least 10 characters."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(reason) > 500:
            return Response(
                {"reason": ["Ensure this field has no more than 500 characters."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        alert.status = EmergencyAlert.Status.CANCELLED
        alert.status_version += 1
        alert.resolved_at = timezone.now()
        from apps.live_map import route_for_assignment

        alert.route = route_for_assignment(alert)
        alert.save(update_fields=["status", "resolved_at", "status_version", "updated_at", "route"])
        active_assignments = list(
            alert.assignments.exclude(
                status__in=[
                    EmergencyResponderAssignment.Status.RESOLVED,
                    EmergencyResponderAssignment.Status.CANCELLED,
                ]
            ).select_related("responder")
        )
        alert.assignments.filter(pk__in=[assignment.pk for assignment in active_assignments]).update(
            status=EmergencyResponderAssignment.Status.CANCELLED
        )
        create_status_event(
            alert,
            EmergencyAlert.Status.CANCELLED,
            request.user,
            f"Resident cancelled the emergency alert: {reason}",
        )
        notify_emergency_status(alert, type=EmergencyAlert.Status.CANCELLED, body="Your emergency alert was cancelled.")
        for assignment in active_assignments:
            create_emergency_notification(
                alert=alert,
                recipient=assignment.responder,
                type="emergency_cancelled",
                title="Dispatch cancelled",
                body=f"The resident cancelled this dispatch: {reason}",
            )
        create_audit_log(
            "emergency.cancelled",
            actor=request.user,
            target_user=request.user,
            metadata={"alert_id": alert.pk, "reason": reason},
            request_meta=request_meta(request),
        )
        return Response(serialize_alert(alert, request))


class EmergencyDispositionView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to review emergency disposition."}, status=status.HTTP_403_FORBIDDEN)
        alert = scoped_alert_or_404(request.user, pk, lock=True)
        if alert.status not in ACTIVE_STATUSES | {EmergencyAlert.Status.CANCELLED, EmergencyAlert.Status.RESOLVED}:
            return Response({"detail": "This emergency already has a final disposition."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EmergencyDispositionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected_version = serializer.validated_data.get("status_version")
        if expected_version is not None and expected_version != alert.status_version:
            return Response({"status_version": ["This emergency was updated elsewhere. Refresh and try again."]}, status=status.HTTP_409_CONFLICT)
        from apps.live_map import route_for_assignment

        note = serializer.validated_data["note"]
        alert.status = serializer.validated_data["status"]
        alert.resolved_at = timezone.now()
        alert.resolution_report = note
        alert.route = route_for_assignment(alert)
        alert.status_version += 1
        alert.save(update_fields=["status", "resolved_at", "resolution_report", "route", "status_version", "updated_at"])
        alert.assignments.filter(status__in=ACTIVE_ASSIGNMENT_STATUSES).update(status=EmergencyResponderAssignment.Status.CANCELLED)
        create_status_event(alert, alert.status, request.user, note)
        log_assignment_action(alert=alert, actor=request.user, action="disposition", new_status=alert.status, note=note)
        notify_emergency_status(alert, type=alert.status, body=note)
        return Response(serialize_alert(alert, request))


class EmergencyAssignView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to assign responders."}, status=status.HTTP_403_FORBIDDEN)
        serializer = EmergencyAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        User = get_user_model()
        responders_by_id = {
            responder.pk: responder
            for responder in User.objects.filter(
                pk__in=serializer.validated_data["responder_ids"],
                role=User.Role.FIRST_RESPONDER,
                status=User.Status.VERIFIED,
                is_active=True,
            )
        }
        responders = [responders_by_id.get(pk) for pk in serializer.validated_data["responder_ids"]]
        if any(responder is None for responder in responders):
            return Response({"responder_ids": ["One or more responders are invalid."]}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            alert = scoped_alert_or_404(request.user, pk, lock=True)
            if alert.status not in ACTIVE_STATUSES:
                return Response({"detail": "Responders cannot be assigned to a closed emergency."}, status=status.HTTP_409_CONFLICT)
            was_unrouted = alert.status in {
                EmergencyAlert.Status.SUBMITTED,
                EmergencyAlert.Status.ESCALATION_REQUIRED,
            }
            role_maps = {responder.pk: role_map_for_responder(alert, responder) for responder in responders}
            ineligible = [
                responder.pk for responder in responders
                if not responder_is_manually_assignable(responder) or not role_maps[responder.pk]
            ]
            if ineligible:
                return Response(
                    {
                        "responder_ids": [
                            "Every responder must be active and belong to a unit assigned to this emergency type."
                        ],
                        "ineligible_responder_ids": ineligible,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            newly_assigned_responders = []
            for responder in responders:
                role_map = role_maps[responder.pk]
                assignment, created = EmergencyResponderAssignment.objects.get_or_create(
                    alert=alert,
                    responder=responder,
                    defaults={
                        "status": EmergencyResponderAssignment.Status.ASSIGNED,
                        "source": EmergencyResponderAssignment.Source.MANUAL,
                        "role_map": role_map,
                        "responding_community": role_map.community,
                        "is_cross_community": role_map.community_id != alert.community_id,
                    },
                )
                if created:
                    log_assignment_action(alert=alert, assignment=assignment, responder=responder, actor=request.user, action="manual_assigned", new_status=assignment.status)
                    newly_assigned_responders.append(responder)
                elif assignment.status not in ACTIVE_ASSIGNMENT_STATUSES:
                    assignment.status = EmergencyResponderAssignment.Status.ASSIGNED
                    assignment.assigned_at = timezone.now()
                    assignment.acknowledged_at = None
                    assignment.arrived_at = None
                    assignment.source = EmergencyResponderAssignment.Source.MANUAL
                    assignment.role_map = role_map
                    assignment.responding_community = role_map.community
                    assignment.is_cross_community = role_map.community_id != alert.community_id
                    assignment.save(
                        update_fields=[
                            "status",
                            "source",
                            "assigned_at",
                            "acknowledged_at",
                            "arrived_at",
                            "role_map",
                            "responding_community",
                            "is_cross_community",
                        ]
                    )
                    log_assignment_action(alert=alert, assignment=assignment, responder=responder, actor=request.user, action="manual_assigned", new_status=assignment.status)
                    newly_assigned_responders.append(responder)
            if not newly_assigned_responders:
                return Response(serialize_alert(alert, request))
            if was_unrouted:
                alert.status = EmergencyAlert.Status.ROUTED
            alert.status_version += 1
            alert.routed_at = alert.routed_at or timezone.now()
            alert.save(update_fields=["status", "status_version", "routed_at", "updated_at"])
            responder_labels = ", ".join(
                privacy_safe_user_name(responder) for responder in newly_assigned_responders
            )
            create_status_event(
                alert,
                alert.status,
                request.user,
                f"Added responder support: {responder_labels}.",
            )
            create_emergency_notification(
                alert=alert,
                recipient=alert.reporter,
                type="emergency_routed",
                title="Emergency response team updated",
                body="A responder has been added to your active emergency response.",
            )
            transaction.on_commit(lambda: broadcast_emergency_update(alert))
            responders = newly_assigned_responders
            if was_unrouted:
                create_witness_notifications(alert)
        for index, responder in enumerate(responders):
            create_emergency_notification(
                alert=alert,
                recipient=responder,
                type="emergency_routed",
                title=f"{alert.type.title()} emergency assigned",
                body="Open your responder dashboard and begin responding.",
            )
            unit = responder_display_unit(responder)
            if index == 0:
                post_responder_chat(
                    alert,
                    responder,
                    (
                        f"Hi, this is {privacy_safe_user_name(responder)} ({unit}). "
                        f"I've been assigned to your {alert.type} emergency. "
                        "Please stay safe — we're coordinating response now."
                    ),
                )
            else:
                post_responder_chat(
                    alert,
                    responder,
                    (
                        f"{privacy_safe_user_name(responder)} ({unit}) joined this response team. "
                        "We're all in this group chat with you."
                    ),
                )
        notify_standby_responders(alert, assigned_ids=[responder.pk for responder in responders])
        create_audit_log("emergency.assigned", actor=request.user, target_user=alert.reporter, metadata={"alert_id": alert.pk, "responder_ids": [responder.pk for responder in responders]}, request_meta=request_meta(request))
        return Response(serialize_alert(alert, request))


class EmergencyAssignmentRemoveView(APIView):
    """Remove one supporting responder while retaining the assignment history."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk, assignment_id):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response(
                {"detail": "You do not have permission to remove responders."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = EmergencyAssignmentRemoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]

        with transaction.atomic():
            alert = scoped_alert_or_404(request.user, pk, lock=True)
            if alert.status not in ACTIVE_STATUSES:
                return Response(
                    {"detail": "Responders cannot be removed from a closed emergency."},
                    status=status.HTTP_409_CONFLICT,
                )
            expected_version = serializer.validated_data.get("status_version")
            if expected_version is not None and expected_version != alert.status_version:
                return Response(
                    {"status_version": ["This emergency was updated elsewhere. Refresh and try again."]},
                    status=status.HTTP_409_CONFLICT,
                )

            active_assignments = list(
                alert.assignments.select_for_update()
                .filter(status__in=ACTIVE_ASSIGNMENT_STATUSES)
                .select_related("responder", "responder__resident_profile")
                .order_by("assigned_at", "id")
            )
            assignment = next(
                (item for item in active_assignments if item.pk == assignment_id),
                None,
            )
            if assignment is None:
                assignment_exists = alert.assignments.filter(pk=assignment_id).exists()
                if not assignment_exists:
                    return Response(
                        {"detail": "Assignment not found for this emergency."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                return Response(
                    {"detail": "This responder assignment is no longer active."},
                    status=status.HTTP_409_CONFLICT,
                )
            if len(active_assignments) == 1:
                return Response(
                    {
                        "detail": (
                            "The last active responder cannot be removed. "
                            "Reassign the emergency to a replacement responder instead."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            assignment.status = EmergencyResponderAssignment.Status.CANCELLED
            assignment.save(update_fields=["status"])
            alert.status_version += 1
            alert.save(update_fields=["status_version", "updated_at"])
            responder_name = privacy_safe_user_name(assignment.responder)
            create_status_event(
                alert,
                alert.status,
                request.user,
                f"Removed {responder_name} from the response: {reason}",
            )
            create_emergency_notification(
                alert=alert,
                recipient=assignment.responder,
                type="emergency_cancelled",
                title="Removed from emergency dispatch",
                body=f"An official removed you from this dispatch: {reason}",
            )
            create_emergency_notification(
                alert=alert,
                recipient=alert.reporter,
                type="emergency_routed",
                title="Emergency response team updated",
                body="A support responder was removed. Your emergency remains assigned and active.",
            )
            remaining_assignment_ids = [
                item.pk for item in active_assignments if item.pk != assignment.pk
            ]
            create_audit_log(
                "emergency.assignment_removed",
                actor=request.user,
                target_user=alert.reporter,
                metadata={
                    "alert_id": alert.pk,
                    "assignment_id": assignment.pk,
                    "responder_id": assignment.responder_id,
                    "reason": reason,
                    "remaining_assignment_ids": remaining_assignment_ids,
                },
                request_meta=request_meta(request),
            )
            transaction.on_commit(lambda: broadcast_emergency_update(alert))

        return Response(serialize_alert(alert, request))


class EmergencyClaimView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not can_manage_responder_shift(request.user) or not responder_is_available(request.user):
            return Response({"detail": "An eligible available responder account is required."}, status=status.HTTP_403_FORBIDDEN)
        try:
            with transaction.atomic():
                alert = scoped_alert_or_404(request.user, pk, lock=True)
                if alert.status != EmergencyAlert.Status.SUBMITTED or alert.assignments.select_for_update().exists():
                    return Response({"detail": "This emergency is no longer claimable."}, status=status.HTTP_409_CONFLICT)
                if not responder_is_eligible(request.user, alert):
                    return Response({"detail": "You are not eligible for this emergency."}, status=status.HTTP_403_FORBIDDEN)
                EmergencyResponderAssignment.objects.create(alert=alert, responder=request.user)
                apply_routing_effects(alert, request.user, request, actor=request.user, audit_action="emergency.claimed")
        except (EmergencyAlert.DoesNotExist, IntegrityError):
            return Response({"detail": "This emergency is no longer claimable."}, status=status.HTTP_409_CONFLICT)
        return Response(serialize_alert(alert, request))


class EmergencyReassignView(APIView):
    """Replace the active primary responder from the official operations view."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to reassign responders."}, status=status.HTTP_403_FORBIDDEN)
        serializer = EmergencyReassignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        responder_id = serializer.validated_data["responder_id"]
        User = get_user_model()
        responder = get_object_or_404(
            User,
            pk=responder_id,
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_active=True,
        )
        with transaction.atomic():
            alert = scoped_alert_or_404(request.user, pk, lock=True)
            if alert.status not in ACTIVE_STATUSES:
                return Response({"detail": "This emergency is already closed."}, status=status.HTTP_409_CONFLICT)
            expected_version = serializer.validated_data.get("status_version")
            if expected_version is not None and expected_version != alert.status_version:
                return Response(
                    {"status_version": ["This emergency was updated elsewhere. Refresh and try again."]},
                    status=status.HTTP_409_CONFLICT,
                )
            if not responder_is_manually_assignable(responder):
                return Response(
                    {
                        "responder_id": [
                            "The replacement must have an active, verified responder account."
                        ]
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            role_map = role_map_for_responder(alert, responder)
            if not role_map:
                return Response(
                    {"responder_id": ["The replacement must belong to a unit assigned to this emergency type."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            active_assignments = list(
                alert.assignments.select_for_update()
                .filter(status__in=ACTIVE_ASSIGNMENT_STATUSES)
                .select_related("responder")
                .order_by("assigned_at", "id")
            )
            removed_assignments = [
                item for item in active_assignments if item.responder_id != responder.pk
            ]
            if removed_assignments:
                alert.assignments.filter(
                    pk__in=[item.pk for item in removed_assignments]
                ).update(status=EmergencyResponderAssignment.Status.CANCELLED)
            assignment, _ = EmergencyResponderAssignment.objects.get_or_create(
                alert=alert,
                responder=responder,
                defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
            )
            assignment.status = EmergencyResponderAssignment.Status.ASSIGNED
            assignment.role_map = role_map
            assignment.responding_community = role_map.community
            assignment.is_cross_community = role_map.community_id != alert.community_id
            assignment.assigned_at = timezone.now()
            assignment.acknowledged_at = None
            assignment.arrived_at = None
            assignment.save(
                update_fields=["status", "role_map", "responding_community", "is_cross_community", "assigned_at", "acknowledged_at", "arrived_at"]
            )
            alert.status = EmergencyAlert.Status.ROUTED
            alert.routed_at = alert.routed_at or timezone.now()
            alert.status_version += 1
            alert.save(update_fields=["status", "routed_at", "status_version", "updated_at"])
            note = serializer.validated_data["note"]
            create_status_event(alert, EmergencyAlert.Status.ROUTED, request.user, note)
            notify_emergency_status(alert, type=EmergencyAlert.Status.ROUTED, body="A responder was reassigned to your emergency.")
            create_emergency_notification(
                alert=alert,
                recipient=responder,
                type="emergency_routed",
                title="Emergency reassigned to you",
                body="Open the incident and begin responding.",
            )
            for removed_assignment in removed_assignments:
                create_emergency_notification(
                    alert=alert,
                    recipient=removed_assignment.responder,
                    type="emergency_cancelled",
                    title="Emergency dispatch reassigned",
                    body=f"An official reassigned this dispatch: {note}",
                )
            post_responder_chat(alert, responder, "I have been assigned to your emergency and am coordinating the response.")
            create_audit_log(
                "emergency.reassigned",
                actor=request.user,
                target_user=alert.reporter,
                metadata={
                    "alert_id": alert.pk,
                    "responder_id": responder.pk,
                    "assignment_id": assignment.pk,
                    "removed_assignment_ids": [item.pk for item in removed_assignments],
                    "removed_responder_ids": [item.responder_id for item in removed_assignments],
                    "reason": note,
                },
                request_meta=request_meta(request),
            )
            transaction.on_commit(lambda: broadcast_emergency_update(alert))
        return Response(serialize_alert(alert, request))


class EmergencyBackupView(APIView):
    """Structured backup request: what kind of support, why, how urgent."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from apps.concerns.models import Department

        alert = scoped_alert_or_404(request.user, pk)
        if not (responder_actions.open_assignment_for(alert, request.user) or can_manage_emergencies(request.user)):
            return Response({"detail": "You cannot view backup units for this emergency."}, status=status.HTTP_403_FORBIDDEN)
        department_ids = EmergencyTypeRoleMap.objects.filter(
            community=alert.community,
            emergency_type=alert.type,
            is_active=True,
        ).values_list("department_id", flat=True)
        rows = Department.objects.filter(pk__in=department_ids, is_active=True).order_by("sort_order", "name")
        return Response([{"id": item.pk, "code": item.code, "name": department_label(item)} for item in rows])

    def post(self, request, pk):
        from apps.concerns.models import Department

        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        if alert.status not in ACTIVE_STATUSES:
            return Response(
                {"detail": "Backup cannot be requested for a closed emergency."},
                status=status.HTTP_409_CONFLICT,
            )

        urgency = (request.data.get("urgency") or "high").strip().lower()
        reason = (request.data.get("reason") or "").strip()
        actor = request.user
        if not responder_actions.open_assignment_for(alert, actor) and not can_manage_emergencies(actor):
            return Response({"detail": "You cannot request backup for this emergency."}, status=status.HTTP_403_FORBIDDEN)
        department = Department.objects.filter(
            pk=request.data.get("target_department_id"),
            community=alert.community,
            is_active=True,
            emergency_role_maps__emergency_type=alert.type,
            emergency_role_maps__is_active=True,
        ).first()
        if not department:
            return Response({"target_department_id": ["Choose an active unit assigned to this emergency type."]}, status=status.HTTP_400_BAD_REQUEST)
        if not reason:
            return Response({"reason": ["Tell the unit why backup is needed."]}, status=status.HTTP_400_BAD_REQUEST)
        if urgency not in responder_actions.URGENCY_LEVELS:
            return Response(
                {"urgency": [f"Choose one of: {', '.join(responder_actions.URGENCY_LEVELS)}."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        idempotency_key = request.data.get("idempotency_key")
        if not idempotency_key:
            return Response({"idempotency_key": ["An idempotency key is required."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            with transaction.atomic():
                backup_request, created = BackupRequest.objects.select_for_update().get_or_create(
                    alert=alert,
                    requested_by=actor,
                    idempotency_key=idempotency_key,
                    defaults={"target_department": department, "reason": reason, "urgency": urgency},
                )
                if not created:
                    payload = serialize_alert(alert, request)
                    payload["backup_request"] = {"id": str(backup_request.public_id), "status": backup_request.status, "assignment_id": backup_request.assignment_id}
                    return Response(payload)
                excluded = list(alert.assignments.values_list("responder_id", flat=True))
                candidates = find_auto_responders(alert, limit=1, exclude_ids=excluded, department=department)
                responder = candidates[0] if candidates else None
                if responder:
                    role_map = role_map_for_responder(alert, responder, department=department)
                    if not role_map:
                        responder = None
                    else:
                        responding_community = role_map.community
                if responder:
                    assignment = EmergencyResponderAssignment.objects.create(
                        alert=alert,
                        responder=responder,
                        role_map=role_map,
                        responding_community=responding_community,
                        is_cross_community=bool(responding_community and responding_community.pk != alert.community_id),
                        source=EmergencyResponderAssignment.Source.AUTO,
                    )
                    backup_request.assignment = assignment
                    backup_request.status = BackupRequest.Status.ASSIGNED
                    backup_request.save(update_fields=["assignment", "status", "updated_at"])
                else:
                    backup_request.status = BackupRequest.Status.PENDING_MANUAL
                    backup_request.save(update_fields=["status", "updated_at"])
        except IntegrityError:
            return Response(
                {"detail": "An active backup request already exists for this unit."},
                status=status.HTTP_409_CONFLICT,
            )
        except (ValidationError, ValueError):
            return Response({"idempotency_key": ["Use a valid UUID."]}, status=status.HTTP_400_BAD_REQUEST)

        create_status_event(
            alert,
            alert.status,
            actor,
            f"{department_label(department)} backup requested with {urgency} priority.",
        )
        create_emergency_notification(
            alert=alert,
            recipient=alert.reporter,
            type="emergency_escalated",
            title="Backup responder requested",
            body="Another responder is being added to support your emergency.",
        )
        if backup_request.assignment_id:
            create_emergency_notification(
                alert=alert,
                recipient=backup_request.assignment.responder,
                type="emergency_routed",
                title="Backup response assigned",
                body=f"You were assigned as {department_label(department)} backup for this emergency.",
            )
            create_audit_log(
                "emergency.backup_assigned",
                actor=actor,
                target_user=backup_request.assignment.responder,
                metadata={"alert_id": alert.pk, "assignment_id": backup_request.assignment_id, "department_id": department.pk},
                request_meta=request_meta(request),
            )
            from apps.live_map import route_for_responder_assignment

            route_for_responder_assignment(alert, backup_request.assignment, refresh=True)
            try:
                from apps.sms.notify import notify_responder_backup_assigned

                notify_responder_backup_assigned(alert, backup_request.assignment.responder, backup_type=department.code, urgency=urgency, reason=reason)
            except Exception:
                pass
        else:
            for official in dispatch_officials(alert, department_ids=[department.pk]):
                create_emergency_notification(
                    alert=alert,
                    recipient=official,
                    type="emergency_escalated",
                    title="Backup needs manual dispatch",
                    body=f"No on-duty {department_label(department)} responder is available: {reason[:150]}",
                )
        transaction.on_commit(lambda: broadcast_emergency_update(alert))
        payload = serialize_alert(alert, request)
        payload["backup_request"] = {"id": str(backup_request.public_id), "status": backup_request.status, "assignment_id": backup_request.assignment_id}
        return Response(payload, status=status.HTTP_201_CREATED)


class EmergencyRespondView(APIView):
    """Responder confirms the assignment. No official approval is involved."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        try:
            responder_actions.acknowledge(
                alert,
                request.user,
                note=(request.data.get("note") or "").strip(),
                source="api",
            )
        except responder_actions.ActionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        transaction.on_commit(lambda: broadcast_emergency_update(alert))
        return Response(serialize_alert(alert, request))


class EmergencyUnableView(APIView):
    """Unable to Respond. Requires a reason and reassigns immediately."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        try:
            responder_actions.decline(
                alert,
                request.user,
                reason=(request.data.get("reason") or "").strip(),
                source="api",
            )
        except responder_actions.ActionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        transaction.on_commit(lambda: broadcast_emergency_update(alert))
        return Response(serialize_alert(alert, request))


class EmergencyTransferView(APIView):
    """Official moves an emergency to another unit."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response(
                {"detail": "Only an official can transfer an emergency to another unit."},
                status=status.HTTP_403_FORBIDDEN,
            )
        alert = scoped_alert_or_404(request.user, pk)
        reason = (request.data.get("reason") or "").strip()
        if len(reason) < 5:
            return Response(
                {"reason": ["Add a brief operational reason for the transfer."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        department = None
        department_code = (request.data.get("department_code") or "").strip()
        if department_code:
            matches = active_departments_by_codes([department_code])
            department = matches[0] if matches else None
            if not department:
                return Response(
                    {"department_code": ["That unit does not exist or is inactive."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with transaction.atomic():
            transferred_out_ids = []
            for assignment in alert.assignments.filter(status__in=ACTIVE_ASSIGNMENT_STATUSES):
                transferred_out_ids.append(assignment.responder_id)
                assignment.status = EmergencyResponderAssignment.Status.CANCELLED
                assignment.status_note = f"Transferred: {reason[:200]}"
                assignment.save(update_fields=["status", "status_note"])
                log_assignment_action(
                    alert=alert,
                    assignment=assignment,
                    responder=assignment.responder,
                    actor=request.user,
                    action="transferred",
                    new_status=assignment.status,
                    note=reason[:255],
                )

            alert.status = EmergencyAlert.Status.TRANSFER_REQUIRED
            alert.status_version += 1
            alert.save(update_fields=["status", "status_version", "updated_at"])
            create_status_event(alert, alert.status, request.user, reason[:255])
            EmergencyEscalation.objects.create(
                alert=alert,
                triggered_by=request.user,
                reason=f"Transferred to {department.name if department else 'another unit'}: {reason[:150]}",
            )

            # Never hand the incident back to the responder it was just taken
            # from — that would silently undo the transfer.
            responder = None
            if department:
                candidates = _rank_responders(
                    alert,
                    [
                        user
                        for user in _on_duty_unit_candidates(alert, exclude_ids=transferred_out_ids)
                        if department.pk in responder_department_ids(user)
                    ],
                )
                responder = candidates[0] if candidates else None
            else:
                responders = find_auto_responders(alert, limit=1, exclude_ids=transferred_out_ids)
                responder = responders[0] if responders else None

            if responder:
                # A responder whose assignment was just cancelled by this
                # transfer can legitimately be picked again; (alert, responder)
                # is unique, so reuse the row rather than inserting a second.
                assignment, _created = EmergencyResponderAssignment.objects.update_or_create(
                    alert=alert,
                    responder=responder,
                    defaults={
                        "source": EmergencyResponderAssignment.Source.MANUAL,
                        "status": EmergencyResponderAssignment.Status.ASSIGNED,
                        "status_note": reason[:255],
                    },
                )
                log_assignment_action(
                    alert=alert,
                    assignment=assignment,
                    responder=responder,
                    actor=request.user,
                    action="assigned_after_transfer",
                    new_status=assignment.status,
                    note=reason[:255],
                )
                apply_routing_effects(alert, responder, request, actor=request.user, audit_action="emergency.transferred")
            else:
                notify_officials_no_responder(alert)

        create_audit_log(
            "emergency.transferred",
            actor=request.user,
            target_user=alert.reporter,
            metadata={
                "alert_id": alert.pk,
                "department_code": department_code,
                "responder_id": getattr(responder, "pk", None),
            },
            request_meta=request_meta(request),
        )
        transaction.on_commit(lambda: broadcast_emergency_update(alert))
        return Response(serialize_alert(alert, request))


class EmergencyAppealCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk, reporter=request.user)
        if alert.status not in {EmergencyAlert.Status.RESOLVED, EmergencyAlert.Status.CANCELLED}:
            return Response({"detail": "Only resolved or cancelled emergencies can be appealed for review."}, status=status.HTTP_400_BAD_REQUEST)
        if alert.appeals.filter(status=EmergencyAppeal.Status.SUBMITTED).exists():
            return Response({"detail": "This emergency already has a pending appeal."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EmergencyAppealCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        appeal = EmergencyAppeal.objects.create(alert=alert, appellant=request.user, reason=serializer.validated_data["reason"])
        User = get_user_model()
        department_ids = [department.pk for department in preferred_departments_for(alert.type, alert.community)]
        for official in dispatch_officials(alert, department_ids=department_ids):
            create_emergency_notification(alert=alert, recipient=official, type="emergency_appeal_submitted", title="Emergency review requested", body=appeal.reason[:240])
        create_audit_log("emergency.appeal_submitted", actor=request.user, target_user=request.user, metadata={"alert_id": alert.pk, "appeal_id": appeal.pk}, request_meta=request_meta(request))
        return Response(EmergencyAppealSerializer(appeal, context={"request": request}).data, status=status.HTTP_201_CREATED)

class EmergencyAppealListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to view emergency appeals."}, status=status.HTTP_403_FORBIDDEN)
        appeals = EmergencyAppeal.objects.filter(
            alert__in=scope_emergency_queryset(EmergencyAlert.objects.all(), request.user)
        ).select_related("alert", "appellant", "appellant__resident_profile", "reviewed_by", "reviewed_by__resident_profile")
        appeal_status = request.query_params.get("status")
        if appeal_status and appeal_status != "all":
            appeals = appeals.filter(status=appeal_status)
        return Response(EmergencyAppealSerializer(appeals, many=True, context={"request": request}).data)

class EmergencyAppealReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, appeal_id):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to review emergency appeals."}, status=status.HTTP_403_FORBIDDEN)
        appeal = get_object_or_404(
            EmergencyAppeal.objects.filter(
                alert__in=scope_emergency_queryset(EmergencyAlert.objects.all(), request.user)
            ).select_related("alert", "appellant"),
            pk=appeal_id,
        )
        if appeal.status != EmergencyAppeal.Status.SUBMITTED:
            return Response({"detail": "This appeal has already been decided."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EmergencyAppealReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        appeal.status = serializer.validated_data["status"]
        appeal.decision_note = serializer.validated_data.get("decision_note", "")
        appeal.reviewed_by = request.user
        appeal.decided_at = timezone.now()
        appeal.save(update_fields=["status", "decision_note", "reviewed_by", "decided_at"])
        notif_type = "emergency_appeal_approved" if appeal.status == EmergencyAppeal.Status.APPROVED else "emergency_appeal_denied"
        create_emergency_notification(alert=appeal.alert, recipient=appeal.appellant, type=notif_type, title=f"Emergency review {appeal.status}", body=appeal.decision_note or f"Your emergency review was {appeal.status}.")
        # NOTE: approving an emergency appeal is a record-only decision -- unlike concern
        # appeals, it intentionally does NOT reopen the alert. Officials who need to act on
        # an approved appeal must dispatch manually via the assignment endpoints; reopening
        # the alert itself is unsupported by design.
        default_note = (
            "Appeal approved — incident review recorded; alert remains closed."
            if appeal.status == EmergencyAppeal.Status.APPROVED
            else f"Emergency appeal {appeal.status}."
        )
        create_status_event(appeal.alert, appeal.alert.status, request.user, appeal.decision_note or default_note)
        create_audit_log("emergency.appeal_reviewed", actor=request.user, target_user=appeal.appellant, metadata={"alert_id": appeal.alert_id, "appeal_id": appeal.pk, "status": appeal.status}, request_meta=request_meta(request))
        return Response(EmergencyAppealSerializer(appeal, context={"request": request}).data)

class EmergencyEscalateOverdueView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to escalate emergencies."}, status=status.HTTP_403_FORBIDDEN)
        serializer = EmergencyEscalateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        escalations = escalate_overdue_assignments(
            minutes=serializer.validated_data["minutes"],
            triggered_by=request.user,
            audit_request_meta=request_meta(request),
        )
        return Response(EmergencyEscalationSerializer(escalations, many=True, context={"request": request}).data)

class AssignmentActionMixin:
    target_status = None
    assignment_status = None
    timestamp_field = None
    default_note = ""
    allowed_statuses = set()

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = scoped_alert_or_404(request.user, pk)
        if self.allowed_statuses and alert.status not in self.allowed_statuses:
            return Response(
                {"status": [f"This emergency cannot move from {alert.status} to {self.target_status}."]},
                status=status.HTTP_409_CONFLICT,
            )
        assignment = alert.assignments.filter(
            responder=request.user,
            status__in=["assigned", "acknowledged", "en_route", "arrived"],
        ).first()
        if not assignment and not can_manage_emergencies(request.user):
            return Response({"detail": "You are not assigned to this emergency."}, status=status.HTTP_403_FORBIDDEN)
        if not assignment:
            assignment = alert.assignments.filter(
                status__in=["assigned", "acknowledged", "en_route", "arrived"],
            ).order_by("assigned_at", "id").first()
        if not assignment and not can_manage_emergencies(request.user):
            return Response({"detail": "No responder has been assigned yet."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = EmergencyNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected_version = serializer.validated_data.get("status_version")
        if expected_version is not None and expected_version != alert.status_version:
            return Response(
                {"status_version": ["This emergency was updated elsewhere. Refresh and try again."]},
                status=status.HTTP_409_CONFLICT,
            )
        note = serializer.validated_data.get("note", "").strip() or self.default_note

        if assignment:
            assignment.status = self.assignment_status
            if self.timestamp_field:
                setattr(assignment, self.timestamp_field, timezone.now())
                assignment.save(update_fields=["status", self.timestamp_field])
            else:
                assignment.save(update_fields=["status"])

        alert.status = self.target_status
        alert.status_version += 1
        if self.target_status == EmergencyAlert.Status.RESOLVED:
            alert.resolved_at = timezone.now()
            from apps.live_map import route_for_assignment

            alert.route = route_for_assignment(alert)
            alert.save(update_fields=["status", "status_version", "resolved_at", "updated_at", "route"])
            alert.assignments.filter(
                status__in=["assigned", "acknowledged", "en_route", "arrived"]
            ).exclude(pk=assignment.pk if assignment else None).update(status=EmergencyResponderAssignment.Status.RESOLVED)
        else:
            alert.save(update_fields=["status", "status_version", "updated_at"])
        create_status_event(alert, self.target_status, request.user, note)
        notify_emergency_status(alert, type=self.target_status, body=note)
        if self.target_status == EmergencyAlert.Status.RESOLVED:
            def send_resolved_sms():
                try:
                    from apps.sms.notify import notify_reporter_resolved

                    notify_reporter_resolved(alert)
                except Exception:
                    logger.warning("Resolved SMS failed for alert %s.", alert.pk, exc_info=True)

            transaction.on_commit(send_resolved_sms)
        # Auto chat updates for the resident group room
        if self.target_status == EmergencyAlert.Status.ACKNOWLEDGED:
            post_responder_chat(
                alert,
                request.user,
                "I've accepted your alert and I'm preparing to respond. Please stay safe.",
            )
        elif self.target_status == EmergencyAlert.Status.ARRIVED:
            post_responder_chat(
                alert,
                request.user,
                "I've arrived at your location. Looking for you now — stay visible if you can.",
            )
        elif self.target_status == EmergencyAlert.Status.RESOLVED:
            post_responder_chat(
                alert,
                request.user,
                "This emergency has been marked resolved. Take care.",
            )
        return Response(serialize_alert(alert, request))


class EmergencyAcknowledgeView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.ACKNOWLEDGED
    assignment_status = EmergencyResponderAssignment.Status.ACKNOWLEDGED
    timestamp_field = "acknowledged_at"
    default_note = "Responder acknowledged the dispatch and is preparing to respond."
    allowed_statuses = {EmergencyAlert.Status.ROUTED}


class EmergencyArrivedView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.ARRIVED
    assignment_status = EmergencyResponderAssignment.Status.ARRIVED
    timestamp_field = "arrived_at"
    default_note = "Responder arrived at the location."
    allowed_statuses = {
        EmergencyAlert.Status.ROUTED,
        EmergencyAlert.Status.ACKNOWLEDGED,
        EmergencyAlert.Status.EN_ROUTE,
        EmergencyAlert.Status.NEARBY,
    }


class EmergencyResolveView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.RESOLVED
    assignment_status = EmergencyResponderAssignment.Status.RESOLVED
    default_note = "Emergency resolved."
    allowed_statuses = {
        EmergencyAlert.Status.ROUTED,
        EmergencyAlert.Status.ACKNOWLEDGED,
        EmergencyAlert.Status.EN_ROUTE,
        EmergencyAlert.Status.NEARBY,
        EmergencyAlert.Status.ARRIVED,
    }


class EmergencyLocationPingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        active_assignment_statuses = [
            EmergencyResponderAssignment.Status.ASSIGNED,
            EmergencyResponderAssignment.Status.ACKNOWLEDGED,
            EmergencyResponderAssignment.Status.EN_ROUTE,
            EmergencyResponderAssignment.Status.ARRIVED,
            EmergencyResponderAssignment.Status.ASSISTING,
        ]
        alert = get_object_or_404(
            scope_emergency_queryset(EmergencyAlert.objects.all(), request.user).filter(
                pk=pk,
                assignments__responder=request.user,
                assignments__status__in=active_assignment_statuses,
            )
        )
        assignment = alert.assignments.filter(
            responder=request.user,
            status__in=active_assignment_statuses,
        ).first()
        if alert.status not in ACTIVE_STATUSES:
            return Response({"detail": "Location tracking is closed for this emergency."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EmergencyLocationPingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            EmergencyLocationPing.objects.create(
                assignment=assignment,
                responder=request.user,
                latitude=serializer.validated_data["latitude"],
                longitude=serializer.validated_data["longitude"],
                accuracy=serializer.validated_data.get("accuracy"),
            )
            request.user.current_latitude = serializer.validated_data["latitude"]
            request.user.current_longitude = serializer.validated_data["longitude"]
            request.user.location_updated_at = timezone.now()
            request.user.save(update_fields=["current_latitude", "current_longitude", "location_updated_at", "updated_at"])
        if alert.status in {EmergencyAlert.Status.ACKNOWLEDGED, EmergencyAlert.Status.ROUTED}:
            alert.status = EmergencyAlert.Status.EN_ROUTE
            alert.status_version += 1
            alert.save(update_fields=["status", "status_version", "updated_at"])
            assignment.status = EmergencyResponderAssignment.Status.EN_ROUTE
            assignment_update_fields = ["status"]
            if assignment.acknowledged_at is None:
                assignment.acknowledged_at = timezone.now()
                assignment_update_fields.append("acknowledged_at")
            assignment.save(update_fields=assignment_update_fields)
            create_status_event(alert, EmergencyAlert.Status.EN_ROUTE, request.user, "Responder is on the way.")
            notify_emergency_status(alert, type=EmergencyAlert.Status.EN_ROUTE, body="Responder is on the way.")
            post_responder_chat(
                alert,
                request.user,
                "I'm on my way to your location now. Please stay safe and keep your phone nearby.",
            )
        else:
            try:
                nearby_distance = int(MapDispatchPolicy.current().responder_nearby_radius_meters)
            except Exception:
                nearby_distance = int(getattr(settings, "EMERGENCY_NEARBY_DISTANCE_METERS", 100))
            # With no incident pin there is no "nearby" to detect; the ping is
            # still recorded and broadcast, the status just does not advance.
            distance = (
                distance_meters(
                    alert.latitude,
                    alert.longitude,
                    serializer.validated_data["latitude"],
                    serializer.validated_data["longitude"],
                )
                if alert.latitude is not None and alert.longitude is not None
                else None
            )
            if alert.status == EmergencyAlert.Status.EN_ROUTE and distance is not None and distance <= nearby_distance:
                alert.status = EmergencyAlert.Status.NEARBY
                alert.status_version += 1
                alert.save(update_fields=["status", "status_version", "updated_at"])
                create_status_event(alert, EmergencyAlert.Status.NEARBY, request.user, "Responder is near your location.")
                notify_emergency_status(alert, type=EmergencyAlert.Status.NEARBY, body="Responder is near your location.")
                post_responder_chat(
                    alert,
                    request.user,
                    "I'm nearby. Please stay where you are if it's safe — watch for me.",
                )
            else:
                broadcast_emergency_update(alert)
        from apps.live_map import emergency_payload, person_payload, route_for_assignment
        from apps.notifications.services import broadcast_live_map_event

        def publish_location_update():
            alert.refresh_from_db()
            broadcast_live_map_event("location.updated", {"person": person_payload(request.user)})
            broadcast_live_map_event(
                "emergency.updated",
                {"emergency": emergency_payload(alert), "route": route_for_assignment(alert)},
            )

        transaction.on_commit(publish_location_update)
        return Response(serialize_alert(alert, request), status=status.HTTP_201_CREATED)
