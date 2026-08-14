from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import knowledge, services
from .serializers import AssistantAskSerializer


class AssistantTopicsView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "assistant"

    def get(self, request):
        return Response(
            {"greeting": knowledge.GREETING, "topics": knowledge.opening_topics()}
        )


class AssistantAskView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "assistant"

    def post(self, request):
        serializer = AssistantAskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            answer = services.answer(
                message=data.get("message", ""),
                topic_id=data.get("topic_id", ""),
                history=data.get("history", []),
                session_id=data.get("session_id", ""),
            )
        except services.AssistantBudgetExceeded as exc:
            return Response(
                {"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        return Response(
            {
                "reply": answer.reply,
                "suggestions": answer.suggestions,
                "source": answer.source,
            }
        )
