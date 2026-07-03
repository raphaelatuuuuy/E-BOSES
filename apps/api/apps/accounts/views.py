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
from rest_framework_simplejwt.tokens import RefreshToken

from .models import OTPChallenge, ResidenceProof
from .permissions import IsStaffOrSuperuser
from .selectors import find_user_by_identifier, latest_active_otp_challenge
from .serializers import (
    AdminCreateUserSerializer,
    LoginSerializer,
    OTPResendSerializer,
    OTPVerifySerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PasswordResetVerifySerializer,
    PhoneOTPRequestSerializer,
    PhoneOTPVerifySerializer,
    RegisterSerializer,
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
    create_phone_otp_challenge,
    create_password_reset_token,
    read_password_reset_token,
    register_resident,
    verify_phone_otp_challenge,
    verify_otp_challenge,
)


def request_meta(request):
    return {
        "ip_address": request.META.get("REMOTE_ADDR"),
        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
    }


def token_response(user, response_status=status.HTTP_200_OK):
    refresh = RefreshToken.for_user(user)
    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSummarySerializer(user).data,
        },
        status=response_status,
    )


class RegisterView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = "auth"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated_data = dict(serializer.validated_data)
        validated_data["proof_files"] = request.FILES.getlist("proof") or [validated_data["proof"]]
        try:
            user = register_resident(validated_data, request_meta(request))
        except OTPVerificationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except (DuplicateProofError, ValidationError) as exc:
            return Response({"proof": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)
        return token_response(user, status.HTTP_201_CREATED)


class PhoneOTPRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "otp"

    def post(self, request):
        serializer = PhoneOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        create_phone_otp_challenge(serializer.validated_data["phone_number"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class PhoneOTPVerifyView(APIView):
    permission_classes = [AllowAny]
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


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        create_audit_log("auth.login_success", actor=user, target_user=user, request_meta=request_meta(request))
        return token_response(user)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
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
            return Response(status=status.HTTP_204_NO_CONTENT)
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
