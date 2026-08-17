import base64
import hashlib
import hmac
import json
import time

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.sms.gateway import SmsConfigurationError, SmsDeliveryError, send_ephemeral_sms


def _hook_key():
    secret = settings.SUPABASE_AUTH_HOOK_SECRET.strip()
    if secret.startswith("v1,"):
        secret = secret[3:]
    if secret.startswith("whsec_"):
        secret = secret[6:]
    if not secret:
        return None
    try:
        return base64.b64decode(secret, validate=True)
    except (ValueError, TypeError):
        return secret.encode("utf-8")


def verify_standard_webhook(request):
    hook_id = request.headers.get("webhook-id", "")
    timestamp = request.headers.get("webhook-timestamp", "")
    signature = request.headers.get("webhook-signature", "")
    key = _hook_key()
    try:
        sent_at = int(timestamp)
    except ValueError:
        return False
    if not key or not hook_id or not signature or abs(int(time.time()) - sent_at) > 300:
        return False

    signed = hook_id.encode() + b"." + timestamp.encode() + b"." + request.body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    candidates = []
    for item in signature.replace(" ", ",").split(","):
        item = item.strip()
        if item and item != "v1":
            candidates.append(item.removeprefix("v1="))
    return any(hmac.compare_digest(expected, candidate) for candidate in candidates)


class SupabaseSendSmsHookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def post(self, request):
        if not verify_standard_webhook(request):
            return Response({"detail": "Invalid hook signature."}, status=status.HTTP_401_UNAUTHORIZED)
        try:
            payload = json.loads(request.body)
            phone = payload["user"]["phone"]
            code = payload["sms"]["otp"]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return Response({"detail": "Invalid hook payload."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            send_ephemeral_sms(phone, f"Your E-Boses code is {code}. It expires in 5 minutes. Do not share it.")
        except (SmsConfigurationError, SmsDeliveryError):
            return Response({"detail": "SMS delivery failed."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({})
