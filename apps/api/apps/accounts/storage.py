"""Local, Supabase, or temporary Cloudinary media storage."""

import mimetypes
from pathlib import PurePosixPath
from urllib.parse import quote

import httpx
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage, Storage


BACKEND = getattr(settings, "STORAGE_BACKEND", "local")

if BACKEND == "cloudinary":
    from cloudinary_storage.storage import (
        MediaCloudinaryStorage as _PublicBase,
        RawMediaCloudinaryStorage as _PrivateBase,
    )
else:
    _PublicBase = _PrivateBase = FileSystemStorage


class _SupabaseStorage(Storage):
    bucket = ""

    @property
    def _headers(self):
        key = settings.SUPABASE_SECRET_KEY
        return {"Authorization": f"Bearer {key}", "apikey": key}

    def _endpoint(self, action, name):
        safe_name = quote(str(name).lstrip("/"), safe="/")
        return f"{settings.SUPABASE_URL}/storage/v1/object/{action}/{self.bucket}/{safe_name}"

    def _save(self, name, content):
        content.seek(0)
        content_type = getattr(content, "content_type", None) or mimetypes.guess_type(name)[0]
        response = httpx.post(
            self._endpoint("", name).replace("/object//", "/object/"),
            content=content.read(),
            headers={
                **self._headers,
                "content-type": content_type or "application/octet-stream",
                "x-upsert": "false",
            },
            timeout=60,
        )
        response.raise_for_status()
        return name

    def _open(self, name, mode="rb"):
        response = httpx.get(self._endpoint("authenticated", name), headers=self._headers, timeout=60)
        response.raise_for_status()
        return ContentFile(response.content, name=name)

    def _metadata(self, name):
        path = PurePosixPath(str(name).lstrip("/"))
        parent = "" if str(path.parent) == "." else str(path.parent)
        response = httpx.post(
            f"{settings.SUPABASE_URL}/storage/v1/object/list/{self.bucket}",
            json={"prefix": parent, "search": path.name, "limit": 100, "offset": 0},
            headers=self._headers,
            timeout=20,
        )
        response.raise_for_status()
        return next((item for item in response.json() if item.get("name") == path.name), None)

    def exists(self, name):
        return self._metadata(name) is not None

    def delete(self, name):
        if not name:
            return
        response = httpx.request(
            "DELETE",
            f"{settings.SUPABASE_URL}/storage/v1/object/{self.bucket}",
            json={"prefixes": [str(name).lstrip("/")]},
            headers=self._headers,
            timeout=30,
        )
        response.raise_for_status()

    def size(self, name):
        item = self._metadata(name)
        if item is None:
            raise FileNotFoundError(name)
        return int((item.get("metadata") or {}).get("size", 0))

    def get_modified_time(self, name):
        raise NotImplementedError

    def signed_url(self, name, expires_in=300):
        response = httpx.post(
            self._endpoint("sign", name),
            json={"expiresIn": int(expires_in)},
            headers=self._headers,
            timeout=20,
        )
        response.raise_for_status()
        path = response.json().get("signedURL") or response.json().get("signedUrl")
        if not path:
            raise ValueError("Supabase did not return a signed URL.")
        return path if path.startswith("http") else f"{settings.SUPABASE_URL}/storage/v1{path}"


class PublicMediaStorage(_PublicBase if BACKEND != "supabase" else _SupabaseStorage):
    bucket = getattr(settings, "SUPABASE_PROTECTED_BUCKET", "protected-photos")

    def __init__(self, *args, **kwargs):
        if BACKEND in {"cloudinary", "supabase"}:
            super().__init__()
            return
        kwargs.setdefault("location", settings.MEDIA_ROOT)
        kwargs.setdefault("base_url", settings.MEDIA_URL)
        super().__init__(*args, **kwargs)

    if BACKEND == "supabase":
        def url(self, name):
            return self.signed_url(name, settings.SUPABASE_SIGNED_URL_TTL_SECONDS)


class PrivateMediaStorage(_PrivateBase if BACKEND != "supabase" else _SupabaseStorage):
    bucket = getattr(settings, "SUPABASE_ORIGINAL_BUCKET", "original-photos")

    def __init__(self, *args, **kwargs):
        if BACKEND in {"cloudinary", "supabase"}:
            super().__init__()
            return
        kwargs.setdefault("location", settings.PRIVATE_MEDIA_ROOT)
        kwargs.setdefault("base_url", None)
        super().__init__(*args, **kwargs)

    if BACKEND == "cloudinary":
        def get_upload_options(self):
            return {"type": "authenticated", "invalidate": True}

        def _upload(self, name, content):
            import cloudinary.uploader

            return cloudinary.uploader.upload(
                content,
                public_id=name,
                resource_type=self._get_resource_type(),
                **self.get_upload_options(),
            )

    def url(self, name):
        raise ValueError("Private media must use an authenticated media view.")


def signed_private_url(name, *, expires_in=300):
    if BACKEND == "supabase":
        return PrivateMediaStorage().signed_url(name, expires_in)
    if BACKEND != "cloudinary":
        return None

    import time
    import cloudinary.utils

    public_id, _, extension = name.rpartition(".")
    return cloudinary.utils.private_download_url(
        public_id or name,
        extension or "",
        resource_type="raw",
        type="authenticated",
        expires_at=int(time.time()) + int(expires_in),
    )
