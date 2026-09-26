from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache, caches
from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Q
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.core.signing import BadSignature, SignatureExpired
from rest_framework import status
from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers as drf_serializers
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from apps.throttling import LocalScopedRateThrottle
from rest_framework.views import APIView
from apps.throttling import LoginIPThrottle, LoginIdentifierThrottle, RefreshSessionThrottle
from django.utils.decorators import method_decorator
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.capabilities import MANAGE_USERS, capability_denied, user_has_capability
from apps.concerns.units import sync_responder_designation
from apps.emergencies.selectors import active_responder_shift_for_update
from apps.system_state import maintenance_blocks

from .models import AccountRequest, AuditLog, DataSubjectRequest, OTPChallenge, ResidenceProof, ResidentSettings
from .community_resolution import (
    CommunityResolutionError,
    create_resolution,
    resolve_token,
    resolve_token_for_signup,
    verified_resident_count,
)
from .permissions import user_has_role_permission
from .privacy_services import (
    PrivacyRequestConflict,
    anonymize_resident_account,
    build_account_data_export,
    deletion_blockers,
)
from .selectors import find_user_by_identifier, latest_active_otp_challenge
from .serializers import (
    AccountEmailChangeRequestSerializer,
    AccountEmailChangeVerifySerializer,
    AccountNameChangeConfirmSerializer,
    AccountPhoneChangeRequestSerializer,
    AccountPhoneChangeVerifySerializer,
    AccountRequestSerializer,
    AccountRequestReviewSerializer,
    AdminCreateUserSerializer,
    ChangePasswordSerializer,
    CommunityResolveSerializer,
    LoginRejected,
    LoginSerializer,
    LoginSerializer,
    OTPResendSerializer,
    OTPVerifySerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PasswordResetVerifySerializer,
    EmailAvailabilitySerializer,
    EmailOTPRequestSerializer,
    EmailOTPVerifySerializer,
    PhoneOTPRequestSerializer,
    PhoneOTPVerifySerializer,
    RegisterSerializer,
    ResidentSettingsSerializer,
    ResponderUpdateSerializer,
    SensitiveAccessAuditSerializer,
    StaffAccountUpdateSerializer,
    UserStatusUpdateSerializer,
    UserProfileUpdateSerializer,
    UserSummarySerializer,
)
from .media_services import (
    log_raw_media_access,
    user_can_access_residence_proof_raw,
)
from .services import (
    DuplicateProofError,
    OTPVerificationError,
    create_audit_log,
    create_otp_challenge,
    create_email_otp_challenge,
    create_phone_otp_challenge,
    create_password_reset_token,
    read_password_reset_token,
    register_resident,
    validate_residence_proof_uploads,
    verify_email_otp_challenge,
    verify_phone_otp_challenge,
    verify_otp_challenge,
)


def request_meta(request):
    # Tolerates None so background paths that have no HTTP request — SMS
    # ingestion, Celery escalation — can share the same audit helpers.
    meta = getattr(request, "META", None) or {}
    return {
        "ip_address": meta.get("REMOTE_ADDR"),
        "user_agent": meta.get("HTTP_USER_AGENT", ""),
    }


LAST_SEEN_WRITE_INTERVAL_SECONDS = 60


def touch_last_seen(user):
    """Record authenticated activity without a DB write on every request."""
    if not (user and user.is_authenticated):
        return
    # cache.add is atomic: only the first caller in the window wins.
    if not caches["default"].add(f"last-seen:{user.pk}", True, LAST_SEEN_WRITE_INTERVAL_SECONDS):
        return
    user.last_seen_at = timezone.now()
    user.save(update_fields=["last_seen_at", "updated_at"])


def can_manage_accounts(user):
    return bool(
        user
        and user.is_authenticated
        and (
            user.is_superuser
            or (
                user_has_role_permission(user, "accounts.verify_residents")
                and user_has_capability(user, MANAGE_USERS)
            )
        )
    )


REFRESH_COOKIE_NAME = "eboses_refresh_token"


def set_refresh_cookie(response, refresh_token):
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        str(refresh_token),
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.REFRESH_COOKIE_SECURE,
        samesite=settings.SESSION_COOKIE_SAMESITE or "Lax",
        path="/api/auth/",
    )


def delete_refresh_cookie(response):
    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        path="/api/auth/",
        samesite=settings.SESSION_COOKIE_SAMESITE or "Lax",
    )


def token_response(user, response_status=status.HTTP_200_OK):
    refresh = RefreshToken.for_user(user)
    response = Response(
        {
            "access": str(refresh.access_token),
            "user": UserSummarySerializer(user).data,
        },
        status=response_status,
    )
    set_refresh_cookie(response, refresh)
    return response


class RegisterView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = "auth"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated_data = dict(serializer.validated_data)
        validated_data["proof_files"] = request.FILES.getlist("proof") or [validated_data["proof"]]
        validated_data["proof_sides"] = request.data.getlist("proof_side")
        try:
            user = register_resident(validated_data, request_meta(request))
        except CommunityResolutionError as exc:
            return Response({"code": exc.code, "detail": exc.detail}, status=exc.status_code)
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except (DuplicateProofError, ValidationError) as exc:
            if hasattr(exc, "error_dict"):
                return Response(exc.error_dict, status=status.HTTP_400_BAD_REQUEST)
            message = exc.message if hasattr(exc, "message") else str(exc)
            return Response({"proof": [message]}, status=status.HTTP_400_BAD_REQUEST)
        return token_response(user, status.HTTP_201_CREATED)


class EmailAvailabilityView(APIView):
    """Public check used on sign-up account step before continuing."""

    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        serializer = EmailAvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        exists = get_user_model().objects.filter(email__iexact=email).exists()
        if exists:
            return Response(
                {
                    "available": False,
                    "email": email,
                    "message": "An account with this email already exists.",
                },
                status=status.HTTP_200_OK,
            )
        return Response(
            {"available": True, "email": email, "message": ""},
            status=status.HTTP_200_OK,
        )


class CommunityPreviewView(APIView):
    """Community data for a previously resolved sign-up location."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "auth"

    def post(self, request):
        token = request.data.get("token") or ""
        email = request.data.get("email") or ""
        try:
            resolution = resolve_token(token, email=email)
        except CommunityResolutionError as exc:
            return Response({"code": exc.code, "detail": exc.detail}, status=exc.status_code)
        response = Response(
            {
                "community": {
                    "id": str(resolution.community.public_id),
                    "name": resolution.community.name,
                },
                "neighbors": verified_resident_count(resolution.community),
            }
        )
        response["Cache-Control"] = "no-store"
        return response


class RegistrationCommunitiesView(APIView):
    """Served community outlines, so the sign-up map can show where we cover."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LocalScopedRateThrottle]
    throttle_scope = "geocode"

    def get(self, request):
        from .selectors import served_community_areas

        return Response({"results": served_community_areas()})


class RegistrationStreetSearchView(APIView):
    """Street suggestions during sign-up, from each community's own catalog."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LocalScopedRateThrottle]
    throttle_scope = "geocode"

    def get(self, request):
        from apps.live_map import registration_street_matches

        query = (request.query_params.get("q") or "").strip()
        try:
            limit = max(1, min(20, int(request.query_params.get("limit", 8))))
        except (TypeError, ValueError):
            limit = 8
        return Response({"results": registration_street_matches(query[:120], limit=limit)})


class RegistrationPinAddressView(APIView):
    """Address for a pin the resident dropped on the sign-up map."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LocalScopedRateThrottle]
    throttle_scope = "registration_geocode"

    def get(self, request):
        from apps.live_map import address_for_pin

        try:
            latitude = float(request.query_params.get("lat"))
            longitude = float(request.query_params.get("lng"))
        except (TypeError, ValueError):
            return Response({"detail": "lat and lng are required."}, status=400)
        if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
            return Response({"detail": "That point is not on the earth."}, status=400)
        # Rounded to ~11m: dragging the pin a metre no longer mints a fresh
        # cache key per position (each miss could reach Nominatim, which now
        # throttles this deployment with 429s). Street names change slowly.
        cache_key = f"registration-pin-address:v3:{latitude:.4f}:{longitude:.4f}"
        payload = cache.get(cache_key)
        if payload is None:
            payload = address_for_pin(latitude, longitude)
            cache.set(cache_key, payload, 3600)
        return Response(payload)


