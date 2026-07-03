from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.core.signing import BadSignature, SignatureExpired
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import OTPChallenge
from .permissions import IsStaffOrSuperuser
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
        except DuplicateProofError as exc:
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
            challenge = OTPChallenge.objects.filter(
                user=request.user,
                channel=serializer.validated_data["channel"],
                purpose=serializer.validated_data["purpose"],
                verified_at__isnull=True,
            ).latest("created_at")
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


def find_user_by_identifier(identifier):
    return get_user_model().objects.filter(email=identifier).first() or get_user_model().objects.filter(phone_number=identifier).first()


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = find_user_by_identifier(serializer.validated_data["identifier"])
        if user is None:
            return Response(
                {"detail": "No account found with that email."},
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
            challenge = OTPChallenge.objects.filter(
                user=user,
                channel=serializer.validated_data["channel"],
                purpose=OTPChallenge.Purpose.PASSWORD_RESET,
                verified_at__isnull=True,
            ).latest("created_at")
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
