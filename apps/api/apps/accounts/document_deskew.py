"""Detect ID-card-like rectangles and perspective-warp them for OCR.

Goal: if a user uploads a photo where the barangay ID is small, tilted, or
off-center, crop/warp it to a flat card image so template field regions align
better. If no reliable card is found, return the original image unchanged.
"""

from __future__ import annotations

import logging
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Typical PH ID / barangay card aspect (width / height), landscape
CARD_ASPECT = 1.586
# Output size for warped card (enough for OCR, not huge)
OUT_WIDTH = 1200
OUT_HEIGHT = int(OUT_WIDTH / CARD_ASPECT)

# Contour must cover at least this fraction of the frame to count as "the card"
MIN_AREA_RATIO = 0.08
MAX_AREA_RATIO = 0.98
# Acceptable aspect range for a candidate quad
MIN_ASPECT = 1.15
MAX_ASPECT = 2.2


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as TL, TR, BR, BL."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _quad_aspect(pts: np.ndarray) -> float:
    ordered = _order_points(pts.astype("float32"))
    (tl, tr, br, bl) = ordered
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    w = max(width_a, width_b)
    h = max(height_a, height_b)
    if h < 1:
        return 0.0
    return float(w / h)


def _warp_quad(image: np.ndarray, pts: np.ndarray) -> np.ndarray:
    ordered = _order_points(pts.astype("float32"))
    dst = np.array(
        [
            [0, 0],
            [OUT_WIDTH - 1, 0],
            [OUT_WIDTH - 1, OUT_HEIGHT - 1],
            [0, OUT_HEIGHT - 1],
        ],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(ordered, dst)
    return cv2.warpPerspective(
        image,
        matrix,
        (OUT_WIDTH, OUT_HEIGHT),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _score_quad(pts: np.ndarray, image_area: float) -> float:
    area = abs(cv2.contourArea(pts))
    if image_area <= 0:
        return 0.0
    area_ratio = area / image_area
    if area_ratio < MIN_AREA_RATIO or area_ratio > MAX_AREA_RATIO:
        return 0.0
    aspect = _quad_aspect(pts)
    if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
        # Also try inverted (portrait photo of landscape card)
        if aspect > 0:
            inv = 1.0 / aspect
            if inv < MIN_ASPECT or inv > MAX_ASPECT:
                return 0.0
            aspect = inv
        else:
            return 0.0
    # Prefer area close to filling frame and aspect near card ratio
    aspect_score = 1.0 - min(1.0, abs(aspect - CARD_ASPECT) / CARD_ASPECT)
    area_score = min(1.0, area_ratio / 0.55)
    return float(0.55 * area_score + 0.45 * aspect_score)


def _find_card_quad(bgr: np.ndarray) -> np.ndarray | None:
    """Return best 4-point card contour or None."""
    h, w = bgr.shape[:2]
    image_area = float(h * w)

    # Work on a moderate scale for stable edges
    scale = 1.0
    max_side = max(h, w)
    if max_side > 1400:
        scale = 1400.0 / max_side
        small = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    else:
        small = bgr

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    candidates: list[tuple[float, np.ndarray]] = []

    # Strategy A: Canny + morphology
    for low, high in ((40, 120), (60, 180), (30, 90)):
        edges = cv2.Canny(gray, low, high)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        edges = cv2.dilate(edges, kernel, iterations=1)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:25]:
            peri = cv2.arcLength(cnt, True)
            if peri < 50:
                continue
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            if len(approx) != 4 or not cv2.isContourConvex(approx):
                continue
            pts = approx.reshape(4, 2).astype("float32")
            # Map back to original scale
            if scale != 1.0:
                pts = pts / scale
            score = _score_quad(pts, image_area)
            if score > 0.25:
                candidates.append((score, pts))

    # Strategy B: adaptive threshold (helps low-contrast cards)
    thr = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7
    )
    thr = cv2.bitwise_not(thr)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    thr = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(thr, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:20]:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.025 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        pts = approx.reshape(4, 2).astype("float32")
        if scale != 1.0:
            pts = pts / scale
        score = _score_quad(pts, image_area)
        if score > 0.25:
            candidates.append((score, pts))

    # Strategy C: minAreaRect of largest contour as fallback quad
    if not candidates:
        edges = cv2.Canny(gray, 50, 150)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            cnt = max(contours, key=cv2.contourArea)
            rect = cv2.minAreaRect(cnt)
            box = cv2.boxPoints(rect).astype("float32")
            if scale != 1.0:
                box = box / scale
            score = _score_quad(box, image_area)
            if score > 0.2:
                candidates.append((score, box))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def deskew_id_card_bgr(bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    """Warp card if found. Returns (image, meta)."""
    meta = {"deskewed": False, "score": 0.0, "reason": "no_card"}
    if bgr is None or bgr.size == 0:
        return bgr, meta
    try:
        quad = _find_card_quad(bgr)
        if quad is None:
            return bgr, meta
        score = _score_quad(quad, float(bgr.shape[0] * bgr.shape[1]))
        meta["score"] = round(score, 4)
        if score < 0.28:
            meta["reason"] = "low_score"
            return bgr, meta
        warped = _warp_quad(bgr, quad)
        # Reject warp if result is almost blank / extremely dark
        gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        if float(gray.std()) < 8:
            meta["reason"] = "blank_warp"
            return bgr, meta
        meta["deskewed"] = True
        meta["reason"] = "warped"
        return warped, meta
    except Exception:
        logger.exception("document deskew failed")
        meta["reason"] = "error"
        return bgr, meta


def enhance_for_ocr_bgr(bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    """Improve text contrast/sharpness without geometric warp (safe with region boxes).

    - Upscale very small phone frames
    - CLAHE on L channel (local contrast)
    - Mild unsharp mask for thin printed text
    """
    meta: dict = {"enhanced": False, "upscaled": False, "reason": "noop"}
    if bgr is None or bgr.size == 0:
        return bgr, meta
    try:
        out = bgr
        h, w = out.shape[:2]
        min_edge = min(h, w)
        # Prefer ~1000px short edge for PaddleOCR on small camera crops
        if min_edge < 1000:
            scale = 1000.0 / float(min_edge)
            # Cap so huge upscales of tiny blur don't explode memory
            scale = min(scale, 2.5)
            out = cv2.resize(
                out,
                None,
                fx=scale,
                fy=scale,
                interpolation=cv2.INTER_CUBIC,
            )
            meta["upscaled"] = True
            meta["scale"] = round(scale, 3)

        lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB)
        l_ch, a_ch, b_ch = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
        l_ch = clahe.apply(l_ch)
        lab = cv2.merge([l_ch, a_ch, b_ch])
        enhanced = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

        # Unsharp mask — mild so we don't invent artifacts
        blur = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=1.15)
        sharpened = cv2.addWeighted(enhanced, 1.4, blur, -0.4, 0)

        # Gentle denoise that keeps edges (helps ISO-noisy phone shots)
        cleaned = cv2.bilateralFilter(sharpened, d=5, sigmaColor=40, sigmaSpace=40)

        meta["enhanced"] = True
        meta["reason"] = "clahe_unsharp"
        meta["width"] = int(cleaned.shape[1])
        meta["height"] = int(cleaned.shape[0])
        return cleaned, meta
    except Exception:
        logger.exception("OCR enhance failed")
        meta["reason"] = "error"
        return bgr, meta


