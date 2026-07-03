from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import OTPChallenge, ResidenceProof
from apps.accounts.services import (
    create_otp_challenge,
    create_phone_otp_challenge,
    sha256_file,
    verify_otp_challenge,
    verify_phone_otp_challenge,
)


class AccountServiceTests(TestCase):
    def test_otp_verifies_both_channels_and_runs_system_verification(self):
        user = get_user_model().objects.create_user(
            email="otp@example.com",
            phone_number="+639191234567",
            password="Str0ng!Pass123",
        )
        proof_file = SimpleUploadedFile("proof.pdf", b"proof bytes", content_type="application/pdf")
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


class AuthAPITests(APITestCase):
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

    def test_full_registration_accepts_preverified_phone_code(self):
        phone_number = "+639231234567"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        proof = SimpleUploadedFile("proof.pdf", b"proof bytes", content_type="application/pdf")
        second_proof = SimpleUploadedFile("proof-2.pdf", b"second proof bytes", content_type="application/pdf")
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

    def test_registration_without_phone_otp_returns_400_not_500(self):
        proof = SimpleUploadedFile("proof.pdf", b"proof bytes", content_type="application/pdf")
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
        existing_file = SimpleUploadedFile("same.pdf", b"duplicate bytes", content_type="application/pdf")
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
        unique_file = SimpleUploadedFile("unique.pdf", b"unique bytes", content_type="application/pdf")
        duplicate_file = SimpleUploadedFile("same.pdf", b"duplicate bytes", content_type="application/pdf")

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
        first_file = SimpleUploadedFile("first.pdf", b"same upload bytes", content_type="application/pdf")
        second_file = SimpleUploadedFile("second.pdf", b"same upload bytes", content_type="application/pdf")

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

    def test_password_reset_request_returns_generic_response_for_unknown_email(self):
        response = self.client.post(
            "/api/auth/password-reset/request/",
            {"identifier": "unknown@example.com", "channel": "email"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

class AuthHardeningTests(APITestCase):
    def test_password_reset_request_uses_generic_response_for_unknown_identifier(self):
        response = self.client.post(
            "/api/auth/password-reset/request/",
            {"identifier": "unknown-generic@example.com", "channel": "email"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_password_policy_rejects_short_registration_password(self):
        phone_number = "+639261234567"
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        proof = SimpleUploadedFile("proof.pdf", b"proof bytes", content_type="application/pdf")

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
