from rest_framework import serializers

from .services import MAX_HISTORY_TURNS, MAX_MESSAGE_LENGTH


class AssistantTurnSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["user", "assistant"])
    content = serializers.CharField(allow_blank=True, trim_whitespace=True)


class AssistantAskSerializer(serializers.Serializer):
    message = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=MAX_MESSAGE_LENGTH,
        trim_whitespace=True,
    )
    topic_id = serializers.CharField(
        required=False, allow_blank=True, max_length=64, trim_whitespace=True
    )
    history = AssistantTurnSerializer(many=True, required=False)
    session_id = serializers.CharField(
        required=False, allow_blank=True, max_length=64, trim_whitespace=True
    )

    def validate_history(self, value):
        return value[-MAX_HISTORY_TURNS:]

    def validate(self, attrs):
        if not attrs.get("message") and not attrs.get("topic_id"):
            raise serializers.ValidationError(
                {"message": "Send a message or choose a topic."}
            )
        return attrs
