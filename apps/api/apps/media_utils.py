"""Shared media hashing/dedup helpers.

Extracted from apps.accounts.services so that other apps (concerns,
emergencies) can import them without reaching into the accounts app's
internals. Pure functions, zero Django model dependencies.
"""

import hashlib
from io import BytesIO

import imagehash
from PIL import Image, ImageStat, UnidentifiedImageError


def sha256_file(uploaded_file):
    digest = hashlib.sha256()
    current_position = uploaded_file.tell() if hasattr(uploaded_file, "tell") else None
    for chunk in uploaded_file.chunks():
        digest.update(chunk)
    if hasattr(uploaded_file, "seek"):
        uploaded_file.seek(current_position or 0)
    return digest.hexdigest()


def phash_file(content: bytes) -> str:
    """Compute perceptual hash (pHash) for image dedup via visual similarity."""
    try:
        with Image.open(BytesIO(content)) as image:
            return str(imagehash.phash(image))
    except (UnidentifiedImageError, OSError, ValueError):
        return ""


PHASH_DUPLICATE_THRESHOLD = 10
PHASH_BLOCK_DUPLICATE_THRESHOLD = 4
PHASH_BLOCK_MIN_SIZE = 96
PHASH_BLOCK_MIN_STDDEV = 8


def is_similar_phash(left: str, right: str, *, threshold=PHASH_DUPLICATE_THRESHOLD) -> bool:
    if not left or not right:
        return False
    try:
        return imagehash.hex_to_hash(left) - imagehash.hex_to_hash(right) <= threshold
    except ValueError:
        return False


def _phash_regions(width: int, height: int):
    yield (0, 0, width, height)

    for ratio in (0.8, 0.6):
        crop_width = int(width * ratio)
        crop_height = int(height * ratio)
        left = (width - crop_width) // 2
        top = (height - crop_height) // 2
        yield (left, top, left + crop_width, top + crop_height)

    for grid in (2, 3):
        tile_width = width // grid
        tile_height = height // grid
        for row in range(grid):
            for col in range(grid):
                left = col * tile_width
                top = row * tile_height
                right = width if col == grid - 1 else left + tile_width
                bottom = height if row == grid - 1 else top + tile_height
                yield (left, top, right, bottom)


def phash_blocks_file(content: bytes) -> list[str]:
    try:
        with Image.open(BytesIO(content)) as image:
            image = image.convert("RGB")
            hashes = []
            for box in _phash_regions(*image.size):
                crop = image.crop(box)
                width, height = crop.size
                if width < PHASH_BLOCK_MIN_SIZE or height < PHASH_BLOCK_MIN_SIZE:
                    continue
                if ImageStat.Stat(crop.convert("L")).stddev[0] < PHASH_BLOCK_MIN_STDDEV:
                    continue
                hashes.append(str(imagehash.phash(crop)))
            return list(dict.fromkeys(hashes))
    except (UnidentifiedImageError, OSError, ValueError):
        return []


def has_similar_phash_block(phash: str, blocks: list[str]) -> bool:
    if not phash or not blocks:
        return False
    return any(
        is_similar_phash(phash, block, threshold=PHASH_BLOCK_DUPLICATE_THRESHOLD)
        for block in blocks
    )


# Multi-index banding (Norouzi et al.): a 64-bit hash split into m disjoint
# bands guarantees that any pair within Hamming distance t shares at least one
# identically-valued band, as long as t < m — pigeonhole, since every band
# would need at least one differing bit otherwise.
PHASH_FULL_BAND_BITS = [6] * 9 + [5] * 2  # threshold 10 -> 11 bands
PHASH_BLOCK_BAND_BITS = [13] * 4 + [12]  # threshold 4 -> 5 bands


def split_phash_bands(hash_hex: str, band_bits: list[int]) -> list[str]:
    """Positional band values of one pHash hex string.

    Returns [] for malformed hashes so callers can skip indexing instead of
    poisoning the lookup table with junk bands.
    """
    if not hash_hex or len(hash_hex) != 16:
        return []
    try:
        value = int(hash_hex, 16)
    except ValueError:
        return []
    bands = []
    offset = 0
    for bits in band_bits:
        mask = (1 << bits) - 1
        width = max(1, (bits + 3) // 4)
        bands.append(format((value >> offset) & mask, f"0{width}x"))
        offset += bits
    if offset != 64:
        return []
    return bands
