from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient, APITestCase
from io import BytesIO, StringIO

from PIL import Image, ImageDraw, ImageFilter, PngImagePlugin

# Force DEBUG=True for all tests so DevelopmentOTPProvider works
DEBUG_ALL = override_settings(DEBUG=True)

from apps.accounts.models import AccountRequest, OTPChallenge, PhoneOTPChallenge, ResidenceProof, ResidenceVerificationCase, ResidentProfile, ResidentSettings
from apps.accounts.serializers import RegisterSerializer
from apps.accounts.services import (
    create_email_otp_challenge,
    create_otp_challenge,
    create_phone_otp_challenge,
    sha256_file,
    verify_email_otp_challenge,
    verify_otp_challenge,
    verify_phone_otp_challenge,
)

VALID_PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def preverified_email_code(email):
    _, code = create_email_otp_challenge(email)
    verify_email_otp_challenge(email, code)
    return code


def proof_image_upload(name="proof.png", content=b"proof"):
    stem = name.rsplit(".", 1)[0]
    return readable_image_upload(f"{stem}.png", label=content.decode("latin-1", errors="ignore"))


def normalized_proof_image_upload(name="proof.png", content=b"proof"):
    from apps.accounts.services import validate_residence_proof_file

    return validate_residence_proof_file(proof_image_upload(name, content))


