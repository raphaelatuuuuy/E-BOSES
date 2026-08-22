import math

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
        from apps.emergencies.views import find_auto_responders_by_unit, preferred_departments_for
        from apps.live_map import route_preview_for_responder

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
        privacy = _privacy_dry_run(uploaded, details)

        routing_reason_for_log = ""
        assigned_department_for_log = None

        likely_unit = None
        if matched_emergency_type:
            preferred = preferred_departments_for(matched_emergency_type)
            if preferred:
                likely_unit = {"id": preferred[0].pk, "name": preferred[0].name, "short_name": preferred[0].short_name}

        if confirmed_ongoing is None:
            response_payload = {
                "requires_confirmation": bool(matched_emergency_type and urgent_attention),
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
            }
        elif confirmed_ongoing is False:
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
            }
        else:
            profile = getattr(request.user, "resident_profile", None)
            barangay = getattr(profile, "barangay", "") or "Marikina Heights"
            alert = EmergencyAlert(
                reporter=request.user,
                type=matched_emergency_type,
                latitude=latitude,
                longitude=longitude,
                barangay=barangay,
            )

            preferred = preferred_departments_for(alert.type)
            department = preferred[0] if preferred else None
            candidates = find_auto_responders_by_unit(alert)
            responder = candidates[0] if candidates else None

            type_label = _emergency_type_label(matched_emergency_type)
            if department:
                routing_reason = f"Routed to {department.name} because the {type_label} emergency type prioritizes it."
            else:
                label_phrase = f"the {type_label} emergency type" if matched_emergency_type else "this emergency type"
                routing_reason = f"No department is configured to handle {label_phrase}."

            if responder:
                preview = route_preview_for_responder(responder, latitude=latitude, longitude=longitude)
                responder_preview = {
                    "found": True,
                    "responder": {
                        "id": responder.pk,
                        "full_name": _responder_full_name(responder),
                        "latitude": float(responder.current_latitude) if responder.current_latitude is not None else None,
                        "longitude": float(responder.current_longitude) if responder.current_longitude is not None else None,
                    },
                    "distance_meters": preview.get("distance_meters"),
                    "eta_seconds": preview.get("eta_seconds"),
                    "geometry": preview.get("geometry"),
                }
            else:
                responder_preview = {"found": False, "reason": "no_on_duty_responder_for_unit"}

            response_payload = {
                "requires_confirmation": False,
                "path": "emergency",
                "matched_emergency_type": matched_emergency_type,
                "image_uploaded": bool(uploaded),
                "image_error": image_error,
                "privacy": privacy,
                "routing": {
                    "department": (
                        {"id": department.pk, "name": department.name, "short_name": department.short_name}
                        if department
                        else None
                    ),
                    "routing_reason": routing_reason,
                    "responder_preview": responder_preview,
                },
            }
            routing_reason_for_log = routing_reason
            assigned_department_for_log = department

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
