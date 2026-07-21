from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
import re

from .models import AccountRequest, AuditLog, OTPChallenge, ResidentSettings, User
from .services import (
    ALLOWED_PROOF_EXTENSIONS,
    ALLOWED_PROOF_MIME_TYPES,
    MAX_PROOF_FILE_SIZE,
    validate_residence_proof_file_light,
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


class EmailAvailabilitySerializer(serializers.Serializer):
    email = serializers.EmailField()


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    email_otp_code = serializers.RegexField(regex=r"^\d{6}$", write_only=True)
    phone_number = serializers.RegexField(regex=r"^\+63\d{10}$")
    phone_otp_code = serializers.RegexField(regex=r"^\d{6}$", write_only=True)
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)
    first_name = serializers.CharField(max_length=50)
    middle_name = serializers.CharField(max_length=50, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=50)
    date_of_birth = serializers.DateField()
    address = serializers.CharField(max_length=200)
    barangay = serializers.CharField(max_length=120, required=False, default="Marikina Heights")
    proof = serializers.FileField(
        allow_empty_file=False,
        # Light check only — C2PA/authenticity already ran at /register/proof/check/
        validators=[validate_residence_proof_file_light],
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
        email = value.strip().lower()
        if get_user_model().objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

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
        return validate_residence_proof_file_light(value)


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
        # Suspended (self-deactivated) users may sign in to reactivate.
        # Rejected accounts stay blocked.
        if user.status == User.Status.REJECTED:
            raise serializers.ValidationError("This account was not approved.")
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
        # Root cause of UI "Pending": ResidentProfile.barangay defaults to "Pending"
        # (and may never be updated after registration). This product is scoped to
        # Marikina Heights — never surface the placeholder string to clients.
        profile = self.profile(obj)
        raw = (profile.barangay if profile else "") or ""
        raw = raw.strip()
        if not raw or raw.lower() == "pending":
            return "Marikina Heights"
        return raw

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

    def validate(self, attrs):
        if "is_on_duty" in attrs:
            raise serializers.ValidationError({
                "is_on_duty": "Responder availability is controlled by the Shift workflow."
            })
        return attrs


class SensitiveAccessAuditSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    subject = serializers.SerializerMethodField()
    resource_type = serializers.SerializerMethodField()
    resource_id = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ("id", "action", "actor", "subject", "resource_type", "resource_id", "created_at")

    def _person(self, user):
        if user is None:
            return None
        profile = getattr(user, "resident_profile", None)
        full_name = ""
        if profile:
            full_name = f"{profile.first_name} {profile.last_name}".strip()
        return {
            "id": user.pk,
            "email": user.email,
            "full_name": full_name or user.email,
            "role": user.role,
        }

    def get_actor(self, obj):
        return self._person(obj.actor)

    def get_subject(self, obj):
        return self._person(obj.target_user)

    def get_resource_type(self, obj):
        if obj.action == "media.raw_accessed":
            return str(obj.metadata.get("media_type") or "protected_media")
        if obj.action == "account.data_export_downloaded":
            return "account_data_export"
        return "restricted_record"

    def get_resource_id(self, obj):
        value = obj.metadata.get("object_id")
        if value is None:
            value = obj.metadata.get("request_id")
        return "" if value is None else str(value)


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


class EmailOTPRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        email = value.strip().lower()
        if get_user_model().objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email


class EmailOTPVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.RegexField(regex=r"^\d{6}$")

    def validate_email(self, value):
        return value.strip().lower()


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    stay_logged_in = serializers.BooleanField(required=False, default=True)

    def validate_new_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class AccountPhoneChangeRequestSerializer(serializers.Serializer):
    phone_number = serializers.RegexField(regex=r"^\+63\d{10}$")

    def validate_phone_number(self, value):
        user = self.context.get("user")
        qs = get_user_model().objects.filter(phone_number=value)
        if user is not None:
            qs = qs.exclude(pk=user.pk)
        if qs.exists():
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value


class AccountPhoneChangeVerifySerializer(serializers.Serializer):
    phone_number = serializers.RegexField(regex=r"^\+63\d{10}$")
    code = serializers.RegexField(regex=r"^\d{6}$")


class AccountEmailChangeRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        email = value.strip().lower()
        user = self.context.get("user")
        qs = get_user_model().objects.filter(email__iexact=email)
        if user is not None:
            qs = qs.exclude(pk=user.pk)
        if qs.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email


class AccountEmailChangeVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.RegexField(regex=r"^\d{6}$")

    def validate_email(self, value):
        return value.strip().lower()


class AccountNameChangeConfirmSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=50)
    middle_name = serializers.CharField(max_length=50, allow_blank=True, required=False, default="")
    last_name = serializers.CharField(max_length=50)
    ocr_first_name = serializers.CharField(max_length=80)
    ocr_middle_name = serializers.CharField(max_length=80, allow_blank=True, required=False, default="")
    ocr_last_name = serializers.CharField(max_length=80)

    def validate_first_name(self, value):
        if not NAME_PATTERN.fullmatch(value):
            raise serializers.ValidationError(NAME_MESSAGE)
        return value

    def validate_last_name(self, value):
        if not NAME_PATTERN.fullmatch(value):
            raise serializers.ValidationError(NAME_MESSAGE)
        return value

    def validate_middle_name(self, value):
        if value == "":
            return value
        if not NAME_PATTERN.fullmatch(value):
            raise serializers.ValidationError(NAME_MESSAGE)
        return value


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
    responder_unit = serializers.ChoiceField(
        choices=User.ResponderUnit.choices,
        allow_blank=True,
        required=False,
        default="",
    )

    def validate_email(self, value):
        email = value.strip().lower()
        if get_user_model().objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

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

    def validate(self, attrs):
        role = attrs.get("role")
        responder_unit = attrs.get("responder_unit", "")
        if role == User.Role.FIRST_RESPONDER and not responder_unit:
            raise serializers.ValidationError({"responder_unit": "Select the responder's operational unit."})
        if role != User.Role.FIRST_RESPONDER:
            attrs["responder_unit"] = ""
        return attrs

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
