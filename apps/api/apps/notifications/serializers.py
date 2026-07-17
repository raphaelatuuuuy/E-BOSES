from rest_framework import serializers

from .models import BrowserPushSubscription, Notification


class NotificationSerializer(serializers.ModelSerializer):
    concern_id = serializers.IntegerField(source="concern.id", read_only=True)
    concern_public_id = serializers.SerializerMethodField()
    concern_title = serializers.CharField(source="concern.title", read_only=True)
    concern_status = serializers.CharField(source="concern.status", read_only=True)
    emergency_id = serializers.IntegerField(source="emergency.id", read_only=True)
    emergency_public_id = serializers.SerializerMethodField()
    emergency_status = serializers.CharField(source="emergency.status", read_only=True)

    def get_concern_public_id(self, obj):
        return str(obj.concern.public_id) if obj.concern_id else None

    def get_emergency_public_id(self, obj):
        return str(obj.emergency.public_id) if obj.emergency_id else None

    class Meta:
        model = Notification
        fields = [
            "id",
            "type",
            "title",
            "body",
            "is_read",
            "created_at",
            "concern_id",
            "concern_public_id",
            "concern_title",
            "concern_status",
            "emergency_id",
            "emergency_public_id",
            "emergency_status",
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
