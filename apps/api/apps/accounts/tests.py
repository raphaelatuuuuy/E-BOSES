from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

# Force DEBUG=True for all tests so DevelopmentOTPProvider works
DEBUG_ALL = override_settings(DEBUG=True)

from apps.accounts.models import OTPChallenge, PhoneOTPChallenge, ResidenceProof
from apps.accounts.serializers import RegisterSerializer
from apps.accounts.services import (
    create_otp_challenge,
    create_phone_otp_challenge,
    sha256_file,
    verify_otp_challenge,
    verify_phone_otp_challenge,
)

VALID_PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def pdf_upload(name="proof.pdf", content=VALID_PDF_BYTES):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


@DEBUG_ALL
class AccountServiceTests(TestCase):
    def test_otp_verifies_both_channels_and_runs_system_verification(self):
        user = get_user_model().objects.create_user(
            email="otp@example.com",
            phone_number="+639191234567",
            password="Str0ng!Pass123",
        )
        proof_file = pdf_upload("proof.pdf")
        digest = sha256_file(proof_file)
        ResidenceProof.objects.create(
            user=user,
            file=proof_file,
            original_filename="proof.pdf",
            mime_type="application/pdf",
            file_size=proof_file.size,
            sha256_hash=digest,
        )
        email_challenge, email_code = create_otp_challenge(user, "email", "registration", user.email)
        sms_challenge, sms_code = create_otp_challenge(user, "sms", "registration", user.phone_number)

        verify_otp_challenge(email_challenge, email_code)
        user.refresh_from_db()
        self.assertEqual(user.status, get_user_model().Status.PENDING_OTP)

        verify_otp_challenge(sms_challenge, sms_code)
        user.refresh_from_db()
        self.assertEqual(user.status, get_user_model().Status.VERIFIED)


