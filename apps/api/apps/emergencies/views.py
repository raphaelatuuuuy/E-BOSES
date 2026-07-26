from datetime import timedelta
from math import asin, cos, radians, sin, sqrt

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsVerifiedAccount as IsAuthenticated, user_has_role_permission
from apps.accounts.media_services import log_raw_media_access
from apps.accounts.services import (
    create_audit_log,
    phash_file,
    sha256_file,
    validate_emergency_media_file,
    validate_location_pair,
)
from apps.accounts.views import request_meta, touch_last_seen
from apps.notifications.services import (
    broadcast_emergency_chat_message,
    broadcast_emergency_update,
    create_emergency_notification,
    notify_emergency_status,
)

from apps.geo_services import validate_barangay_location

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyChatAttachment,
    EmergencyChatMessage,
    EmergencyEscalation,
    EmergencyLocationPing,
    MapDispatchPolicy,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
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
    EmergencyChatCreateSerializer,
    EmergencyChatMessageSerializer,
    EmergencyCreateSerializer,
    EmergencyEscalateSerializer,
    EmergencyEscalationSerializer,
    EmergencyLocationPingCreateSerializer,
    MapDispatchPolicySerializer,
    EmergencyNoteSerializer,
    EmergencyReassignSerializer,
    ResponderShiftEndSerializer,
    ResponderShiftSerializer,
    ResponderShiftStartSerializer,
)
from .media_services import (
    ensure_chat_attachment_preview,
    ensure_emergency_media_preview,
    user_can_access_emergency_media,
    validate_chat_attachment,
)


ACTIVE_STATUSES = {
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTED,
    EmergencyAlert.Status.ACKNOWLEDGED,
    EmergencyAlert.Status.EN_ROUTE,
    EmergencyAlert.Status.NEARBY,
    EmergencyAlert.Status.ARRIVED,
}

ACTIVE_ASSIGNMENT_STATUSES = {
    EmergencyResponderAssignment.Status.ASSIGNED,
    EmergencyResponderAssignment.Status.ACKNOWLEDGED,
    EmergencyResponderAssignment.Status.EN_ROUTE,
    EmergencyResponderAssignment.Status.ARRIVED,
}

# Map SOS category → first-responder units that handle that case
UNIT_BY_EMERGENCY_TYPE = {
    EmergencyAlert.Type.MEDICAL: {"bhw"},
    EmergencyAlert.Type.FIRE: {"bdrrmo"},
    EmergencyAlert.Type.CRIME: {"tanod"},
    EmergencyAlert.Type.DISASTER: {"bdrrmo"},
    EmergencyAlert.Type.OTHER: {"tanod", "bhw", "bdrrmo"},
}

# Prefer responders with GPS updated within this window when ranking
RESPONDER_LOCATION_FRESH_MINUTES = 30


def can_manage_emergencies(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_staff
            or user.is_superuser
            or user_has_role_permission(user, "emergencies.manage")
        )
    )


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
        and user.responder_unit in preferred_units_for(alert.type)
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
    return (
        can_manage_emergencies(user)
        or alert.reporter_id == user.pk
        or alert.assignments.filter(
            responder=user,
            status__in=[
                EmergencyResponderAssignment.Status.ASSIGNED,
                EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                EmergencyResponderAssignment.Status.EN_ROUTE,
                EmergencyResponderAssignment.Status.ARRIVED,
            ],
        ).exists()
    )


