from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Q
from django.db import transaction
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

from apps.capabilities import MANAGE_USERS, capability_denied, user_has_capability
from apps.concerns.units import sync_responder_designation
from apps.emergencies.selectors import active_responder_shift_for_update
from apps.system_state import maintenance_blocks

from .models import AccountRequest, AuditLog, OTPChallenge, ResidenceProof, ResidentSettings
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
    LoginRejected,
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
    # Tolerates None so background paths that have no HTTP request — SMS
    # ingestion, Celery escalation — can share the same audit helpers.
    meta = getattr(request, "META", None) or {}
    return {
        "ip_address": meta.get("REMOTE_ADDR"),
        "user_agent": meta.get("HTTP_USER_AGENT", ""),
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
        from .services import (
            OTP_EXPIRY_MINUTES,
            OTP_RESEND_COOLDOWN_SECONDS,
            OTPDeliveryError,
            OTPRateLimited,
        )

        serializer = PhoneOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone_number = serializer.validated_data["phone_number"]
        try:
            create_phone_otp_challenge(phone_number)
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
                    submitted_profile=submitted_profile,
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
            _challenge, code = create_phone_otp_challenge(phone_number)
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
            _challenge, code = create_email_otp_challenge(email)
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
                    "detail": "The name on your document does not match the name you entered. Please correct the name or resubmit a clearer ID.",
                    "code": "ocr_name_mismatch",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Middle name: only enforce when both sides provide one
        if req_middle and ocr_middle:
            if req_middle != ocr_middle and req_middle not in ocr_middle and ocr_middle not in req_middle:
                return Response(
                    {
                        "detail": "The middle name on your document does not match. Please correct it or resubmit.",
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

    @transaction.atomic
    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to review account requests."}, status=status.HTTP_403_FORBIDDEN)
        account_request = get_object_or_404(
            AccountRequest.objects.select_for_update().select_related("user", "user__resident_profile"),
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
        queryset = User.objects.filter(role=User.Role.RESIDENT).select_related("resident_profile")
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
        queryset = (
            User.objects.all()
            .select_related("resident_profile")
            .prefetch_related("designations__department", "designations__position")
        )

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
        queryset = (
            User.objects.filter(role=User.Role.RESIDENT, status=User.Status.VERIFIED)
            .select_related("resident_profile")
            .order_by("resident_profile__first_name", "resident_profile__last_name", "id")
        )
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
        resident = get_object_or_404(User, pk=pk, role=User.Role.RESIDENT)
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
        target = get_object_or_404(User, pk=pk)

        # Only a system administrator may mint another official, matching the
        # rule already enforced on account creation.
        if (
            request.data.get("role") == User.Role.BARANGAY_OFFICIAL
            and target.role != User.Role.BARANGAY_OFFICIAL
            and not (request.user.is_staff or request.user.is_superuser)
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

        fields = []
        for field, value in serializer.validated_data.items():
            setattr(target, field, value)
            fields.append(field)

        # A resident or official has no responder unit; leaving a stale one would
        # keep them in dispatch candidate queries.
        if target.role != User.Role.FIRST_RESPONDER and target.responder_unit:
            target.responder_unit = ""
            fields.append("responder_unit")

        target.save(update_fields=[*dict.fromkeys(fields), "updated_at"])

        if target.role == User.Role.FIRST_RESPONDER:
            sync_responder_designation(target)

        create_audit_log(
            "account.staff_updated",
            actor=request.user,
            target_user=target,
            metadata={"fields": fields},
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

    @transaction.atomic
    def patch(self, request, pk):
        touch_last_seen(request.user)
        if not can_manage_accounts(request.user):
            return Response({"detail": "You do not have permission to update responders."}, status=status.HTTP_403_FORBIDDEN)
        User = get_user_model()
        responder = get_object_or_404(
            User.objects.select_for_update(),
            pk=pk,
            role=User.Role.FIRST_RESPONDER,
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
            and not (request.user.is_staff or request.user.is_superuser)
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
        preview = ensure_residence_proof_preview(proof)
        return FileResponse(preview.open("rb"), content_type="image/jpeg")
