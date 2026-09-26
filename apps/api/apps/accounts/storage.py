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

            # Callers often reuse one validated file object across two saves
            # (sample + legacy sync); upload from the start so the second
            # save is not an empty stream (Cloudinary 500s, disk writes 0B).
            if hasattr(content, "seek"):
                try:
                    content.seek(0)
                except Exception:
                    pass
            return cloudinary.uploader.upload(
                content,
                public_id=name,
                resource_type=self._get_resource_type(name),
                **self.get_upload_options(),
            )

    def url(self, name):
        raise ValueError("Private media must use an authenticated media view.")


def signed_private_url(name, *, expires_in=300):
    if BACKEND != "cloudinary":
        return None

    import time
    import cloudinary.utils
    from cloudinary_storage import app_settings as cloudinary_settings

    # Migrated rows store the bare field path (raw/...); the Cloudinary
    # backend prefixes every id (config/storage _prepend_prefix), and new
    # saves store the prefixed id. Normalise both to the stored form.
    name = name.replace("\\", "/")
    prefix = str(getattr(cloudinary_settings, "PREFIX", "media") or "media").strip("/")
    if prefix and not name.startswith(prefix + "/"):
        name = f"{prefix}/{name}"

    # Raw assets keep the extension inside the stored public id (the
    # uploader appends/keeps it), so the download lookup needs the full
    # name with an empty format; splitting the extension off 404s.
    return cloudinary.utils.private_download_url(
        name,
        "",
        resource_type="raw",
        type="authenticated",
        expires_at=int(time.time()) + int(expires_in),
    )
