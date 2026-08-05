"""Registration OTP hardening.

Registration OTP verifies that a person controls a phone number. It is not part
of emergency handling and must never become part of it.
"""

import logging
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import PhoneOTPChallenge
from apps.accounts.services import (
    OTP_EXPIRY_MINUTES,
    OTPDeliveryError,
    OTPRateLimited,
    OTPVerificationError,
    create_phone_otp_challenge,
    verify_phone_otp_challenge,
)
from apps.sms.models import OutboundSmsMessage, SmsPurpose

NUMBER = "+639461230001"


@override_settings(OUTBOUND_SMS_DRIVER="console", CELERY_TASK_ALWAYS_EAGER=True)
class PhoneOtpSecurityTests(APITestCase):
    request_url = "/api/auth/register/phone-otp/request/"
    verify_url = "/api/auth/register/phone-otp/verify/"

    def issue(self, number=NUMBER):
        return create_phone_otp_challenge(number, enforce_rate_limit=False)

    # -- generation and storage ------------------------------------------

    def test_code_is_six_digits(self):
        _challenge, code = self.issue()
        self.assertRegex(code, r"^\d{6}$")

    def test_code_is_stored_hashed_not_in_plain_text(self):
        challenge, code = self.issue()
        self.assertNotIn(code, challenge.code_hash)
        self.assertTrue(len(challenge.code_hash) > 20)

    def test_expiry_is_five_minutes(self):
        challenge, _code = self.issue()
        remaining = (challenge.expires_at - timezone.now()).total_seconds()
        self.assertLessEqual(remaining, OTP_EXPIRY_MINUTES * 60 + 2)
        self.assertGreater(remaining, OTP_EXPIRY_MINUTES * 60 - 10)

    # -- verification ----------------------------------------------------

    def test_correct_code_verifies(self):
        _challenge, code = self.issue()
        challenge = verify_phone_otp_challenge(NUMBER, code)
        self.assertIsNotNone(challenge.verified_at)

    def test_wrong_code_is_rejected_and_counted(self):
        challenge, _code = self.issue()
        with self.assertRaises(OTPVerificationError):
            verify_phone_otp_challenge(NUMBER, "000000")
        challenge.refresh_from_db()
        self.assertEqual(challenge.attempts, 1)

    def test_attempts_are_capped(self):
        challenge, code = self.issue()
        for _ in range(challenge.max_attempts):
            with self.assertRaises(OTPVerificationError):
                verify_phone_otp_challenge(NUMBER, "000000")
        # Even the right code stops working once the cap is hit.
        with self.assertRaises(OTPVerificationError):
            verify_phone_otp_challenge(NUMBER, code)

    def test_expired_code_is_rejected(self):
        challenge, code = self.issue()
        challenge.expires_at = timezone.now() - timedelta(seconds=1)
        challenge.save(update_fields=["expires_at"])
        with self.assertRaises(OTPVerificationError):
            verify_phone_otp_challenge(NUMBER, code)

    def test_a_code_is_single_use(self):
        _challenge, code = self.issue()
        verify_phone_otp_challenge(NUMBER, code)
        with self.assertRaises(OTPVerificationError):
            verify_phone_otp_challenge(NUMBER, code)

    def test_resending_invalidates_the_previous_code(self):
        first_challenge, first_code = self.issue()
        _second_challenge, second_code = self.issue()

        first_challenge.refresh_from_db()
        self.assertIsNotNone(first_challenge.consumed_at)
        self.assertNotEqual(first_code, second_code)

        with self.assertRaises(OTPVerificationError):
            verify_phone_otp_challenge(NUMBER, first_code)
        self.assertIsNotNone(verify_phone_otp_challenge(NUMBER, second_code))

    # -- rate limiting ---------------------------------------------------

    def test_resend_cooldown_is_enforced_server_side(self):
        create_phone_otp_challenge(NUMBER)
        with self.assertRaises(OTPRateLimited) as ctx:
            create_phone_otp_challenge(NUMBER)
        self.assertGreater(ctx.exception.retry_after, 0)

    def test_hourly_cap_per_number(self):
        for _ in range(5):
            challenge, _code = self.issue()
            challenge.created_at = timezone.now() - timedelta(minutes=10)
            challenge.save(update_fields=["created_at"])
        with self.assertRaises(OTPRateLimited):
            create_phone_otp_challenge(NUMBER)

    def test_api_returns_429_with_retry_after(self):
        self.client.post(self.request_url, {"phone_number": NUMBER}, format="json")
        response = self.client.post(self.request_url, {"phone_number": NUMBER}, format="json")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertGreater(response.data["retry_after"], 0)

    # -- gateway ---------------------------------------------------------

    @override_settings(OUTBOUND_SMS_DRIVER="disabled", DEBUG=False, IS_LOCAL_DEVELOPMENT=False, IS_TEST_RUN=False)
    def test_a_down_gateway_never_silently_verifies(self):
        with self.assertRaises(OTPDeliveryError):
            create_phone_otp_challenge(NUMBER, enforce_rate_limit=False)
        self.assertFalse(PhoneOTPChallenge.objects.filter(phone_number=NUMBER).exists())

    @override_settings(OUTBOUND_SMS_DRIVER="disabled", DEBUG=False, IS_LOCAL_DEVELOPMENT=False, IS_TEST_RUN=False)
    def test_api_returns_503_when_the_gateway_is_unavailable(self):
        response = self.client.post(self.request_url, {"phone_number": NUMBER}, format="json")
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_the_message_is_composed_by_the_backend(self):
        self.issue()
        message = OutboundSmsMessage.objects.filter(purpose=SmsPurpose.OTP).latest("id")
        self.assertEqual(message.destination_last_four, NUMBER[-4:])

    # -- the code must not escape ----------------------------------------

    def test_the_code_is_never_persisted_on_the_outbound_record(self):
        _challenge, code = self.issue()
        for body in OutboundSmsMessage.objects.values_list("body", flat=True):
            self.assertNotIn(code, body)

    def test_the_api_response_never_carries_the_code(self):
        response = self.client.post(self.request_url, {"phone_number": NUMBER}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("debug_code", response.data)
        challenge = PhoneOTPChallenge.objects.filter(phone_number=NUMBER).latest("created_at")
        self.assertNotIn(challenge.code_hash, str(response.data))

    def test_no_plaintext_code_reaches_the_log(self):
        with self.assertLogs(level=logging.DEBUG) as captured:
            logging.getLogger("apps.accounts.services").debug("probe")
            _challenge, code = self.issue()
        for line in captured.output:
            self.assertNotIn(code, line)

    # -- separation from emergencies -------------------------------------

    def test_an_otp_challenge_is_not_linked_to_any_emergency(self):
        challenge, _code = self.issue()
        self.assertFalse(hasattr(challenge, "alert"))
        self.assertFalse(hasattr(challenge, "alert_id"))

    def test_an_otp_outbound_row_is_not_attached_to_an_emergency(self):
        self.issue()
        message = OutboundSmsMessage.objects.filter(purpose=SmsPurpose.OTP).latest("id")
        self.assertIsNone(message.alert_id)
