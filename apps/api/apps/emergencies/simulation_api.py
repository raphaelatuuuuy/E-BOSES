import math
import random

from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasRolePermission
from apps.capabilities import CONFIGURE_CLASSIFICATION, HasCapability


def _coerce_confirmed_ongoing(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"true", "1", "yes"}:
        return True
    if text in {"false", "0", "no"}:
        return False
    return None


def _emergency_type_label(matched_emergency_type: str) -> str:
    from apps.emergencies.models import EmergencyCategory

    if not matched_emergency_type:
        return ""
    category = EmergencyCategory.objects.filter(code=matched_emergency_type, is_active=True).first()
    if category:
        return category.label
    return matched_emergency_type.replace("_", " ").title()


def _responder_full_name(responder) -> str:
    profile = getattr(responder, "resident_profile", None)
    if profile:
        return f"{profile.first_name} {profile.last_name}".strip()
    return responder.email.split("@")[0]


def _sample_route_preview(dest_lat, dest_lng):
    """A real road route from a random nearby point, for when no responder was
    matched. The map otherwise has nothing to draw but a lone pin; this gives
    an official previewing the tool an actual OSRM route to look at rather
    than a straight line, while staying clearly labelled as a sample.
    """
    from apps.live_map import _osrm_route

    meters = 200 + random.random() * 400
    bearing = random.random() * 2 * math.pi
    metres_per_degree_lat = 111_320
    metres_per_degree_lng = 111_320 * math.cos(math.radians(dest_lat))
    origin_lat = dest_lat + (math.cos(bearing) * meters) / metres_per_degree_lat
    origin_lng = dest_lng + (math.sin(bearing) * meters) / metres_per_degree_lng

    route = _osrm_route(
        origin_lat=origin_lat,
        origin_lng=origin_lng,
        dest_lat=dest_lat,
        dest_lng=dest_lng,
        cache_key="emergency-sim-sample-route:%s:%s:%s:%s" % (
            round(origin_lat, 5), round(origin_lng, 5), round(dest_lat, 5), round(dest_lng, 5),
        ),
    )
    if route.get("status") != "ok":
        return None
    return {"latitude": origin_lat, "longitude": origin_lng, "route": route}