@DEBUG_ALL
class AuthAPITests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_phone_otp_request_and_verify_endpoints_work_before_registration(self):
        request_response = self.client.post(
            "/api/auth/register/phone-otp/request/",
            {"phone_number": "+639231234567"},
            format="json",
        )

        self.assertEqual(request_response.status_code, status.HTTP_204_NO_CONTENT)

        verify_response = self.client.post(
            "/api/auth/register/phone-otp/verify/",
            {"phone_number": "+639231234567", "code": "000000"},
            format="json",
        )

        self.assertEqual(verify_response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_phone_otp_request_rejects_registered_phone_number(self):
        get_user_model().objects.create_user(
            email="registered-phone@example.com",
            phone_number="+639640746068",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )

        response = self.client.post(
            "/api/auth/register/phone-otp/request/",
            {"phone_number": "+639640746068"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["phone_number"][0], "An account with this phone number already exists.")

    def test_phone_otp_request_rejects_registered_phone_number_variant(self):
        get_user_model().objects.create_user(
            email="registered-phone-variant@example.com",
            phone_number="09640746068",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )

        response = self.client.post(
            "/api/auth/register/phone-otp/request/",
            {"phone_number": "+639640746068"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["phone_number"][0], "An account with this phone number already exists.")

    def test_full_registration_accepts_preverified_phone_code(self):
        phone_number = "+639231234567"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        proof = pdf_upload("proof.pdf")
        second_proof = pdf_upload("proof-2.pdf", VALID_PDF_BYTES + b"2")
        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "resident@example.com",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": [proof, second_proof],
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)
        self.assertIn("eboses_refresh_token", response.cookies)
        self.assertTrue(response.cookies["eboses_refresh_token"]["httponly"])
        user = get_user_model().objects.get(email="resident@example.com")
        self.assertEqual(user.status, get_user_model().Status.PENDING_OTP)
        self.assertIsNotNone(user.phone_verified_at)
        self.assertEqual(user.otp_challenges.count(), 1)
        self.assertEqual(user.otp_challenges.get().channel, "email")
        self.assertEqual(user.residence_proofs.count(), 2)

    def test_consumed_phone_otp_cannot_register_multiple_accounts(self):
        phone_number = "+639231234571"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)

        first_response = self.client.post(
            "/api/auth/register/",
            {
                "email": "first-consumed@example.com",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": SimpleUploadedFile("first-proof.pdf", b"%PDF-1.4\nfirst proof bytes\n%%EOF", content_type="application/pdf"),
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(first_response.status_code, status.HTTP_201_CREATED)
        challenge = PhoneOTPChallenge.objects.get(phone_number=phone_number)
        self.assertIsNotNone(challenge.consumed_at)

        second_response = self.client.post(
            "/api/auth/register/",
            {
                "email": "second-consumed@example.com",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Maria",
                "middle_name": "",
                "last_name": "Reyes",
                "date_of_birth": "1999-01-01",
                "address": "456 Barangay Street",
                "barangay": "Pending",
                "proof": pdf_upload("second-proof.pdf", VALID_PDF_BYTES + b"second"),
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(second_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(second_response.data["phone_number"][0], "An account with this phone number already exists.")
        self.assertFalse(get_user_model().objects.filter(email="second-consumed@example.com").exists())

    def test_registration_without_phone_otp_returns_400_not_500(self):
        proof = pdf_upload("proof.pdf")
        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "missing-phone-otp@example.com",
                "phone_number": "+639231234568",
                "phone_otp_code": "123456",
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": proof,
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["detail"], "No active phone OTP challenge.")

    def test_registration_duplicate_proof_returns_proof_field_error(self):
        existing = get_user_model().objects.create_user(
            email="existing@example.com",
            phone_number="+639231234560",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        existing_file = pdf_upload("same.pdf", VALID_PDF_BYTES + b"duplicate")
        digest = sha256_file(existing_file)
        ResidenceProof.objects.create(
            user=existing,
            file=existing_file,
            original_filename="same.pdf",
            mime_type="application/pdf",
            file_size=existing_file.size,
            sha256_hash=digest,
        )
        phone_number = "+639231234569"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        unique_file = pdf_upload("unique.pdf", VALID_PDF_BYTES + b"unique")
        duplicate_file = pdf_upload("same.pdf", VALID_PDF_BYTES + b"duplicate")

        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "duplicate-proof@example.com",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": [unique_file, duplicate_file],
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")
        self.assertFalse(get_user_model().objects.filter(email="duplicate-proof@example.com").exists())

    def test_registration_rejects_duplicate_files_in_same_upload(self):
        phone_number = "+639231234570"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        first_file = pdf_upload("first.pdf", VALID_PDF_BYTES + b"same")
        second_file = pdf_upload("second.pdf", VALID_PDF_BYTES + b"same")

        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "same-upload@example.com",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": [first_file, second_file],
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")
        self.assertFalse(get_user_model().objects.filter(email="same-upload@example.com").exists())

    def test_registration_proof_check_rejects_existing_duplicate(self):
        existing = get_user_model().objects.create_user(
            email="existing-proof-check@example.com",
            phone_number="+639231234572",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        existing_file = pdf_upload("existing.pdf", VALID_PDF_BYTES + b"proof-check")
        ResidenceProof.objects.create(
            user=existing,
            file=existing_file,
            original_filename="existing.pdf",
            mime_type="application/pdf",
            file_size=existing_file.size,
            sha256_hash=sha256_file(existing_file),
        )

        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": pdf_upload("duplicate.pdf", VALID_PDF_BYTES + b"proof-check")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")

    def test_registration_proof_check_rejects_duplicate_files_in_same_upload(self):
        response = self.client.post(
            "/api/auth/register/proof/check/",
            {
                "proof": [
                    pdf_upload("first.pdf", VALID_PDF_BYTES + b"same-check"),
                    pdf_upload("second.pdf", VALID_PDF_BYTES + b"same-check"),
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")

    def test_login_returns_tokens(self):
        get_user_model().objects.create_user(
            email="login@example.com",
            phone_number="+639241234567",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )

        response = self.client.post(
            "/api/auth/login/",
            {"identifier": "login@example.com", "password": "Str0ng!Pass123"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)
        self.assertIn("eboses_refresh_token", response.cookies)
        self.assertTrue(response.cookies["eboses_refresh_token"]["httponly"])

    def test_login_endpoint_is_throttled(self):
        responses = [
            self.client.post(
                "/api/auth/login/",
                {"identifier": "missing@example.com", "password": "Wrong!Pass123"},
                format="json",
            )
            for _ in range(6)
        ]

        for i in range(5):
            self.assertEqual(responses[i].status_code, status.HTTP_400_BAD_REQUEST, f"request {i} should reach validation")
        self.assertEqual(responses[5].status_code, status.HTTP_429_TOO_MANY_REQUESTS)


    def test_refresh_without_cookie_returns_204(self):
        rejected_response = self.client.post("/api/auth/refresh/", {}, format="json")
        self.assertEqual(rejected_response.status_code, status.HTTP_204_NO_CONTENT)

    def test_refresh_rotates_cookie_session_and_requires_csrf(self):
        get_user_model().objects.create_user(
            email="refresh@example.com",
            phone_number="+639261111111",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        client = APIClient(enforce_csrf_checks=True)
        login_response = client.post(
            "/api/auth/login/",
            {"identifier": "refresh@example.com", "password": "Str0ng!Pass123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

        rejected_response = client.post("/api/auth/refresh/", {}, format="json")
        self.assertEqual(rejected_response.status_code, status.HTTP_403_FORBIDDEN)

        csrf_response = client.get("/api/auth/csrf/")
        self.assertEqual(csrf_response.status_code, status.HTTP_200_OK)
        csrf_token = client.cookies["csrftoken"].value
        refresh_response = client.post(
            "/api/auth/refresh/",
            {},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(refresh_response.status_code, status.HTTP_200_OK)
        self.assertIn("access", refresh_response.data)
        self.assertNotIn("refresh", refresh_response.data)
        self.assertIn("eboses_refresh_token", refresh_response.cookies)

    def test_logout_clears_refresh_cookie_with_csrf(self):
        get_user_model().objects.create_user(
            email="logout@example.com",
            phone_number="+639262222222",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        client = APIClient(enforce_csrf_checks=True)
        login_response = client.post(
            "/api/auth/login/",
            {"identifier": "logout@example.com", "password": "Str0ng!Pass123"},
            format="json",
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        client.get("/api/auth/csrf/")

        logout_response = client.post(
            "/api/auth/logout/",
            {},
            format="json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )

        self.assertEqual(logout_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(logout_response.cookies["eboses_refresh_token"].value, "")

    def test_password_reset_request_generates_challenge(self):
        user = get_user_model().objects.create_user(
            email="reset@example.com",
            phone_number="+639251234567",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )

        response = self.client.post(
            "/api/auth/password-reset/request/",
            {"identifier": "reset@example.com", "channel": "email"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(
            OTPChallenge.objects.filter(
                user=user,
                channel="email",
                purpose="password_reset",
            ).exists()
        )

    def test_password_reset_request_rejects_unknown_email(self):
        response = self.client.post(
            "/api/auth/password-reset/request/",
            {"identifier": "unknown@example.com", "channel": "email"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["identifier"][0], "No account found with that email.")

@DEBUG_ALL
class AuthHardeningTests(APITestCase):
    def test_password_reset_request_rejects_unknown_identifier(self):
        response = self.client.post(
            "/api/auth/password-reset/request/",
            {"identifier": "unknown-generic@example.com", "channel": "email"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["identifier"][0], "No account found with that email.")

    def test_password_policy_rejects_short_registration_password(self):
        phone_number = "+639261234567"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        proof = pdf_upload("proof.pdf")

        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "weak@example.com",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "short123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": proof,
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.data)

    def test_registration_name_validation_allows_enye_and_rejects_special_characters(self):
        valid_data = {
            "email": "valid-name@example.com",
            "phone_number": "+639261234568",
            "phone_otp_code": "123456",
            "password": "Str0ng!Pass123",
            "first_name": "Niño",
            "middle_name": "De La",
            "last_name": "Peña",
            "date_of_birth": "1998-01-01",
            "address": "123 Barangay Street",
            "barangay": "Pending",
            "proof": pdf_upload("valid-name.pdf"),
            "terms_version": "2026-07-02",
            "privacy_version": "2026-07-02",
        }
        valid_serializer = RegisterSerializer(data=valid_data)
        self.assertTrue(valid_serializer.is_valid(), valid_serializer.errors)

        invalid_data = {
            **valid_data,
            "email": "invalid-name@example.com",
            "phone_number": "+639261234569",
            "first_name": "Ju@n",
            "proof": pdf_upload("invalid-name.pdf"),
        }
        invalid_serializer = RegisterSerializer(data=invalid_data)
        self.assertFalse(invalid_serializer.is_valid())
        self.assertEqual(invalid_serializer.errors["first_name"][0], "Use letters only, including Ñ/ñ.")

    def test_phone_otp_cannot_be_verified_twice(self):
        phone_number = "+639271234567"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)

        with self.assertRaisesMessage(Exception, "already been used"):
            verify_phone_otp_challenge(phone_number, phone_code)

    def test_registration_rejects_unsupported_proof_type(self):
        phone_number = "+639281234567"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        proof = SimpleUploadedFile("proof.exe", b"not allowed", content_type="application/octet-stream")

        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "bad-upload@example.com",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": proof,
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("proof", response.data)

    def test_login_writes_audit_log(self):
        user = get_user_model().objects.create_user(
            email="audit-login@example.com",
            phone_number="+639291234567",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )

        response = self.client.post(
            "/api/auth/login/",
            {"identifier": "audit-login@example.com", "password": "Str0ng!Pass123"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(user.audit_actions.filter(action="auth.login_success").exists())

    def test_role_specific_permissions(self):
        from apps.accounts.permissions import user_has_role_permission

        resident = get_user_model().objects.create_user(
            email="resident-perms@example.com",
            phone_number="+639301234567",
            password="Str0ng!Pass123",
            role=get_user_model().Role.RESIDENT,
        )
        official = get_user_model().objects.create_user(
            email="official-perms@example.com",
            phone_number="+639311234567",
            password="Str0ng!Pass123",
            role=get_user_model().Role.BARANGAY_OFFICIAL,
        )

        self.assertTrue(user_has_role_permission(resident, "concerns.create"))
        self.assertFalse(user_has_role_permission(resident, "accounts.create_staff"))
        self.assertTrue(user_has_role_permission(official, "accounts.create_staff"))


@DEBUG_ALL
class AccountSecurityTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_password_reset_request_rejects_unknown_account(self):
        get_user_model().objects.create_user(
            email="known-reset@example.com",
            phone_number="+639331234567",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )

        known_response = self.client.post(
            "/api/auth/password-reset/request/",
            {"identifier": "known-reset@example.com", "channel": "email"},
            format="json",
        )
        unknown_response = self.client.post(
            "/api/auth/password-reset/request/",
            {"identifier": "unknown-reset@example.com", "channel": "email"},
            format="json",
        )

        self.assertEqual(known_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(unknown_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(unknown_response.data["identifier"][0], "No account found with that email.")

    def test_phone_otp_request_is_throttled(self):
        """Production rate is 5/min — 6th request is throttled."""
        responses = [
            self.client.post(
                "/api/auth/register/phone-otp/request/",
                {"phone_number": f"+63934{index:07d}"},
                format="json",
            )
            for index in range(6)
        ]

        for i in range(5):
            self.assertEqual(responses[i].status_code, status.HTTP_204_NO_CONTENT, f"request {i} should succeed")
        self.assertEqual(responses[5].status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_backend_password_policy_requires_frontend_character_classes(self):
        weak_passwords = [
            "lowercase1!",
            "UPPERCASE1!",
            "NoNumber!",
            "NoSymbol1",
        ]

        for password in weak_passwords:
            with self.subTest(password=password):
                with self.assertRaises(DjangoValidationError):
                    validate_password(password)

        validate_password("Str0ng!Pass123")
