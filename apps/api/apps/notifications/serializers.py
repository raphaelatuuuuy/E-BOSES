from rest_framework import serializers
from .models import DeviceToken, Notification, WitnessNotification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "recipient", "type", "title", "body", "data", "read_at", "created_at"]
        read_only_fields = ["recipient", "read_at", "created_at"]


class DeviceTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceToken
        fields = ["id", "token", "platform", "created_at", "last_seen_at"]
        read_only_fields = ["created_at", "last_seen_at"]


class WitnessNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = WitnessNotification
        fields = ["id", "alert", "resident", "sent_at", "delivery_status"]
