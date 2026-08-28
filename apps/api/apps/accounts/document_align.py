"""Put a submitted ID into the same frame as the barangay's stored sample.

Field regions are drawn on the sample in Mark Areas and stored as fractions of
that image. Applying them to a submission only works if the two pictures frame
the card the same way — and a phone photo never does. The card sits somewhere
else, at another size, rotated a quarter turn because the resident held the
phone upright over a landscape card, tilted a few degrees, cropped tighter or
looser. Every one of those shifts the box labelled "Full Name" onto whatever
happens to be at that fraction of the frame, which is how a name box comes back
reading "MALE".

Deskewing does not fix this. It rectifies the card into a canonical rectangle of
its own choosing, which is a *different* frame from the sample's — so the code
that uses regions had to switch deskewing off, leaving raw phone photos to be
measured against a flat scan.

This aligns instead: find the same visual landmarks in both pictures, solve for
the transform between them, and warp the submission into the sample's exact
coordinate frame. Rotation, scale, translation, and perspective all fall out of
one homography, and the stored fractions then mean what they meant when they
were drawn.

Alignment is attempted, never assumed. Every failure — too few landmarks, an
implausible transform, a missing sample — returns the image untouched with a
reason, and the caller carries on with label-based extraction.
"""

from __future__ import annotations

import logging
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Long edge both images are scaled to before matching. Big enough for the small
# printed text on a barangay ID to survive as corners, small enough that ORB on
# a 12MP phone photo does not dominate the request.
WORK_LONG_EDGE = 1400

ORB_FEATURES = 5000
# Lowe's ratio. Loose enough for a blurry night photo of a laminated card,
# tight enough that repeated card guilloche patterns do not match each other.
RATIO_TEST = 0.78

MIN_GOOD_MATCHES = 18
MIN_INLIERS = 12
MIN_INLIER_RATIO = 0.30

# A real photo of the same card maps the sample's frame onto a convex quad
# covering a sensible part of it. These reject the folded, mirrored, or
# collapsed homographies RANSAC produces from coincidental matches.
MIN_MAPPED_AREA_RATIO = 0.25
MAX_MAPPED_AREA_RATIO = 4.0
MIN_MAPPED_EDGE_RATIO = 0.15


