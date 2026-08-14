"""Produce the protected public copy of a concern photo.

Called from a Celery task after Gemma has decided a scan is warranted, and again
whenever an official draws their own blur box.

The single invariant: **`preview_file` is never a copy of the original.** Every
path through this module re-encodes the image, strips EXIF, and either bakes in
the blur or leaves the media non-public. There is no branch that hands the
untouched upload to the public feed.

`public_visible` and `privacy_state` are always written together, so a
half-finished or crashed run leaves the media restricted rather than exposed.
"""

from __future__ import annotations

import hashlib
import logging
from io import BytesIO

from django.core.files.base import ContentFile
from django.utils import timezone
from PIL import Image, ImageOps

from apps.concerns.models import ConcernMedia, ConcernMediaRedaction

from .masks import Region, blur_regions, detected_classes, parse_regions
from .sam3_client import Sam3NotConfigured, Sam3Unavailable, run_segmentation


logger = logging.getLogger(__name__)

# Bump when the blur, padding or encoding changes so cached results are
# recomputed rather than trusted.
PROCESSOR_VERSION = "sam3-v1"

PREVIEW_MAX_SIDE = 1600
PREVIEW_QUALITY = 84

# Substring match: Gemma may name it "blood", "blood stain", "blood spatter".
BLOOD_CLASS = "blood"


def privacy_cache_key(media, classes) -> str:
    """Identity of one privacy run: this image, these classes, this processor."""
    parts = f"{media.sha256_hash}|{','.join(sorted(classes))}|{PROCESSOR_VERSION}"
    return hashlib.sha256(parts.encode("utf-8")).hexdigest()


