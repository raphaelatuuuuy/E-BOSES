from unittest.mock import Mock, patch

from django.core.files.base import ContentFile
from django.test import SimpleTestCase, override_settings

from .storage import _SupabaseStorage


class TestStorage(_SupabaseStorage):
    bucket = "original-photos"


@override_settings(
    SUPABASE_URL="https://project.supabase.co",
    SUPABASE_SECRET_KEY="sb_secret_test",
)
class SupabaseStorageTests(SimpleTestCase):
    @patch("apps.accounts.storage.httpx.post")
    def test_upload_keeps_private_bucket_path(self, post):
        missing = Mock()
        missing.raise_for_status.return_value = None
        missing.json.return_value = []
        uploaded = Mock()
        uploaded.raise_for_status.return_value = None
        post.side_effect = [missing, uploaded]
        name = TestStorage().save("raw/id image.png", ContentFile(b"image", name="id image.png"))
        self.assertEqual(name, "raw/id image.png")
        self.assertIn("/storage/v1/object/original-photos/raw/id%20image.png", post.call_args_list[1].args[0])
        self.assertEqual(post.call_args_list[1].kwargs["headers"]["content-type"], "image/png")

    @patch("apps.accounts.storage.httpx.post")
    def test_exists_uses_exact_object_listing(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [{"name": "id.png", "metadata": {"size": 12}}]
        post.return_value = response

        storage = TestStorage()
        self.assertTrue(storage.exists("raw/id.png"))
        self.assertEqual(storage.size("raw/id.png"), 12)
        self.assertEqual(post.call_args.kwargs["json"]["prefix"], "raw")

    @patch("apps.accounts.storage.httpx.request")
    def test_delete_uses_supabase_bulk_remove_endpoint(self, request):
        response = Mock()
        response.raise_for_status.return_value = None
        request.return_value = response

        TestStorage().delete("raw/id.png")

        self.assertEqual(request.call_args.args[0], "DELETE")
        self.assertEqual(request.call_args.kwargs["json"], {"prefixes": ["raw/id.png"]})

    @patch("apps.accounts.storage.httpx.post")
    def test_signed_url_is_short_lived(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"signedURL": "/object/sign/original-photos/raw/id.png?token=test"}
        post.return_value = response
        url = TestStorage().signed_url("raw/id.png", 60)
        self.assertTrue(url.startswith("https://project.supabase.co/storage/v1/object/sign/"))
        self.assertEqual(post.call_args.kwargs["json"], {"expiresIn": 60})

    @patch("apps.accounts.storage.httpx.get")
    def test_download_returns_file_content(self, get):
        response = Mock(content=b"private-image")
        response.raise_for_status.return_value = None
        get.return_value = response
        with TestStorage().open("raw/id.png", "rb") as file:
            self.assertEqual(file.read(), b"private-image")