def enhance_for_ocr_bytes(content: bytes) -> tuple[bytes, dict]:
    """Enhance JPEG/PNG bytes for OCR. Geometry unchanged (region boxes stay valid)."""
    meta = {"enhanced": False, "reason": "decode_failed"}
    if not content:
        return content, meta
    try:
        arr = np.frombuffer(content, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            with Image.open(BytesIO(content)) as im:
                im = im.convert("RGB")
                rgb = np.array(im)
                bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        enhanced, meta = enhance_for_ocr_bgr(bgr)
        ok, encoded = cv2.imencode(
            ".jpg",
            enhanced,
            [int(cv2.IMWRITE_JPEG_QUALITY), 93],
        )
        if not ok:
            meta["reason"] = "encode_failed"
            return content, meta
        return encoded.tobytes(), meta
    except Exception:
        logger.exception("enhance_for_ocr_bytes failed")
        return content, {"enhanced": False, "reason": "error"}


def deskew_id_card_bytes(content: bytes) -> tuple[bytes, dict]:
    """Deskew JPEG/PNG bytes; returns (jpeg_bytes, meta). Always JPEG output."""
    meta = {"deskewed": False, "score": 0.0, "reason": "decode_failed"}
    if not content:
        return content, meta
    try:
        arr = np.frombuffer(content, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            # Pillow fallback
            with Image.open(BytesIO(content)) as im:
                im = im.convert("RGB")
                rgb = np.array(im)
                bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        warped, meta = deskew_id_card_bgr(bgr)
        ok, encoded = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        if not ok:
            return content, {**meta, "reason": "encode_failed"}
        return encoded.tobytes(), meta
    except Exception:
        logger.exception("deskew_id_card_bytes failed")
        return content, {"deskewed": False, "score": 0.0, "reason": "error"}
