from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import OTPChallenge, User


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    phone_number = serializers.RegexField(regex=r"^\+63\d{10}$")
    phone_otp_code = serializers.RegexField(regex=r"^\d{6}$", write_only=True)
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)
    first_name = serializers.CharField(max_length=50)
    middle_name = serializers.CharField(max_length=50, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=50)
    date_of_birth = serializers.DateField()
    address = serializers.CharField(max_length=200)
    barangay = serializers.CharField(max_length=120, required=False, default="Pending")
    proof = serializers.FileField()
    terms_version = serializers.CharField(max_length=32)
    privacy_version = serializers.CharField(max_length=32)

    def validate_email(self, value):
        if get_user_model().objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_phone_number(self, value):
        if get_user_model().objects.filter(phone_number=value).exists():
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value


class LoginSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        identifier = attrs["identifier"]
        password = attrs["password"]
        user = get_user_model().objects.filter(email=identifier).first()
        if user is None:
            user = get_user_model().objects.filter(phone_number=identifier).first()
        if user is None or not user.check_password(password):
            raise serializers.ValidationError("Invalid credentials.")
        if user.status == User.Status.SUSPENDED:
            raise serializers.ValidationError("This account is suspended.")
        attrs["user"] = user
        return attrs


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "phone_number",
            "role",
            "status",
            "is_staff",
            "is_superuser",
            "email_verified_at",
            "phone_verified_at",
        )


class OTPVerifySerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=OTPChallenge.Channel.choices)
    purpose = serializers.ChoiceField(choices=OTPChallenge.Purpose.choices)
    code = serializers.RegexField(regex=r"^\d{6}$")


class OTPResendSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=OTPChallenge.Channel.choices)
    purpose = serializers.ChoiceField(choices=OTPChallenge.Purpose.choices)


class PhoneOTPRequestSerializer(serializers.Serializer):
    phone_number = serializers.RegexField(regex=r"^\+63\d{10}$")

    def validate_phone_number(self, value):
        if get_user_model().objects.filter(phone_number=value).exists():
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value


class PhoneOTPVerifySerializer(serializers.Serializer):
    phone_number = serializers.RegexField(regex=r"^\+63\d{10}$")
    code = serializers.RegexField(regex=r"^\d{6}$")


class AdminCreateUserSerializer(serializers.Serializer):
    email = serializers.EmailField()
    phone_number = serializers.RegexField(regex=r"^\+63\d{10}$")
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)
    role = serializers.ChoiceField(
        choices=[
            (User.Role.BARANGAY_OFFICIAL, "Barangay Official"),
            (User.Role.FIRST_RESPONDER, "First Responder"),
        ]
    )

    def create(self, validated_data):
        return get_user_model().objects.create_user(
            **validated_data,
            status=User.Status.VERIFIED,
        )


class PasswordResetRequestSerializer(serializers.Serializer):
    identifier = serializers.CharField()
    channel = serializers.ChoiceField(choices=OTPChallenge.Channel.choices)


class PasswordResetVerifySerializer(serializers.Serializer):
    identifier = serializers.CharField()
    channel = serializers.ChoiceField(choices=OTPChallenge.Channel.choices)
    code = serializers.RegexField(regex=r"^\d{6}$")


class PasswordResetConfirmSerializer(serializers.Serializer):
    reset_token = serializers.CharField()
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)
