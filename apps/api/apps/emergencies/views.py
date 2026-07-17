from datetime import timedelta
from math import asin, cos, radians, sin, sqrt

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
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
from apps.notifications.models import Notification
from apps.notifications.services import broadcast_emergency_update, create_emergency_notification, notify_emergency_status

from .models import (
    EmergencyAlert,
    EmergencyAppeal,
    EmergencyEscalation,
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    WitnessNotification,
)
from .serializers import (
    EmergencyAlertSerializer,
    EmergencyAppealCreateSerializer,
    EmergencyAppealReviewSerializer,
    EmergencyAppealSerializer,
    EmergencyAssignSerializer,
    EmergencyCreateSerializer,
    EmergencyEscalateSerializer,
    EmergencyEscalationSerializer,
    EmergencyLocationPingCreateSerializer,
    EmergencyNoteSerializer,
)
from .media_services import ensure_emergency_media_preview, user_can_access_emergency_media


ACTIVE_STATUSES = {
    EmergencyAlert.Status.SUBMITTED,
    EmergencyAlert.Status.ROUTED,
    EmergencyAlert.Status.ACKNOWLEDGED,
    EmergencyAlert.Status.EN_ROUTE,
    EmergencyAlert.Status.NEARBY,
    EmergencyAlert.Status.ARRIVED,
}

UNIT_BY_EMERGENCY_TYPE = {
    EmergencyAlert.Type.MEDICAL: {"bhw"},
    EmergencyAlert.Type.FIRE: {"bdrrmo"},
    EmergencyAlert.Type.CRIME: {"tanod"},
    EmergencyAlert.Type.DISASTER: {"bdrrmo"},
}


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


def can_view_alert(user, alert):
    if not user or not user.is_authenticated:
        return False
    return (
        can_manage_emergencies(user)
        or alert.reporter_id == user.pk
        or alert.assignments.filter(responder=user).exists()
    )


def create_status_event(alert, status_value, actor=None, note=""):
    return EmergencyStatusEvent.objects.create(
        alert=alert,
        status=status_value,
        note=note,
        actor=actor,
    )


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
    return UNIT_BY_EMERGENCY_TYPE.get(alert_type, set())

def responder_unit_label(unit):
    labels = {
        "tanod": "Barangay Tanod",
        "bhw": "BHW",
        "bdrrmo": "BDRRMO",
        "other": "Responder",
        "": "Responder",
    }
    return labels.get(unit or "", "Responder")

def find_auto_responder(alert):
    User = get_user_model()
    preferred_units = preferred_units_for(alert.type)
    if not preferred_units:
        return None
    fresh_after = timezone.now() - timedelta(minutes=2)
    responders = list(
        User.objects
        .filter(
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_on_duty=True,
            responder_unit__in=preferred_units,
            resident_profile__barangay=alert.barangay,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
            location_updated_at__gte=fresh_after,
        )
        .select_related("resident_profile")
    )
    if not responders:
        return None
    return min(responders, key=lambda responder: location_distance_score(alert, responder) or float("inf"))