def _load_image(media):
    with media.file.open("rb") as handle:
        raw = handle.read()
    with Image.open(BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((PREVIEW_MAX_SIDE, PREVIEW_MAX_SIDE), Image.Resampling.LANCZOS)
        # load() before the context manager closes the underlying file.
        image.load()
    return image


def _write_preview(media, image) -> None:
    output = BytesIO()
    image.save(output, format="JPEG", quality=PREVIEW_QUALITY, optimize=True)
    if media.preview_file:
        media.preview_file.delete(save=False)
    media.preview_file.save(
        f"protected-{media.pk}.jpg",
        ContentFile(output.getvalue()),
        save=False,
    )


def _official_regions(media) -> list[Region]:
    return [
        Region(
            x=row.x,
            y=row.y,
            width=row.width,
            height=row.height,
            label=row.label,
            source=ConcernMediaRedaction.Source.OFFICIAL,
        )
        for row in media.redactions.filter(source=ConcernMediaRedaction.Source.OFFICIAL)
    ]


def _finish(media, *, state, public, regions=None, detected=None, failure=None, cache_key="") -> ConcernMedia:
    media.privacy_state = state
    media.public_visible = public
    media.privacy_regions = [region.as_dict() for region in (regions or [])]
    media.privacy_detected_classes = detected if detected is not None else []
    media.privacy_failure = failure or {}
    media.privacy_cache_key = cache_key
    media.privacy_processed_at = timezone.now()
    media.save(
        update_fields=[
            "preview_file",
            "privacy_state",
            "public_visible",
            "privacy_regions",
            "privacy_detected_classes",
            "privacy_failure",
            "privacy_cache_key",
            "privacy_processed_at",
        ]
    )
    return media


def _restrict(media, *, state, reason: str) -> ConcernMedia:
    """Fail closed.

    The protected copy is still written — a sanitized, re-encoded render with
    any regions we do have blurred in — but it is not published. Officials view
    the original through the audited raw endpoint.
    """
    try:
        image = _load_image(media)
        _write_preview(media, blur_regions(image, _official_regions(media)))
    except Exception as exc:
        logger.warning(
            "Could not render restricted preview for media=%s error=%s",
            media.pk,
            exc.__class__.__name__,
        )
    return _finish(
        media,
        state=state,
        public=False,
        regions=_official_regions(media),
        detected=list(media.privacy_detected_classes or []),
        failure={"reason": reason, "at": timezone.now().isoformat()},
    )



def process_media_privacy(media, *, requested_classes: list[str], force: bool = False) -> ConcernMedia:
    """Run SAM3 for `requested_classes` and write the protected copy."""
    classes = list(requested_classes or [])
    cache_key = privacy_cache_key(media, classes)

    terminal_success = {
        ConcernMedia.PrivacyState.PROTECTED,
        ConcernMedia.PrivacyState.SENSITIVE_REVIEW_REQUIRED,
        ConcernMedia.PrivacyState.NO_MATCH_FOUND,
    }
    if not force and media.privacy_cache_key == cache_key and media.privacy_state in terminal_success:
        # Same image, same classes, same processor, and it worked last time.
        # Calling Roboflow again would cost money to produce the same masks.
        return media

    media.privacy_state = ConcernMedia.PrivacyState.PROCESSING
    media.privacy_requested_classes = classes
    media.public_visible = False
    media.save(update_fields=["privacy_state", "privacy_requested_classes", "public_visible"])

    try:
        image = _load_image(media)
    except Exception as exc:
        logger.warning("Concern media %s could not be decoded for privacy processing: %s", media.pk, exc.__class__.__name__)
        return _restrict(media, state=ConcernMedia.PrivacyState.FAILED_RESTRICTED, reason="image_unreadable")

    try:
        payload = run_segmentation(media.file.path, classes)
    except Sam3NotConfigured:
        return _restrict(media, state=ConcernMedia.PrivacyState.FAILED_RESTRICTED, reason="media_protection_not_configured")
    except Sam3Unavailable as exc:
        return _restrict(media, state=ConcernMedia.PrivacyState.FAILED_RESTRICTED, reason=f"sam3_unavailable:{exc}")

    width, height = image.size
    sam3_regions = parse_regions(payload, image_width=width, image_height=height)
    found = detected_classes(sam3_regions)

    # Blood-like content is never treated as confirmed. It is a reason to keep
    # the image away from the public feed until a person looks at it, not a
    # finding to act on.
    blood_suspected = any(BLOOD_CLASS in name for name in classes)
    blood_found = any(BLOOD_CLASS in (region.label or "") or "blood" in (region.label or "") for region in sam3_regions)

    # Only face and plate masks are blurred. A blood region is not something we
    # can responsibly decide to hide or to show, so it gates visibility instead.
    blurrable = [region for region in sam3_regions if "blood" not in (region.label or "")]
    regions = blurrable + _official_regions(media)

    try:
        protected = blur_regions(image, regions)
        _write_preview(media, protected)
    except Exception as exc:
        logger.warning("Blur failed for media=%s error=%s", media.pk, exc.__class__.__name__)
        return _restrict(media, state=ConcernMedia.PrivacyState.FAILED_RESTRICTED, reason="blur_failed")

    if blood_found or (blood_suspected and not sam3_regions):
        # Suspected blood with nothing else confirmed still gets held: "we
        # looked and found nothing" is not a claim we can make about an image
        # flagged for possible injury.
        return _finish(
            media,
            state=ConcernMedia.PrivacyState.SENSITIVE_REVIEW_REQUIRED,
            public=False,
            regions=regions,
            detected=found,
            cache_key=cache_key,
        )

    if not blurrable:
        return _finish(
            media,
            state=ConcernMedia.PrivacyState.NO_MATCH_FOUND,
            public=False,
            regions=regions,
            detected=found,
            cache_key=cache_key,
        )

    _sync_sam3_redaction_rows(media, blurrable)
    return _finish(
        media,
        state=ConcernMedia.PrivacyState.PROTECTED,
        public=True,
        regions=regions,
        detected=found,
        cache_key=cache_key,
    )


def _sync_sam3_redaction_rows(media, regions: list[Region]) -> None:
    """Replace the automatic rows; official rows are never touched here."""
    media.redactions.filter(source=ConcernMediaRedaction.Source.SAM3).delete()
    ConcernMediaRedaction.objects.bulk_create(
        [
            ConcernMediaRedaction(
                media=media,
                x=region.x,
                y=region.y,
                width=region.width,
                height=region.height,
                label=region.label,
                source=ConcernMediaRedaction.Source.SAM3,
            )
            for region in regions
        ]
    )


def rerender_protected_copy(media) -> ConcernMedia:
    """Rebuild the protected copy from every stored region, automatic and manual.

    This is the path an official's manual blur takes. It never calls SAM3: the
    automatic regions are already on the row, so adding a box an official spotted
    costs nothing and cannot be blocked by Roboflow being down.
    """
    regions = [
        Region(x=row.x, y=row.y, width=row.width, height=row.height, label=row.label, source=row.source)
        for row in media.redactions.all()
    ]
    try:
        image = _load_image(media)
        _write_preview(media, blur_regions(image, regions))
    except Exception as exc:
        logger.warning("Manual re-render failed for media=%s error=%s", media.pk, exc.__class__.__name__)
        return _restrict(media, state=ConcernMedia.PrivacyState.FAILED_RESTRICTED, reason="rerender_failed")

    return _finish(
        media,
        state=ConcernMedia.PrivacyState.PROTECTED,
        public=True,
        regions=regions,
        detected=list(media.privacy_detected_classes or []),
        cache_key=media.privacy_cache_key,
    )
