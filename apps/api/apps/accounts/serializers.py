from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
import re

from .models import OTPChallenge, User
from .services import (
    ALLOWED_PROOF_EXTENSIONS,
    ALLOWED_PROOF_MIME_TYPES,
    MAX_PROOF_FILE_SIZE,
    validate_residence_proof_file,
)

NAME_PATTERN = re.compile(r"^[A-Za-zÑñ ]+$")
NAME_MESSAGE = "Use letters only, including Ñ/ñ."


def phone_number_variants(value):
    digits = re.sub(r"\D", "", value)
    variants = {value}
    if digits.startswith("63") and len(digits) == 12:
        variants.update({f"+{digits}", digits, f"0{digits[2:]}"})
    elif digits.startswith("0") and len(digits) == 11:
        variants.update({digits, f"+63{digits[1:]}", f"63{digits[1:]}"})
    elif digits.startswith("9") and len(digits) == 10:
        variants.update({digits, f"+63{digits}", f"63{digits}", f"0{digits}"})
    return variants


def phone_number_exists(value):
    return get_user_model().objects.filter(phone_number__in=phone_number_variants(value)).exists()


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
    proof = serializers.FileField(
        allow_empty_file=False,
        validators=[validate_residence_proof_file],
        help_text=(
            "Residence proof upload. Allowed MIME types: "
            f"{', '.join(sorted(ALLOWED_PROOF_MIME_TYPES))}; allowed extensions: "
            f"{', '.join(sorted(ALLOWED_PROOF_EXTENSIONS))}; max size: {MAX_PROOF_FILE_SIZE} bytes."
        ),
    )
    terms_version = serializers.CharField(max_length=32)
    privacy_version = serializers.CharField(max_length=32)

    def validate_email(self, value):
        if get_user_model().objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_phone_number(self, value):
        if phone_number_exists(value):
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value

    def validate_first_name(self, value):
        return self.validate_name(value)

    def validate_middle_name(self, value):
        if value == "":
            return value
        return self.validate_name(value)

    def validate_last_name(self, value):
        return self.validate_name(value)

    def validate_name(self, value):
        if not NAME_PATTERN.fullmatch(value):
            raise serializers.ValidationError(NAME_MESSAGE)
        return value

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate_proof(self, value):
        return validate_residence_proof_file(value)


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
    firstName = serializers.SerializerMethodField()
    lastName = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    barangay = serializers.SerializerMethodField()
    date_of_birth = serializers.SerializerMethodField()
    member_since = serializers.SerializerMethodField()

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
            "last_seen_at",
            "is_onboarded",
            "date_joined",
            "firstName",
            "lastName",
            "full_name",
            "address",
            "barangay",
            "date_of_birth",
            "member_since",
        )

    def profile(self, obj):
        return getattr(obj, "resident_profile", None)

    def get_firstName(self, obj):
        profile = self.profile(obj)
        return profile.first_name if profile else obj.first_name

    def get_lastName(self, obj):
        profile = self.profile(obj)
        return profile.last_name if profile else obj.last_name

    def get_full_name(self, obj):
        return f"{self.get_firstName(obj)} {self.get_lastName(obj)}".strip() or obj.email

    def get_address(self, obj):
        profile = self.profile(obj)
        return profile.address if profile else ""

    def get_barangay(self, obj):
        profile = self.profile(obj)
        return profile.barangay if profile else ""

    def get_date_of_birth(self, obj):
        profile = self.profile(obj)
        return profile.date_of_birth if profile else None

    def get_member_since(self, obj):
        return obj.date_joined.strftime("%b %Y")


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
        if phone_number_exists(value):
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

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate_phone_number(self, value):
        if phone_number_exists(value):
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value

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

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value
