from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
import re

from .models import AccountRequest, OTPChallenge, ResidentSettings, User
from .services import (
    ALLOWED_PROOF_EXTENSIONS,
    ALLOWED_PROOF_MIME_TYPES,
    MAX_PROOF_FILE_SIZE,
    validate_residence_proof_file,
)

NAME_PATTERN = re.compile(r"^[A-Za-zÑñ ]+$")
NAME_MESSAGE = "Use letters only, including Ñ/ñ."
ALLOWED_AVATARS = {
    "",
    "young-man",
    "young-woman",
    "middleaged-man",
    "middleaged-woman",
    "senior-man",
    "senior-woman",
}


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
    gender = serializers.ChoiceField(choices=["male", "female", "prefer_not_to_say"], allow_blank=True, required=False)
    avatar = serializers.CharField(max_length=30, allow_blank=True, required=False)
    terms_version = serializers.CharField(max_length=32)
    privacy_version = serializers.CharField(max_length=32)
    proof_type = serializers.CharField(max_length=32, required=False)

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
    middleName = serializers.SerializerMethodField()
    lastName = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    barangay = serializers.SerializerMethodField()
    date_of_birth = serializers.SerializerMethodField()
    member_since = serializers.SerializerMethodField()
    gender = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()

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
            "responder_unit",
            "is_on_duty",
            "current_latitude",
            "current_longitude",
            "location_updated_at",
            "date_joined",
            "firstName",
            "middleName",
            "lastName",
            "full_name",
            "address",
            "barangay",
            "date_of_birth",
            "member_since",
            "gender",
            "avatar",
        )

    def profile(self, obj):
        return getattr(obj, "resident_profile", None)

    def get_firstName(self, obj):
        profile = self.profile(obj)
        return profile.first_name if profile else obj.first_name

    def get_middleName(self, obj):
        profile = self.profile(obj)
        return profile.middle_name if profile else ""

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

    def get_gender(self, obj):
        profile = self.profile(obj)
        return profile.gender if profile else ""

    def get_avatar(self, obj):
        profile = self.profile(obj)
        if profile and profile.avatar:
            return profile.avatar
        # Role-based avatar map
        role_prefix_map = {
            User.Role.BARANGAY_OFFICIAL: "official",
        }
        responder_unit_map = {
            User.ResponderUnit.TANOD: "tanod",
            User.ResponderUnit.BHW: "bhw",
            User.ResponderUnit.BDRRMO: "bdrmmo",
        }
        prefix = None
        if obj.role in role_prefix_map:
            prefix = role_prefix_map[obj.role]
        elif obj.role == User.Role.FIRST_RESPONDER and obj.responder_unit:
            prefix = responder_unit_map.get(obj.responder_unit)
        if prefix:
            gender = (profile.gender if profile else "") or ""
            if gender == "male":
                return f"{prefix}-male"
            if gender == "female":
                return f"{prefix}-female"
            return f"{prefix}-male"  # fallback when gender unknown
        # Resident default: compute from gender + age
        if profile and profile.gender and profile.gender != "prefer_not_to_say" and profile.date_of_birth:
            from datetime import date
            age = date.today().year - profile.date_of_birth.year
            if age >= 55:
                age_bucket = "senior"
            elif age >= 30:
                age_bucket = "middleaged"
            else:
                age_bucket = "young"
            icon_type = "man" if profile.gender == "male" else "woman"
            return f"{age_bucket}-{icon_type}"
        return ""


class UserProfileUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=50, required=False)
    middle_name = serializers.CharField(max_length=50, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=50, required=False)
    address = serializers.CharField(max_length=200, required=False)
    gender = serializers.ChoiceField(choices=["male", "female", "prefer_not_to_say"], allow_blank=True, required=False)
    avatar = serializers.CharField(max_length=30, allow_blank=True, required=False)

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

    def validate_avatar(self, value):
        if value not in ALLOWED_AVATARS:
            raise serializers.ValidationError("Choose a valid avatar.")
        return value

    def update(self, instance, validated_data):
        profile = instance.resident_profile
        for field, value in validated_data.items():
            setattr(profile, field, value)
        profile.save(update_fields=[*validated_data.keys(), "updated_at"])
        return instance


class ResidentSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResidentSettings
        fields = (
            "push_alerts",
            "report_updates",
            "community_sharing",
            "location_confirmation",
            "sos_placement",
            "updated_at",
        )
        read_only_fields = ("updated_at",)

class AccountRequestSerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)

    class Meta:
        model = AccountRequest
        fields = ("id", "user", "type", "status", "note", "staff_note", "created_at", "updated_at")
        read_only_fields = ("id", "user", "status", "staff_note", "created_at", "updated_at")

class AccountRequestReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            AccountRequest.Status.REVIEWED,
            AccountRequest.Status.COMPLETED,
            AccountRequest.Status.REJECTED,
        ]
    )
    staff_note = serializers.CharField(max_length=255, allow_blank=True, required=False)

class UserStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=User.Status.choices)

class ResponderUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=User.Status.choices, required=False)
    responder_unit = serializers.ChoiceField(choices=User.ResponderUnit.choices, allow_blank=True, required=False)
    is_on_duty = serializers.BooleanField(required=False)


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
