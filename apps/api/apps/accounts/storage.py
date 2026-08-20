"""Local or temporary Cloudinary media storage."""

from django.conf import settings
from django.core.files.storage import FileSystemStorage


BACKEND = getattr(settings, "STORAGE_BACKEND", "local")

if BACKEND == "cloudinary":
    from cloudinary_storage.storage import (
        MediaCloudinaryStorage as _PublicBase,
        RawMediaCloudinaryStorage as _PrivateBase,
    )
else:
    _PublicBase = _PrivateBase = FileSystemStorage


class PublicMediaStorage(_PublicBase):
    def __init__(self, *args, **kwargs):
        if BACKEND == "cloudinary":
            super().__init__()
            return
        kwargs.setdefault("location", settings.MEDIA_ROOT)
        kwargs.setdefault("base_url", settings.MEDIA_URL)
        super().__init__(*args, **kwargs)


class PrivateMediaStorage(_PrivateBase):
    def __init__(self, *args, **kwargs):
        if BACKEND == "cloudinary":
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
