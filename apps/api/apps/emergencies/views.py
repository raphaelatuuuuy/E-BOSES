from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import user_has_role_permission
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
    EmergencyLocationPing,
    EmergencyMedia,
    EmergencyResponderAssignment,
    EmergencyStatusEvent,
    WitnessNotification,
)
from .serializers import (
    EmergencyAlertSerializer,
    EmergencyAssignSerializer,
    EmergencyCreateSerializer,
    EmergencyLocationPingCreateSerializer,
    EmergencyNoteSerializer,
)


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
    lat_delta = float(alert.latitude) - float(responder.current_latitude)
    lng_delta = float(alert.longitude) - float(responder.current_longitude)
    return (lat_delta * lat_delta) + (lng_delta * lng_delta)

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
    responders = list(
        User.objects
        .filter(
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            is_on_duty=True,
            current_latitude__isnull=False,
            current_longitude__isnull=False,
        )
        .select_related("resident_profile")
    )
    if not responders:
        return None
    preferred_units = preferred_units_for(alert.type)
    preferred = [responder for responder in responders if responder.responder_unit in preferred_units]
    candidates = preferred or responders
    return min(candidates, key=lambda responder: location_distance_score(alert, responder) or float("inf"))

def auto_route_alert(alert, request):
    responder = find_auto_responder(alert)
    if not responder:
        return None
    EmergencyResponderAssignment.objects.update_or_create(
        alert=alert,
        responder=responder,
        defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
    )
    alert.status = EmergencyAlert.Status.ROUTED
    alert.save(update_fields=["status", "updated_at"])
    unit_label = responder_unit_label(responder.responder_unit)
    create_status_event(alert, EmergencyAlert.Status.ROUTED, None, f"Auto-routed to {unit_label} {responder.email}.")
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
    witnesses = (
        User.objects
        .filter(status=User.Status.VERIFIED, role=User.Role.RESIDENT, resident_profile__barangay=reporter_profile.barangay)
        .exclude(pk=alert.reporter_id)
    )
    for witness in witnesses:
        WitnessNotification.objects.get_or_create(
            alert=alert,
            resident=witness,
            defaults={"distance_meters": 0},
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
            "assignments__responder",
            "assignments__responder__resident_profile",
            "assignments__location_pings",
        )
        .get(pk=alert.pk)
    )
    return EmergencyAlertSerializer(alert, context={"request": request}).data


class EmergencyCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @transaction.atomic
    def post(self, request):
        touch_last_seen(request.user)
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

        serializer = EmergencyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        media_files = []
        media_hashes = set()
        for uploaded_file in request.FILES.getlist("media"):
            try:
                validated_file = validate_emergency_media_file(uploaded_file)
            except ValidationError as exc:
                return Response({"media": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
            media_hash = sha256_file(validated_file)
            raw_content = validated_file.read(); validated_file.seek(0)
            media_phash = phash_file(raw_content)
            if media_hash in media_hashes or EmergencyMedia.objects.filter(sha256_hash=media_hash).exists():
                return Response({"media": [f"{uploaded_file.name}: duplicate media upload detected."]}, status=status.HTTP_400_BAD_REQUEST)
            media_hashes.add(media_hash)
            media_files.append((uploaded_file, validated_file, media_hash, media_phash))

        profile = getattr(request.user, "resident_profile", None)
        alert = EmergencyAlert.objects.create(
            reporter=request.user,
            type=serializer.validated_data["type"],
            note=serializer.validated_data.get("note", ""),
            latitude=serializer.validated_data["latitude"],
            longitude=serializer.validated_data["longitude"],
            address=serializer.validated_data.get("address", ""),
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
        responder = get_object_or_404(
            User,
            pk=serializer.validated_data["responder_id"],
            role__in=[User.Role.FIRST_RESPONDER, User.Role.BARANGAY_OFFICIAL],
            status=User.Status.VERIFIED,
        )
        EmergencyResponderAssignment.objects.update_or_create(
            alert=alert,
            responder=responder,
            defaults={"status": EmergencyResponderAssignment.Status.ASSIGNED},
        )
        alert.status = EmergencyAlert.Status.ROUTED
        alert.save(update_fields=["status", "updated_at"])
        create_status_event(alert, EmergencyAlert.Status.ROUTED, request.user, f"Assigned to {responder.email}.")
        notify_emergency_status(alert, type=EmergencyAlert.Status.ROUTED, body="A responder has been assigned to your emergency.")
        create_emergency_notification(
            alert=alert,
            recipient=responder,
            type=Notification.Type.EMERGENCY_ROUTED,
            title=f"{alert.type.title()} emergency assigned",
            body="Open your responder dashboard and acknowledge this assignment.",
        )
        create_audit_log("emergency.assigned", actor=request.user, target_user=alert.reporter, metadata={"alert_id": alert.pk, "responder_id": responder.pk}, request_meta=request_meta(request))
        return Response(serialize_alert(alert, request))


class AssignmentActionMixin:
    target_status = None
    assignment_status = None
    timestamp_field = None
    default_note = ""

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        assignment = alert.assignments.filter(responder=request.user).first()
        if not assignment and not can_manage_emergencies(request.user):
            return Response({"detail": "You are not assigned to this emergency."}, status=status.HTTP_403_FORBIDDEN)
        if not assignment:
            assignment = alert.assignments.order_by("-assigned_at", "-id").first()
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
        if self.target_status == EmergencyAlert.Status.RESOLVED:
            alert.resolved_at = timezone.now()
            alert.save(update_fields=["status", "resolved_at", "updated_at"])
        else:
            alert.save(update_fields=["status", "updated_at"])
        create_status_event(alert, self.target_status, request.user, note)
        notify_emergency_status(alert, type=self.target_status, body=note)
        return Response(serialize_alert(alert, request))


class EmergencyAcknowledgeView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.ACKNOWLEDGED
    assignment_status = EmergencyResponderAssignment.Status.ACKNOWLEDGED
    timestamp_field = "acknowledged_at"
    default_note = "Responder acknowledged the emergency."


class EmergencyArrivedView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.ARRIVED
    assignment_status = EmergencyResponderAssignment.Status.ARRIVED
    timestamp_field = "arrived_at"
    default_note = "Responder arrived at the location."


class EmergencyResolveView(AssignmentActionMixin, APIView):
    permission_classes = [IsAuthenticated]
    target_status = EmergencyAlert.Status.RESOLVED
    assignment_status = EmergencyResponderAssignment.Status.RESOLVED
    default_note = "Emergency resolved."


class EmergencyLocationPingView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        touch_last_seen(request.user)
        alert = get_object_or_404(EmergencyAlert, pk=pk)
        assignment = alert.assignments.filter(responder=request.user).first()
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
            alert.save(update_fields=["status", "updated_at"])
            assignment.status = EmergencyResponderAssignment.Status.EN_ROUTE
            assignment.save(update_fields=["status"])
            create_status_event(alert, EmergencyAlert.Status.EN_ROUTE, request.user, "Responder is on the way.")
            notify_emergency_status(alert, type=EmergencyAlert.Status.EN_ROUTE, body="Responder is on the way.")
        else:
            broadcast_emergency_update(alert)
        return Response(serialize_alert(alert, request), status=status.HTTP_201_CREATED)
