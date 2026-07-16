from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.core.signing import BadSignature, SignatureExpired
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils.decorators import method_decorator
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AccountRequest, OTPChallenge, ResidenceProof, ResidentSettings
from .permissions import IsStaffOrSuperuser, user_has_role_permission
from .selectors import find_user_by_identifier, latest_active_otp_challenge
from .serializers import (
    AccountRequestSerializer,
    AccountRequestReviewSerializer,
    AdminCreateUserSerializer,
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
    UserStatusUpdateSerializer,
    UserProfileUpdateSerializer,
    UserSummarySerializer,
)
from .media_services import (
    ensure_residence_proof_preview,
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
    return {
        "ip_address": request.META.get("REMOTE_ADDR"),
        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
    }


def touch_last_seen(user):
    if user and user.is_authenticated:
        user.last_seen_at = timezone.now()
        user.save(update_fields=["last_seen_at", "updated_at"])

def can_manage_accounts(user):
    return bool(
        user
        and user.is_authenticated
        and (user.is_staff or user.is_superuser or user_has_role_permission(user, "accounts.verify_residents"))
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
    """Public stats for the sign-up “verified peek” (neighbor count, etc.)."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "auth"

    def get(self, request):
        User = get_user_model()
        # Simple count: every registered account with role=resident.
        neighbors = User.objects.filter(role=User.Role.RESIDENT).count()
        return Response(
            {
                "barangay": "Marikina Heights",
                "neighbors": neighbors,
            }
        )


class PhoneOTPRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "otp"

    def post(self, request):
        from django.conf import settings as django_settings

        from .services import OTPDeliveryError

        serializer = PhoneOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        try:
            _challenge, code = create_phone_otp_challenge(phone_number)
        except OTPDeliveryError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception:
            logger = __import__("logging").getLogger(__name__)
            logger.exception("Phone OTP request failed for %s", phone_number)
            return Response(
                {"detail": "We could not send the SMS code. Please try again in a moment."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        # Local dev: return the code so you can finish sign-up without a real SMS gateway.
        if getattr(django_settings, "IS_LOCAL_DEVELOPMENT", False) or django_settings.DEBUG:
            return Response(
                {
                    "detail": "Code sent (development mode — check the API console).",
                    "debug_code": code,
                },
                status=status.HTTP_200_OK,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        try:
            _challenge, code = create_email_otp_challenge(email)
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
                {
                    "detail": "Code sent (development mode — check the API console).",
                    "debug_code": code,
                },
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
    throttle_scope = "auth"

    def post(self, request):
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
            if proof_type:
                from .ocr_runtime import document_type_for_registration

                # Validate type exists / enabled only — not side completeness
                document_type_for_registration(proof_type)
        except (DuplicateProofError, ValidationError) as exc:
            if hasattr(exc, "message_dict"):
                return Response(exc.message_dict, status=status.HTTP_400_BAD_REQUEST)
            message = exc.message if hasattr(exc, "message") else str(exc)
            return Response({"proof": [message]}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ResidenceProofDetectView(APIView):
    """Auto-detect document type from an uploaded/captured proof at sign-up."""

    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = "auth"

    def post(self, request):
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

        try:
            # When two files are uploaded, run side-aware extract on each and merge.
            if len(proof_files) >= 2:
                front_result = detect_residence_proof(
                    proof_files[0],
                    hint_type=(request.data.get("proof_type") or "").strip() or None,
                    side="front",
                )
                back_result = detect_residence_proof(
                    proof_files[1],
                    hint_type=(request.data.get("proof_type") or "").strip() or None,
                    side="back",
                )
                from .ocr_engine import merge_extracted_fields

                merged_fields = merge_extracted_fields(
                    front_result.get("extracted_fields") or {},
                    back_result.get("extracted_fields") or {},
                )
                # Prefer front type detection; require both sides to look readable.
                result = dict(front_result)
                result["extracted_fields"] = merged_fields
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
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        create_audit_log("auth.login_success", actor=user, target_user=user, request_meta=request_meta(request))
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
    throttle_scope = "auth"

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
        request.user.refresh_from_db()
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
        create_audit_log("settings.updated", actor=request.user, target_user=request.user, metadata={"fields": sorted(serializer.validated_data.keys())}, request_meta=request_meta(request))
        return Response(serializer.data)

class AccountRequestListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        requests = AccountRequest.objects.filter(user=request.user)
        return Response(AccountRequestSerializer(requests, many=True).data)

    def post(self, request):
        touch_last_seen(request.user)
        serializer = AccountRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account_request = serializer.save(user=request.user)
        create_audit_log(
            "account.request_submitted",
            actor=request.user,
            target_user=request.user,
            metadata={"request_id": account_request.pk, "type": account_request.type},
            request_meta=request_meta(request),
        )
        return Response(AccountRequestSerializer(account_request).data, status=status.HTTP_201_CREATED)

class AccountRequestManageListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to manage account requests."}, status=status.HTTP_403_FORBIDDEN)
        queryset = AccountRequest.objects.select_related("user", "user__resident_profile")
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

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to review account requests."}, status=status.HTTP_403_FORBIDDEN)
        account_request = get_object_or_404(AccountRequest, pk=pk)
        serializer = AccountRequestReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account_request.status = serializer.validated_data["status"]
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

class ResidentDirectoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to view residents."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        queryset = User.objects.filter(role=User.Role.RESIDENT).select_related("resident_profile")
        status_filter = request.query_params.get("status")
        if status_filter and status_filter != "all":
            queryset = queryset.filter(status=status_filter)
        search = (request.query_params.get("search") or request.query_params.get("q") or "").strip()
        if search:
            queryset = queryset.filter(email__icontains=search) | queryset.filter(phone_number__icontains=search) | queryset.filter(resident_profile__first_name__icontains=search) | queryset.filter(resident_profile__last_name__icontains=search)
        return Response(UserSummarySerializer(queryset.order_by("-date_joined"), many=True).data)

class ResidentStatusUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to update residents."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        resident = get_object_or_404(User, pk=pk, role=User.Role.RESIDENT)
        serializer = UserStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resident.status = serializer.validated_data["status"]
        resident.save(update_fields=["status", "updated_at"])
        create_audit_log("account.resident_status_updated", actor=request.user, target_user=resident, metadata={"status": resident.status}, request_meta=request_meta(request))
        return Response(UserSummarySerializer(resident).data)

class ResponderDirectoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to view responders."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        queryset = User.objects.filter(role=User.Role.FIRST_RESPONDER).select_related("resident_profile")
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

    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to update responders."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        responder = get_object_or_404(User, pk=pk, role=User.Role.FIRST_RESPONDER)
        serializer = ResponderUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = []
        for field, value in serializer.validated_data.items():
            setattr(responder, field, value)
            fields.append(field)
        if fields:
            responder.save(update_fields=[*fields, "updated_at"])
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
    permission_classes = [IsStaffOrSuperuser]

    def post(self, request):
        serializer = AdminCreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
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
    permission_classes = [AllowAny]

    def get(self, request, pk):
        proof = get_object_or_404(ResidenceProof, pk=pk)
        preview = ensure_residence_proof_preview(proof)
        return FileResponse(preview.open("rb"), content_type="text/plain")
