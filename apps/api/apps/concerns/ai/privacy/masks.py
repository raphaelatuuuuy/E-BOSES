"""Turn a SAM3 response into blur regions, and blur them.

Everything here is written to fail closed. A mask we cannot understand is
discarded rather than approximated, because an approximated face box that lands
slightly off is worse than no protection at all — it looks protected.

Regions are normalised to 0..1 before they are stored. The protected copy is a
resized JPEG, officials draw their own boxes on a scaled preview, and the
original may be any resolution; normalised coordinates are the only form that
survives all three.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.conf import settings


logger = logging.getLogger(__name__)

# A mask smaller than this is noise; larger than this is the model having
# selected essentially the whole photo, which blurs the evidence rather than
# the person.
#
# The ceiling is deliberately generous. A close-up portrait legitimately has a
# face filling most of the frame — a real 265x212 photo produced a 90%-confident
# face mask covering 41% of the image, which became 64% once padded, and a
# tighter ceiling threw it away and published the face unblurred. Rejecting a
# genuine detection is far worse than blurring slightly too much, so only a mask
# that covers almost everything is treated as meaningless.
MIN_AREA_RATIO = 0.0005
MAX_AREA_RATIO = 0.92
MIN_SIDE_PIXELS = 8


@dataclass(frozen=True)
class Region:
    """An area to blur: the exact segmentation mask when we have one, else a box.

    SAM3 is a segmentation model — it returns the outline of the thing, not just
    a rectangle around it. `mask_rle` keeps that outline (COCO run-length
    encoding, as Roboflow sends it) so the blur follows the face rather than
    covering a rectangle of surrounding wall and shoulder.

    The box is still carried alongside: it is what gets stored for the UI, what
    an official's manual blur produces, and the fallback whenever a mask is
    missing or will not decode.
    """

    x: float
    y: float
    width: float
    height: float
    label: str = ""
    source: str = "sam3"
    mask_rle: dict | None = None

    def as_dict(self) -> dict:
        payload = {
            "x": round(self.x, 6),
            "y": round(self.y, 6),
            "width": round(self.width, 6),
            "height": round(self.height, 6),
            "label": self.label,
            "source": self.source,
        }
        # Stored so a re-render (an official adding their own box later)
        # reproduces the same precise blur instead of degrading to rectangles.
        if self.mask_rle:
            payload["mask_rle"] = self.mask_rle
        return payload

    def to_pixels(self, image_width: int, image_height: int) -> tuple[int, int, int, int]:
        left = int(round(self.x * image_width))
        top = int(round(self.y * image_height))
        right = int(round((self.x + self.width) * image_width))
        bottom = int(round((self.y + self.height) * image_height))
        return (
            max(0, min(image_width, left)),
            max(0, min(image_height, top)),
            max(0, min(image_width, right)),
            max(0, min(image_height, bottom)),
        )


def decode_rle_mask(rle: dict):
    """Decode COCO compressed RLE into a boolean HxW numpy array.

    Roboflow returns `{"size": [height, width], "counts": "<ascii>"}` — the
    pycocotools format. Implemented here rather than pulling in pycocotools,
    which ships compiled extensions and is a heavy dependency for one function.

    Each count is written in 5-bit chunks: bit 0x20 continues the number, bit
    0x10 on the final chunk sign-extends it, and from the third value onwards
    counts are deltas against the value two positions back. The runs then
    alternate background/foreground down columns (Fortran order).

    Returns None on anything unexpected; the caller falls back to the box.
    """
    try:
        import numpy as np

        size = rle.get("size") or []
        counts = rle.get("counts")
        if len(size) != 2 or not isinstance(counts, str):
            return None
        height, width = int(size[0]), int(size[1])
        if height <= 0 or width <= 0:
            return None

        values: list[int] = []
        position = 0
        while position < len(counts):
            value = 0
            shift = 0
            more = True
            while more:
                char = ord(counts[position]) - 48
                value |= (char & 0x1F) << (5 * shift)
                more = char & 0x20
                position += 1
                shift += 1
                if not more and (char & 0x10):
                    value |= -1 << (5 * shift)
            if len(values) > 2:
                value += values[-2]
            values.append(value)

        flat = np.zeros(height * width, dtype=bool)
        index = 0
        filled = False
        for run in values:
            if run < 0:
                return None
            end = min(index + run, flat.size)
            if filled:
                flat[index:end] = True
            index = end
            filled = not filled
        return flat.reshape((height, width), order="F")
    except Exception:
        return None


def _finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _predictions_from(payload) -> list[dict]:
    """Find the prediction list wherever this workflow version puts it.

    Roboflow workflow outputs are keyed by the block name the workspace owner
    chose, so the shape is not fixed across workflows. Rather than hard-code one
    path and silently return nothing when it changes, walk the response for the
    first list of dicts that looks like predictions.
    """
    if isinstance(payload, list):
        if payload and all(isinstance(item, dict) for item in payload):
            return payload
        for item in payload:
            found = _predictions_from(item)
            if found:
                return found
        return []
    if not isinstance(payload, dict):
        return []

    for key in ("predictions", "segmentations", "masks", "outputs", "output", "result"):
        if key in payload:
            found = _predictions_from(payload[key])
            if found:
                return found
    for value in payload.values():
        if isinstance(value, (dict, list)):
            found = _predictions_from(value)
            if found:
                return found
    return []


def _polygon_points(prediction: dict) -> list:
    points = prediction.get("points")
    if isinstance(points, list):
        return points
    mask = prediction.get("mask")
    if isinstance(mask, dict) and isinstance(mask.get("points"), list):
        return mask["points"]
    return []


def _bounds_of(points: list) -> tuple[float, float, float, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    for point in points:
        if isinstance(point, dict):
            x, y = _finite(point.get("x")), _finite(point.get("y"))
        elif isinstance(point, (list, tuple)) and len(point) >= 2:
            x, y = _finite(point[0]), _finite(point[1])
        else:
            continue
        if x is not None and y is not None:
            xs.append(x)
            ys.append(y)
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def _box_from_prediction(prediction: dict) -> tuple[float, float, float, float] | None:
    """Read a box out of a prediction, whichever way this workflow expresses it.

    Segmentation gives a polygon, detection gives a centre plus size, and some
    blocks give corners. We only ever need the bounding box: the blur is applied
    to a padded rectangle, not to the mask outline, because a tight polygon blur
    leaves a recognisable silhouette.
    """
    polygon = _polygon_points(prediction)
    if len(polygon) >= 3:
        bounds = _bounds_of(polygon)
        if bounds is not None:
            return bounds

    # Roboflow's detection form: centre point plus size.
    centre_x = _finite(prediction.get("x"))
    centre_y = _finite(prediction.get("y"))
    box_width = _finite(prediction.get("width"))
    box_height = _finite(prediction.get("height"))
    if None not in (centre_x, centre_y, box_width, box_height):
        return centre_x - box_width / 2, centre_y - box_height / 2, box_width, box_height

    # Corner form.
    left = _finite(prediction.get("x1") or prediction.get("left"))
    top = _finite(prediction.get("y1") or prediction.get("top"))
    right = _finite(prediction.get("x2") or prediction.get("right"))
    bottom = _finite(prediction.get("y2") or prediction.get("bottom"))
    if None not in (left, top, right, bottom):
        return left, top, right - left, bottom - top

    return None


def parse_regions(payload, *, image_width: int, image_height: int) -> list[Region]:
    """Normalised, validated, padded regions. Unusable masks are dropped."""
    if image_width <= 0 or image_height <= 0:
        return []

    padding = max(0.0, min(0.5, float(getattr(settings, "EBOSES_PRIVACY_MASK_PADDING", 0.12))))
    regions: list[Region] = []

    for prediction in _predictions_from(payload):
        box = _box_from_prediction(prediction)
        if box is None:
            continue
        left, top, box_width, box_height = box
        if box_width <= 0 or box_height <= 0:
            continue

        # Some workflows emit 0..1 coordinates instead of pixels. A box whose
        # far edges both land inside the unit square cannot be pixel-space on
        # any real photo, so scale it up.
        if max(abs(left) + box_width, abs(top) + box_height) <= 1.5:
            left, top = left * image_width, top * image_height
            box_width, box_height = box_width * image_width, box_height * image_height

        if box_width < MIN_SIDE_PIXELS or box_height < MIN_SIDE_PIXELS:
            continue

        # Sanity-check what the model actually returned, before our own padding.
        # Judging the padded box meant our safety margin could disqualify a
        # detection the model was confident about — the padding is a deliberate
        # expansion on our side, not evidence about the mask.
        area_ratio = (box_width * box_height) / (image_width * image_height)
        if not (MIN_AREA_RATIO <= area_ratio <= MAX_AREA_RATIO):
            continue

        pad_x = box_width * padding
        pad_y = box_height * padding
        left = max(0.0, left - pad_x)
        top = max(0.0, top - pad_y)
        right = min(float(image_width), left + box_width + 2 * pad_x)
        bottom = min(float(image_height), top + box_height + 2 * pad_y)
        if right <= left or bottom <= top:
            continue

        mask_rle = prediction.get("rle_mask") or prediction.get("mask_rle")
        regions.append(
            Region(
                x=left / image_width,
                y=top / image_height,
                width=(right - left) / image_width,
                height=(bottom - top) / image_height,
                label=str(prediction.get("class") or prediction.get("class_name") or "").strip().lower(),
                source="sam3",
                mask_rle=mask_rle if isinstance(mask_rle, dict) else None,
            )
        )

    return regions


def detected_classes(regions: list[Region]) -> list[str]:
    return sorted({region.label for region in regions if region.label})


def blur_regions(image, regions: list[Region]):
    """Return a copy of `image` (a PIL RGB image) with each region blurred out.

    Where SAM3 gave us a segmentation mask, the blur follows that mask exactly —
    the face is covered, the wall behind it is not. Only regions with no usable
    mask (an official's hand-drawn box, or a prediction whose RLE would not
    decode) fall back to blurring the bounding rectangle.

    If cv2 cannot be imported the caller must treat the protection as failed;
    this function never silently returns the original.
    """
    import cv2
    import numpy as np

    if not regions:
        return image

    strength = int(getattr(settings, "EBOSES_PRIVACY_BLUR_STRENGTH", 31))
    padding = max(0.0, min(0.5, float(getattr(settings, "EBOSES_PRIVACY_MASK_PADDING", 0.12))))
    frame = np.asarray(image).copy()
    height, width = frame.shape[:2]

    # One blurred copy of the whole frame, composited through each mask. Two
    # passes: a single pass at this kernel still leaves recoverable structure
    # on a small face.
    kernel = max(3, strength if strength % 2 else strength - 1)
    blurred_frame = cv2.GaussianBlur(cv2.GaussianBlur(frame, (kernel, kernel), 0), (kernel, kernel), 0)

    combined = np.zeros((height, width), dtype=bool)
    for region in regions:
        mask = decode_rle_mask(region.mask_rle) if region.mask_rle else None
        if mask is not None:
            if mask.shape != (height, width):
                # The mask is sized to whatever SAM3 saw; the frame here may be
                # a resized preview.
                mask = np.asarray(
                    cv2.resize(mask.astype(np.uint8), (width, height), interpolation=cv2.INTER_NEAREST)
                ).astype(bool)
            # Grow the mask so the blur does not stop exactly at the outline —
            # a sharp silhouette is itself identifying.
            grow = max(3, int(round(min(width, height) * padding * 0.25)) | 1)
            mask = cv2.dilate(mask.astype(np.uint8), np.ones((grow, grow), np.uint8), iterations=1).astype(bool)
            combined |= mask
            continue

        left, top, right, bottom = region.to_pixels(width, height)
        if right - left < 2 or bottom - top < 2:
            continue
        combined[top:bottom, left:right] = True

    if not combined.any():
        return image

    frame[combined] = blurred_frame[combined]

    from PIL import Image

    return Image.fromarray(frame)
