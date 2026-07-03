from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PublicMediaStorage(FileSystemStorage):
    """Store generated safe previews under public MEDIA_ROOT."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("location", settings.MEDIA_ROOT)
        kwargs.setdefault("base_url", settings.MEDIA_URL)
        super().__init__(*args, **kwargs)


class PrivateMediaStorage(FileSystemStorage):
    """Store raw sensitive uploads outside public MEDIA_URL."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("location", settings.PRIVATE_MEDIA_ROOT)
        kwargs.setdefault("base_url", None)
        super().__init__(*args, **kwargs)