def find_backup_responder(alert):
    User = get_user_model()
    preferred_units = preferred_units_for(alert.type)
    if not preferred_units:
        return None
    fresh_after = timezone.now() - timedelta(minutes=2)
    assigned_ids = alert.assignments.values_list("responder_id", flat=True)
    responders = list(
        User.objects
        .filter(
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_on_duty=True,
            responder_unit__in=preferred_units,
            resident_profile__barangay=alert.barangay,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
            location_updated_at__gte=fresh_after,
        )
        .exclude(pk__in=assigned_ids)
        .select_related("resident_profile")
    )
    if not responders:
        return None
    return min(responders, key=lambda responder: location_distance_score(alert, responder) or float("inf"))


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
            alert = assignment.alert
            backup = find_backup_responder(alert)
            reason = f"No responder acknowledgement within {minutes} minutes."
            if backup:
                EmergencyResponderAssignment.objects.update_or_create(
                    alert=alert,
                    responder=backup,
                    defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
                )
                assignment.status = EmergencyResponderAssignment.Status.ESCALATED
                assignment.save(update_fields=["status"])
                alert.status = EmergencyAlert.Status.ROUTED
                alert.status_version += 1
                alert.save(update_fields=["status", "status_version", "updated_at"])
                create_emergency_notification(
                    alert=alert,
                    recipient=backup,
                    type=Notification.Type.EMERGENCY_ESCALATED,
                    title=f"Escalated {alert.type} emergency",
                    body="You were assigned because the first responder did not acknowledge.",
                )
            escalation = EmergencyEscalation.objects.create(
                alert=alert,
                previous_assignment=assignment,
                escalated_to=backup,
                triggered_by=triggered_by,
                reason=reason,
            )
            create_status_event(alert, EmergencyAlert.Status.ROUTED, triggered_by, f"Escalated: {reason}")
            create_emergency_notification(
                alert=alert,
                recipient=alert.reporter,
                type=Notification.Type.EMERGENCY_ESCALATED,
                title="Emergency response escalated",
                body="Barangay has escalated your emergency to keep response moving.",
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
    officials = User.objects.filter(
        role=User.Role.BARANGAY_OFFICIAL,
        status=User.Status.VERIFIED,
        resident_profile__barangay=alert.barangay,
    )
    for official in officials:
        create_emergency_notification(
            alert=alert,
            recipient=official,
            type=Notification.Type.EMERGENCY_ESCALATED,
            title="Emergency needs manual dispatch",
            body=f"No fresh on-duty {alert.type} responder was available in {alert.barangay}.",
        )


def privacy_safe_user_name(user):
    profile = getattr(user, "resident_profile", None)
    if not profile:
        return "assigned responder"
    first_name = profile.first_name.strip()
    last_initial = profile.last_name.strip()[:1]
    return f"{first_name} {last_initial}.".strip() if last_initial else first_name


def auto_route_alert(alert, request):
    responder = find_auto_responder(alert)
    if not responder:
        EmergencyEscalation.objects.create(
            alert=alert,
            reason="No fresh same-barangay responder from the required unit was available.",
        )
        create_status_event(
            alert,
            alert.status,
            None,
            "Awaiting manual dispatch from the barangay emergency desk.",
        )
        notify_officials_no_responder(alert)
        return None
    EmergencyResponderAssignment.objects.update_or_create(
        alert=alert,
        responder=responder,
        defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
    )
    alert.status = EmergencyAlert.Status.ROUTED
    alert.routed_at = timezone.now()
    alert.status_version += 1
    alert.save(update_fields=["status", "routed_at", "status_version", "updated_at"])
    unit_label = responder_unit_label(responder.responder_unit)
    create_status_event(
        alert,
        EmergencyAlert.Status.ROUTED,
        None,
        f"Auto-routed to {unit_label} {privacy_safe_user_name(responder)}.",
    )
    notify_emergency_status(alert, type=EmergencyAlert.Status.ROUTED, body=f"A {unit_label} responder has been assigned to your emergency.")
    create_emergency_notification(
        alert=alert,
        recipient=responder,
        type=Notification.Type.EMERGENCY_ROUTED,
        title=f"{alert.type.title()} emergency assigned",
        body=f"Auto-routed to you as nearest on-duty {unit_label}.",
    )
    create_audit_log(
        "emergency.auto_routed",
        actor=None,
        target_user=alert.reporter,
        metadata={"alert_id": alert.pk, "responder_id": responder.pk, "responder_unit": responder.responder_unit},
        request_meta=request_meta(request),
    )
    return responder

def create_witness_notifications(alert):
    reporter_profile = getattr(alert.reporter, "resident_profile", None)
    if not reporter_profile or not reporter_profile.barangay:
        return
    User = get_user_model()
    fresh_after = timezone.now() - timedelta(minutes=5)
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
        WitnessNotification.objects.get_or_create(
            alert=alert,
            resident=witness,
            defaults={"distance_meters": round(distance)},
        )
        create_emergency_notification(
            alert=alert,
            recipient=witness,
            type=Notification.Type.WITNESS_ALERT,
            title="Emergency reported nearby",
            body=f"An emergency was reported in {alert.barangay}. Stay alert and avoid the area if needed.",
        )


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
        create_witness_notifications(alert)
        auto_route_alert(alert, request)
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


class MyAssignedEmergencyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_respond_to_emergencies(request.user):
            return Response({"detail": "You do not have permission to view assigned emergencies."}, status=status.HTTP_403_FORBIDDEN)
        alerts = (
            EmergencyAlert.objects
            .filter(assignments__responder=request.user, status__in=ACTIVE_STATUSES)
            .distinct()
            .order_by("-created_at")
        )
        return Response([serialize_alert(alert, request) for alert in alerts])


class EmergencyDutyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        if not can_respond_to_emergencies(request.user):
            return Response({"detail": "You do not have permission to update responder duty."}, status=status.HTTP_403_FORBIDDEN)

        raw_on_duty = request.data.get("is_on_duty", True)
        is_on_duty = raw_on_duty in {True, "true", "True", "1", 1, "on"}
        responder_unit = (request.data.get("responder_unit") or request.user.responder_unit or "").strip()
        User = get_user_model()
        valid_units = {choice[0] for choice in User.ResponderUnit.choices}
        if responder_unit and responder_unit not in valid_units:
            return Response({"responder_unit": ["Choose a valid responder unit."]}, status=status.HTTP_400_BAD_REQUEST)

        latitude = request.data.get("latitude")
        longitude = request.data.get("longitude")
        request.user.is_on_duty = is_on_duty
        update_fields = ["is_on_duty", "updated_at"]
        if responder_unit:
            request.user.responder_unit = responder_unit
            update_fields.append("responder_unit")
        if latitude is not None or longitude is not None:
            try:
                validate_location_pair(latitude, longitude, required=True)
            except ValidationError as exc:
                return Response({"location": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
            request.user.current_latitude = latitude
            request.user.current_longitude = longitude
            request.user.location_updated_at = timezone.now()
            update_fields.extend(["current_latitude", "current_longitude", "location_updated_at"])
        request.user.save(update_fields=update_fields)
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

class EmergencyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        if not can_view_alert(request.user, alert):
            return Response({"detail": "You do not have permission to view this emergency."}, status=status.HTTP_403_FORBIDDEN)
        return Response(serialize_alert(alert, request))


class EmergencyCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk, reporter=request.user)
        if alert.status not in {EmergencyAlert.Status.SUBMITTED, EmergencyAlert.Status.ROUTED}:
            return Response({"detail": "This emergency can no longer be cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        alert.status = EmergencyAlert.Status.CANCELLED
        alert.resolved_at = timezone.now()
        alert.save(update_fields=["status", "resolved_at", "updated_at"])
        alert.assignments.exclude(status__in=[EmergencyResponderAssignment.Status.RESOLVED, EmergencyResponderAssignment.Status.CANCELLED]).update(status=EmergencyResponderAssignment.Status.CANCELLED)
        create_status_event(alert, EmergencyAlert.Status.CANCELLED, request.user, "Resident cancelled the emergency alert.")
        notify_emergency_status(alert, type=EmergencyAlert.Status.CANCELLED, body="Your emergency alert was cancelled.")
        create_audit_log("emergency.cancelled", actor=request.user, target_user=request.user, metadata={"alert_id": alert.pk}, request_meta=request_meta(request))
        return Response(serialize_alert(alert, request))


class EmergencyAssignView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_emergencies(request.user):
            return Response({"detail": "You do not have permission to assign responders."}, status=status.HTTP_403_FORBIDDEN)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        serializer = EmergencyAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        User = get_user_model()
        responders = list(
            User.objects.filter(
                pk__in=serializer.validated_data["responder_ids"],
                role__in=[User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL],
                status=User.Status.VERIFIED,
            )
        )
        if len(responders) != len(serializer.validated_data["responder_ids"]):
            return Response({"responder_ids": ["One or more responders are invalid."]}, status=status.HTTP_400_BAD_REQUEST)
        for responder in responders:
            EmergencyResponderAssignment.objects.update_or_create(
                alert=alert,
                responder=responder,
                defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
            )
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        responder_labels = ", ".join(responder.email for responder in responders)
        create_status_event(alert, EmergencyAlert.Status.ROUTED, request.user, f"Assigned to {responder_labels}.")
        notify_emergency_status(alert, type=EmergencyAlert.Status.ROUTED, body="A responder has been assigned to your emergency.")
        for responder in responders:
            create_emergency_notification(
                alert=alert,
                recipient=responder,
                type=Notification.Type.EMERGENCY_ROUTED,
                title=f"{alert.type.title()} emergency assigned",
                body="Open your responder dashboard and acknowledge this assignment.",
            )
        create_audit_log("emergency.assigned", actor=request.user, target_user=alert.reporter, metadata={"alert_id": alert.pk, "responder_ids": [responder.pk for responder in responders]}, request_meta=request_meta(request))
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
            create_emergency_notification(alert=alert, recipient=official, type=Notification.Type.EMERGENCY_APPEAL_SUBMITTED, title="Emergency review requested", body=appeal.reason[:240])
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
        notif_type = Notification.Type.EMERGENCY_APPEAL_APPROVED if appeal.status == EmergencyAppeal.Status.APPROVED else Notification.Type.EMERGENCY_APPEAL_DENIED
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
        assignment = alert.assignments.filter(responder=request.user).exclude(
            status=EmergencyResponderAssignment.Status.ESCALATED,
        ).first()
        if not assignment and not can_manage_emergencies(request.user):
            return Response({"detail": "You are not assigned to this emergency."}, status=status.HTTP_403_FORBIDDEN)
        if not assignment:
            assignment = alert.assignments.exclude(
                status=EmergencyResponderAssignment.Status.ESCALATED,
            ).order_by("-assigned_at", "-id").first()
        if not assignment:
            return Response({"detail": "No responder has been assigned yet."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = EmergencyNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = serializer.validated_data.get("note", "").strip() or self.default_note

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
        else:
            alert.save(update_fields=["status", "status_version", "updated_at"])
        create_status_event(alert, self.target_status, request.user, note)
        notify_emergency_status(alert, type=self.target_status, body=note)
        return Response(serialize_alert(alert, request))


class EmergencyAcknowledgeView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.ACKNOWLEDGED
    assignment_status = EmergencyResponderAssignment.Status.ACKNOWLEDGED
    timestamp_field = "acknowledged_at"
    default_note = "Responder acknowledged the emergency."
    allowed_statuses = {EmergencyAlert.Status.ROUTED}


class EmergencyArrivedView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.ARRIVED
    assignment_status = EmergencyResponderAssignment.Status.ARRIVED
    timestamp_field = "arrived_at"
    default_note = "Responder arrived at the location."
    allowed_statuses = {
        EmergencyAlert.Status.ACKNOWLEDGED,
        EmergencyAlert.Status.EN_ROUTE,
        EmergencyAlert.Status.NEARBY,
    }


class EmergencyResolveView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.RESOLVED
    assignment_status = EmergencyResponderAssignment.Status.RESOLVED
    default_note = "Emergency resolved."
    allowed_statuses = {EmergencyAlert.Status.ARRIVED}


class EmergencyLocationPingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        assignment = alert.assignments.filter(responder=request.user).exclude(
            status=EmergencyResponderAssignment.Status.ESCALATED,
        ).first()
        if not assignment:
            return Response({"detail": "You are not assigned to this emergency."}, status=status.HTTP_403_FORBIDDEN)
        if alert.status not in ACTIVE_STATUSES:
            return Response({"detail": "Location tracking is closed for this emergency."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = EmergencyLocationPingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        EmergencyLocationPing.objects.create(
            assignment=assignment,
            responder=request.user,
            latitude=serializer.validated_data["latitude"],
            longitude=serializer.validated_data["longitude"],
            accuracy=serializer.validated_data.get("accuracy"),
        )
        if alert.status in {EmergencyAlert.Status.ACKNOWLEDGED, EmergencyAlert.Status.ROUTED}:
            alert.status = EmergencyAlert.Status.EN_ROUTE
            alert.status_version += 1
            alert.save(update_fields=["status", "status_version", "updated_at"])
            assignment.status = EmergencyResponderAssignment.Status.EN_ROUTE
            assignment.save(update_fields=["status"])
            create_status_event(alert, EmergencyAlert.Status.EN_ROUTE, request.user, "Responder is on the way.")
            notify_emergency_status(alert, type=EmergencyAlert.Status.EN_ROUTE, body="Responder is on the way.")
        else:
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
            else:
                broadcast_emergency_update(alert)
        return Response(serialize_alert(alert, request), status=status.HTTP_201_CREATED)