class EmergencySimulationView(APIView):
    """Text+pin simulation of the emergency dispatch path, for the admin test
    workspace. Mirrors OfficialClassificationSubmissionTestView's gate exactly.

    Nothing here is persisted: the Gemma call is the same one the real intake
    flow uses, but the routed alert is an in-memory, never-saved
    `EmergencyAlert`, and no `EmergencyResponderAssignment` is ever created.
    """

    permission_classes = [IsAuthenticated, HasRolePermission, HasCapability]
    required_permission = "concerns.manage"
    required_capability = CONFIGURE_CLASSIFICATION
    parser_classes = [MultiPartParser]

    def post(self, request):
        from apps.concerns.ai.classification import classification_payload
        from apps.concerns.classification_api import (
            _first_uploaded,
            _prepared_image_from_upload,
            _privacy_dry_run,
            _review_details,
        )
        from apps.concerns.models import ConcernClassificationConfiguration, LlmDecisionLog
        from apps.emergencies.models import EmergencyAlert
        from apps.emergencies.location_resolution import resolve_incident_location
        from apps.emergencies.routing_preview import preview_dispatch
        from apps.emergencies.views import preferred_departments_for

        title = str(request.data.get("title", ""))[:160]
        description = str(request.data.get("description", ""))[:5000]
        try:
            latitude = float(request.data.get("latitude"))
            longitude = float(request.data.get("longitude"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "latitude and longitude are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if (
            not math.isfinite(latitude)
            or not math.isfinite(longitude)
            or not (-90 <= latitude <= 90)
            or not (-180 <= longitude <= 180)
        ):
            return Response(
                {"detail": "latitude and longitude must be real coordinates."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        confirmed_ongoing = _coerce_confirmed_ongoing(request.data.get("confirmed_ongoing"))
        location_resolution = resolve_incident_location(
            latitude=latitude,
            longitude=longitude,
            message_area="",
            user=request.user,
        )

        config = ConcernClassificationConfiguration.current()
        uploaded = _first_uploaded(request)
        image, image_error = _prepared_image_from_upload(uploaded)
        result = classification_payload(
            title=title,
            description=description,
            selected_category="",
            configuration=config,
            image=image,
            image_uploaded=bool(uploaded),
        )
        details = result.get("details") or {}
        matched_emergency_type = details.get("matched_emergency_type") or ""
        emergency_routing_reason = details.get("emergency_routing_reason") or ""
        urgent_attention = bool(details.get("urgent_attention"))
        requires_confirmation = bool(details.get("ongoing_emergency_confirmation_required")) or bool(
            matched_emergency_type and urgent_attention and (details.get("incident_timing") or "unclear") == "unclear"
        )
        privacy = _privacy_dry_run(uploaded, details)

        routing_reason_for_log = ""
        assigned_department_for_log = None

        likely_unit = None
        if matched_emergency_type and location_resolution.community:
            preferred = preferred_departments_for(matched_emergency_type, location_resolution.community)
            if preferred:
                likely_unit = {"id": preferred[0].pk, "name": preferred[0].name, "short_name": preferred[0].short_name}

        if confirmed_ongoing is None and requires_confirmation:
            response_payload = {
                "requires_confirmation": True,
                "matched_emergency_type": matched_emergency_type,
                "emergency_routing_reason": emergency_routing_reason,
                "likely_unit": likely_unit,
                "image_uploaded": bool(uploaded),
                "image_error": image_error,
                "privacy": privacy,
                "review": _review_details(
                    result,
                    selected_category="",
                    image_uploaded=bool(uploaded),
                    title=title,
                    description=description,
                ),
                "location": location_resolution.payload(),
            }
        elif confirmed_ongoing is False or not (matched_emergency_type and urgent_attention):
            response_payload = {
                "requires_confirmation": False,
                "path": "concern",
                "image_uploaded": bool(uploaded),
                "image_error": image_error,
                "privacy": privacy,
                "review": _review_details(
                    result,
                    selected_category="",
                    image_uploaded=bool(uploaded),
                    title=title,
                    description=description,
                ),
                "location": location_resolution.payload(),
            }
        else:
            alert = EmergencyAlert(
                reporter=request.user,
                type=matched_emergency_type,
                latitude=latitude,
                longitude=longitude,
                community=location_resolution.community,
                barangay=location_resolution.community.name if location_resolution.community else "Community pending confirmation",
                location_source=location_resolution.source,
            )
            dispatch = preview_dispatch(alert)
            department = dispatch["department"]
            routing_reason = dispatch["message"]
            responder_preview = (
                {
                    "found": True,
                    "responder": dispatch["responder"],
                    **dispatch["route"],
                }
                if dispatch["responder"]
                else {"found": False, "reason": "no_on_duty_responder_for_unit"}
            )
            sample_route = None if dispatch["responder"] else _sample_route_preview(latitude, longitude)

            response_payload = {
                "requires_confirmation": False,
                "path": "emergency",
                "matched_emergency_type": matched_emergency_type,
                "image_uploaded": bool(uploaded),
                "image_error": image_error,
                "privacy": privacy,
                "location": location_resolution.payload(),
                "routing": {
                    "department": department,
                    "routing_reason": routing_reason,
                    "responder_preview": responder_preview,
                    "scope": dispatch["scope"],
                    "manual_dispatch": dispatch["manual_dispatch"],
                    "responding_community": dispatch["responding_community"],
                    "route": dispatch["route"],
                    "sample_route": sample_route,
                },
            }
            routing_reason_for_log = routing_reason
            if department:
                from apps.concerns.models import Department

                assigned_department_for_log = Department.objects.filter(pk=department["id"]).first()

        LlmDecisionLog.objects.create(
            run_kind=LlmDecisionLog.RunKind.SIMULATION,
            domain=LlmDecisionLog.Domain.EMERGENCY,
            performed_by=request.user,
            model_version=result.get("model_version") or "",
            input_snapshot={
                "title": title,
                "description": description,
                "latitude": latitude,
                "longitude": longitude,
                "confirmed_ongoing": confirmed_ongoing,
                "image_uploaded": bool(uploaded),
            },
            output_snapshot=response_payload,
            resident_message="",
            recommended_action=details.get("recommended_action") or "",
            assigned_department=assigned_department_for_log,
            routing_reason=routing_reason_for_log,
        )
        return Response(response_payload)