class CommunityResolveView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "auth"

    def post(self, request):
        serializer = CommunityResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            resolution, token = create_resolution(**serializer.validated_data)
        except CommunityResolutionError as exc:
            return Response({"code": exc.code, "detail": exc.detail}, status=exc.status_code)

        from .ocr_api import _document_payload

        documents = [
            _document_payload(item)
            for item in (
                resolution.configuration.document_types.filter(enabled=True).order_by("display_order", "id")
                if resolution.configuration_id
                else []
            )
        ]
        community = resolution.community
        response = Response(
            {
                "token": token,
                "community": {
                    "id": str(community.public_id),
                    "code": community.code,
                    "name": community.name,
                    "center": {
                        "latitude": float(community.center_latitude),
                        "longitude": float(community.center_longitude),
                    },
                    "boundary": community.boundary.geometry if community.boundary_id else None,
                    "boundary_revision": community.boundary_revision,
                },
                "weather_coordinates": {
                    "latitude": float(community.center_latitude),
                    "longitude": float(community.center_longitude),
                },
                "neighbors": verified_resident_count(community),
                "ocr_version": resolution.configuration.version if resolution.configuration_id else None,
                "proof_options": documents,
            }
        )
        response["Cache-Control"] = "no-store"
        return response


class PhoneOTPRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "otp"

    def post(self, request):
        from .services import (
            OTP_EXPIRY_MINUTES,
            OTP_RESEND_COOLDOWN_SECONDS,
            OTPDeliveryError,
            OTPRateLimited,
        )

        serializer = PhoneOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        first_name = (request.data.get("first_name") or request.data.get("firstName") or "").strip() if isinstance(request.data, dict) else ""
        try:
            create_phone_otp_challenge(phone_number, recipient_name=first_name)
        except OTPRateLimited as exc:
            return Response(
                {"detail": str(exc), "retry_after": exc.retry_after},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except OTPDeliveryError as exc:
            # Never fall through to "verified" when the gateway is down.
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception:
            logger = __import__("logging").getLogger(__name__)
            logger.exception("Phone OTP request failed")
            return Response(
                {"detail": "We could not send the SMS code. Please try again in a moment."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        # The code itself is never returned. In local development it is printed
        # to the API console by the console SMS driver.
        return Response(
            {
                "detail": "Code sent.",
                "expires_in": OTP_EXPIRY_MINUTES * 60,
                "retry_after": OTP_RESEND_COOLDOWN_SECONDS,
            },
            status=status.HTTP_200_OK,
        )


class PhoneOTPVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "otp"

    def post(self, request):
        serializer = PhoneOTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            verify_phone_otp_challenge(
                serializer.validated_data["phone_number"],
                serializer.validated_data["code"],
            )
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class EmailOTPRequestView(APIView):
    """Send email OTP right after the sign-up email/password step (no account yet)."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "otp"

    def post(self, request):
        from django.conf import settings as django_settings

        from .services import OTPDeliveryError

        serializer = EmailOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        # Accept optional first_name for personalized greeting (e.g. from sign-up form)
        first_name = (request.data.get("first_name") or request.data.get("firstName") or "").strip() if isinstance(request.data, dict) else ""
        try:
            _challenge, code = create_email_otp_challenge(email, recipient_name=first_name)
        except OTPDeliveryError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception:
            logger = __import__("logging").getLogger(__name__)
            logger.exception("Email OTP request failed for %s", email)
            return Response(
                {"detail": "We could not send the email code. Please try again in a moment."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if getattr(django_settings, "IS_LOCAL_DEVELOPMENT", False) or django_settings.DEBUG:
            return Response(
                {"detail": "Code sent. Check the API console in development."},
                status=status.HTTP_200_OK,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class EmailOTPVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "otp"

    def post(self, request):
        serializer = EmailOTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            verify_email_otp_challenge(
                serializer.validated_data["email"],
                serializer.validated_data["code"],
            )
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResidenceProofCheckView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    # Forensics on anonymous uploads is expensive CPU; this endpoint gets its
    # own budget so login/OTP bursts cannot share (or exhaust) it.
    throttle_scope = "proof_preflight"

    def post(self, request):
        try:
            resolution = resolve_token_for_signup(
                request.data.get("community_resolution_token") or "",
                email=request.data.get("email") or "",
                address=request.data.get("address") or "",
            )
        except CommunityResolutionError as exc:
            return Response({"code": exc.code, "detail": exc.detail}, status=exc.status_code)
        proof_files = request.FILES.getlist("proof")
        if not proof_files:
            return Response(
                {"proof": ["Upload at least one valid government-issued ID or bill."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(proof_files) > 2:
            return Response(
                {"proof": ["You can upload a maximum of 2 files."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            # Per-file media_forensics (Layers 1–5) on ORIGINAL bytes + duplicates.
            # Multi-side completeness is NOT enforced here so front can be checked
            # before back is uploaded; final registration enforces full set.
            from .services import validate_residence_proof_uploads_preflight

            validate_residence_proof_uploads_preflight(proof_files)

            proof_type = (request.data.get("proof_type") or "").strip()
            if not proof_type:
                return Response(
                    {"proof": ["Select a residence document type before uploading."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            from .ocr_runtime import document_type_for_registration

            # Validate type exists / enabled only — not side completeness. The
            # resolver returns (configuration, document_type); keep only the
            # document type here so the picture gate can load its real sample.
            _, document_type = document_type_for_registration(
                proof_type, configuration=resolution.configuration
            )
        except (DuplicateProofError, ValidationError) as exc:
            if hasattr(exc, "message_dict"):
                return Response(exc.message_dict, status=status.HTTP_400_BAD_REQUEST)
            message = exc.message if hasattr(exc, "message") else str(exc)
            return Response({"proof": [message]}, status=status.HTTP_400_BAD_REQUEST)

        # Layer 2 on this one photo, here rather than only at Verify. Media
        # forensics reads bytes, so a genuine camera photo of the wrong thing —
        # a selfie, a receipt, an ID on someone else's screen — passes it and
        # lands in the slot looking accepted. The picture check is the layer
        # that can say "that is not this document", so it has to run before the
        # side is kept.
        if document_type is not None:
            from .id_integrity import RESUBMIT_MESSAGE, integrity_feedback
            from .id_pipeline import gate_payload, run_pre_ocr_gate

            submitted_sides = request.data.getlist("proof_side")
            if not submitted_sides and len(proof_files) == 2:
                submitted_sides = ["front", "back"]
            proof_sides = []
            proof_contents = []
            for index, proof in enumerate(proof_files):
                raw_side = str(
                    submitted_sides[index] if index < len(submitted_sides) else ""
                ).strip().lower()
                proof_sides.append(raw_side if raw_side in {"front", "back", "single"} else None)
                proof.seek(0)
                proof_contents.append(proof.read())
                proof.seek(0)

            gate = run_pre_ocr_gate(
                contents=proof_contents,
                document_type=document_type,
                configuration=resolution.configuration,
                run_forensics=False,
                sides=proof_sides,
            )
            integrity = gate.get("integrity")
            if integrity and integrity.get("flagged"):
                detail = integrity_feedback(integrity)
                return Response(
                    {
                        "proof": [detail or RESUBMIT_MESSAGE],
                        "code": "id_integrity_flagged",
                        "integrity_detail": detail,
                        "integrity": integrity,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not gate.get("integrity_checks"):
                return Response(
                    {
                        "proof": [
                            "The document picture check is temporarily unavailable. Please try again later."
                        ],
                        "code": "id_integrity_unavailable",
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            checked_side = next((side for side in proof_sides if side), None)
            return Response(
                {
                    "checked": True,
                    "side": checked_side,
                    "media_authenticity": {"checked": True, "passed": True},
                    "id_integrity": integrity,
                    "pipeline": gate_payload(gate),
                },
                status=status.HTTP_200_OK,
            )
        return Response(
            {
                "checked": True,
                "media_authenticity": {"checked": True, "passed": True},
            },
            status=status.HTTP_200_OK,
        )


class ResidenceProofDetectView(APIView):
    """Auto-detect document type from an uploaded/captured proof at sign-up."""

    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = "proof_preflight"

    def post(self, request):
        try:
            resolution = resolve_token_for_signup(
                request.data.get("community_resolution_token") or "",
                email=request.data.get("email") or "",
                address=request.data.get("address") or "",
            )
        except CommunityResolutionError as exc:
            return Response({"code": exc.code, "detail": exc.detail}, status=exc.status_code)
        proof_files = request.FILES.getlist("proof")
        if not proof_files:
            proof = request.FILES.get("file") or request.FILES.get("proof")
            proof_files = [proof] if proof else []
        if not proof_files:
            return Response(
                {
                    "detected": False,
                    "message": "Upload or capture a document photo.",
                    "reasons": ["No file provided."],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(proof_files) > 2:
            return Response(
                {
                    "detected": False,
                    "message": "You can upload a maximum of 2 files.",
                    "reasons": ["Too many files."],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Stage 1 of the pipeline, and it has to happen here. EXIF tags, C2PA
        # manifests, and the compression history ELA reads all live in the bytes
        # the resident sent; the validation below normalizes every upload to
        # JPEG, which destroys all three. Run it first, then hand the verdict
        # down so detect does not re-derive it from a re-encode.
        from .media_forensics import forensics_findings
        from .id_pipeline import FORENSICS_RESUBMIT_MESSAGE, STAGE_FORENSICS

        forensics = {"checked": False, "flagged": False, "layer": "", "message": ""}
        for proof_file in proof_files:
            try:
                proof_file.seek(0)
                raw = proof_file.read()
                proof_file.seek(0)
            except Exception:
                continue
            if not raw:
                continue
            result = forensics_findings(raw)
            if not forensics.get("checked") or result.get("flagged"):
                forensics = result
            if result.get("flagged"):
                break
        if forensics.get("flagged"):
            return Response(
                {
                    "detected": False,
                    "message": FORENSICS_RESUBMIT_MESSAGE,
                    "reasons": [FORENSICS_RESUBMIT_MESSAGE],
                    "id_integrity": None,
                    "pipeline": {
                        "reached": STAGE_FORENSICS,
                        "blocked_by": STAGE_FORENSICS,
                        "forensics": forensics,
                        "message": FORENSICS_RESUBMIT_MESSAGE,
                        "detail": forensics.get("message") or "",
                    },
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        try:
            from .services import validate_residence_proof_uploads_for_detect

            proof_files = validate_residence_proof_uploads_for_detect(proof_files)
        except (DuplicateProofError, ValidationError) as exc:
            if hasattr(exc, "message_dict"):
                detail = exc.message_dict
                message = next(iter(detail.values())) if detail else str(exc)
                if isinstance(message, list):
                    message = message[0] if message else "Invalid proof file."
                return Response(
                    {"detected": False, "message": str(message), "reasons": [str(message)], "detail": detail},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            message = getattr(exc, "message", None) or str(exc)
            return Response(
                {"detected": False, "message": message, "reasons": [message]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .ocr_runtime import detect_residence_proof

        raw_side = str(request.data.get("proof_side") or request.data.get("side") or "").strip().lower()
        detect_side = raw_side if raw_side in {"front", "back", "single"} else None
        # Multi-file detect: treat as ordered front then back when sides not provided.
        if detect_side is None and len(proof_files) == 1:
            detect_side = None

        # Registrant profile from the in-flight sign-up form. Optional so the
        # detect endpoint keeps working for early-step checks; when provided,
        # admin-configured profile_match rules run against these values.
        submitted_profile = {
            "first_name": str(request.data.get("first_name") or "").strip(),
            "middle_name": str(request.data.get("middle_name") or "").strip(),
            "last_name": str(request.data.get("last_name") or "").strip(),
            "date_of_birth": str(request.data.get("date_of_birth") or "").strip(),
            "gender": str(request.data.get("gender") or "").strip(),
            "address": str(request.data.get("address") or "").strip(),
        }
        if not any(submitted_profile.values()):
            submitted_profile = None

        try:
            # When two files are uploaded, run side-aware extract on each and merge.
            if len(proof_files) >= 2:
                from concurrent.futures import ThreadPoolExecutor

                hint_type = (request.data.get("proof_type") or "").strip() or None

                def detect_side(index: int, side: str) -> dict:
                    return detect_residence_proof(
                        proof_files[index],
                        hint_type=hint_type,
                        side=side,
                        submitted_profile=submitted_profile,
                        configuration=resolution.configuration,
                        forensics=forensics,
                    )

                # OCR.space is an I/O-bound HTTP call, so the two sides can run
                # concurrently instead of front-then-back (~2x faster).
                with ThreadPoolExecutor(max_workers=2) as executor:
                    front_future = executor.submit(detect_side, 0, "front")
                    back_future = executor.submit(detect_side, 1, "back")
                    front_result = front_future.result()
                    back_result = back_future.result()
                from .ocr_engine import merge_extracted_fields

                merged_fields = merge_extracted_fields(
                    front_result.get("extracted_fields") or {},
                    back_result.get("extracted_fields") or {},
                )
                # Prefer front type detection; require both sides to look readable.
                # Keep both picture-check results so a back-side mismatch or
                # cartoon warning is not hidden by the front response.
                integrity_checks = [
                    item
                    for item in (front_result.get("id_integrity"), back_result.get("id_integrity"))
                    if item
                ]
                flagged_integrity = next(
                    (item for item in integrity_checks if item.get("flagged")),
                    None,
                )
                result = dict(front_result)
                result["extracted_fields"] = merged_fields
                result["id_integrity"] = flagged_integrity or (integrity_checks[0] if integrity_checks else None)
                result["id_integrity_checks"] = integrity_checks
                result["pipeline"] = {
                    **(front_result.get("pipeline") or {}),
                    "integrity_checks": integrity_checks,
                }
                confidences = [
                    float((item or {}).get("confidence") or 0)
                    for item in merged_fields.values()
                    if isinstance(item, dict) and (item.get("value") or "").strip()
                ]
                if confidences:
                    from statistics import fmean

                    result["confidence"] = round(fmean(confidences), 4)
                if not front_result.get("detected") or not back_result.get("detected"):
                    result["detected"] = False
                    failed_side_result = next(
                        (item for item in (front_result, back_result) if not item.get("detected")),
                        None,
                    )
                    if failed_side_result:
                        result["pipeline"] = {
                            **(failed_side_result.get("pipeline") or {}),
                            "integrity_checks": integrity_checks,
                        }
                    reasons = []
                    if not front_result.get("detected"):
                        reasons.append(front_result.get("message") or "Front side could not be verified.")
                    if not back_result.get("detected"):
                        reasons.append(back_result.get("message") or "Back side could not be verified.")
                    result["reasons"] = reasons
                    result["message"] = reasons[0] if reasons else result.get("message")
                else:
                    result["detected"] = True
                    result["message"] = front_result.get("message") or "Document verified."
            else:
                result = detect_residence_proof(
                    proof_files[0],
                    hint_type=(request.data.get("proof_type") or "").strip() or None,
                    side=detect_side,
                    submitted_profile=submitted_profile,
                    configuration=resolution.configuration,
                    forensics=forensics,
                )
        except Exception:
            import logging

            logging.getLogger(__name__).exception("Residence proof detect failed")
            return Response(
                {
                    "detected": False,
                    "message": "We could not analyze this photo right now. Check that the API is running, then try again with a clearer JPG/PNG.",
                    "reasons": ["OCR analysis failed unexpectedly."],
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        status_code = status.HTTP_200_OK if result.get("detected") else status.HTTP_422_UNPROCESSABLE_ENTITY
        return Response(result, status=status_code)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginIdentifierThrottle, LoginIPThrottle]

    @extend_schema(
        summary="Log in",
        description=(
            "Exchange an email **or** phone number plus password for a JWT pair. "
            "The refresh token is also set as an HttpOnly cookie. Rate limited to "
            "5 attempts per identifier per minute."
        ),
        request=LoginSerializer,
        responses={
            200: OpenApiResponse(
                response=inline_serializer(
                    name="LoginSuccess",
                    fields={
                        "access": drf_serializers.CharField(help_text="Short-lived JWT for Authorization: Bearer calls."),
                        "user": UserSummarySerializer(),
                    },
                ),
                description="Signed in. The refresh token rides an HttpOnly cookie.",
            ),
            400: OpenApiResponse(description="`{detail, code}` — e.g. code=invalid_credentials."),
            503: OpenApiResponse(description="Maintenance window blocks sign-in."),
        },
        examples=[
            OpenApiExample(
                "Resident login",
                value={"identifier": "juan.reyes@example.com", "password": "Str0ng!Passphrase"},
                request_only=True,
            ),
            OpenApiExample(
                "Phone-number login",
                value={"identifier": "+639171234567", "password": "Str0ng!Passphrase"},
                request_only=True,
            ),
        ],
        tags=["auth"],
    )
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except LoginRejected as exc:
            return Response(
                {"detail": exc.detail, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = serializer.validated_data["user"]

        maintenance = maintenance_blocks(user)
        if maintenance:
            return Response(
                {
                    "code": "maintenance",
                    "detail": maintenance.message,
                    "until": maintenance.ends_at,
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        from .ip_intel import evaluate_request, ip_blocked_response

        ip, ip_meta, ip_reason = evaluate_request(request)
        if ip_reason:
            create_audit_log(
                "auth.login_ip_blocked",
                actor=user,
                target_user=user,
                metadata={"reason": ip_reason, "ip": ip},
                request_meta=request_meta(request),
            )
            return ip_blocked_response(ip_reason)
        if ip_meta:
            get_user_model().objects.filter(pk=user.pk).update(
                ip_asn=ip_meta.get("asn", ""),
                ip_country=ip_meta.get("country", ""),
                ip_org=ip_meta.get("org", ""),
                ip_verdict=ip_meta.get("verdict", ""),
                ip_score=ip_meta.get("score"),
            )
        create_audit_log("auth.login_success", actor=user, target_user=user, request_meta=request_meta(request))
        if user.role == user.Role.FIRST_RESPONDER:
            from apps.emergencies.views import retry_waiting_alerts_for_responder

            try:
                retry_waiting_alerts_for_responder(user)
            except Exception:
                __import__("logging").getLogger(__name__).exception(
                    "Responder login routing retry failed for user %s",
                    user.pk,
                )
        return token_response(user)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CSRFTokenView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({"detail": "CSRF cookie set."})


@method_decorator(csrf_protect, name="dispatch")
class RefreshTokenView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [RefreshSessionThrottle, LoginIPThrottle]

    def post(self, request):
        raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if not raw_refresh:
            return Response(status=status.HTTP_204_NO_CONTENT)

        try:
            refresh = RefreshToken(raw_refresh)
            user_id = refresh.get("user_id")
            access = str(refresh.access_token)
            if settings.SIMPLE_JWT.get("ROTATE_REFRESH_TOKENS"):
                if settings.SIMPLE_JWT.get("BLACKLIST_AFTER_ROTATION"):
                    refresh.blacklist()
        except TokenError:
            response = Response({"detail": "Refresh session expired."}, status=status.HTTP_401_UNAUTHORIZED)
            delete_refresh_cookie(response)
            return response

        from django.contrib.auth import get_user_model
        user = get_user_model().objects.filter(pk=user_id).first()
        if user is None or not user.is_active:
            response = Response({"detail": "Refresh session expired."}, status=status.HTTP_401_UNAUTHORIZED)
            delete_refresh_cookie(response)
            return response

        if settings.SIMPLE_JWT.get("ROTATE_REFRESH_TOKENS"):
            refresh = RefreshToken.for_user(user)
            access = str(refresh.access_token)

        response = Response({"access": access, "user": UserSummarySerializer(user).data})
        if settings.SIMPLE_JWT.get("ROTATE_REFRESH_TOKENS"):
            set_refresh_cookie(response, refresh)
        return response


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw_refresh = request.COOKIES.get(REFRESH_COOKIE_NAME)
        if raw_refresh:
            try:
                RefreshToken(raw_refresh).blacklist()
            except TokenError:
                pass
        response = Response(status=status.HTTP_204_NO_CONTENT)
        delete_refresh_cookie(response)
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Current account",
        description="Profile of the authenticated account; updates accept profile fields.",
        request=None,
        responses={
            200: UserSummarySerializer,
            401: OpenApiResponse(description="Missing or expired access token."),
        },
        tags=["auth"],
    )
    def get(self, request):
        touch_last_seen(request.user)
        return Response(UserSummarySerializer(request.user).data)

    def patch(self, request):
        touch_last_seen(request.user)
        if not hasattr(request.user, "resident_profile"):
            return Response({"detail": "Profile is not available for this account."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = UserProfileUpdateSerializer(instance=request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        create_audit_log("profile.updated", actor=request.user, target_user=request.user, metadata={"fields": sorted(serializer.validated_data.keys())}, request_meta=request_meta(request))
        return Response(UserSummarySerializer(request.user).data)


class ResidentSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get_settings(self, user):
        settings_obj, _ = ResidentSettings.objects.get_or_create(user=user)
        return settings_obj

    def get(self, request):
        touch_last_seen(request.user)
        return Response(ResidentSettingsSerializer(self.get_settings(request.user)).data)

    def patch(self, request):
        touch_last_seen(request.user)
        settings_obj = self.get_settings(request.user)
        serializer = ResidentSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if serializer.validated_data.get("location_sharing_enabled") is False:
            request.user.current_latitude = None
            request.user.current_longitude = None
            request.user.location_updated_at = None
            request.user.save(update_fields=["current_latitude", "current_longitude", "location_updated_at", "updated_at"])
        create_audit_log("settings.updated", actor=request.user, target_user=request.user, metadata={"fields": sorted(serializer.validated_data.keys())}, request_meta=request_meta(request))
        return Response(serializer.data)

class AccountRequestListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        requests = AccountRequest.objects.filter(user=request.user)
        payload = AccountRequestSerializer(requests, many=True).data
        blockers = deletion_blockers(request.user)
        for row in payload:
            if row.get("type") == AccountRequest.Type.DELETION and row.get("status") in {
                AccountRequest.Status.SUBMITTED,
                AccountRequest.Status.REVIEWED,
            }:
                row["blocked"] = blockers["blocked"]
                row["blocked_reasons"] = blockers["reasons"]
        return Response(payload)

    def delete(self, request):
        """Withdraw a request the resident has changed their mind about."""
        touch_last_seen(request.user)
        pending = AccountRequest.objects.filter(
            user=request.user,
            status__in=[AccountRequest.Status.SUBMITTED, AccountRequest.Status.REVIEWED],
        )
        request_type = request.data.get("type") if isinstance(request.data, dict) else None
        if request_type:
            pending = pending.filter(type=request_type)
        withdrawn = pending.count()
        if not withdrawn:
            return Response(
                {"detail": "There is no open request to withdraw."},
                status=status.HTTP_404_NOT_FOUND,
            )
        pending.update(
            status=AccountRequest.Status.REJECTED,
            staff_note="Withdrawn by the resident.",
        )
        create_audit_log(
            "account.request_withdrawn",
            actor=request.user,
            target_user=request.user,
            metadata={"withdrawn": withdrawn},
            request_meta=request_meta(request),
        )
        return Response({"withdrawn": withdrawn})

    def post(self, request):
        touch_last_seen(request.user)
        if request.user.role != request.user.Role.RESIDENT:
            return Response(
                {"detail": "Only resident accounts can submit privacy requests."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = AccountRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_type = serializer.validated_data["type"]
        if request_type not in {AccountRequest.Type.DELETION, AccountRequest.Type.DATA_EXPORT}:
            return Response(
                {"type": ["Use the account deactivation workflow for temporary deactivation."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if AccountRequest.objects.filter(
            user=request.user,
            type=request_type,
            status__in=[AccountRequest.Status.SUBMITTED, AccountRequest.Status.REVIEWED],
        ).exists():
            return Response(
                {"type": ["An active request of this type already exists."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account_request = serializer.save(user=request.user)
        # Neither of these is a decision an official gets to make. A resident
        # asking for their own data back, or asking to leave, is exercising a
        # right — the only real question is whether anything still blocks it.
        #
        # Deletion used to sit in a review queue. That queue's screen is gone
        # (it is an audit log now), so a request parked there would wait for a
        # person who has nowhere to act. It completes itself instead, and the
        # sweeper finishes the ones that are blocked today.
        if (
            request_type == AccountRequest.Type.DATA_EXPORT
            and getattr(settings, "SELF_SERVICE_DATA_EXPORT", True)
        ):
            account_request.status = AccountRequest.Status.COMPLETED
            account_request.staff_note = "Completed automatically: resident self-service export."
            account_request.save(update_fields=["status", "staff_note", "updated_at"])
        elif request_type == AccountRequest.Type.DELETION:
            # Deliberately NOT immediate. Anonymising cannot be undone, so the
            # resident keeps a grace period to change their mind — the withdraw
            # path depends on the request still being open. The sweeper finishes
            # it once the grace period passes and nothing blocks it.
            blockers = deletion_blockers(request.user)
            grace_days = getattr(settings, "ACCOUNT_DELETION_GRACE_DAYS", 7)
            account_request.staff_note = (
                " ".join(blockers["reasons"])
                if blockers["blocked"]
                else f"Scheduled automatically. Completes in {grace_days} days unless withdrawn."
            )
            account_request.save(update_fields=["staff_note", "updated_at"])
        create_audit_log(
            "account.request_submitted",
            actor=request.user,
            target_user=request.user,
            metadata={"request_id": account_request.pk, "type": account_request.type},
            request_meta=request_meta(request),
        )
        return Response(AccountRequestSerializer(account_request).data, status=status.HTTP_201_CREATED)


class DataSubjectRequestView(APIView):
    """PH Data Privacy Act erasure request: file it, officials approve in admin."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Latest data privacy request",
        description="Returns the resident's most recent erasure request and its status.",
        request=None,
        responses={
            200: OpenApiResponse(
                response=inline_serializer(
                    name="DataSubjectRequestStatus",
                    fields={
                        "id": drf_serializers.IntegerField(),
                        "kind": drf_serializers.CharField(),
                        "status": drf_serializers.CharField(help_text="none | pending | approved | declined | completed"),
                        "requested_at": drf_serializers.DateTimeField(),
                    },
                ),
            ),
        },
        tags=["auth"],
    )
    def get(self, request):
        latest = DataSubjectRequest.objects.filter(user=request.user).order_by("-requested_at").first()
        if not latest:
            return Response({"status": "none"})
        return Response({
            "id": latest.pk,
            "kind": latest.kind,
            "status": latest.status,
            "requested_at": latest.requested_at,
        })

    @extend_schema(
        summary="File a data erasure request",
        description=(
            "Creates an erasure request under the PH Data Privacy Act. An official "
            "reviews it in Django admin; on approval a worker deletes every uploaded "
            "file and the account itself. Idempotent: while one request is pending or "
            "approved, repeats return it unchanged."
        ),
        request=None,
        responses={
            201: OpenApiResponse(
                response=inline_serializer(
                    name="DataSubjectRequestCreated",
                    fields={"id": drf_serializers.IntegerField(), "status": drf_serializers.CharField()},
                ),
                description="Request filed.",
            ),
            200: OpenApiResponse(description="An active request already exists; its state is returned."),
        },
        tags=["auth"],
    )
    def post(self, request):
        active = DataSubjectRequest.objects.filter(
            user=request.user,
            status__in=[DataSubjectRequest.Status.PENDING, DataSubjectRequest.Status.APPROVED],
        ).first()
        if active:
            return Response({"id": active.pk, "status": active.status}, status=status.HTTP_200_OK)
        dsr = DataSubjectRequest.objects.create(user=request.user)
        return Response({"id": dsr.pk, "status": dsr.status}, status=status.HTTP_201_CREATED)


class DeactivateAccountView(APIView):
    """Temporary self-deactivation — sets status to suspended immediately."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        user = request.user
        if user.status == user.Status.SUSPENDED:
            return Response({"detail": "This account is already deactivated."}, status=status.HTTP_400_BAD_REQUEST)
        if user.status != user.Status.VERIFIED:
            return Response({"detail": "Only verified accounts can be deactivated."}, status=status.HTTP_400_BAD_REQUEST)

        reason = str(request.data.get("reason") or "").strip()[:120]
        feedback = str(request.data.get("feedback") or "").strip()[:200]
        note_parts = []
        if reason:
            note_parts.append(f"Reason: {reason}")
        if feedback:
            note_parts.append(f"Feedback: {feedback}")
        note = " | ".join(note_parts)[:255] or "Resident deactivated their account."

        user.status = user.Status.SUSPENDED
        user.save(update_fields=["status", "updated_at"])

        account_request = AccountRequest.objects.create(
            user=user,
            type=AccountRequest.Type.DEACTIVATION,
            status=AccountRequest.Status.COMPLETED,
            note=note,
        )
        create_audit_log(
            "account.deactivated",
            actor=user,
            target_user=user,
            metadata={"request_id": account_request.pk, "reason": reason},
            request_meta=request_meta(request),
        )
        return Response(
            {
                "user": UserSummarySerializer(user).data,
                "request": AccountRequestSerializer(account_request).data,
            }
        )


class ReactivateAccountView(APIView):
    """Restore a self-deactivated (suspended) account."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        user = request.user
        if user.status != user.Status.SUSPENDED:
            return Response({"detail": "This account is not deactivated."}, status=status.HTTP_400_BAD_REQUEST)

        user.status = user.Status.VERIFIED
        user.save(update_fields=["status", "updated_at"])
        from .email_services import send_account_email_after_commit
        send_account_email_after_commit(user, "account_reactivated")
        create_audit_log(
            "account.reactivated",
            actor=user,
            target_user=user,
            metadata={},
            request_meta=request_meta(request),
        )
        return Response(UserSummarySerializer(user).data)


def _normalize_person_name(value: str) -> str:
    import re as _re
    text = (value or "").strip().casefold()
    text = _re.sub(r"[^\w\sñ]", " ", text, flags=_re.UNICODE)
    text = _re.sub(r"\s+", " ", text).strip()
    return text


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        touch_last_seen(request.user)
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        current = serializer.validated_data["current_password"]
        new_password = serializer.validated_data["new_password"]
        if not request.user.check_password(current):
            return Response(
                {"detail": "Current password is incorrect.", "current_password": ["Current password is incorrect."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if current == new_password:
            return Response(
                {"detail": "New password must be different from your current password."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_password(new_password, user=request.user)
        except DjangoValidationError as exc:
            return Response({"new_password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save(update_fields=["password", "updated_at"])
        from .email_services import send_account_email_after_commit
        send_account_email_after_commit(request.user, "password_changed")
        create_audit_log(
            "account.password_changed",
            actor=request.user,
            target_user=request.user,
            metadata={},
            request_meta=request_meta(request),
        )
        return Response({"detail": "Password updated."})


class AccountPhoneChangeRequestView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp"

    def post(self, request):
        from django.conf import settings as django_settings
        from .services import OTPDeliveryError

        touch_last_seen(request.user)
        serializer = AccountPhoneChangeRequestSerializer(
            data=request.data, context={"user": request.user}
        )
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        if phone_number == (request.user.phone_number or ""):
            return Response(
                {"detail": "That is already your mobile number."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            profile = getattr(request.user, "resident_profile", None)
            recipient_name = (getattr(profile, "first_name", "") or getattr(request.user, "first_name", "") or "").strip()
            _challenge, code = create_phone_otp_challenge(phone_number, recipient_name=recipient_name)
        except OTPDeliveryError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception:
            return Response(
                {"detail": "We could not send the SMS code. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if getattr(django_settings, "IS_LOCAL_DEVELOPMENT", False) or django_settings.DEBUG:
            return Response(
                {"detail": "Code sent. Check the API console in development."},
                status=status.HTTP_200_OK,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AccountPhoneChangeVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp"

    def post(self, request):
        touch_last_seen(request.user)
        serializer = AccountPhoneChangeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        # Uniqueness again
        if (
            get_user_model()
            .objects.filter(phone_number=phone_number)
            .exclude(pk=request.user.pk)
            .exists()
        ):
            return Response(
                {"detail": "An account with this phone number already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            verify_phone_otp_challenge(phone_number, serializer.validated_data["code"])
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        request.user.phone_number = phone_number
        request.user.phone_verified_at = timezone.now()
        request.user.save(update_fields=["phone_number", "phone_verified_at", "updated_at"])
        create_audit_log(
            "account.phone_changed",
            actor=request.user,
            target_user=request.user,
            metadata={"phone_number": phone_number},
            request_meta=request_meta(request),
        )
        return Response(UserSummarySerializer(request.user).data)


class AccountEmailChangeRequestView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp"

    def post(self, request):
        from django.conf import settings as django_settings
        from .services import OTPDeliveryError

        touch_last_seen(request.user)
        serializer = AccountEmailChangeRequestSerializer(
            data=request.data, context={"user": request.user}
        )
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        if email == (request.user.email or "").lower():
            return Response(
                {"detail": "That is already your email address."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            profile = getattr(request.user, "resident_profile", None)
            recipient_name = (getattr(profile, "first_name", "") or getattr(request.user, "first_name", "") or "").strip()
            _challenge, code = create_email_otp_challenge(email, recipient_name=recipient_name)
        except OTPDeliveryError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception:
            return Response(
                {"detail": "We could not send the email code. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        if getattr(django_settings, "IS_LOCAL_DEVELOPMENT", False) or django_settings.DEBUG:
            return Response(
                {"detail": "Code sent. Check the API console in development."},
                status=status.HTTP_200_OK,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class AccountEmailChangeVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp"

    def post(self, request):
        from .services import verify_email_otp_challenge

        touch_last_seen(request.user)
        serializer = AccountEmailChangeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        if (
            get_user_model()
            .objects.filter(email__iexact=email)
            .exclude(pk=request.user.pk)
            .exists()
        ):
            return Response(
                {"detail": "An account with this email already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            verify_email_otp_challenge(email, serializer.validated_data["code"])
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        request.user.email = email
        request.user.email_verified_at = timezone.now()
        request.user.save(update_fields=["email", "email_verified_at", "updated_at"])
        from .email_services import send_account_email_after_commit
        send_account_email_after_commit(request.user, "email_changed")
        create_audit_log(
            "account.email_changed",
            actor=request.user,
            target_user=request.user,
            metadata={"email": email},
            request_meta=request_meta(request),
        )
        return Response(UserSummarySerializer(request.user).data)


class AccountNameChangeConfirmView(APIView):
    """Apply a name change only when OCR-extracted name matches the requested name."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        touch_last_seen(request.user)
        if not hasattr(request.user, "resident_profile"):
            return Response(
                {"detail": "Profile is not available for this account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = AccountNameChangeConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        req_first = _normalize_person_name(data["first_name"])
        req_last = _normalize_person_name(data["last_name"])
        req_middle = _normalize_person_name(data.get("middle_name") or "")
        ocr_first = _normalize_person_name(data["ocr_first_name"])
        ocr_last = _normalize_person_name(data["ocr_last_name"])
        ocr_middle = _normalize_person_name(data.get("ocr_middle_name") or "")

        if not ocr_first or not ocr_last:
            return Response(
                {
                    "detail": "We could not read a full name on your document. Please resubmit a clearer ID.",
                    "code": "ocr_name_missing",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        first_ok = req_first == ocr_first or req_first in ocr_first or ocr_first in req_first
        last_ok = req_last == ocr_last or req_last in ocr_last or ocr_last in req_last
        if not first_ok or not last_ok:
            return Response(
                {
                    "detail": "Please check your details, your name does not match the name on your document.",
                    "code": "ocr_name_mismatch",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Middle name: only enforce when both sides provide one
        if req_middle and ocr_middle:
            if req_middle != ocr_middle and req_middle not in ocr_middle and ocr_middle not in req_middle:
                return Response(
                    {
                        "detail": "Please check your details, your middle name does not match the one on your document.",
                        "code": "ocr_name_mismatch",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        profile = request.user.resident_profile
        profile.first_name = data["first_name"].strip()
        profile.middle_name = (data.get("middle_name") or "").strip()
        profile.last_name = data["last_name"].strip()
        profile.save(update_fields=["first_name", "middle_name", "last_name", "updated_at"])
        create_audit_log(
            "account.name_changed",
            actor=request.user,
            target_user=request.user,
            metadata={"first_name": profile.first_name, "last_name": profile.last_name},
            request_meta=request_meta(request),
        )
        request.user.refresh_from_db()
        return Response(UserSummarySerializer(request.user).data)

class AccountRequestManageListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to manage account requests."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import scope_user_queryset

        User = get_user_model()
        users = scope_user_queryset(User.objects.all(), request.user)
        queryset = AccountRequest.objects.select_related("user", "user__resident_profile").filter(user__in=users)
        request_status = request.query_params.get("status")
        if request_status and request_status != "all":
            queryset = queryset.filter(status=request_status)
        request_type = request.query_params.get("type")
        if request_type and request_type != "all":
            queryset = queryset.filter(type=request_type)
        return Response(AccountRequestSerializer(queryset, many=True).data)

class AccountRequestReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        return self.patch(request, pk)

    @transaction.atomic
    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to review account requests."}, status=status.HTTP_403_FORBIDDEN)
        from apps.community_scope import scope_user_queryset

        User = get_user_model()
        users = scope_user_queryset(User.objects.all(), request.user)
        account_request = get_object_or_404(
            AccountRequest.objects.select_for_update(of=("self",)).select_related("user", "user__resident_profile").filter(user__in=users),
            pk=pk,
        )
        serializer = AccountRequestReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        next_status = serializer.validated_data["status"]
        if account_request.status == AccountRequest.Status.COMPLETED:
            return Response(AccountRequestSerializer(account_request).data)
        if account_request.type == AccountRequest.Type.DELETION and next_status == AccountRequest.Status.COMPLETED:
            try:
                anonymize_resident_account(account_request.user)
            except PrivacyRequestConflict as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
            create_audit_log(
                "account.deletion_completed",
                actor=request.user,
                target_user=account_request.user,
                metadata={"request_id": account_request.pk, "retained": "anonymized civic case records"},
                request_meta=request_meta(request),
            )
        account_request.status = next_status
        account_request.staff_note = serializer.validated_data.get("staff_note", "")
        account_request.reviewed_by = request.user
        account_request.save(update_fields=["status", "staff_note", "reviewed_by", "updated_at"])
        create_audit_log(
            "account.request_reviewed",
            actor=request.user,
            target_user=account_request.user,
            metadata={"request_id": account_request.pk, "status": account_request.status},
            request_meta=request_meta(request),
        )
        return Response(AccountRequestSerializer(account_request).data)


class AccountDataExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        touch_last_seen(request.user)
        account_request = get_object_or_404(
            AccountRequest,
            pk=pk,
            user=request.user,
            type=AccountRequest.Type.DATA_EXPORT,
        )
        if account_request.status != AccountRequest.Status.COMPLETED:
            return Response(
                {"detail": "The data export is not ready for download."},
                status=status.HTTP_409_CONFLICT,
            )
        payload = build_account_data_export(request.user)
        create_audit_log(
            "account.data_export_downloaded",
            actor=request.user,
            target_user=request.user,
            metadata={"request_id": account_request.pk},
            request_meta=request_meta(request),
        )
        response = Response(payload)
        response["Content-Disposition"] = f'attachment; filename="e-boses-data-export-{request.user.pk}.json"'
        return response


class SensitiveAccessAuditView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response(
                {"detail": "You do not have permission to review sensitive access."},
                status=status.HTTP_403_FORBIDDEN,
            )
        queryset = AuditLog.objects.filter(
            action__in=["media.raw_accessed", "account.data_export_downloaded"]
        ).select_related(
            "actor", "actor__resident_profile", "target_user", "target_user__resident_profile"
        )
        if not request.user.is_superuser:
            from apps.community_scope import community_ids_for_user

            queryset = queryset.filter(community_id__in=community_ids_for_user(request.user))
        kind = (request.query_params.get("kind") or "all").strip().lower()
        if kind == "media":
            queryset = queryset.filter(action="media.raw_accessed")
        elif kind == "export":
            queryset = queryset.filter(action="account.data_export_downloaded")
        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(actor__email__icontains=search)
                | Q(target_user__email__icontains=search)
                | Q(actor__resident_profile__first_name__icontains=search)
                | Q(actor__resident_profile__last_name__icontains=search)
                | Q(target_user__resident_profile__first_name__icontains=search)
                | Q(target_user__resident_profile__last_name__icontains=search)
            )
        try:
            limit = min(200, max(1, int(request.query_params.get("limit", 100))))
        except (TypeError, ValueError):
            return Response({"limit": ["Use a whole number from 1 to 200."]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SensitiveAccessAuditSerializer(queryset.order_by("-created_at", "-id")[:limit], many=True).data)

class ResidentDirectoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to view residents."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        from apps.community_scope import scope_user_queryset

        queryset = scope_user_queryset(
            User.objects.filter(role=User.Role.RESIDENT).select_related("resident_profile"), request.user
        )
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            queryset = queryset.filter(status=status_filter)
        search = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        if search:
            queryset = queryset.filter(email__icontains=search) | queryset.filter(phone_number__icontains=search) | queryset.filter(resident_profile__first_name__icontains=search) | queryset.filter(resident_profile__last_name__icontains=search)
        return Response(UserSummarySerializer(queryset.order_by("-date_joined"), many=True).data)


class StaffDirectoryView(APIView):
    """Every account, for the Users configuration screen.

    The existing directories are role-specific (residents here, responders
    there), which is why officials had no single place to see and manage
    accounts. This one spans roles and carries each person's unit designations,
    since assigning a unit and position is what actually grants capabilities.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user) or not user_has_capability(
            request.user, MANAGE_USERS
        ):
            return capability_denied(MANAGE_USERS)

        User = get_user_model()
        from apps.community_scope import scope_user_queryset

        queryset = scope_user_queryset(
            User.objects.all()
            .select_related("resident_profile")
            .prefetch_related("designations__department", "designations__position")
        , request.user)

        role = request.query_params.get("role")
        if role and role != "all":
            queryset = queryset.filter(role=role)

        account_status = request.query_params.get("status")
        if account_status and account_status != "all":
            queryset = queryset.filter(status=account_status)

        search = (request.query_params.get("search") or "").strip()
        if search:
            queryset = (
                queryset.filter(email__icontains=search)
                | queryset.filter(phone_number__icontains=search)
                | queryset.filter(resident_profile__first_name__icontains=search)
                | queryset.filter(resident_profile__last_name__icontains=search)
            )

        return Response(
            UserSummarySerializer(queryset.distinct().order_by("-date_joined"), many=True).data
        )


class ResidentMentionSearchView(APIView):
    """
    Lightweight mention directory for any authenticated user.
    Returns only id + names (no email/phone) for verified residents.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        User = get_user_model()
        search = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        from apps.community_scope import scope_user_queryset

        queryset = scope_user_queryset(
            User.objects.filter(role=User.Role.RESIDENT, status=User.Status.VERIFIED)
            .select_related("resident_profile")
            .order_by("resident_profile__first_name", "resident_profile__last_name", "id")
        , request.user)
        if search:
            queryset = queryset.filter(
                Q(resident_profile__first_name__icontains=search)
                | Q(resident_profile__last_name__icontains=search)
            )
        # Empty @ query: return a short starter list so the picker isn't empty
        limit = 20 if search else 12
        rows = []
        for user in queryset[:limit]:
            profile = getattr(user, "resident_profile", None)
            first = (getattr(profile, "first_name", None) or "").strip()
            last = (getattr(profile, "last_name", None) or "").strip()
            full = f"{first} {last}".strip() or (user.email.split("@")[0] if user.email else f"User {user.id}")
            rows.append(
                {
                    "id": user.id,
                    "firstName": first or full.split()[0],
                    "lastName": last,
                    "full_name": full,
                }
            )
        return Response(rows)


class ResidentStatusUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to update residents."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        from apps.community_scope import scope_user_queryset

        resident = get_object_or_404(
            scope_user_queryset(User.objects.all(), request.user), pk=pk, role=User.Role.RESIDENT
        )
        serializer = UserStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resident.status = serializer.validated_data["status"]
        resident.save(update_fields=["status", "updated_at"])
        create_audit_log("account.resident_status_updated", actor=request.user, target_user=resident, metadata={"status": resident.status}, request_meta=request_meta(request))
        return Response(UserSummarySerializer(resident).data)

class StaffAccountUpdateView(APIView):
    """Change a person's role, status and unit from the Users screen."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user) or not user_has_capability(
            request.user, MANAGE_USERS
        ):
            return capability_denied(MANAGE_USERS)

        User = get_user_model()
        from apps.community_scope import scope_user_queryset

        target = get_object_or_404(scope_user_queryset(User.objects.all(), request.user), pk=pk)

        # Only a system administrator may mint another official, matching the
        # rule already enforced on account creation.
        if (
            request.data.get("role") == User.Role.BARANGAY_OFFICIAL
            and target.role != User.Role.BARANGAY_OFFICIAL
            and not request.user.is_superuser
        ):
            return Response(
                {"role": ["Only a system administrator can promote someone to official."]},
                status=status.HTTP_403_FORBIDDEN,
            )

        if target.pk == request.user.pk and "role" in request.data:
            # Losing your own role mid-session is unrecoverable from the UI.
            return Response(
                {"role": ["You cannot change your own role."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = StaffAccountUpdateSerializer(data=request.data)
        serializer.instance = target
        serializer.is_valid(raise_exception=True)
        validated = dict(serializer.validated_data)

        # Moving an account between communities. The target must be one the
        # admin already manages, so a single-community official cannot push a
        # resident into a barangay they have no authority over.
        community = validated.pop("community", None)
        if community is not None:
            from apps.community_scope import community_ids_for_user

            if community.pk not in community_ids_for_user(request.user):
                return Response(
                    {"community": ["Choose a community you manage."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # A resident carries their name/gender on `ResidentProfile`, which
        # `UserSummarySerializer` reads in preference to the bare User
        # fields — write there too, or the edit would silently not show.
        profile = getattr(target, "resident_profile", None)
        profile_only_fields = {"middle_name", "gender"}
        profile_fields = []
        fields = []
        for field, value in validated.items():
            if profile is not None and field in ({"first_name", "last_name"} | profile_only_fields):
                setattr(profile, field, value)
                profile_fields.append(field)
                if field in profile_only_fields:
                    continue
            setattr(target, field, value)
            fields.append(field)

        # A resident or official has no responder unit; leaving a stale one would
        # keep them in dispatch candidate queries.
        if target.role != User.Role.FIRST_RESPONDER and target.responder_unit:
            target.responder_unit = ""
            fields.append("responder_unit")

        # A community move rewrites both the FK the scoping follows and the
        # plain-text barangay every legacy display reads, so they can never
        # disagree.
        if (
            community is not None
            and profile is not None
            and profile.community_id != community.pk
        ):
            profile.community = community
            profile.barangay = community.name
            profile_fields.extend(["community", "barangay"])

        if profile_fields:
            profile.save(update_fields=[*dict.fromkeys(profile_fields), "updated_at"])
        target.save(update_fields=[*dict.fromkeys(fields), "updated_at"])

        if target.role == User.Role.FIRST_RESPONDER:
            sync_responder_designation(target)

        create_audit_log(
            "account.staff_updated",
            actor=request.user,
            target_user=target,
            metadata={"fields": sorted({*fields, *profile_fields})},
            request_meta=request_meta(request),
        )
        return Response(UserSummarySerializer(target).data)


class ResponderDirectoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to view responders."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        from apps.community_scope import scope_user_queryset

        queryset = scope_user_queryset(
            User.objects.filter(role=User.Role.FIRST_RESPONDER).select_related("resident_profile"), request.user
        )
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            queryset = queryset.filter(status=status_filter)
        unit = request.query_params.get("unit")
        if unit and unit != "all":
            queryset = queryset.filter(responder_unit=unit)
        on_duty = request.query_params.get("on_duty")
        if on_duty in {"true", "false"}:
            queryset = queryset.filter(is_on_duty=on_duty == "true")
        search = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        if search:
            queryset = queryset.filter(email__icontains=search) | queryset.filter(phone_number__icontains=search) | queryset.filter(resident_profile__first_name__icontains=search) | queryset.filter(resident_profile__last_name__icontains=search)
        return Response(UserSummarySerializer(queryset.order_by("responder_unit", "email"), many=True).data)

class ResponderUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to update responders."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        from apps.community_scope import scope_user_queryset

        # `scope_user_queryset()` uses `.distinct()` for designation joins.
        # PostgreSQL does not allow `SELECT DISTINCT ... FOR UPDATE`, so keep
        # the scoped visibility check in a subquery and lock the user row by
        # primary key in the outer query.
        visible_ids = scope_user_queryset(
            User.objects.filter(pk=pk), request.user
        ).values("pk")
        responder = get_object_or_404(
            User.objects.select_for_update().filter(
                pk__in=visible_ids,
                role=User.Role.FIRST_RESPONDER,
            ),
            pk=pk,
        )
        serializer = ResponderUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        active_shift = active_responder_shift_for_update(responder)
        next_unit = serializer.validated_data.get("responder_unit")
        if active_shift and next_unit is not None and next_unit != responder.responder_unit:
            return Response(
                {"responder_unit": ["End the responder's active shift before changing their unit."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        fields = []
        for field, value in serializer.validated_data.items():
            setattr(responder, field, value)
            fields.append(field)
        next_status = serializer.validated_data.get("status")
        if next_status is not None and next_status != User.Status.VERIFIED:
            if active_shift:
                active_shift.status = "ended"
                active_shift.ended_at = timezone.now()
                active_shift.save(update_fields=["status", "ended_at", "updated_at"])
                create_audit_log(
                    "responder.shift_ended",
                    actor=request.user,
                    target_user=responder,
                    metadata={
                        "shift_id": active_shift.pk,
                        "reason": f"Responder account changed to {next_status}.",
                    },
                    request_meta=request_meta(request),
                )
            if responder.is_on_duty:
                responder.is_on_duty = False
                fields.append("is_on_duty")
        if fields:
            fields = list(dict.fromkeys(fields))
            responder.save(update_fields=[*fields, "updated_at"])
            if "responder_unit" in fields:
                # Keep unit membership in step with the enum, or the responder
                # would keep being dispatched for their previous unit.
                sync_responder_designation(responder)
            create_audit_log("account.responder_updated", actor=request.user, target_user=responder, metadata={"fields": fields}, request_meta=request_meta(request))
        return Response(UserSummarySerializer(responder).data)


class OnboardCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        request.user.is_onboarded = True
        request.user.save(update_fields=["is_onboarded", "updated_at"])
        return Response(UserSummarySerializer(request.user).data)


class OTPVerifyView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp"

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            challenge = latest_active_otp_challenge(
                request.user,
                serializer.validated_data["channel"],
                serializer.validated_data["purpose"],
            )
            verify_otp_challenge(challenge, serializer.validated_data["code"])
        except ObjectDoesNotExist:
            return Response({"detail": "No active OTP challenge."}, status=status.HTTP_404_NOT_FOUND)
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        request.user.refresh_from_db()
        # Finish registration OCR in-request when still pending so clients go
        # straight to onboarding instead of a permanent "queued" pending page.
        if request.user.status == request.user.Status.PENDING_VERIFICATION:
            try:
                from .ocr_runtime import process_stuck_user_case

                process_stuck_user_case(request.user)
                request.user.refresh_from_db()
            except Exception:
                pass
        return Response(UserSummarySerializer(request.user).data)


class OTPResendView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "otp"

    def post(self, request):
        serializer = OTPResendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = serializer.validated_data["channel"]
        destination = request.user.email if channel == OTPChallenge.Channel.EMAIL else request.user.phone_number
        create_otp_challenge(request.user, channel, serializer.validated_data["purpose"], destination)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminCreateUserView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to create managed accounts."}, status=status.HTTP_403_FORBIDDEN)
        serializer = AdminCreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if (
            serializer.validated_data["role"] == get_user_model().Role.BARANGAY_OFFICIAL
            and not request.user.is_superuser
        ):
            return Response(
                {"role": ["Only a system administrator can create another official account."]},
                status=status.HTTP_403_FORBIDDEN,
            )
        user = serializer.save()
        # Dispatch finds responders through Designation, so a responder created
        # with only `responder_unit` set would never be routed to.
        sync_responder_designation(user)
        create_audit_log("admin.user_created", actor=request.user, target_user=user, metadata={"role": user.role}, request_meta=request_meta(request))
        return Response(UserSummarySerializer(user).data, status=status.HTTP_201_CREATED)


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_identifier(serializer.validated_data["identifier"])
        if user is None:
            create_audit_log("password_reset.requested_unknown", metadata={"channel": serializer.validated_data["channel"]}, request_meta=request_meta(request))
            return Response(
                {"identifier": ["No account found with that email."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        channel = serializer.validated_data["channel"]
        destination = user.email if channel == OTPChallenge.Channel.EMAIL else user.phone_number
        create_otp_challenge(user, channel, OTPChallenge.Purpose.PASSWORD_RESET, destination)
        create_audit_log("password_reset.requested", target_user=user, request_meta=request_meta(request))
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetVerifyView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_identifier(serializer.validated_data["identifier"])
        if user is None:
            return Response({"detail": "Invalid reset request."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            challenge = latest_active_otp_challenge(
                user,
                serializer.validated_data["channel"],
                OTPChallenge.Purpose.PASSWORD_RESET,
            )
            verify_otp_challenge(challenge, serializer.validated_data["code"])
        except ObjectDoesNotExist:
            return Response({"detail": "No active reset challenge."}, status=status.HTTP_404_NOT_FOUND)
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"reset_token": create_password_reset_token(user)})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = read_password_reset_token(serializer.validated_data["reset_token"])
        except (BadSignature, SignatureExpired, ObjectDoesNotExist):
            return Response({"detail": "Invalid or expired reset token."}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password", "updated_at"])
        from .email_services import send_account_email_after_commit
        send_account_email_after_commit(user, "password_changed")
        create_audit_log("password_reset.confirmed", target_user=user, request_meta=request_meta(request))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResidenceProofRawMediaView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        proof = get_object_or_404(ResidenceProof, pk=pk)
        if not user_can_access_residence_proof_raw(request.user, proof):
            return Response({"detail": "You do not have permission to access this media."}, status=status.HTTP_403_FORBIDDEN)
        log_raw_media_access(
            actor=request.user,
            target_user=proof.user,
            media_type="residence_proof",
            object_id=proof.pk,
            request_meta=request_meta(request),
        )
        return FileResponse(proof.file.open("rb"), content_type=proof.mime_type or "application/octet-stream")


class ResidenceProofPreviewMediaView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        proof = get_object_or_404(ResidenceProof, pk=pk)
        if not user_can_access_residence_proof_raw(request.user, proof):
            return Response({"detail": "You do not have permission to access this media."}, status=status.HTTP_403_FORBIDDEN)
        log_raw_media_access(
            actor=request.user,
            target_user=proof.user,
            media_type="residence_proof_preview",
            object_id=proof.pk,
            request_meta=request_meta(request),
        )
        if proof.blurred_preview_file:
            return FileResponse(proof.blurred_preview_file.open("rb"), content_type="image/jpeg")
        # Rendering (OpenCV face detection + PIL re-encode) never runs on the
        # request thread; registration already queued it, this covers gaps.
        from .ocr_tasks import enqueue_residence_proof_preview

        transaction.on_commit(lambda proof_id=proof.pk: enqueue_residence_proof_preview(proof_id))
        from io import BytesIO

        from .media_services import placeholder_preview_jpeg

        return FileResponse(BytesIO(placeholder_preview_jpeg()), content_type="image/jpeg")
