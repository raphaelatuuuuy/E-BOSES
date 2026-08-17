from rest_framework import serializers

from .models import BrowserPushSubscription, Notification


class NotificationSerializer(serializers.ModelSerializer):
    concern_id = serializers.IntegerField(source="concern.id", read_only=True)
    concern_public_id = serializers.SerializerMethodField()
    concern_title = serializers.CharField(source="concern.title", read_only=True)
    concern_status = serializers.CharField(source="concern.status", read_only=True)
    emergency_id = serializers.SerializerMethodField()
    emergency_public_id = serializers.SerializerMethodField()
    emergency_status = serializers.SerializerMethodField()
    safety_limited = serializers.SerializerMethodField()
    safety_guidance = serializers.SerializerMethodField()
    action_url = serializers.SerializerMethodField()
    display_title = serializers.SerializerMethodField()
    display_body = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()
    priority = serializers.SerializerMethodField()
    action_label = serializers.SerializerMethodField()
    tag = serializers.SerializerMethodField()
    icon_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    actions = serializers.SerializerMethodField()

    def _display_payload(self, obj):
        cached = getattr(obj, "_notification_display_payload", None)
        if cached is None:
            from .services import notification_display_payload

            cached = notification_display_payload(obj)
            setattr(obj, "_notification_display_payload", cached)
        return cached

    def get_action_url(self, obj):
        from .services import notification_url

        return notification_url(obj)

    def get_display_title(self, obj):
        return self._display_payload(obj).get("title", obj.title)

    def get_display_body(self, obj):
        return self._display_payload(obj).get("body", obj.body)

    def get_category(self, obj):
        return self._display_payload(obj).get("category", "report")

    def get_priority(self, obj):
        return self._display_payload(obj).get("priority", "normal")

    def get_action_label(self, obj):
        actions = self._display_payload(obj).get("actions") or []
        return actions[0].get("title") if actions else "Open"

    def get_tag(self, obj):
        return self._display_payload(obj).get("tag")

    def get_icon_url(self, obj):
        return self._display_payload(obj).get("icon")

    def get_image_url(self, obj):
        image = self._display_payload(obj).get("image")
        if not image:
            media = None
            if obj.concern_id:
                media = obj.concern.media.filter(public_visible=True).exclude(preview_file="").first()
            elif obj.emergency_id:
                media = obj.emergency.media.exclude(preview_file="").first()
            if media and media.preview_file:
                image = media.preview_file.url
        if image and image.startswith("/"):
            request = self.context.get("request")
            if request:
                image = request.build_absolute_uri(image)
        return image or None

    def get_actions(self, obj):
        return self._display_payload(obj).get("actions") or []

    def get_concern_public_id(self, obj):
        return str(obj.concern.public_id) if obj.concern_id else None

    def get_emergency_public_id(self, obj):
        if obj.type == Notification.Type.WITNESS_ALERT:
            return None
        return str(obj.emergency.public_id) if obj.emergency_id else None

    def get_emergency_id(self, obj):
        if obj.type == Notification.Type.WITNESS_ALERT:
            return None
        return obj.emergency_id

    def get_emergency_status(self, obj):
        if obj.type == Notification.Type.WITNESS_ALERT:
            return None
        return obj.emergency.status if obj.emergency_id else None

    def get_safety_limited(self, obj):
        return obj.type == Notification.Type.WITNESS_ALERT

    def get_safety_guidance(self, obj):
        if obj.type != Notification.Type.WITNESS_ALERT:
            return None
        return "Stay clear of the area and do not intervene. Call emergency services if you can do so safely."

    class Meta:
        model = Notification
        fields = [
            "id",
            "type",
            "title",
            "body",
            "is_read",
            "is_archived",
            "created_at",
            "concern_id",
            "concern_public_id",
            "concern_title",
            "concern_status",
            "emergency_id",
            "emergency_public_id",
            "emergency_status",
            "safety_limited",
            "safety_guidance",
            "action_url",
            "display_title",
            "display_body",
            "category",
            "priority",
            "action_label",
            "tag",
            "icon_url",
            "image_url",
            "actions",
        ]


class NotificationReadSerializer(serializers.Serializer):
    id = serializers.IntegerField()

class BrowserPushSubscriptionSerializer(serializers.Serializer):
    endpoint = serializers.URLField(max_length=500)
    keys = serializers.DictField(child=serializers.CharField(), write_only=True)

    def validate(self, attrs):
        keys = attrs.get("keys") or {}
        if not keys.get("p256dh") or not keys.get("auth"):
            raise serializers.ValidationError("Push subscription keys are required.")
        return attrs

    def save(self, **kwargs):
        request = self.context["request"]
        keys = self.validated_data["keys"]
        subscription, _ = BrowserPushSubscription.objects.update_or_create(
            endpoint=self.validated_data["endpoint"],
            defaults={
                "user": request.user,
                "p256dh": keys["p256dh"],
                "auth": keys["auth"],
                "user_agent": request.META.get("HTTP_USER_AGENT", ""),
                "is_active": True,
            },
        )
        return subscription