def _decode(content: bytes) -> np.ndarray | None:
    if not content:
        return None
    try:
        array = np.frombuffer(content, dtype=np.uint8)
        image = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if image is not None:
            return image
    except Exception:
        pass
    try:
        with Image.open(BytesIO(content)) as handle:
            return cv2.cvtColor(np.array(handle.convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception:
        return None


def _work_scale(image: np.ndarray) -> float:
    long_edge = max(image.shape[:2])
    if long_edge <= 0:
        return 1.0
    return min(1.0, WORK_LONG_EDGE / float(long_edge))


def _prepare(image: np.ndarray) -> tuple[np.ndarray, float]:
    """Grey, contrast-equalised, and scaled down. Returns (image, scale)."""
    scale = _work_scale(image)
    if scale < 1.0:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # The submission is a photo and the sample is usually a flat scan, so their
    # brightness and local contrast have nothing in common. CLAHE puts both on
    # comparable footing before corners are counted.
    return cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(grey), scale


def _homography_is_plausible(matrix: np.ndarray, sample_shape: tuple[int, int]) -> bool:
    """Reject transforms no photograph of the same card could produce."""
    height, width = sample_shape[:2]
    corners = np.array(
        [[0, 0], [width, 0], [width, height], [0, height]], dtype="float32"
    ).reshape(-1, 1, 2)
    try:
        mapped = cv2.perspectiveTransform(corners, matrix).reshape(-1, 2)
    except Exception:
        return False
    if not np.all(np.isfinite(mapped)):
        return False

    area = abs(cv2.contourArea(mapped.astype("float32")))
    sample_area = float(width * height)
    if sample_area <= 0:
        return False
    ratio = area / sample_area
    if ratio < MIN_MAPPED_AREA_RATIO or ratio > MAX_MAPPED_AREA_RATIO:
        return False

    hull = cv2.convexHull(mapped.astype("float32"))
    # A fold or a mirror loses a corner from the hull.
    if len(hull) < 4:
        return False

    edges = [float(np.linalg.norm(mapped[index] - mapped[(index + 1) % 4])) for index in range(4)]
    longest = max(edges)
    if longest <= 0 or min(edges) / longest < MIN_MAPPED_EDGE_RATIO:
        return False
    return True


def align_bgr_to_sample(
    submitted: np.ndarray, sample: np.ndarray
) -> tuple[np.ndarray, dict]:
    """Warp `submitted` into `sample`'s frame. Returns (image, meta)."""
    meta: dict = {"aligned": False, "reason": "not_attempted", "matches": 0, "inliers": 0}
    if submitted is None or sample is None or submitted.size == 0 or sample.size == 0:
        meta["reason"] = "empty_image"
        return submitted, meta

    try:
        submitted_grey, submitted_scale = _prepare(submitted)
        sample_grey, sample_scale = _prepare(sample)

        orb = cv2.ORB_create(nfeatures=ORB_FEATURES, scaleFactor=1.2, nlevels=10)
        submitted_kp, submitted_desc = orb.detectAndCompute(submitted_grey, None)
        sample_kp, sample_desc = orb.detectAndCompute(sample_grey, None)
        if submitted_desc is None or sample_desc is None:
            meta["reason"] = "no_features"
            return submitted, meta
        if len(submitted_kp) < MIN_GOOD_MATCHES or len(sample_kp) < MIN_GOOD_MATCHES:
            meta["reason"] = "too_few_features"
            return submitted, meta

        matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        pairs = matcher.knnMatch(submitted_desc, sample_desc, k=2)
        good = [
            pair[0]
            for pair in pairs
            if len(pair) == 2 and pair[0].distance < RATIO_TEST * pair[1].distance
        ]
        meta["matches"] = len(good)
        if len(good) < MIN_GOOD_MATCHES:
            meta["reason"] = "too_few_matches"
            return submitted, meta

        # Back out of the working scale so the homography lands in full-resolution
        # sample pixels — the frame the region fractions were drawn against.
        source = np.float32(
            [submitted_kp[match.queryIdx].pt for match in good]
        ).reshape(-1, 1, 2) / submitted_scale
        destination = np.float32(
            [sample_kp[match.trainIdx].pt for match in good]
        ).reshape(-1, 1, 2) / sample_scale

        matrix, mask = cv2.findHomography(source, destination, cv2.RANSAC, 4.0, maxIters=4000)
        if matrix is None or mask is None:
            meta["reason"] = "no_homography"
            return submitted, meta
        inliers = int(mask.sum())
        meta["inliers"] = inliers
        meta["inlier_ratio"] = round(inliers / float(len(good)), 3)
        if inliers < MIN_INLIERS or meta["inlier_ratio"] < MIN_INLIER_RATIO:
            meta["reason"] = "weak_homography"
            return submitted, meta
        if not _homography_is_plausible(matrix, sample.shape):
            meta["reason"] = "implausible_homography"
            return submitted, meta

        height, width = sample.shape[:2]
        warped = cv2.warpPerspective(
            submitted,
            matrix,
            (width, height),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE,
        )
        if float(cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY).std()) < 8:
            meta["reason"] = "blank_warp"
            return submitted, meta

        meta["aligned"] = True
        meta["reason"] = "homography"
        meta["width"] = int(width)
        meta["height"] = int(height)
        return warped, meta
    except Exception:
        logger.exception("ID alignment failed")
        meta["reason"] = "error"
        return submitted, meta


def align_bytes_to_sample(submitted: bytes, sample: bytes) -> tuple[bytes, dict]:
    """Byte-level wrapper. Returns the original bytes whenever alignment fails."""
    meta = {"aligned": False, "reason": "decode_failed", "matches": 0, "inliers": 0}
    submitted_bgr = _decode(submitted)
    sample_bgr = _decode(sample)
    if submitted_bgr is None or sample_bgr is None:
        return submitted, meta
    warped, meta = align_bgr_to_sample(submitted_bgr, sample_bgr)
    if not meta.get("aligned"):
        return submitted, meta
    ok, encoded = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 94])
    if not ok:
        return submitted, {**meta, "aligned": False, "reason": "encode_failed"}
    return encoded.tobytes(), meta


def sample_bytes_for_side(document_type, side: str | None) -> bytes | None:
    """The stored Mark Areas photo the regions for `side` were drawn on.

    A front and a back are different frames. Never use a sample from the other
    side: doing so can move field regions onto unrelated parts of the photo and
    makes the OCR path disagree with the picture-check path. A synthetic card
    is still allowed only when it belongs to the requested side; it is drawn to
    exercise field boxes, not to look like the genuine article.
    """
    if document_type is None:
        return None
    wanted = (side or "").strip().lower()
    candidates: list = []
    try:
        samples = list(document_type.samples.filter(is_active=True))
    except Exception:
        samples = []

    if wanted in {"front", "back", "single"}:
        samples = [
            sample
            for sample in samples
            if ((getattr(sample, "metadata", None) or {}).get("side") or getattr(sample, "name", "") or "")
            .strip()
            .lower()
            == wanted
        ]

    def rank(sample):
        return (1 if getattr(sample, "is_synthetic", False) else 0, getattr(sample, "name", ""))

    for sample in sorted(samples, key=rank):
        if sample.file:
            candidates.append(sample.file)
    legacy = getattr(document_type, "sample_file", None)
    if legacy and wanted in {"", "front", "single"}:
        candidates.append(legacy)

    for field_file in candidates:
        try:
            with field_file.open("rb") as handle:
                content = handle.read()
        except Exception:
            continue
        if content:
            return content
    return None