def image_upload(name="proof.png", *, size=(640, 400), color=(128, 128, 128), blur=False):
    image = Image.new("RGB", size, color)
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(radius=12))
    output = BytesIO()
    image.save(output, format="PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


def readable_image(name="proof.png", *, size=(640, 400), blur=False, label="E-BOSES PROOF 12345"):
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    seed = sum(label.encode("utf-8", errors="ignore"))
    for x in range(40, size[0] - 40, 80):
        for y in range(40, size[1] - 40, 80):
            fill = "black" if (x + y + seed) % 160 == 0 else "gray"
            draw.rectangle((x, y, x + 45, y + 45), fill=fill)
    draw.rectangle((40 + seed % 420, 260, 120 + seed % 420, 340), fill="black")
    draw.text((60, 20), label, fill="black")
    return image.filter(ImageFilter.GaussianBlur(radius=8)) if blur else image


def image_file(name, image):
    output = BytesIO()
    image.save(output, format="PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


def readable_image_upload(name="proof.png", *, size=(640, 400), blur=False, label="E-BOSES PROOF 12345"):
    return image_file(name, readable_image(size=size, blur=blur, label=label))


def cropped_readable_image_upload(name="crop.png", *, box=(0, 0, 320, 200), label="E-BOSES PROOF 12345"):
    return image_file(name, readable_image(label=label).crop(box))


def image_bytes(image, *, format="JPEG", quality=95, pnginfo=None):
    output = BytesIO()
    save_kwargs = {"format": format}
    if format == "JPEG":
        save_kwargs["quality"] = quality
    if pnginfo is not None:
        save_kwargs["pnginfo"] = pnginfo
    image.save(output, **save_kwargs)
    return output.getvalue()


def tampered_jpeg_bytes():
    base = readable_image().convert("RGB")
    base_bytes = BytesIO()
    base.save(base_bytes, format="JPEG", quality=50)
    base_bytes.seek(0)
    with Image.open(base_bytes) as compressed_base:
        base = compressed_base.convert("RGB")

    patch = Image.new("RGB", (220, 140), "white")
    draw = ImageDraw.Draw(patch)
    for x in range(0, 220, 4):
        draw.line((x, 0, 219 - x, 139), fill="black", width=1)
    draw.rectangle((20, 35, 200, 105), fill=(20, 20, 20))
    draw.text((42, 62), "EDITED NAME", fill="white")
    patch_bytes = image_bytes(patch, quality=95)
    with Image.open(BytesIO(patch_bytes)) as compressed_patch:
        base.paste(compressed_patch.convert("RGB"), (210, 120))
    return image_bytes(base, quality=95)


class ProductionHardeningTests(TestCase):
    def test_health_endpoint_is_public_and_reports_database(self):
        response = APIClient().get("/api/health/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["database"], "ok")

    def test_readiness_command_reports_without_strict_failure(self):
        output = StringIO()
        call_command("check_production_readiness", stdout=output)
        self.assertTrue(output.getvalue().strip())


@DEBUG_ALL
class AccountServiceTests(TestCase):
    def test_otp_verifies_both_channels_and_runs_system_verification(self):
        user = get_user_model().objects.create_user(
            email="otp@example.com",
            phone_number="+639191234567",
            password="Str0ng!Pass123",
        )
        proof_file = proof_image_upload("proof.png")
        digest = sha256_file(proof_file)
        ResidenceProof.objects.create(
            user=user,
            file=proof_file,
            original_filename="proof.png",
            mime_type="image/png",
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
        # OCR is deliberately asynchronous: completing both OTP channels only
        # queues the pinned verification case.  Provider failure or low
        # confidence must never reject a resident in this request.
        self.assertEqual(user.status, get_user_model().Status.PENDING_VERIFICATION)
        self.assertTrue(
            ResidenceVerificationCase.objects.filter(
                user=user,
                status__in=[
                    ResidenceVerificationCase.Status.QUEUED,
                    ResidenceVerificationCase.Status.MANUAL_REVIEW,
                ],
            ).exists()
        )

    def test_phash_blocks_file_returns_hashes_for_readable_image(self):
        from apps.accounts.services import phash_blocks_file

        upload = readable_image_upload("proof.png")
        content = upload.read()

        blocks = phash_blocks_file(content)

        self.assertTrue(blocks)
        self.assertLessEqual(len(blocks), 16)
        self.assertTrue(all(len(block) == 16 for block in blocks))

    def test_phash_blocks_file_returns_empty_for_invalid_image(self):
        from apps.accounts.services import phash_blocks_file

        self.assertEqual(phash_blocks_file(b"not an image"), [])

    def test_visual_tamper_forensics_allows_clean_readable_photo(self):
        from apps.accounts.media_forensics import visual_tamper_forensics

        content = image_bytes(readable_image().convert("RGB"), quality=95)

        self.assertIsNone(visual_tamper_forensics(content))

    def test_visual_tamper_forensics_rejects_composited_jpeg(self):
        from apps.accounts.media_forensics import VISUAL_TAMPER_MESSAGE, visual_tamper_forensics

        self.assertEqual(visual_tamper_forensics(tampered_jpeg_bytes()), VISUAL_TAMPER_MESSAGE)

    def test_visual_tamper_forensics_ignores_flat_image(self):
        from apps.accounts.media_forensics import visual_tamper_forensics

        content = image_bytes(Image.new("RGB", (640, 400), "gray"), quality=95)

        self.assertIsNone(visual_tamper_forensics(content))

    def test_normalize_uploaded_file_strips_png_metadata(self):
        from apps.accounts.services import normalize_uploaded_file

        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("Software", "NeutralCamera")
        uploaded = SimpleUploadedFile(
            "proof.png",
            image_bytes(readable_image().convert("RGB"), format="PNG", pnginfo=metadata),
            content_type="image/png",
        )

        normalized = normalize_uploaded_file(uploaded, content=uploaded.read(), detected_mime_type="image/png")
        normalized_content = normalized.read()

        self.assertNotIn(b"NeutralCamera", normalized_content)
        with Image.open(BytesIO(normalized_content)) as image:
            self.assertNotIn("Software", image.info)


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

        # Local/debug returns 200 with debug_code; production returns 204.
        self.assertIn(request_response.status_code, {status.HTTP_200_OK, status.HTTP_204_NO_CONTENT})

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
        email = "resident@example.com"
        email_code = preverified_email_code(email)
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        proof = proof_image_upload("proof.png")
        second_proof = proof_image_upload("proof-2.png", VALID_PDF_BYTES + b"2")
        response = self.client.post(
            "/api/auth/register/",
            {
                "email": email,
                "email_otp_code": email_code,
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
        user = get_user_model().objects.get(email=email)
        self.assertEqual(user.status, get_user_model().Status.PENDING_VERIFICATION)
        self.assertIsNotNone(user.email_verified_at)
        self.assertIsNotNone(user.phone_verified_at)
        self.assertEqual(user.otp_challenges.count(), 0)
        self.assertEqual(user.residence_proofs.count(), 2)
        self.assertTrue(all(proof.phash_blocks for proof in user.residence_proofs.all()))

    def test_consumed_phone_otp_cannot_register_multiple_accounts(self):
        phone_number = "+639231234571"
        first_email = "first-consumed@example.com"
        email_code = preverified_email_code(first_email)
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)

        first_response = self.client.post(
            "/api/auth/register/",
            {
                "email": first_email,
                "email_otp_code": email_code,
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": proof_image_upload("first-proof.png", b"first proof bytes"),
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
                "email_otp_code": "123456",
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Maria",
                "middle_name": "",
                "last_name": "Reyes",
                "date_of_birth": "1999-01-01",
                "address": "456 Barangay Street",
                "barangay": "Pending",
                "proof": proof_image_upload("second-proof.png", VALID_PDF_BYTES + b"second"),
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(second_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(second_response.data["phone_number"][0], "An account with this phone number already exists.")
        self.assertFalse(get_user_model().objects.filter(email="second-consumed@example.com").exists())

    def test_registration_without_phone_otp_returns_400_not_500(self):
        email = "missing-phone-otp@example.com"
        email_code = preverified_email_code(email)
        proof = proof_image_upload("proof.png")
        response = self.client.post(
            "/api/auth/register/",
            {
                "email": email,
                "email_otp_code": email_code,
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
        existing_file = normalized_proof_image_upload("same.png", VALID_PDF_BYTES + b"duplicate")
        digest = sha256_file(existing_file)
        ResidenceProof.objects.create(
            user=existing,
            file=existing_file,
            original_filename="same.png",
            mime_type="image/png",
            file_size=existing_file.size,
            sha256_hash=digest,
        )
        phone_number = "+639231234569"
        email = "duplicate-proof@example.com"
        email_code = preverified_email_code(email)
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        unique_file = proof_image_upload("unique.png", VALID_PDF_BYTES + b"unique")
        duplicate_file = proof_image_upload("same.png", VALID_PDF_BYTES + b"duplicate")

        response = self.client.post(
            "/api/auth/register/",
            {
                "email": email,
                "email_otp_code": email_code,
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
        email = "same-upload@example.com"
        email_code = preverified_email_code(email)
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)
        first_file = proof_image_upload("first.png", VALID_PDF_BYTES + b"same")
        second_file = proof_image_upload("second.png", VALID_PDF_BYTES + b"same")

        response = self.client.post(
            "/api/auth/register/",
            {
                "email": email,
                "email_otp_code": email_code,
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

    def test_registration_proof_check_rejects_pdf(self):
        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": SimpleUploadedFile("proof.pdf", VALID_PDF_BYTES, content_type="application/pdf")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("JPG", response.data["proof"][0])

    def test_registration_proof_check_rejects_existing_duplicate(self):
        from apps.accounts.services import phash_file

        existing = get_user_model().objects.create_user(
            email="existing-proof-check@example.com",
            phone_number="+639231234572",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        # Same visual seed as the upload below so pHash matches even if re-encoded.
        label = "DUPLICATE-PROOF-CHECK-SEED"
        existing_upload = readable_image_upload("existing.png", label=label)
        existing_bytes = existing_upload.read()
        existing_upload.seek(0)
        ResidenceProof.objects.create(
            user=existing,
            file=existing_upload,
            original_filename="existing.png",
            mime_type="image/png",
            file_size=len(existing_bytes),
            sha256_hash=sha256_file(existing_upload),
            phash=phash_file(existing_bytes),
        )

        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": readable_image_upload("duplicate.png", label=label)},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")
    def test_registration_proof_check_rejects_duplicate_files_in_same_upload(self):
        response = self.client.post(
            "/api/auth/register/proof/check/",
            {
                "proof": [
                    proof_image_upload("first.png", VALID_PDF_BYTES + b"same-check"),
                    proof_image_upload("second.png", VALID_PDF_BYTES + b"same-check"),
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")

    def test_registration_proof_check_rejects_tiny_image(self):
        # Soft quality only rejects below ~120×80 (strict 300×200 no longer used on preflight).
        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": image_upload("tiny.png", size=(80, 60))},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("too small", response.data["proof"][0].lower())

    def test_registration_proof_check_rejects_blank_flat_image(self):
        """Soft quality rejects blank/solid frames (no Laplacian blur gate)."""
        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": image_upload("flat.png")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("no visible detail", response.data["proof"][0].lower())

    def test_registration_proof_check_allows_slightly_blurry_image(self):
        """Soft preflight does not reject moderate blur (phone photos)."""
        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": readable_image_upload("blurred.png", blur=True)},
            format="multipart",
        )

        # Soft quality: blur alone must not reject (200/204 OK, or other non-blur errors).
        self.assertNotEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        if hasattr(response, "data") and response.data:
            self.assertNotIn("too blurry", str(response.data).lower())
    def test_registration_proof_check_rejects_visual_tamper(self):
        from apps.accounts.media_forensics import VISUAL_TAMPER_MESSAGE

        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": SimpleUploadedFile("tampered.jpg", tampered_jpeg_bytes(), content_type="image/jpeg")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], VISUAL_TAMPER_MESSAGE)

    def test_registration_proof_check_rejects_existing_phash_duplicate(self):
        from apps.accounts.services import phash_file

        existing = get_user_model().objects.create_user(
            email="existing-phash@example.com",
            phone_number="+639231234573",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        existing_file = readable_image_upload("existing.png")
        existing_content = existing_file.read()
        existing_file.seek(0)
        ResidenceProof.objects.create(
            user=existing,
            file=existing_file,
            original_filename="existing.png",
            mime_type="image/png",
            file_size=existing_file.size,
            sha256_hash=sha256_file(existing_file),
            phash=phash_file(existing_content),
        )

        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": readable_image_upload("similar.png")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")

    def test_registration_proof_check_rejects_existing_block_phash_crop_duplicate(self):
        from apps.accounts.services import phash_blocks_file, phash_file

        existing = get_user_model().objects.create_user(
            email="existing-block-phash@example.com",
            phone_number="+639231234574",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        existing_file = readable_image_upload("existing-block.png")
        existing_content = existing_file.read()
        existing_file.seek(0)
        ResidenceProof.objects.create(
            user=existing,
            file=existing_file,
            original_filename="existing-block.png",
            mime_type="image/png",
            file_size=existing_file.size,
            sha256_hash=sha256_file(existing_file),
            phash=phash_file(existing_content),
            phash_blocks=phash_blocks_file(existing_content),
        )

        response = self.client.post(
            "/api/auth/register/proof/check/",
            {"proof": cropped_readable_image_upload("crop.png")},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")

    def test_registration_rejects_block_phash_duplicate_files_in_same_upload(self):
        phone_number = "+639231234575"
        email = "same-block-upload@example.com"
        email_code = preverified_email_code(email)
        _, phone_code = create_phone_otp_challenge(phone_number)
        verify_phone_otp_challenge(phone_number, phone_code)

        response = self.client.post(
            "/api/auth/register/",
            {
                "email": email,
                "email_otp_code": email_code,
                "phone_number": phone_number,
                "phone_otp_code": phone_code,
                "password": "Str0ng!Pass123",
                "first_name": "Juan",
                "middle_name": "",
                "last_name": "Santos",
                "date_of_birth": "1998-01-01",
                "address": "123 Barangay Street",
                "barangay": "Pending",
                "proof": [
                    readable_image_upload("full.png"),
                    cropped_readable_image_upload("crop.png"),
                ],
                "terms_version": "2026-07-02",
                "privacy_version": "2026-07-02",
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["proof"][0], "Duplicate proof upload detected.")
        self.assertFalse(get_user_model().objects.filter(email="same-block-upload@example.com").exists())

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

    def test_resident_can_update_profile_fields(self):
        user = get_user_model().objects.create_user(
            email="profile-update@example.com",
            phone_number="+639241234568",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=user,
            first_name="Juan",
            middle_name="",
            last_name="Santos",
            date_of_birth="1998-01-01",
            address="Old address",
            barangay="Marikina Heights",
            gender="male",
        )
        self.client.force_authenticate(user)

        response = self.client.patch(
            "/api/auth/me/",
            {
                "first_name": "Maria",
                "middle_name": "Ana",
                "last_name": "Reyes",
                "address": "New address",
                "gender": "female",
                "avatar": "young-woman",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.resident_profile.first_name, "Maria")
        self.assertEqual(user.resident_profile.avatar, "young-woman")
        self.assertEqual(response.data["full_name"], "Maria Reyes")
        self.assertEqual(response.data["middleName"], "Ana")

    def test_resident_profile_update_rejects_invalid_name(self):
        user = get_user_model().objects.create_user(
            email="profile-invalid@example.com",
            phone_number="+639241234570",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        ResidentProfile.objects.create(
            user=user,
            first_name="Juan",
            middle_name="",
            last_name="Santos",
            date_of_birth="1998-01-01",
            address="Old address",
            barangay="Marikina Heights",
            gender="male",
        )
        self.client.force_authenticate(user)

        response = self.client.patch(
            "/api/auth/me/",
            {"first_name": "Ju@n"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["first_name"][0], "Use letters only, including Ñ/ñ.")

    def test_resident_settings_are_created_and_persisted(self):
        user = get_user_model().objects.create_user(
            email="settings@example.com",
            phone_number="+639241234569",
            password="Str0ng!Pass123",
            status=get_user_model().Status.VERIFIED,
        )
        self.client.force_authenticate(user)

        get_response = self.client.get("/api/auth/settings/")
        patch_response = self.client.patch(
            "/api/auth/settings/",
            {
                "push_alerts": False,
                "report_updates": True,
                "community_sharing": True,
                "location_confirmation": False,
            },
            format="json",
        )

        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        settings_obj = ResidentSettings.objects.get(user=user)
        self.assertFalse(settings_obj.push_alerts)
        self.assertTrue(settings_obj.community_sharing)
        self.assertFalse(settings_obj.location_confirmation)

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
        proof = proof_image_upload("proof.png")

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
            "email_otp_code": "123456",
            "phone_number": "+639261234568",
            "phone_otp_code": "123456",
            "password": "Str0ng!Pass123",
            "first_name": "Niño",
            "middle_name": "De La",
            "last_name": "Peña",
            "date_of_birth": "1998-01-01",
            "address": "123 Barangay Street",
            "barangay": "Pending",
            "proof": proof_image_upload("valid-name.png"),
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
            "proof": proof_image_upload("invalid-name.png"),
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
            status=get_user_model().Status.VERIFIED,
        )
        official = get_user_model().objects.create_user(
            email="official-perms@example.com",
            phone_number="+639311234567",
            password="Str0ng!Pass123",
            role=get_user_model().Role.BARANGAY_OFFICIAL,
            status=get_user_model().Status.VERIFIED,
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
        """The configured 5/min rate throttles the sixth development request."""
        responses = [
            self.client.post(
                "/api/auth/register/phone-otp/request/",
                {"phone_number": f"+63934{index:07d}"},
                format="json",
            )
            for index in range(6)
        ]

        for i in range(5):
            self.assertEqual(responses[i].status_code, status.HTTP_200_OK, f"request {i} should succeed")
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

@DEBUG_ALL
class PhaseOneBAccountAPITests(APITestCase):
    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.resident = User.objects.create_user(
            email="phase1b-resident@example.com",
            phone_number="+639351234567",
            password="Str0ng!Pass123",
            status=User.Status.PENDING_VERIFICATION,
        )
        ResidentProfile.objects.create(
            user=self.resident,
            first_name="Cardu",
            last_name="Dalisay",
            date_of_birth="1998-01-01",
            address="Marikina Heights",
            barangay="Marikina Heights",
        )
        self.official = User.objects.create_user(
            email="phase1b-official@example.com",
            phone_number="+639351234568",
            password="Str0ng!Pass123",
            role=User.Role.BARANGAY_OFFICIAL,
            status=User.Status.VERIFIED,
        )
        self.responder = User.objects.create_user(
            email="phase1b-responder@example.com",
            phone_number="+639351234569",
            password="Str0ng!Pass123",
            role=User.Role.FIRST_RESPONDER,
            status=User.Status.VERIFIED,
            responder_unit=User.ResponderUnit.TANOD,
        )

    def test_official_can_review_account_request(self):
        account_request = AccountRequest.objects.create(user=self.resident, type=AccountRequest.Type.DATA_EXPORT)
        self.client.force_authenticate(self.official)

        list_response = self.client.get("/api/auth/account-requests/manage/?status=submitted")
        review_response = self.client.patch(
            f"/api/auth/account-requests/{account_request.pk}/review/",
            {"status": AccountRequest.Status.COMPLETED, "staff_note": "Export prepared."},
            format="json",
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data[0]["id"], account_request.pk)
        self.assertEqual(review_response.status_code, status.HTTP_200_OK)
        account_request.refresh_from_db()
        self.assertEqual(account_request.status, AccountRequest.Status.COMPLETED)
        self.assertEqual(account_request.reviewed_by, self.official)

    def test_official_can_list_and_update_residents_and_responders(self):
        self.client.force_authenticate(self.official)

        residents = self.client.get("/api/auth/residents/?q=Cardu")
        resident_update = self.client.patch(
            f"/api/auth/residents/{self.resident.pk}/status/",
            {"status": get_user_model().Status.VERIFIED},
            format="json",
        )
        responders = self.client.get("/api/auth/responders/?unit=tanod")
        responder_update = self.client.patch(
            f"/api/auth/responders/{self.responder.pk}/",
            {"responder_unit": "bhw", "is_on_duty": True},
            format="json",
        )

        self.assertEqual(residents.status_code, status.HTTP_200_OK)
        self.assertEqual(residents.data[0]["id"], self.resident.pk)
        self.assertEqual(resident_update.data["status"], get_user_model().Status.VERIFIED)
        self.assertEqual(responders.status_code, status.HTTP_200_OK)
        self.assertEqual(responders.data[0]["id"], self.responder.pk)
        self.assertEqual(responder_update.data["responder_unit"], "bhw")
        self.assertTrue(responder_update.data["is_on_duty"])
