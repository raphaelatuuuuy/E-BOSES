import json
import re

from rest_framework import serializers

from apps.notifications.presence import is_user_online
from django.core.exceptions import ValidationError as DjangoValidationError

from apps.accounts.models import User
from apps.accounts.services import validate_concern_media_file, validate_icon_image_file, validate_public_image_file
from apps.capabilities import ALL_CAPABILITIES

from .models import (
    Announcement,
    BarangayEvent,
    ChatMessageRead,
    ChatTypingIndicator,
    Concern,
    ConcernAppeal,
    ConcernAssignment,
    ConcernAiAssessment,
    ConcernCategory,
    ConcernChatMessage,
    ConcernChatAttachment,
    ConcernClarification,
    ConcernComment,
    ConcernFormField,
    ConcernFormValue,
    ConcernOfficialRemark,
    ConcernResolutionEvidence,
    ConcernTimelineEntry,
    ContentFlag,
    ConcernMedia,
    ConcernStatusEvent,
    Department,
    DepartmentChatMessage,
    DepartmentChatThread,
    Designation,
    Position,
    RoutingRule,
)
from apps.geo_services import validate_report_location
from apps.media_urls import concern_media_preview_url


AREA_ADDRESS_SEGMENTS = {
    "marikina heights",
    "marist village",
    "marikina city",
    "marikina",
    "metro manila",
    "philippines",
}
MACHINE_ADDRESS_PREFIXES = (
    "sms fallback coordinates",
    "pinned coordinates",
    "pinned location",
    "pending",
)
COORDINATE_ADDRESS_RE = re.compile(r"-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}")
HOUSE_NUMBER_RE = re.compile(r"^[\d]+[A-Za-z]?(\s*[-/]\s*[\dA-Za-z]+)?\s+")


def public_street_address(address, barangay):
    """Street name plus barangay, with the house number dropped.

    The public feed must say where a concern was pinned without naming the
    house that reported it: "99 Champaca Street" becomes "Champaca Street,
    Marikina Heights".
    """
    barangay = (barangay or "").strip()
    area_segments = AREA_ADDRESS_SEGMENTS | ({barangay.casefold()} if barangay else set())
    value = (address or "").strip()
    lowered = value.lower()
    if (
        not value
        or COORDINATE_ADDRESS_RE.search(lowered)
        or lowered.startswith(MACHINE_ADDRESS_PREFIXES)
    ):
        return barangay

    street = ""
    for part in value.split(","):
        segment = part.strip().strip(",").strip()
        if not segment or segment.casefold() in area_segments:
            continue
        street = HOUSE_NUMBER_RE.sub("", segment).strip()
        break

    if not street:
        return barangay
    if not barangay or street.lower() == barangay.lower():
        return street
    return f"{street}, {barangay}"


class ConcernMediaUploadSerializer(serializers.Serializer):
    media = serializers.FileField(
        allow_empty_file=False,
        validators=[validate_concern_media_file],
    )

    def validate_media(self, value):
        return validate_concern_media_file(value)


class PublicUserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    initials = serializers.SerializerMethodField()
    is_online = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    # Street line only (first segment of residence address) for feed identity
    street = serializers.SerializerMethodField()
    barangay = serializers.SerializerMethodField()
    position = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "full_name",
            "initials",
            "role",
            "last_seen_at",
            "is_online",
            "avatar",
            "responder_unit",
            "is_on_duty",
            "street",
            "barangay",
            "position",
        )

    def get_full_name(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile:
            first_name = profile.first_name.strip()
            last_name = profile.last_name.strip()
            return f"{first_name} {last_name}".strip() if last_name else first_name
        account_name = obj.get_full_name().strip()
        if account_name:
            return account_name
        return (obj.email.split("@", 1)[0] or "E-Boses user").replace(".", " ")

    def get_initials(self, obj):
        parts = self.get_full_name(obj).split()
        if not parts:
            return "U"
        return f"{parts[0][:1]}{parts[-1][:1] if len(parts) > 1 else ''}".upper()

    def get_is_online(self, obj):
        return is_user_online(obj.pk)

    def get_street(self, obj):
        if self.context.get("privacy_safe"):
            return ""
        profile = getattr(obj, "resident_profile", None)
        if not profile or not (profile.address or "").strip():
            return ""
        # Prefer street line: "123 Champaca St, Marikina Heights, ..." → first segment
        street = profile.address.split(",")[0].strip()
        # Never surface placeholder defaults as a street label
        if street.lower() in {"pending", "n/a", "none", "null"}:
            return ""
        return street

    def get_barangay(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if not profile:
            return ""
        value = (profile.barangay or "").strip()
        # Model default is "Pending" until verification fills a real barangay
        if not value or value.lower() == "pending":
            return getattr(getattr(profile, "community", None), "name", "")
        return value

    def get_position(self, obj):
        """Return the configured staff position when it is available."""
        # Staff updates are shown in public timelines and feeds.  Officials
        # can have a configured designation too (for example, "Operations
        # Officer"), so do not drop their position while only checking the
        # legacy responder role.
        if getattr(obj, "role", None) not in {
            User.Role.FIRST_RESPONDER,
            User.Role.BARANGAY_OFFICIAL,
        }:
            return ""
        cache = getattr(obj, "_prefetched_objects_cache", {})
        designations = cache.get("designations")
        if designations is None:
            return ""
        active = [item for item in designations if getattr(item, "is_active", False)]
        active.sort(key=lambda item: (getattr(getattr(item, "department", None), "sort_order", 0), item.pk))
        if not active:
            return ""
        designation = active[0]
        position = getattr(designation, "position", None)
        if position and getattr(position, "name", ""):
            return position.name
        if getattr(designation, "title", ""):
            return designation.title
        department = getattr(designation, "department", None)
        return (department.short_name or department.name) if department else ""

    def get_avatar(self, obj):
        profile = getattr(obj, "resident_profile", None)
        if profile and profile.avatar:
            return profile.avatar
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
            return prefix
        return ""

class DepartmentSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()
    # Communities share unit names ("Environmental and Sanitation Committee"
    # exists in every barangay), so the Users screen needs the owning
    # community on each row to tell the duplicates apart.
    community_name = serializers.SerializerMethodField()

    def get_community_name(self, obj):
        community = getattr(obj, "community", None)
        return community.name if community else ""

    def get_member_count(self, obj):
        # Count over the prefetched relation when available; a chained
        # .filter().count() would bypass the cache with one query per row.
        designations = obj.designations.all()
        if hasattr(obj, "_prefetched_objects_cache") and "designations" in obj._prefetched_objects_cache:
            return sum(1 for item in designations if item.is_active)
        return designations.filter(is_active=True).count()

    class Meta:
        model = Department
        fields = (
            "id",
            "community",
            "community_name",
            "name",
            "code",
            "short_name",
            "description",
            "emergency_role",
            "sort_order",
            "is_active",
            # Emergency dispatch reads these; the Units screen edits them.
            "responds_to_emergencies",
            "emergency_types",
            "contact_number",
            "member_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "community", "community_name", "member_count", "created_at", "updated_at")

    def validate_emergency_types(self, value):
        from apps.emergencies.models import EmergencyCategory

        queryset = EmergencyCategory.objects.filter(is_active=True)
        community = getattr(self.instance, "community", None) or self.context.get("community")
        if community:
            queryset = queryset.filter(community=community)
        allowed = set(queryset.values_list("code", flat=True))
        invalid = [item for item in value if item not in allowed]
        if invalid:
            raise serializers.ValidationError(
                f"Unknown emergency type(s): {', '.join(sorted(invalid))}."
            )
        return value

    def validate(self, attrs):
        responds = attrs.get(
            "responds_to_emergencies",
            getattr(self.instance, "responds_to_emergencies", False),
        )
        types = attrs.get("emergency_types", getattr(self.instance, "emergency_types", None)) or []
        if responds and not types:
            raise serializers.ValidationError(
                {
                    "emergency_types": [
                        "Choose at least one emergency type, or this unit will never be dispatched to."
                    ]
                }
            )
        return attrs


class PositionSerializer(serializers.ModelSerializer):
    department_detail = DepartmentSerializer(source="department", read_only=True)

    class Meta:
        model = Position
        fields = (
            "id",
            "name",
            "code",
            "department",
            "department_detail",
            "permissions",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_permissions(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Permissions must be a list.")
        permissions = list(dict.fromkeys(value))
        invalid = sorted(set(permissions) - set(ALL_CAPABILITIES))
        if invalid:
            raise serializers.ValidationError(
                f"Unknown permission: {', '.join(invalid)}."
            )
        return permissions


class DesignationSerializer(serializers.ModelSerializer):
    user_detail = PublicUserSerializer(source="user", read_only=True)
    department_detail = DepartmentSerializer(source="department", read_only=True)
    position_detail = PositionSerializer(source="position", read_only=True)

    class Meta:
        model = Designation
        fields = ("id", "user", "department", "position", "title", "is_active", "user_detail", "department_detail", "position_detail", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs):
        # A position belongs to one unit; it may only be given to people in
        # that unit. Barangay-wide positions (department is None) stay
        # assignable anywhere for the RBAC catalog seeded in 0027.
        department = attrs.get("department", getattr(self.instance, "department", None))
        position = attrs.get("position", getattr(self.instance, "position", None))
        user = attrs.get("user", getattr(self.instance, "user", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        if user and user.role == User.Role.RESIDENT:
            raise serializers.ValidationError(
                {"user": "Residents cannot receive staff positions."}
            )
        if is_active and department and not department.is_active:
            raise serializers.ValidationError({"department": "Choose an active unit."})
        if is_active and position and not position.is_active:
            raise serializers.ValidationError({"position": "Choose an active position."})
        if department and position and position.department_id not in (None, department.pk):
            raise serializers.ValidationError(
                {"position": "This position does not belong to the selected unit."}
            )
        return attrs


class ConcernFormFieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernFormField
        fields = ("id", "category", "field_key", "label", "field_type", "is_required", "options", "sort_order", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ConcernCategorySerializer(serializers.ModelSerializer):
    department_detail = DepartmentSerializer(source="department", read_only=True)
    form_fields = ConcernFormFieldSerializer(many=True, read_only=True)
    icon_image_url = serializers.SerializerMethodField()

    class Meta:
        model = ConcernCategory
        fields = ("id", "name", "code", "description", "icon_key", "custom_icon_label", "icon_image", "icon_image_url", "department", "department_detail", "is_active", "photo_required", "description_required", "location_required", "public_feed_allowed", "form_fields", "created_at", "updated_at")
        read_only_fields = ("id", "icon_image_url", "created_at", "updated_at")

    def get_icon_image_url(self, obj):
        if not obj.icon_image:
            return ""
        request = self.context.get("request")
        return request.build_absolute_uri(obj.icon_image.url) if request else obj.icon_image.url

    def validate_icon_key(self, value):
        value = (value or "tag").strip()
        if not value:
            return "tag"
        return value[:48]

    def validate_icon_image(self, value):
        return validate_icon_image_file(value)


class RoutingRuleSerializer(serializers.ModelSerializer):
    category_detail = ConcernCategorySerializer(source="category", read_only=True)
    department_detail = DepartmentSerializer(source="department", read_only=True)

    class Meta:
        model = RoutingRule
        fields = ("id", "name", "category", "department", "priority", "is_active", "category_detail", "department_detail", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ConcernFormValueSerializer(serializers.ModelSerializer):
    field_key = serializers.CharField(source="field.field_key", read_only=True)
    label = serializers.CharField(source="field.label", read_only=True)

    class Meta:
        model = ConcernFormValue
        fields = ("id", "field", "field_key", "label", "value", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ConcernTimelineEntrySerializer(serializers.ModelSerializer):
    actor = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernTimelineEntry
        fields = ("id", "event_type", "status", "message", "actor", "visible_to_resident", "is_custom", "metadata", "created_at")
        read_only_fields = ("id", "actor", "created_at")


class ConcernTimelineEntryCreateSerializer(serializers.Serializer):
    event_type = serializers.ChoiceField(choices=ConcernTimelineEntry.EventType.choices, default=ConcernTimelineEntry.EventType.CUSTOM)
    status = serializers.CharField(max_length=32, allow_blank=True, required=False)
    message = serializers.CharField(max_length=2000)
    visible_to_resident = serializers.BooleanField(default=True, required=False)
    is_custom = serializers.BooleanField(default=True, required=False)
    metadata = serializers.JSONField(default=dict, required=False)


class ChatReadSerializer(serializers.Serializer):
    last_read_message_id = serializers.IntegerField(min_value=1)


class ChatTypingSerializer(serializers.Serializer):
    is_typing = serializers.BooleanField()


class DepartmentChatThreadSerializer(serializers.ModelSerializer):
    department_detail = DepartmentSerializer(source="department", read_only=True)
    created_by = PublicUserSerializer(read_only=True)

    class Meta:
        model = DepartmentChatThread
        fields = ("id", "department", "department_detail", "title", "created_by", "created_at", "updated_at")
        read_only_fields = ("id", "created_by", "created_at", "updated_at")


class DepartmentChatMessageSerializer(serializers.ModelSerializer):
    sender = PublicUserSerializer(read_only=True)

    class Meta:
        model = DepartmentChatMessage
        fields = ("id", "thread", "sender", "body", "created_at")
        read_only_fields = ("id", "sender", "created_at")



class ConcernMediaRedactionSerializer(serializers.Serializer):
    """One blur box, in normalised 0..1 coordinates.

    Normalised because the official draws on a scaled preview and the blur is
    applied to a different-sized render. Bounds are enforced here rather than in
    the view so a malformed box can never reach the renderer.
    """

    x = serializers.FloatField(min_value=0, max_value=1)
    y = serializers.FloatField(min_value=0, max_value=1)
    width = serializers.FloatField(min_value=0.005, max_value=1)
    height = serializers.FloatField(min_value=0.005, max_value=1)
    label = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["x"] + attrs["width"] > 1.001 or attrs["y"] + attrs["height"] > 1.001:
            raise serializers.ValidationError("The area must stay inside the photo.")
        return attrs


class ConcernMediaSerializer(serializers.ModelSerializer):
    preview_url = serializers.SerializerMethodField()
    raw_url = serializers.SerializerMethodField()
    redactions = serializers.SerializerMethodField()
    privacy_detected_classes = serializers.SerializerMethodField()

    class Meta:
        model = ConcernMedia
        fields = (
            "id",
            "original_filename",
            "mime_type",
            "file_size",
            "preview_url",
            "raw_url",
            "validation_status",
            "validation_detail",
            "privacy_state",
            "public_visible",
            "privacy_detected_classes",
            "redactions",
            "uploaded_at",
        )

    def get_privacy_detected_classes(self, obj):
        """What was actually blurred — "face", "license plate".

        Class names only, never coordinates. Withheld on the public feed: a
        passer-by has no reason to be told which photos contain a face.
        """
        if self.context.get("privacy_safe"):
            return []
        return list(obj.privacy_detected_classes or [])

    def get_preview_url(self, obj):
        from apps.media_urls import concern_media_preview_url

        return concern_media_preview_url(obj.pk)

    def get_raw_url(self, obj):
        if self.context.get("privacy_safe"):
            return ""
        path = f"/api/concerns/media/{obj.pk}/raw/"
        return path

    def get_redactions(self, obj):
        """Official-drawn boxes only, and only for officials.

        Residents have no use for them, and publishing the coordinates of a
        redaction to the people it is hiding information from would defeat it.
        SAM3 regions are never exposed at all — those are mask coordinates,
        which the official interface must not show either.
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return []
        from apps.community_access import concern_access_mode

        if concern_access_mode(user, obj.concern) != "operational":
            return []
        return [
            {
                "id": row.id,
                "x": row.x,
                "y": row.y,
                "width": row.width,
                "height": row.height,
            }
            for row in obj.redactions.all()
            if row.source == "official"
        ]


class ConcernResolutionEvidenceSerializer(serializers.ModelSerializer):
    uploaded_by = PublicUserSerializer(read_only=True)
    raw_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()

    class Meta:
        model = ConcernResolutionEvidence
        fields = (
            "id",
            "uploaded_by",
            "original_filename",
            "mime_type",
            "file_size",
            "note",
            "raw_url",
            "preview_url",
            "created_at",
        )

    def get_raw_url(self, obj):
        path = f"/api/concerns/resolution-evidence/{obj.pk}/raw/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path

    def get_preview_url(self, obj):
        if not self.context.get("public_resolution"):
            return ""
        path = f"/api/concerns/resolution-evidence/{obj.pk}/preview/"
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path


class ConcernStatusEventSerializer(serializers.ModelSerializer):
    actor = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernStatusEvent
        fields = ("id", "status", "note", "actor", "created_at")

class ConcernCommentSerializer(serializers.ModelSerializer):
    author = PublicUserSerializer(read_only=True)
    replies = serializers.SerializerMethodField()
    attachment = serializers.SerializerMethodField()

    class Meta:
        model = ConcernComment
        fields = (
            "id",
            "author",
            "parent",
            "body",
            "original_body",
            "is_edited",
            "created_at",
            "updated_at",
            "attachment",
            "replies",
        )

    def get_replies(self, obj):
        # One-level stack only: never nest replies under replies
        if obj.parent_id is not None:
            return []
        # .all() over the prefetched relation; chaining select_related here
        # would bypass the cache with one query per comment.
        return ConcernCommentSerializer(obj.replies.all(), many=True, context=self.context).data

    def get_attachment(self, obj):
        from .comment_media import serialize_public_comment_attachment

        return serialize_public_comment_attachment(getattr(obj, "attachment", None), self.context.get("request"))

class ConcernAiAssessmentSerializer(serializers.ModelSerializer):
    possible_duplicate = serializers.SerializerMethodField()
    duplicate_similarity = serializers.SerializerMethodField()
    duplicate_distance_meters = serializers.SerializerMethodField()
    duplicate_match = serializers.SerializerMethodField()

    text_assessment = serializers.SerializerMethodField()
    photo_assessment = serializers.SerializerMethodField()
    possible_categories = serializers.SerializerMethodField()
    suggested_category = serializers.SerializerMethodField()
    incident_timing = serializers.SerializerMethodField()
    current_danger = serializers.SerializerMethodField()

    class Meta:
        model = ConcernAiAssessment
        # `raw_result` is deliberately absent. It carries the provider name, the
        # fallback reason, and Gemma's unedited output — none of which belongs in
        # an official's browser. Everything the UI needs is a named field.
        fields = (
            "status",
            "detected_objects",
            "severity_estimate",
            "severity_reason",
            "nlp_validity",
            "nlp_confidence",
            "category_match",
            "image_review_succeeded",
            "evidence_relationship",
            "privacy_scan_required",
            "suspected_sensitive_classes",
            "missing_information",
            "recommended_action",
            "recommendation",
            "explanation",
            "text_assessment",
            "photo_assessment",
            "possible_categories",
            "suggested_category",
            "incident_timing",
            "current_danger",
            "flagged",
            "flag_reasons",
            "possible_duplicate",
            "duplicate_similarity",
            "duplicate_distance_meters",
            "duplicate_match",
            "updated_at",
        )

    def _review(self, obj):
        return (obj.raw_result or {}).get("review") or {}

    def get_text_assessment(self, obj):
        return self._review(obj).get("text_assessment") or ""

    def get_photo_assessment(self, obj):
        return self._review(obj).get("photo_assessment") or ""

    def get_possible_categories(self, obj):
        return self._review(obj).get("possible_categories") or []

    def get_suggested_category(self, obj):
        return (obj.raw_result or {}).get("suggested_category") or ""

    def get_incident_timing(self, obj):
        return self._review(obj).get("incident_timing") or "unclear"

    def get_current_danger(self, obj):
        return bool(self._review(obj).get("current_danger"))

    def _duplicate_payload(self, obj):
        return (obj.raw_result or {}).get("duplicate") or {}

    def get_possible_duplicate(self, obj):
        return bool(self._duplicate_payload(obj).get("possible_duplicate"))

    def get_duplicate_similarity(self, obj):
        return self._duplicate_payload(obj).get("similarity")

    def get_duplicate_distance_meters(self, obj):
        return self._duplicate_payload(obj).get("distance_meters")

    def get_duplicate_match(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        from apps.community_access import concern_access_mode

        # This serializer is nested under ConcernSerializer, so ``obj`` is
        # the AI assessment rather than the concern itself.  Passing the
        # assessment to the access helper crashes the resident feed as soon
        # as a concern has an AI result.
        concern = obj.concern
        if concern_access_mode(user, concern) != "operational":
            return None
        payload = self._duplicate_payload(obj)
        matched_id = payload.get("matched_concern_id")
        if not matched_id:
            return None
        match = Concern.objects.filter(pk=matched_id).only("id", "public_id", "title", "status", "tracking_number", "created_at").first()
        if not match:
            return None
        return {
            "id": match.pk,
            "public_id": str(match.public_id),
            "tracking_id": match.tracking_id,
            "title": match.title,
            "status": match.status,
        }


class ContentFlagSerializer(serializers.ModelSerializer):
    reporter = PublicUserSerializer(read_only=True)
    reporter_full_name = serializers.SerializerMethodField()
    comment = serializers.IntegerField(required=False, allow_null=True)
    target = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    llm_review = serializers.SerializerMethodField()

    class Meta:
        model = ContentFlag
        fields = (
            "id",
            "concern",
            "comment",
            "reporter",
            "reporter_full_name",
            "reason",
            "note",
            "status",
            "staff_note",
            "auto_moderated",
            "reviewed_by_name",
            "target",
            "llm_review",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "concern",
            "reporter",
            "status",
            "staff_note",
            "auto_moderated",
            "created_at",
            "updated_at",
        )

    def get_reviewed_by_name(self, obj):
        return self._content_author_name(obj.reviewed_by) if obj.reviewed_by_id else None

    def get_llm_review(self, obj):
        log = obj.llm_decision_logs.order_by("-created_at", "-id").first()
        if log is None:
            return None
        output = log.output_snapshot if isinstance(log.output_snapshot, dict) else {}
        return {
            "assessment": output.get("assessment", ""),
            "recommended_disposition": output.get("recommended_disposition", ""),
            "short_explanation": output.get("short_explanation", ""),
            "image_review": output.get("image_review"),
            "model_version": log.model_version,
            "created_at": log.created_at,
        }

    def get_reporter_full_name(self, obj):
        profile = getattr(obj.reporter, "resident_profile", None)
        if profile:
            return f"{profile.first_name.strip()} {profile.last_name.strip()}".strip()
        return obj.reporter.email.split("@", 1)[0].replace(".", " ")

    @staticmethod
    def _content_author_name(user):
        if not user:
            return ""
        profile = getattr(user, "resident_profile", None)
        if profile:
            name = f"{profile.first_name.strip()} {profile.last_name.strip()}".strip()
            if name:
                return name
        return user.email.split("@", 1)[0].replace(".", " ")

    @staticmethod
    def _excerpt(text):
        return (text or "").strip()[:160]

    def get_target(self, obj):
        """One shape for every `target_kind`, so the frontend never needs a
        per-row follow-up fetch to render a flag regardless of what it targets.
        """
        kind = obj.target_kind
        if kind == "announcement_comment":
            comment = obj.announcement_comment
            return {
                "kind": kind,
                "excerpt": self._excerpt(comment.body),
                "author_name": self._content_author_name(comment.author),
                "post_title": comment.announcement.title if comment.announcement_id else None,
            }
        if kind == "emergency_comment":
            comment = obj.emergency_comment
            alert = comment.alert
            return {
                "kind": kind,
                "excerpt": self._excerpt(comment.body),
                "author_name": self._content_author_name(comment.author),
                "post_title": f"{alert.get_type_display()} emergency" if alert else None,
            }
        if kind == "concern_comment":
            comment = obj.comment
            return {
                "kind": kind,
                "excerpt": self._excerpt(comment.body),
                "author_name": self._content_author_name(comment.author),
                "post_title": obj.concern.title if obj.concern_id else None,
            }
        concern = obj.concern
        if not concern:
            return {"kind": kind, "excerpt": "", "author_name": "", "post_title": None}
        return {
            "kind": kind,
            "excerpt": self._excerpt(f"{concern.title}\n{concern.description}"),
            "author_name": self._content_author_name(concern.reporter),
            "post_title": None,
        }


class ContentFlagReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            ContentFlag.Status.DISMISSED,
            ContentFlag.Status.TAKEN_DOWN,
        ]
    )
    staff_note = serializers.CharField(min_length=5, max_length=255, trim_whitespace=True)


class ConcernAssignmentSerializer(serializers.ModelSerializer):
    assignee = PublicUserSerializer(read_only=True)
    assigned_by = PublicUserSerializer(read_only=True)
    department = DepartmentSerializer(read_only=True)

    class Meta:
        model = ConcernAssignment
        fields = ("id", "assignee", "assigned_by", "department", "office", "note", "status", "created_at", "updated_at")

class ConcernClarificationSerializer(serializers.ModelSerializer):
    requested_by = PublicUserSerializer(read_only=True)
    responded_by = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernClarification
        fields = ("id", "requested_by", "request_text", "response_text", "responded_by", "status", "created_at", "responded_at")

class ConcernAppealSerializer(serializers.ModelSerializer):
    appellant = PublicUserSerializer(read_only=True)
    reviewed_by = PublicUserSerializer(read_only=True)
    concern_id = serializers.IntegerField(read_only=True)
    concern_title = serializers.CharField(source="concern.title", read_only=True)
    concern_status = serializers.CharField(source="concern.status", read_only=True)
    concern_tracking_id = serializers.SerializerMethodField()

    class Meta:
        model = ConcernAppeal
        fields = ("id", "concern_id", "concern_title", "concern_status", "concern_tracking_id", "appellant", "reason", "status", "decision_note", "reviewed_by", "created_at", "decided_at")

    def get_concern_tracking_id(self, obj):
        return obj.concern.tracking_id

class ConcernOfficialRemarkSerializer(serializers.ModelSerializer):
    author = PublicUserSerializer(read_only=True)

    class Meta:
        model = ConcernOfficialRemark
        fields = ("id", "author", "body", "visible_to_resident", "created_at")

class ConcernAssignSerializer(serializers.Serializer):
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    department_id = serializers.IntegerField(required=False, allow_null=True)
    office = serializers.CharField(max_length=120, allow_blank=True, required=False)
    note = serializers.CharField(max_length=255, allow_blank=True, required=False)

    def validate(self, attrs):
        if not attrs.get("assignee_id") and not (attrs.get("office") or "").strip():
            raise serializers.ValidationError("Choose an assignee or office.")
        return attrs

class ClarificationRequestSerializer(serializers.Serializer):
    request_text = serializers.CharField(max_length=500)

class ClarificationReplySerializer(serializers.Serializer):
    response_text = serializers.CharField(max_length=2000)

class ConcernAppealCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)

class ConcernAppealReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[ConcernAppeal.Status.APPROVED, ConcernAppeal.Status.DENIED])
    decision_note = serializers.CharField(max_length=255, allow_blank=True, required=False)

class ConcernOfficialRemarkCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000)
    visible_to_resident = serializers.BooleanField(required=False, default=True)


class ConcernChatMessageSerializer(serializers.ModelSerializer):
    sender = PublicUserSerializer(read_only=True)
    is_mine = serializers.SerializerMethodField()
    attachment = serializers.SerializerMethodField()
    delivery_state = serializers.SerializerMethodField()

    class Meta:
        model = ConcernChatMessage
        fields = ("id", "concern", "sender", "body", "attachment", "created_at", "is_mine", "delivery_state")
        read_only_fields = ("id", "concern", "sender", "created_at", "is_mine")

    def get_is_mine(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and obj.sender_id == user.pk)

    def get_delivery_state(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if ChatMessageRead.objects.filter(message=obj).exclude(user=user).exists():
            return "read"
        return "sent"

    def get_attachment(self, obj):
        attachment = getattr(obj, "attachment", None)
        if not attachment:
            return None
        path = f"/api/concerns/chat-media/{attachment.pk}/"
        request = self.context.get("request")
        return {
            "id": attachment.pk,
            "original_filename": attachment.original_filename,
            "mime_type": attachment.mime_type,
            "kind": attachment.kind,
            "file_size": attachment.file_size,
            "authenticity_status": attachment.authenticity_status,
            "authenticity_detail": attachment.authenticity_detail,
            "raw_url": request.build_absolute_uri(path) if request else path,
            "created_at": attachment.created_at,
        }


class ConcernChatCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000, trim_whitespace=True, allow_blank=True, required=False, default="")
    media = serializers.FileField(required=False, write_only=True, allow_empty_file=False)

    def validate_body(self, value):
        return (value or "").strip()


class ConcernSerializer(serializers.ModelSerializer):
    community = serializers.SerializerMethodField()
    reporter_community = serializers.SerializerMethodField()
    is_cross_community = serializers.SerializerMethodField()
    access_mode = serializers.SerializerMethodField()
    can_interact = serializers.SerializerMethodField()
    tracking_id = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()
    location_source = serializers.SerializerMethodField()
    location_accuracy = serializers.SerializerMethodField()
    reporter = serializers.SerializerMethodField()
    is_anonymous = serializers.BooleanField(read_only=True)
    # Unmasked reporter name for officials reviewing flagged content; the
    # public `reporter.full_name` stays first-name + last-initial for privacy.
    reporter_full_name = serializers.SerializerMethodField()
    media = ConcernMediaSerializer(many=True, read_only=True)
    status_events = serializers.SerializerMethodField()
    comments = serializers.SerializerMethodField()
    ai_assessment = ConcernAiAssessmentSerializer(read_only=True)
    assignments = serializers.SerializerMethodField()
    viewers = serializers.SerializerMethodField()
    category_ref = ConcernCategorySerializer(read_only=True)
    assigned_department = DepartmentSerializer(read_only=True)
    form_values = serializers.SerializerMethodField()
    timeline = serializers.SerializerMethodField()
    clarifications = serializers.SerializerMethodField()
    appeals = serializers.SerializerMethodField()
    official_remarks = serializers.SerializerMethodField()
    resolution_evidence = serializers.SerializerMethodField()
    conversation = serializers.SerializerMethodField()
    vote_count = serializers.IntegerField(read_only=True, default=0)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    upvoters = serializers.SerializerMethodField()
    # Severity band, derived from the AI assessment. Exposed so clients can
    # show it without recomputing, and so API ordering and UI ordering agree.
    severity = serializers.CharField(read_only=True, default="low")
    # Sortable priority (severity band first, then recency/support within the
    # band). Pure Python over annotated/prefetched relations — no queries for
    # unassessed rows, cache-backed config for assessed ones.
    priority_score = serializers.SerializerMethodField()
    # Coarse distance (meters) from the requesting viewer's own position to
    # this concern. Set by the feed view when the client passes its lat/lng;
    # it lets "nearby" ranking work without exposing the concern's exact
    # coordinates (which privacy_safe deliberately hides in feed responses).
    distance_meters = serializers.SerializerMethodField()
    user_vote = serializers.SerializerMethodField()
    community_incident = serializers.SerializerMethodField()
    recurrence_of = serializers.SerializerMethodField()
    also_reported_count = serializers.SerializerMethodField()

    def get_community_incident(self, obj):
        from .community_incident import build

        return build(obj, media_serializer=ConcernMediaSerializer, context=self.context)

    def get_recurrence_of(self, obj):
        previous = obj.recurrence_of
        if previous is None:
            return None
        return {
            "id": previous.pk,
            "tracking_id": previous.tracking_id,
            "status": previous.status,
        }

    def get_also_reported_count(self, obj):
        from .community_incident import group_members

        _, duplicates = group_members(obj)
        return len(duplicates)

    def get_upvoters(self, obj) -> list[str]:
        names = []
        # Sort the prefetched cache in Python: .order_by()[:3] would issue
        # one query per row and defeat decorate_concerns() prefetching.
        votes = list(obj.votes.all())
        votes.sort(key=lambda vote: (vote.created_at, vote.pk), reverse=True)
        for vote in votes[:3]:
            profile = getattr(vote.user, "resident_profile", None)
            if profile:
                names.append(f"{profile.first_name.strip()} {profile.last_name.strip()}".strip())
            else:
                names.append(vote.user.get_full_name() or vote.user.email.split("@", 1)[0])
        return names

    def get_priority_score(self, obj) -> int:
        from .severity import priority_score

        return priority_score(obj)

    class Meta:
        model = Concern
        fields = (
            "id",
            "public_id",
            "tracking_id",
            "validation_status",
            "validation_summary",
            "rejection_code",
            "status_version",
            "community",
            "reporter_community",
            "is_cross_community",
            "access_mode",
            "can_interact",
            "is_anonymous",
            "reporter",
            "reporter_full_name",
            "title",
            "description",
            "summary",
            "notification_subject",
            "category",
            "category_ref",
            "assigned_department",
            "form_values",
            "timeline",
            "status",
            "address",
            "latitude",
            "longitude",
            "location_source",
            "location_accuracy",
            "barangay",
            "update_text",
            "visibility",
            "official_title",
            "community_incident",
            "recurrence_of",
            "also_reported_count",
            "archived_at",
            "reopened_at",
            "reopen_count",
            "media",
            "status_events",
            "comments",
            "ai_assessment",
            "assignments",
            "viewers",
            "clarifications",
            "appeals",
            "official_remarks",
            "resolution_evidence",
            "conversation",
            "vote_count",
            "comment_count",
            "upvoters",
            "severity",
            "priority_score",
            "user_vote",
            "distance_meters",
            "created_at",
            "updated_at",
        )

    def is_privacy_safe(self):
        return bool(self.context.get("privacy_safe"))

    def _viewer(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def get_community(self, obj):
        from apps.community_access import community_summary

        return community_summary(obj.community)

    def get_reporter_community(self, obj):
        from apps.community_access import community_summary

        return community_summary(obj.reporter_community)

    def get_is_cross_community(self, obj):
        return bool(
            obj.community_id
            and obj.reporter_community_id
            and obj.community_id != obj.reporter_community_id
        )

    def get_access_mode(self, obj):
        from apps.community_access import concern_access_mode

        return concern_access_mode(self._viewer(), obj)

    def get_can_interact(self, obj):
        # Accepted community reports are public discussion threads, including
        # reports routed to a neighbouring community. Keep the access mode
        # metadata for operational decisions, but do not make cross-community
        # residents read-only in the feed.
        return self.get_access_mode(obj) is not None

    def get_user_vote(self, obj):
        return getattr(obj, "user_vote", 0)

    def _viewer_roles(self, obj):
        user = self._viewer()
        if not user or not user.is_authenticated:
            return False, False, False
        from apps.community_scope import community_ids_for_user

        is_official = bool(
            user.is_superuser
            or (
                user.role == User.Role.BARANGAY_OFFICIAL
                and obj.community_id in community_ids_for_user(user)
            )
        )
        is_owner = user.pk == obj.reporter_id
        # Iterate the prefetched relation — .filter().exists() would bypass
        # the prefetch cache and issue one query per concern row.
        is_assignee = any(
            assignment.assignee_id == user.pk
            and assignment.status == ConcernAssignment.Status.ACTIVE
            for assignment in obj.assignments.all()
        )
        return is_official, is_owner, is_assignee

    def _can_view_case(self, obj):
        if self.is_privacy_safe():
            return False
        return any(self._viewer_roles(obj))

    def _public_user(self, user):
        if not user:
            return None
        return PublicUserSerializer(user, context=self.context).data

    def _date(self, value):
        return serializers.DateTimeField().to_representation(value) if value else None

    def get_tracking_id(self, obj):
        return obj.tracking_id

    def get_reporter_full_name(self, obj):
        if obj.is_anonymous:
            return "Community Reporter"
        if self.is_privacy_safe():
            return PublicUserSerializer(obj.reporter, context=self.context).data.get("full_name", "")
        profile = getattr(obj.reporter, "resident_profile", None)
        if profile:
            return f"{profile.first_name.strip()} {profile.last_name.strip()}".strip()
        return obj.reporter.email.split("@", 1)[0].replace(".", " ")

    def get_reporter(self, obj):
        if obj.is_anonymous:
            return {
                "id": 0,
                "full_name": "Community Reporter",
                "initials": "CR",
                "role": User.Role.RESIDENT,
                "last_seen_at": None,
                "avatar": "",
                "responder_unit": "",
                "is_on_duty": False,
                "street": "",
                "barangay": "",
                "phone_number": "",
            }
        # The detail view is fetched by the officials handling the report and
        # by the reporter themselves, so the callback number is safe to include
        # here — but not in PublicUserSerializer, which also serializes feed
        # identity where other residents would see it.
        data = PublicUserSerializer(obj.reporter, context=self.context).data
        # Public/community serializers must not expose a resident's callback
        # number. Detail views for the owner or authorized staff still receive
        # it, while privacy-safe feed responses stay limited to the public
        # identity fields above.
        if not self.is_privacy_safe():
            data["phone_number"] = obj.reporter.phone_number
        return data

    def get_address(self, obj):
        if self.is_privacy_safe():
            return public_street_address(obj.address, obj.barangay)
        return obj.address

    def get_distance_meters(self, obj):
        # Attached by ConcernFeedView when the request includes lat/lng.
        # Rounded to 10 m so it cannot be used to triangulate a precise pin.
        value = getattr(obj, "distance_meters", None)
        return None if value is None else int(round(value / 10.0) * 10)

    def get_latitude(self, obj):
        if self.is_privacy_safe() or obj.latitude is None:
            return None
        return str(obj.latitude)

    def get_longitude(self, obj):
        if self.is_privacy_safe() or obj.longitude is None:
            return None
        return str(obj.longitude)

    def get_location_source(self, obj):
        if self.is_privacy_safe():
            return ""
        return obj.location_source

    def get_location_accuracy(self, obj):
        if self.is_privacy_safe():
            return None
        return obj.location_accuracy

    def get_status_events(self, obj):
        queryset = obj.status_events.all()
        if self._can_view_case(obj):
            return ConcernStatusEventSerializer(queryset, many=True, context=self.context).data
        return [
            {
                "id": event.pk,
                "status": event.status,
                "note": event.note if event.status == obj.status and event.status in {
                    Concern.Status.RESOLVED,
                    Concern.Status.REJECTED,
                } else "",
                "actor": self._public_user(event.actor)
                if event.status == obj.status and event.status in {
                    Concern.Status.RESOLVED,
                    Concern.Status.REJECTED,
                }
                else None,
                "created_at": self._date(event.created_at),
            }
            for event in queryset
        ]

    def get_comments(self, obj):
        # Python-filter over the prefetched relation; .filter() here would
        # bypass the prefetch cache with one query per concern.
        comments = [comment for comment in obj.comments.all() if comment.parent_id is None]
        return ConcernCommentSerializer(comments, many=True, context=self.context).data

    def get_form_values(self, obj):
        if not self._can_view_case(obj):
            return []
        return ConcernFormValueSerializer(obj.form_values.all(), many=True, context=self.context).data

    def get_timeline(self, obj):
        # Work over the prefetched list; chaining .filter()/.select_related()
        # on the manager would re-query per concern row.
        entries = sorted(obj.timeline_entries.all(), key=lambda entry: (entry.created_at, entry.pk))
        is_official, is_owner, is_assignee = self._viewer_roles(obj)
        if not (is_official or is_owner or is_assignee):
            entries = [entry for entry in entries if entry.visible_to_resident]
        return ConcernTimelineEntrySerializer(entries, many=True, context=self.context).data

    def get_assignments(self, obj):
        if not self._can_view_case(obj):
            return []
        assignments = sorted(obj.assignments.all(), key=lambda item: (-item.created_at.timestamp(), -item.pk))
        return ConcernAssignmentSerializer(assignments, many=True, context=self.context).data

    def get_viewers(self, obj):
        if not self._can_view_case(obj):
            return []
        views = sorted(obj.views.all(), key=lambda item: item.first_viewed_at)
        return [self._public_user(view.viewer) for view in views if view.viewer_id]

    def get_clarifications(self, obj):
        if not self._can_view_case(obj):
            return []
        # Iterate the prefetched relation — chaining .select_related() here
        # bypasses the cache and re-queries per concern row.
        rows = sorted(obj.clarifications.all(), key=lambda item: (item.created_at, item.pk))
        return ConcernClarificationSerializer(rows, many=True, context=self.context).data

    def get_appeals(self, obj):
        is_official, is_owner, _ = self._viewer_roles(obj)
        if self.is_privacy_safe() or not (is_official or is_owner):
            return []
        rows = sorted(obj.appeals.all(), key=lambda item: (item.created_at, item.pk))
        return ConcernAppealSerializer(rows, many=True, context=self.context).data

    def get_official_remarks(self, obj):
        is_official, is_owner, is_assignee = self._viewer_roles(obj)
        if self.is_privacy_safe() or not (is_official or is_owner or is_assignee):
            return []
        rows = list(obj.official_remarks.all())
        if not is_official:
            rows = [remark for remark in rows if remark.visible_to_resident]
        rows.sort(key=lambda item: (item.created_at, item.pk))
        return ConcernOfficialRemarkSerializer(rows, many=True, context=self.context).data

    def get_resolution_evidence(self, obj):
        if self.is_privacy_safe():
            if not (
                obj.visibility == Concern.Visibility.COMMUNITY
                and obj.validation_status == Concern.ValidationStatus.ACCEPTED
                and obj.status in {Concern.Status.RESOLVED, Concern.Status.REJECTED}
            ):
                return []
            return ConcernResolutionEvidenceSerializer(
                obj.resolution_evidence.all(),
                many=True,
                context={**self.context, "public_resolution": True},
            ).data
        if not self._can_view_case(obj):
            return []
        return ConcernResolutionEvidenceSerializer(obj.resolution_evidence.all(), many=True, context=self.context).data

    def get_conversation(self, obj):
        is_official, is_owner, is_assignee = self._viewer_roles(obj)
        if self.is_privacy_safe() or not (is_official or is_owner or is_assignee):
            return []

        items = []

        def add(*, item_id, kind, body, created_at, actor=None, visibility="participants", status="", attachments=None, metadata=None):
            if not created_at:
                return
            items.append({
                "id": item_id,
                "kind": kind,
                "body": body or "",
                "created_at": self._date(created_at),
                "actor": self._public_user(actor),
                "visibility": visibility,
                "status": status or "",
                "attachments": attachments or [],
                "metadata": metadata or {},
                "_sort_at": created_at,
            })

        for event in obj.status_events.all():
            add(
                item_id=f"status-{event.pk}",
                kind="status",
                body=event.note or event.get_status_display(),
                created_at=event.created_at,
                actor=event.actor,
                status=event.status,
                metadata={"phase": "status_change"},
            )

        assignments = sorted(obj.assignments.all(), key=lambda item: (item.created_at, item.pk))
        for assignment_index, assignment in enumerate(assignments):
            assignee_name = (
                self._public_user(assignment.assignee).get("full_name")
                if assignment.assignee
                else "the assigned response team"
            )
            assignment_context = " · ".join(
                part for part in (assignee_name, assignment.office.strip()) if part
            )
            assignment_verb = "Reassigned to" if assignment_index else "Assigned to"
            body = f"{assignment_verb} {assignment_context}."
            if assignment.note.strip():
                body = f"{body} {assignment.note.strip()}"
            add(
                item_id=f"assignment-{assignment.pk}-assigned",
                kind="assignment",
                body=body,
                created_at=assignment.created_at,
                actor=assignment.assigned_by,
                status=ConcernAssignment.Status.ACTIVE,
                metadata={
                    "phase": "assigned",
                    "assignment_id": assignment.pk,
                    "assignee_id": assignment.assignee_id,
                    "assignee_name": assignee_name,
                    "office": assignment.office,
                },
            )
            if assignment.status != ConcernAssignment.Status.ACTIVE:
                add(
                    item_id=f"assignment-{assignment.pk}-{assignment.status}",
                    kind="assignment",
                    body=f"Assignment for {assignment_context} was {assignment.get_status_display().lower()}.",
                    created_at=assignment.updated_at,
                    # The current schema records who opened the assignment but
                    # not who closed it. Do not attribute the closing action to
                    # the original assigning official.
                    actor=None,
                    status=assignment.status,
                    metadata={
                        "phase": assignment.status,
                        "assignment_id": assignment.pk,
                        "assignee_id": assignment.assignee_id,
                        "assignee_name": assignee_name,
                        "office": assignment.office,
                    },
                )

        messages = obj.chat_messages.all()
        for message in messages:
            serialized = ConcernChatMessageSerializer(message, context=self.context).data
            attachment = serialized.get("attachment")
            add(
                item_id=f"chat-{message.pk}",
                kind="chat",
                body=message.body,
                created_at=message.created_at,
                actor=message.sender,
                attachments=[attachment] if attachment else [],
                metadata={"phase": "message"},
            )

        clarifications = obj.clarifications.all()
        for clarification in clarifications:
            add(
                item_id=f"clarification-{clarification.pk}-request",
                kind="clarification",
                body=clarification.request_text,
                created_at=clarification.created_at,
                actor=clarification.requested_by,
                status=clarification.status,
                metadata={"phase": "request", "clarification_id": clarification.pk},
            )
            if clarification.response_text and clarification.responded_at:
                add(
                    item_id=f"clarification-{clarification.pk}-reply",
                    kind="clarification",
                    body=clarification.response_text,
                    created_at=clarification.responded_at,
                    actor=clarification.responded_by,
                    status=clarification.status,
                    metadata={"phase": "reply", "clarification_id": clarification.pk},
                )

        remarks = [remark for remark in obj.official_remarks.all()]
        if not is_official:
            remarks = [remark for remark in remarks if remark.visible_to_resident]
        for remark in remarks:
            add(
                item_id=f"official-remark-{remark.pk}",
                kind="official_remark",
                body=remark.body,
                created_at=remark.created_at,
                actor=remark.author,
                visibility="resident" if remark.visible_to_resident else "official",
                metadata={"visible_to_resident": remark.visible_to_resident},
            )

        if is_official or is_owner:
            appeals = obj.appeals.all()
            for appeal in appeals:
                add(
                    item_id=f"appeal-{appeal.pk}-submitted",
                    kind="appeal",
                    body=appeal.reason,
                    created_at=appeal.created_at,
                    actor=appeal.appellant,
                    visibility="resident",
                    status=appeal.status,
                    metadata={"phase": "submitted", "appeal_id": appeal.pk},
                )
                if appeal.decided_at:
                    add(
                        item_id=f"appeal-{appeal.pk}-decision",
                        kind="appeal",
                        body=appeal.decision_note or f"Appeal {appeal.get_status_display().lower()}.",
                        created_at=appeal.decided_at,
                        actor=appeal.reviewed_by,
                        visibility="resident",
                        status=appeal.status,
                        metadata={"phase": "decision", "appeal_id": appeal.pk},
                    )

        items.sort(key=lambda item: (item["_sort_at"], item["kind"], item["id"]))
        for item in items:
            item.pop("_sort_at", None)
        return items


class ConcernCreateSerializer(serializers.Serializer):
    client_request_id = serializers.UUIDField(required=False)
    title = serializers.CharField(max_length=160)
    description = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    category = serializers.CharField(required=False, allow_blank=True, max_length=80)
    category_id = serializers.IntegerField(required=False)
    dynamic_fields = serializers.JSONField(required=False, default=dict)
    visibility = serializers.ChoiceField(choices=Concern.Visibility.choices, default=Concern.Visibility.COMMUNITY)
    address = serializers.CharField(max_length=255, required=False, allow_blank=True)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7, required=False, allow_null=True)
    location_source = serializers.ChoiceField(choices=("gps", "manual_pin"), required=False, allow_blank=True)
    location_accuracy = serializers.FloatField(required=False, allow_null=True)
    duplicate_of = serializers.IntegerField(required=False, allow_null=True)
    recurrence_of = serializers.IntegerField(required=False, allow_null=True)
    # Kept as ignored legacy inputs so older clients can still submit a report.
    # Normal concerns never create EmergencyAlert records; only the explicit
    # SOS flow enters emergency tracking.
    emergency_type = serializers.CharField(max_length=80, required=False, allow_blank=True)
    auto_escalate = serializers.BooleanField(required=False, default=False)

    def validate_duplicate_of(self, value):
        if value and not Concern.objects.filter(pk=value).exists():
            raise serializers.ValidationError("The linked report does not exist.")
        return value

    def validate_recurrence_of(self, value):
        if value and not Concern.objects.filter(pk=value).exists():
            raise serializers.ValidationError("The linked report does not exist.")
        return value

    def validate_address(self, value: str) -> str:
        """Persist a human street line with the report — reject Lat/Lng placeholders."""
        text = (value or "").strip()
        if not text:
            raise serializers.ValidationError("Pin a location with a street name.")
        lower = text.lower()
        if lower in {"pending", "selected location", "finding street…", "finding street..."}:
            raise serializers.ValidationError("Pin a location with a street name.")
        if lower.startswith("lat ") or lower.startswith("lat:") or lower.startswith("lat,"):
            raise serializers.ValidationError("Pin a location with a street name.")
        # "14.65, 121.12" style
        if re.match(r"^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$", text):
            raise serializers.ValidationError("Pin a location with a street name.")
        return text[:255]

    def validate(self, attrs):
        if not attrs.get("category") and not attrs.get("category_id"):
            raise serializers.ValidationError({"category": "Choose a concern category."})
        dynamic_fields = attrs.get("dynamic_fields")
        if isinstance(dynamic_fields, str):
            import json
            try:
                attrs["dynamic_fields"] = json.loads(dynamic_fields or "{}")
            except ValueError as exc:
                raise serializers.ValidationError({"dynamic_fields": "Enter valid JSON."}) from exc
        if attrs.get("latitude") is not None and attrs.get("longitude") is not None:
            try:
                attrs["_location_review"] = validate_report_location(attrs["latitude"], attrs["longitude"])
            except DjangoValidationError as exc:
                request = self.context.get("request")
                profile = getattr(getattr(request, "user", None), "resident_profile", None)
                community_name = getattr(getattr(profile, "community", None), "name", "") or getattr(
                    profile, "barangay", ""
                )
                if community_name:
                    raise serializers.ValidationError(
                        f"Location is too far from Barangay {community_name}. Choose a place inside an active community."
                    ) from exc
                raise serializers.ValidationError(exc) from exc
        else:
            attrs["_location_review"] = {}
        return attrs


class GuestConcernCreateSerializer(serializers.Serializer):
    """The intentionally small public contract for an anonymous report."""

    description = serializers.CharField(max_length=4000, trim_whitespace=True)
    latitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    longitude = serializers.DecimalField(max_digits=10, decimal_places=7)
    address = serializers.CharField(max_length=255, trim_whitespace=True)
    location_source = serializers.ChoiceField(
        choices=("gps", "manual_pin"), required=False, allow_blank=True, default="manual_pin"
    )
    client_request_id = serializers.UUIDField(required=False)

    def validate_description(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Describe what happened.")
        return value

    def validate_address(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Pin a location with a street name.")
        lower = value.casefold()
        if (
            lower in {"pending", "selected location", "finding street…", "finding street..."}
            or lower.startswith(("lat ", "lat:", "lat,"))
            or re.match(r"^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$", value)
        ):
            raise serializers.ValidationError("Pin a location with a street name.")
        return value[:255]

    def validate_latitude(self, value):
        if not -90 <= value <= 90:
            raise serializers.ValidationError("Enter a valid latitude.")
        return value

    def validate_longitude(self, value):
        if not -180 <= value <= 180:
            raise serializers.ValidationError("Enter a valid longitude.")
        return value


class ConcernVoteSerializer(serializers.Serializer):
    value = serializers.IntegerField(min_value=0, max_value=1, default=1)


class ConcernCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    parent = serializers.IntegerField(required=False, allow_null=True)
    media = serializers.FileField(required=False, write_only=True, allow_empty_file=False)

    def validate(self, attrs):
        attrs["body"] = (attrs.get("body") or "").strip()
        if not attrs["body"] and not attrs.get("media"):
            raise serializers.ValidationError("Comment text or an image/video attachment is required.")
        return attrs


class ConcernStatusUpdateSerializer(serializers.Serializer):
    """One official decision, saved as one request.

    `category`, `department_id` and `internal_note` are optional companions to
    the status change rather than three separate endpoints, so pressing "Save
    update" produces one atomic change and one audit entry. Before this, a
    report filed under the wrong category could never be re-filed: routing ran
    once at submission and there was no way to correct it.

    `applied_ai_suggestion` records only that the official pressed Apply
    Suggestion beforehand. It changes nothing about what is saved — it is there
    so the audit log can distinguish an accepted recommendation from an
    independent decision that happened to agree with one.
    """

    status = serializers.ChoiceField(choices=Concern.Status.choices)
    note = serializers.CharField(max_length=255, allow_blank=True, required=False)
    status_version = serializers.IntegerField(min_value=0, required=False)
    category = serializers.CharField(max_length=32, required=False, allow_blank=True)
    department_id = serializers.IntegerField(required=False, allow_null=True)
    assignee_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
    )
    internal_note = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    applied_ai_suggestion = serializers.BooleanField(required=False, default=False)

    def validate_status(self, value):
        if value == Concern.Status.SUBMITTED:
            raise serializers.ValidationError("Use a progress, resolved, rejected, or appealed status.")
        return value

    def validate_category(self, value):
        if not value:
            return ""
        category_queryset = ConcernCategory.objects.filter(code=value, is_active=True)
        community = self.context.get("community")
        if community is None and getattr(self, "instance", None) is not None:
            community = getattr(self.instance, "community", None)
        if community is not None:
            category_queryset = category_queryset.filter(community=community)
        if not category_queryset.exists() and value not in Concern.Category.values:
            raise serializers.ValidationError("Choose a category the barangay currently uses.")
        return value


class ConcernCategoryMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernCategory
        fields = ("id", "name", "icon_key")


class ConcernListReporterSerializer(serializers.Serializer):
    full_name = serializers.SerializerMethodField()

    def get_full_name(self, obj) -> str:
        profile = getattr(obj, "resident_profile", None)
        if profile:
            return f"{profile.first_name.strip()} {profile.last_name.strip()}".strip()
        return obj.email.split("@", 1)[0].replace(".", " ")


class DepartmentMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ("id", "name", "code", "short_name", "description")


class ConcernFeedSerializer(ConcernSerializer):
    """Slim rows for the community feed (memory-bounded list endpoint).

    Drops the heavy nested collections (comments + replies, timeline, chat
    conversation, clarifications, appeals, official remarks, form values,
    viewers, assignments) which are only read on the detail view. Keeps
    everything feed cards render: media previews, AI status, reporter,
    routing, votes, severity/priority and resolution attribution.
    """

    class Meta(ConcernSerializer.Meta):
        fields = tuple(
            name
            for name in ConcernSerializer.Meta.fields
            if name
            not in {
                "comments",
                "timeline",
                "conversation",
                "clarifications",
                "appeals",
                "official_remarks",
                "form_values",
                "viewers",
                "assignments",
            }
        )

    def to_representation(self, instance):
        # Shape-compatibility: feed rows never load these collections (they
        # come from the detail view), but older clients index them directly.
        # Emit explicit empty arrays so no client can crash on a missing key.
        data = super().to_representation(instance)
        for name in (
            "comments",
            "timeline",
            "conversation",
            "clarifications",
            "appeals",
            "official_remarks",
            "form_values",
            "viewers",
            "assignments",
        ):
            data.setdefault(name, [])
        return data


class ConcernListSerializer(serializers.ModelSerializer):
    """Slim row payload for list endpoints.

    The full ConcernSerializer (timeline, chat, community incident, appeals,
    ...) is reserved for the detail view; list cards only render the summary
    fields below. The web app fetches /api/concerns/{id}/ when a row is opened.
    """

    reporter = serializers.SerializerMethodField()
    is_anonymous = serializers.BooleanField(read_only=True)
    category_ref = ConcernCategoryMiniSerializer(read_only=True)
    assigned_department = DepartmentMiniSerializer(read_only=True)
    tracking_id = serializers.CharField(read_only=True)
    first_photo = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    vote_count = serializers.IntegerField(read_only=True, default=0)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    also_reported_count = serializers.SerializerMethodField()
    upvoters = serializers.SerializerMethodField()
    severity = serializers.CharField(read_only=True, default="low")
    severity_assessed = serializers.BooleanField(read_only=True, default=False)
    severity_reason = serializers.SerializerMethodField()
    resolution_actor = serializers.SerializerMethodField()
    resolution_photo = serializers.SerializerMethodField()
    resolution_photo_count = serializers.SerializerMethodField()

    class Meta:
        model = Concern
        fields = (
            "id",
            "public_id",
            "tracking_id",
            "title",
            "description",
            "notification_subject",
            "category",
            "status",
            "update_text",
            "validation_status",
            "is_anonymous",
            "visibility",
            "barangay",
            "address",
            "created_at",
            "updated_at",
            "reporter",
            "category_ref",
            "assigned_department",
            "first_photo",
            "photo_count",
            "vote_count",
            "comment_count",
            "also_reported_count",
            "upvoters",
            "official_title",
            "summary",
            "severity",
            "severity_assessed",
            "severity_reason",
            "resolution_actor",
            "resolution_photo",
            "resolution_photo_count",
        )

    def get_reporter(self, obj):
        if obj.is_anonymous:
            return {"full_name": "Community Reporter"}
        return ConcernListReporterSerializer(obj.reporter, context=self.context).data

    def get_severity_reason(self, obj) -> str:
        assessment = getattr(obj, "ai_assessment", None)
        if not assessment or assessment.status != ConcernAiAssessment.Status.COMPLETED:
            return ""
        return assessment.severity_reason or ""

    def get_resolution_actor(self, obj):
        """Expose the staff member who closed a resolved row.

        List responses intentionally stay slim, but a resolved concern still
        needs the same attribution as its feed card. ``decorate_concerns``
        prefetches status events, evidence uploaders, and their designations,
        so this reads the cached relations without adding one query per row.
        """
        if obj.status != Concern.Status.RESOLVED:
            return None
        events = [
            event
            for event in obj.status_events.all()
            if event.status == Concern.Status.RESOLVED and event.actor_id
        ]
        event = max(events, key=lambda item: (item.created_at, item.pk), default=None)
        actor = event.actor if event else None
        if actor is None:
            evidence = sorted(
                [item for item in obj.resolution_evidence.all() if item.uploaded_by_id],
                key=lambda item: (item.created_at, item.pk),
                reverse=True,
            )
            actor = evidence[0].uploaded_by if evidence else None
        return PublicUserSerializer(actor, context=self.context).data if actor else None

    def get_first_photo(self, obj) -> str | None:
        media = next((m for m in obj.media.all()), None)
        return concern_media_preview_url(media.pk) if media else None

    def get_resolution_photo(self, obj) -> str | None:
        if obj.status != Concern.Status.RESOLVED:
            return None
        evidence = next(
            (item for item in obj.resolution_evidence.all() if item.mime_type.startswith("image/")),
            None,
        )
        return f"/api/concerns/resolution-evidence/{evidence.pk}/preview/" if evidence else None

    def get_resolution_photo_count(self, obj) -> int:
        if obj.status != Concern.Status.RESOLVED:
            return 0
        return sum(1 for item in obj.resolution_evidence.all() if item.mime_type.startswith("image/"))

    def get_photo_count(self, obj) -> int:
        return len(obj.media.all())

    def get_also_reported_count(self, obj) -> int:
        from .community_incident import group_members

        _, duplicates = group_members(obj)
        return len(duplicates)

    def get_upvoters(self, obj) -> list[str]:
        names = []
        # Sort the prefetched cache in Python: .order_by()[:3] would issue
        # one query per row and defeat decorate_concerns() prefetching.
        votes = list(obj.votes.all())
        votes.sort(key=lambda vote: (vote.created_at, vote.pk), reverse=True)
        for vote in votes[:3]:
            profile = getattr(vote.user, "resident_profile", None)
            if profile:
                names.append(f"{profile.first_name.strip()} {profile.last_name.strip()}".strip())
            else:
                names.append(vote.user.get_full_name() or vote.user.email.split("@", 1)[0])
        return names


class AnnouncementSerializer(serializers.ModelSerializer):
    date_label = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            "id",
            "title",
            "body",
            "llm_summary",
            "tag",
            "audience",
            "barangay",
            "urgency",
            "is_pinned",
            "is_published",
            "published_at",
            "starts_at",
            "expires_at",
            "notification_sent_at",
            "image",
            "image_url",
            "image_alt",
            "place_label",
            "latitude",
            "longitude",
            "affected_streets",
            "area_geometry",
            "date_label",
            "status_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at", "notification_sent_at", "image_url", "llm_summary")
        extra_kwargs = {"image": {"required": False, "write_only": True}}

    def to_internal_value(self, data):
        # Multipart uploads carry the area as JSON text, so decode it before the
        # JSONFields see it and store the raw string.
        area_fields = ("affected_streets", "area_geometry")
        if not any(isinstance(data.get(field), str) for field in area_fields):
            return super().to_internal_value(data)

        decoded = {key: data.get(key) for key in data}
        for field in area_fields:
            value = decoded.get(field)
            if not isinstance(value, str):
                continue
            try:
                decoded[field] = json.loads(value) if value else None
            except ValueError:
                raise serializers.ValidationError({field: "Must be valid JSON."})
        return super().to_internal_value(decoded)

    def validate_image(self, value):
        if not value:
            return value
        # Byte-signature + extension cross-check: the client-supplied
        # Content-Type alone is spoofable, and this file lands on public media.
        try:
            return validate_public_image_file(value)
        except DjangoValidationError as exc:
            detail = getattr(exc, "message_dict", None) or list(getattr(exc, "messages", None) or [str(exc)])
            raise serializers.ValidationError(detail[0] if len(detail) == 1 else detail)

    def validate(self, attrs):
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        expires_at = attrs.get("expires_at", getattr(self.instance, "expires_at", None))
        if starts_at and expires_at and expires_at <= starts_at:
            raise serializers.ValidationError({"expires_at": "Expiry must be after the scheduled start."})
        return attrs

    def get_date_label(self, obj):
        target = obj.starts_at or obj.published_at or obj.created_at
        return target.strftime("%b %d, %Y")

    def get_status_label(self, obj):
        from django.utils import timezone

        now = timezone.now()
        if not obj.is_published:
            return "draft"
        if obj.starts_at and obj.starts_at > now:
            return "scheduled"
        if obj.expires_at and obj.expires_at <= now:
            return "expired"
        return "published"

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get("request")
        url = obj.image.url
        return request.build_absolute_uri(url) if request else url


class BarangayEventSerializer(serializers.ModelSerializer):
    time_label = serializers.SerializerMethodField()

    class Meta:
        model = BarangayEvent
        fields = (
            "id",
            "title",
            "detail",
            "barangay",
            "starts_at",
            "ends_at",
            "is_published",
            "time_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def validate(self, attrs):
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError({"ends_at": "The event must end after it starts."})
        return attrs

    def get_time_label(self, obj):
        if not obj.starts_at:
            return ""
        return obj.starts_at.strftime("%I:%M %p").lstrip("0")


class ActiveResponderSerializer(PublicUserSerializer):
    class Meta(PublicUserSerializer.Meta):
        fields = PublicUserSerializer.Meta.fields + (
            "current_latitude",
            "current_longitude",
            "location_updated_at",
        )

    def get_fields(self):
        fields = super().get_fields()
        if not self.context.get("include_location", False):
            fields.pop("current_latitude", None)
            fields.pop("current_longitude", None)
            fields.pop("location_updated_at", None)
        return fields
