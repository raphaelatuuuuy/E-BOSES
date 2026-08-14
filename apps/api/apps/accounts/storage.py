"""Media storage.

Two guarantees, whichever backend is behind them:

- PublicMediaStorage: safe-to-publish derived files. Has a URL.
- PrivateMediaStorage: raw IDs and evidence. ``.url`` raises, so the only way
  to read one is the authenticated proxy views that check permission and audit.

Cloudinary is used when CLOUDINARY_URL is set, else local disk. Class names and
constructor signatures must not change: migrations bake in ``PrivateMediaStorage()``.
"""

from django.conf import settings
from django.core.files.storage import FileSystemStorage


USE_CLOUDINARY = bool(getattr(settings, "CLOUDINARY_URL", ""))

if USE_CLOUDINARY:
    from cloudinary_storage.storage import (
        MediaCloudinaryStorage as _PublicBase,
        RawMediaCloudinaryStorage as _PrivateBase,
    )
else:
    _PublicBase = _PrivateBase = FileSystemStorage


class PublicMediaStorage(_PublicBase):
    def __init__(self, *args, **kwargs):
        if USE_CLOUDINARY:
            super().__init__()
            return
        kwargs.setdefault("location", settings.MEDIA_ROOT)
        kwargs.setdefault("base_url", settings.MEDIA_URL)
        super().__init__(*args, **kwargs)


class PrivateMediaStorage(_PrivateBase):
    """Raw sensitive uploads. Never publicly addressable."""

    def __init__(self, *args, **kwargs):
        if USE_CLOUDINARY:
            super().__init__()
            return
        kwargs.setdefault("location", settings.PRIVATE_MEDIA_ROOT)
        kwargs.setdefault("base_url", None)
        super().__init__(*args, **kwargs)

    if USE_CLOUDINARY:

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
        raise ValueError(
            "Private media has no public URL. Serve it through the authenticated "
            "media views so access is checked and recorded."
        )


def signed_private_url(name, *, expires_in=300):
    """Short-lived signed URL for an authenticated asset, for server-side reads only."""
    if not USE_CLOUDINARY:
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