def create_status_event(alert, status_value, actor=None, note=""):
    return EmergencyStatusEvent.objects.create(
        alert=alert,
        status=status_value,
        note=note,
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

def preferred_units_for(alert_type):
    return set(UNIT_BY_EMERGENCY_TYPE.get(alert_type) or set())

def responder_unit_label(unit):
    labels = {
        "tanod": "Barangay Tanod",
        "bhw": "BHW",
        "bdrrmo": "BDRRMO",
        "other": "Responder",
        "": "Responder",
    }
    return labels.get(unit or "", "Responder")


def normalize_barangay(value: str) -> str:
    text = (value or "").strip()
    if not text or text.lower() == "pending":
        return "Marikina Heights"
    return text


def _on_duty_unit_candidates(alert, *, exclude_ids=None):
    """
    Available on-duty first responders whose unit matches the emergency
    category (medical→BHW, crime→Tanod, fire/disaster→BDRRMO).
    """
    User = get_user_model()
    preferred_units = preferred_units_for(alert.type)
    if not preferred_units:
        return []

    barangay = normalize_barangay(alert.barangay)
    qs = (
        User.objects.filter(
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_active=True,
            responder_unit__in=preferred_units,
        )
        .filter(is_on_duty=True)
        .filter(resident_profile__barangay__iexact=barangay)
        .exclude(
            emergency_assignments__alert__status__in=ACTIVE_STATUSES,
            emergency_assignments__status__in=[
                EmergencyResponderAssignment.Status.ASSIGNED,
                EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                EmergencyResponderAssignment.Status.EN_ROUTE,
                EmergencyResponderAssignment.Status.ARRIVED,
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


def find_auto_responders(alert, *, limit=5, exclude_ids=None):
    candidates = _on_duty_unit_candidates(alert, exclude_ids=exclude_ids)
    if not candidates:
        return []
    ranked = _rank_responders(alert, candidates)
    return ranked[: max(1, limit)]


def find_auto_responder(alert):
    responders = find_auto_responders(alert, limit=1)
    return responders[0] if responders else None


def find_backup_responder(alert):
    assigned_ids = alert.assignments.values_list("responder_id", flat=True)
    responders = find_auto_responders(alert, limit=1, exclude_ids=assigned_ids)
    return responders[0] if responders else None


def escalate_overdue_assignments(*, minutes, triggered_by=None, audit_request_meta=None):
    cutoff = timezone.now() - timedelta(minutes=minutes)
    assignment_ids = list(
        EmergencyResponderAssignment.objects.filter(
            status=EmergencyResponderAssignment.Status.ASSIGNED,
            assigned_at__lte=cutoff,
            alert__status__in=ACTIVE_STATUSES,
            escalations__isnull=True,
        ).values_list("pk", flat=True)
    )
    escalations = []
    for assignment_id in assignment_ids:
        with transaction.atomic():
            assignment = (
                EmergencyResponderAssignment.objects
                .select_for_update()
                .select_related("alert", "alert__reporter", "responder")
                .get(pk=assignment_id)
            )
            if assignment.status != EmergencyResponderAssignment.Status.ASSIGNED or assignment.escalations.exists():
                continue
            alert = EmergencyAlert.objects.select_for_update().get(pk=assignment.alert_id)
            if alert.status not in ACTIVE_STATUSES:
                continue
            backup = find_backup_responder(alert)
            reason = f"Additional responder requested after {minutes} minutes without response progress."
            if backup:
                EmergencyResponderAssignment.objects.get_or_create(
                    alert=alert,
                    responder=backup,
                    defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
                )
                alert.status = EmergencyAlert.Status.ROUTED
                alert.status_version += 1
                alert.save(update_fields=["status", "status_version", "updated_at"])
                create_emergency_notification(
                    alert=alert,
                    recipient=backup,
                    type="emergency_escalated",
                    title=f"Backup requested for {alert.type} emergency",
                    body="You were added to support the active response.",
                )
            escalation = EmergencyEscalation.objects.create(
                alert=alert,
                previous_assignment=assignment,
                escalated_to=backup,
                triggered_by=triggered_by,
                reason=reason,
            )
            create_status_event(alert, EmergencyAlert.Status.ROUTED, triggered_by, f"Backup: {reason}")
            create_emergency_notification(
                alert=alert,
                recipient=alert.reporter,
                type="emergency_escalated",
                title="Backup response requested",
                body="Barangay added another responder while the original response remains active.",
            )
            create_audit_log(
                "emergency.escalated",
                actor=triggered_by,
                target_user=alert.reporter,
                metadata={
                    "alert_id": alert.pk,
                    "assignment_id": assignment.pk,
                    "backup_id": getattr(backup, "pk", None),
                    "automatic": triggered_by is None,
                },
                request_meta=audit_request_meta or {},
            )
            escalations.append(escalation)
    return escalations


def notify_officials_no_responder(alert):
    User = get_user_model()
    preferred = preferred_units_for(alert.type)
    unit_names = ", ".join(responder_unit_label(u) for u in sorted(preferred)) or alert.type
    barangay = normalize_barangay(alert.barangay)
    officials = User.objects.filter(
        role=User.Role.BARANGAY_OFFICIAL,
        status=User.Status.VERIFIED,
    ).filter(
        models.Q(resident_profile__barangay__iexact=barangay)
        | models.Q(resident_profile__barangay__iexact="Marikina Heights")
        | models.Q(resident_profile__barangay="")
    )
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
    create_status_event(alert, EmergencyAlert.Status.ROUTED, actor, "Responder routed")
    notify_emergency_status(alert, type=EmergencyAlert.Status.ROUTED, body="Responder routed")
    unit = responder_unit_label(responder.responder_unit)
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


def auto_route_alert(alert, request):
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
        if locked_alert.status != EmergencyAlert.Status.SUBMITTED or active_assignment:
            return active_assignment.responder if active_assignment else None

        responder = find_auto_responder(locked_alert)
        if not responder:
            preferred = preferred_units_for(locked_alert.type)
            unit_names = ", ".join(responder_unit_label(u) for u in sorted(preferred)) or "responder"
            reason = f"No eligible on-duty {unit_names} in {normalize_barangay(locked_alert.barangay)}."
            EmergencyEscalation.objects.get_or_create(alert=locked_alert, reason=reason)
            notify_officials_no_responder(locked_alert)
            return None

        EmergencyResponderAssignment.objects.create(
            alert=locked_alert,
            responder=responder,
            status=EmergencyResponderAssignment.Status.ASSIGNED,
        )
        apply_routing_effects(locked_alert, responder, request)
        return responder

def create_witness_notifications(alert):
    reporter_profile = getattr(alert.reporter, "resident_profile", None)
    if not reporter_profile or not reporter_profile.barangay:
        return
    User = get_user_model()
    fresh_after = timezone.now() - timedelta(minutes=15)
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


def serialize_alert(alert, request):
    alert = (
        EmergencyAlert.objects
        .select_related("reporter", "reporter__resident_profile")
        .prefetch_related(
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
        )
        .get(pk=alert.pk)
    )
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
        preview = ensure_emergency_media_preview(media)
        return FileResponse(preview.open("rb"), content_type="image/jpeg")


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
            file_obj = ensure_chat_attachment_preview(attachment)
            if not file_obj:
                return Response({"detail": "Video previews are unavailable."}, status=status.HTTP_404_NOT_FOUND)
            return FileResponse(file_obj.open("rb"), content_type="image/jpeg")
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
        active_alert = (
            EmergencyAlert.objects
            .filter(reporter=request.user, status__in=ACTIVE_STATUSES)
            .order_by("-created_at")
            .first()
        )
        if active_alert:
            return Response(
                {
                    "detail": "You already have an active emergency alert.",
                    "active_emergency": serialize_alert(active_alert, request),
                },
                status=status.HTTP_409_CONFLICT,
            )
        lat = serializer.validated_data.get("latitude")
        lng = serializer.validated_data.get("longitude")
        if lat is not None and lng is not None:
            try:
                validate_barangay_location(lat, lng)
            except ValidationError as exc:
                messages = [str(m) for m in exc.messages] if hasattr(exc, "messages") and exc.messages else [str(exc)]
                return Response({"location": messages}, status=status.HTTP_400_BAD_REQUEST)
        media_files = []
        media_hashes = set()
        media_warnings = []
        for uploaded_file in request.FILES.getlist("media"):
            try:
                validated_file = validate_emergency_media_file(uploaded_file)
            except ValidationError as exc:
                media_warnings.append(f"{uploaded_file.name}: attachment was skipped ({exc}).")
                continue
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
            type=serializer.validated_data["type"],
            note=serializer.validated_data.get("note", ""),
            latitude=serializer.validated_data["latitude"],
            longitude=serializer.validated_data["longitude"],
            location_source=serializer.validated_data.get("location_source", "gps"),
            location_accuracy=serializer.validated_data.get("location_accuracy"),
            address=serializer.validated_data.get("address", ""),
            media_warnings=media_warnings,
            barangay=getattr(profile, "barangay", "") or "Marikina Heights",
        )
        create_status_event(alert, EmergencyAlert.Status.SUBMITTED, request.user, "Emergency alert submitted.")
        notify_emergency_status(alert, type=EmergencyAlert.Status.SUBMITTED, body="Your emergency alert was submitted.")
        auto_route_alert(alert, request)
        create_witness_notifications(alert)
        for uploaded_file, validated_file, media_hash, media_phash in media_files:
            EmergencyMedia.objects.create(
                alert=alert,
                file=validated_file,
                original_filename=uploaded_file.name,
                mime_type=getattr(validated_file, "content_type", "") or "",
                file_size=validated_file.size,
                sha256_hash=media_hash,
                phash=media_phash,
            )
        create_audit_log(
            "emergency.created",
            actor=request.user,
            target_user=request.user,
            metadata={"alert_id": alert.pk, "type": alert.type},
            request_meta=request_meta(request),
        )
        from apps.live_map import emergency_payload, route_for_assignment
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(lambda: broadcast_live_map_event("emergency.created", {"emergency": emergency_payload(alert), "route": route_for_assignment(alert)}))
        return Response(serialize_alert(alert, request), status=status.HTTP_201_CREATED)


class MapDispatchPolicyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to manage map dispatch policy."}, status=status.HTTP_403_FORBIDDEN)
        return Response(MapDispatchPolicySerializer(MapDispatchPolicy.current()).data)

    def patch(self, request):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to manage map dispatch policy."}, status=status.HTTP_403_FORBIDDEN)
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

    def get(self, request):
        touch_last_seen(request.user)
        alerts = EmergencyAlert.objects.filter(reporter=request.user).order_by("-created_at")
        return Response([serialize_alert(alert, request) for alert in alerts])


class EmergencyQueueView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to view emergency queue."}, status=status.HTTP_403_FORBIDDEN)
        alerts = EmergencyAlert.objects.filter(status__in=ACTIVE_STATUSES).order_by("-created_at")
        return Response([serialize_alert(alert, request) for alert in alerts])


class ClaimableEmergencyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, "resident_profile", None)
        if not can_manage_responder_shift(request.user) or not request.user.is_on_duty or not profile:
            return Response({"detail": "An eligible on-duty responder account is required."}, status=status.HTTP_403_FORBIDDEN)
        alerts = EmergencyAlert.objects.filter(
            status=EmergencyAlert.Status.SUBMITTED,
            type__in=[key for key, units in UNIT_BY_EMERGENCY_TYPE.items() if request.user.responder_unit in units],
            barangay__iexact=normalize_barangay(profile.barangay),
            assignments__isnull=True,
        ).order_by("-created_at")
        return Response([serialize_alert(alert, request) for alert in alerts])


class MyAssignedEmergencyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_respond_to_emergencies(request.user):
            return Response({"detail": "You do not have permission to view assigned emergencies."}, status=status.HTTP_403_FORBIDDEN)
        alerts = (
            EmergencyAlert.objects
            .filter(
                assignments__responder=request.user,
                assignments__status__in=["assigned", "acknowledged", "en_route", "arrived"],
                status__in=ACTIVE_STATUSES,
            )
            .distinct()
            .order_by("-created_at")
        )
        return Response([serialize_alert(alert, request) for alert in alerts])


class EmergencyDutyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        if not can_manage_responder_shift(request.user):
            return Response({"detail": "You do not have permission to update responder duty."}, status=status.HTTP_403_FORBIDDEN)

        raw_on_duty = request.data.get("is_on_duty", True)
        is_on_duty = raw_on_duty in {True, "true", "True", "1", 1, "on"}
        responder_unit = (request.data.get("responder_unit") or request.user.responder_unit or "").strip()
        User = get_user_model()
        valid_units = {choice[0] for choice in User.ResponderUnit.choices}
        if responder_unit and responder_unit not in valid_units:
            return Response({"responder_unit": ["Choose a valid responder unit."]}, status=status.HTTP_400_BAD_REQUEST)

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
            if responder_unit:
                request.user.responder_unit = responder_unit
                update_fields.append("responder_unit")
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
        broadcast_live_map_event("location.updated", {"person": person_payload(request.user)})
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

        responder_unit = serializer.validated_data.get("responder_unit") or request.user.responder_unit or ""
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
            request.user.responder_unit = responder_unit
            request.user.current_latitude = latitude
            request.user.current_longitude = longitude
            request.user.location_updated_at = now
            request.user.save(update_fields=[
                "is_on_duty",
                "responder_unit",
                "current_latitude",
                "current_longitude",
                "location_updated_at",
                "updated_at",
            ])

        from apps.live_map import person_payload
        from apps.notifications.services import broadcast_live_map_event
        broadcast_live_map_event("location.updated", {"person": person_payload(request.user)})
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
        broadcast_live_map_event("location.updated", {"person": person_payload(request.user)})
        create_audit_log(
            "responder.shift_ended",
            actor=request.user,
            target_user=request.user,
            metadata={"shift_id": shift.pk},
            request_meta=request_meta(request),
        )
        return Response(ResponderShiftSerializer(shift, context={"request": request}).data)


class EmergencyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        if not can_view_alert(request.user, alert):
            return Response({"detail": "You do not have permission to view this emergency."}, status=status.HTTP_403_FORBIDDEN)
        return Response(serialize_alert(alert, request))


class EmergencyRouteView(APIView):
    """Return the OSRM route between the primary responder and the incident."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from apps.live_map import route_for_assignment

        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        if not can_view_alert(request.user, alert):
            return Response({"detail": "You do not have permission to view this emergency route."}, status=status.HTTP_403_FORBIDDEN)
        route = route_for_assignment(alert)
        if route is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(route)


class EmergencyChatView(APIView):
    """
    Resident ↔ assigned responders chat for one SOS alert.
    GET list messages · POST send a message.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
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
        alert = get_object_or_404(EmergencyAlert, pk=pk)
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
        message = (
            EmergencyChatMessage.objects.select_related("sender", "sender__resident_profile")
            .get(pk=message.pk)
        )
        payload = EmergencyChatMessageSerializer(message, context={"request": request}).data
        # Live delivery via emergency tracking websocket; REST poll is fallback
        transaction.on_commit(lambda m=message: broadcast_emergency_chat_message(m))
        return Response(payload, status=status.HTTP_201_CREATED)


class EmergencyCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk, reporter=request.user)
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
        alert.resolved_at = timezone.now()
        alert.save(update_fields=["status", "resolved_at", "updated_at"])
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
            alert = get_object_or_404(EmergencyAlert.objects.select_for_update(), pk=pk)
            if alert.status not in ACTIVE_STATUSES:
                return Response({"detail": "Responders cannot be assigned to a closed emergency."}, status=status.HTTP_409_CONFLICT)
            was_unrouted = alert.status == EmergencyAlert.Status.SUBMITTED
            ineligible = [
                responder.pk for responder in responders
                if not responder_is_manually_assignable(responder)
            ]
            if ineligible:
                return Response(
                    {
                        "responder_ids": [
                            "Every responder must have an active, verified responder account."
                        ],
                        "ineligible_responder_ids": ineligible,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            newly_assigned_responders = []
            for responder in responders:
                assignment, created = EmergencyResponderAssignment.objects.get_or_create(
                    alert=alert,
                    responder=responder,
                    defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
                )
                if created:
                    newly_assigned_responders.append(responder)
                elif assignment.status not in ACTIVE_ASSIGNMENT_STATUSES:
                    assignment.status = EmergencyResponderAssignment.Status.ASSIGNED
                    assignment.assigned_at = timezone.now()
                    assignment.acknowledged_at = None
                    assignment.arrived_at = None
                    assignment.save(
                        update_fields=[
                            "status",
                            "assigned_at",
                            "acknowledged_at",
                            "arrived_at",
                        ]
                    )
                    newly_assigned_responders.append(responder)
            if not newly_assigned_responders:
                return Response(serialize_alert(alert, request))
            if alert.status == EmergencyAlert.Status.SUBMITTED:
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
            unit = responder_unit_label(getattr(responder, "responder_unit", None))
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
            alert = get_object_or_404(EmergencyAlert.objects.select_for_update(), pk=pk)
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
                alert = EmergencyAlert.objects.select_for_update().get(pk=pk)
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
        responder_id = serializer.validated_data["responder_ids"][0]
        User = get_user_model()
        responder = get_object_or_404(
            User,
            pk=responder_id,
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_active=True,
        )
        with transaction.atomic():
            alert = get_object_or_404(EmergencyAlert.objects.select_for_update(), pk=pk)
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
            assignment.assigned_at = timezone.now()
            assignment.acknowledged_at = None
            assignment.arrived_at = None
            assignment.save(
                update_fields=["status", "assigned_at", "acknowledged_at", "arrived_at"]
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
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            with transaction.atomic():
                alert = EmergencyAlert.objects.select_for_update().get(pk=pk)
                if alert.status not in ACTIVE_STATUSES:
                    return Response({"detail": "Backup cannot be requested for a closed emergency."}, status=status.HTTP_409_CONFLICT)
                assignments = alert.assignments.select_for_update().filter(
                    status__in=["assigned", "acknowledged", "en_route", "arrived"]
                ).order_by("assigned_at", "id")
                assignment = assignments.filter(responder=request.user).first()
                if not assignment and can_manage_emergencies(request.user):
                    assignment = assignments.first()
                if not assignment:
                    return Response({"detail": "You cannot request backup for this emergency."}, status=status.HTTP_403_FORBIDDEN)
                repeated = alert.escalations.filter(
                    previous_assignment=assignment,
                    triggered_by=request.user,
                    reason="Backup requested.",
                ).exists()
                if repeated:
                    return Response(serialize_alert(alert, request))
                backup = find_backup_responder(alert)
                if not backup:
                    return Response({"detail": "No other eligible responder is available."}, status=status.HTTP_409_CONFLICT)
                EmergencyResponderAssignment.objects.create(alert=alert, responder=backup)
                EmergencyEscalation.objects.create(alert=alert, previous_assignment=assignment, escalated_to=backup, triggered_by=request.user, reason="Backup requested.")
                create_status_event(alert, EmergencyAlert.Status.ROUTED, request.user, "Backup responder routed.")
                create_emergency_notification(
                    alert=alert,
                    recipient=backup,
                    type="emergency_escalated",
                    title="Backup requested",
                    body="You were added to support an active emergency response.",
                )
                create_emergency_notification(
                    alert=alert,
                    recipient=alert.reporter,
                    type="emergency_escalated",
                    title="Backup responder routed",
                    body="Another responder was added to support your emergency.",
                )
                post_responder_chat(alert, backup, "Backup responder joined this emergency.")
                create_audit_log(
                    "emergency.backup_requested",
                    actor=request.user,
                    target_user=alert.reporter,
                    metadata={"alert_id": alert.pk, "backup_id": backup.pk, "assignment_id": assignment.pk},
                    request_meta=request_meta(request),
                )
                transaction.on_commit(lambda: broadcast_emergency_update(alert))
        except (EmergencyAlert.DoesNotExist, IntegrityError):
            return Response({"detail": "Backup assignment conflicted with another update."}, status=status.HTTP_409_CONFLICT)
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
        for official in User.objects.filter(role=User.Role.BARANGAY_OFFICIAL, status=User.Status.VERIFIED):
            create_emergency_notification(alert=alert, recipient=official, type="emergency_appeal_submitted", title="Emergency review requested", body=appeal.reason[:240])
        create_audit_log("emergency.appeal_submitted", actor=request.user, target_user=request.user, metadata={"alert_id": alert.pk, "appeal_id": appeal.pk}, request_meta=request_meta(request))
        return Response(EmergencyAppealSerializer(appeal, context={"request": request}).data, status=status.HTTP_201_CREATED)

class EmergencyAppealListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to view emergency appeals."}, status=status.HTTP_403_FORBIDDEN)
        appeals = EmergencyAppeal.objects.select_related("alert", "appellant", "appellant__resident_profile", "reviewed_by", "reviewed_by__resident_profile")
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
        appeal = get_object_or_404(EmergencyAppeal.objects.select_related("alert", "appellant"), pk=appeal_id)
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
        create_status_event(appeal.alert, appeal.alert.status, request.user, appeal.decision_note or f"Emergency appeal {appeal.status}.")
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
        alert = get_object_or_404(EmergencyAlert, pk=pk)
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
            alert.save(update_fields=["status", "status_version", "resolved_at", "updated_at"])
            alert.assignments.filter(
                status__in=["assigned", "acknowledged", "en_route", "arrived"]
            ).exclude(pk=assignment.pk if assignment else None).update(status=EmergencyResponderAssignment.Status.RESOLVED)
        else:
            alert.save(update_fields=["status", "status_version", "updated_at"])
        create_status_event(alert, self.target_status, request.user, note)
        notify_emergency_status(alert, type=self.target_status, body=note)
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
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        assignment = alert.assignments.filter(
            responder=request.user,
            status__in=[
                EmergencyResponderAssignment.Status.ASSIGNED,
                EmergencyResponderAssignment.Status.ACKNOWLEDGED,
                EmergencyResponderAssignment.Status.EN_ROUTE,
                EmergencyResponderAssignment.Status.ARRIVED,
            ],
        ).first()
        if not assignment:
            return Response({"detail": "You are not assigned to this emergency."}, status=status.HTTP_403_FORBIDDEN)
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
        # Persisted user coordinates update the official live map, while this
        # incident-scoped event lets the reporter update their own tracking
        # view without waiting for a full map refresh.
        from apps.live_map import emergency_payload, route_for_assignment
        from apps.notifications.services import broadcast_live_map_event
        transaction.on_commit(
            lambda: broadcast_live_map_event(
                "emergency.updated",
                {
                    "emergency": emergency_payload(alert),
                    "route": route_for_assignment(alert),
                },
            )
        )
        if alert.status in {EmergencyAlert.Status.ACKNOWLEDGED, EmergencyAlert.Status.ROUTED}:
            alert.status = EmergencyAlert.Status.EN_ROUTE
            alert.status_version += 1
            alert.save(update_fields=["status", "status_version", "updated_at"])
            assignment.status = EmergencyResponderAssignment.Status.EN_ROUTE
            assignment.save(update_fields=["status"])
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
            distance = distance_meters(
                alert.latitude,
                alert.longitude,
                serializer.validated_data["latitude"],
                serializer.validated_data["longitude"],
            )
            if alert.status == EmergencyAlert.Status.EN_ROUTE and distance <= nearby_distance:
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
        return Response(serialize_alert(alert, request), status=status.HTTP_201_CREATED)
